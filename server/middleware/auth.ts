import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    username: string;
    role: "HEAD" | "CLASS" | "SUBJECT";
    assignedClassId?: number;
    assignedClassName?: string;
    assignedSubjectId?: number;
    assignedSubjectName?: string;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";
const JWT_ISSUER = process.env.JWT_ISSUER || "e-sba";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "e-sba-users";
const STACK_JWKS_URL =
  process.env.STACK_JWKS_URL ||
  process.env.NEON_STACK_JWKS_URL ||
  process.env.STACK_AUTH_JWKS_URL;

let jwksCache: {
  fetchedAt: number;
  keys: Array<Record<string, unknown>>;
} | null = null;

async function getJWKS(): Promise<Array<Record<string, unknown>>> {
  const maxAgeMs = 5 * 60 * 1000;
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < maxAgeMs) {
    return jwksCache.keys;
  }
  if (!STACK_JWKS_URL) {
    return [];
  }
  const res = await fetch(STACK_JWKS_URL);
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

function decodeHeader(token: string): { kid?: string; alg?: string } {
  const decoded = jwt.decode(token, { complete: true }) as {
    header?: { kid?: string; alg?: string };
  } | null;
  return decoded?.header || {};
}

async function verifyWithJWKS(
  token: string,
): Promise<AuthRequest["user"] | null> {
  try {
    const { kid } = decodeHeader(token);
    if (!kid) return null;
    const keys = await getJWKS();
    const jwk = keys.find((k) => (k as { kid?: string }).kid === kid);
    if (!jwk) return null;
    const keyObject = crypto.createPublicKey({
      key: jwk as unknown as Record<string, unknown>,
      format: "jwk",
    });
    const pem = keyObject.export({ type: "spki", format: "pem" }) as string;
    const payload = jwt.verify(token, pem, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["RS256"],
    }) as AuthRequest["user"];
    return payload;
  } catch {
    return null;
  }
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const localVerified = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as AuthRequest["user"];
    req.user = localVerified;
    return next();
  } catch {
    const extVerified = await verifyWithJWKS(token);
    if (!extVerified) {
      return res.status(403).json({ error: "Forbidden: Invalid token" });
    }
    req.user = extVerified;
    return next();
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }
    next();
  };
};
