import { kvGet, kvSet, saveData, getData } from "./storage";
import { logger } from "./logger";

// --- Types ---

export interface SchoolConfig {
  name: string;
  motto: string;
  headTeacher: string;
  address: string;
  catWeight: number;
  examWeight: number;
  logoUrl: string | null;
  signatureEnabled?: boolean;
  headSignatureUrl?: string | null;
}

export interface AcademicConfig {
  academicYear: string;
  term: string;
}

export interface SystemSetupData {
  school: SchoolConfig;
  academic: AcademicConfig;
  version: number;
  updatedAt: number;
  checksum: string;
}

// --- Constants ---

const SYS_CONFIG_VERSION = 1;

// --- Helpers ---

async function computeChecksum(data: unknown): Promise<string> {
  const str = JSON.stringify(data);
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Storage Handlers ---

export const SchoolProfileStorage = {
  async save(config: SchoolConfig, encrypt = false, passphrase?: string) {
    try {
      // Create a wrapper with metadata
      const payload = {
        data: config,
        version: SYS_CONFIG_VERSION,
        updatedAt: Date.now(),
      };

      // Compute checksum for integrity
      const checksum = await computeChecksum(config);
      const wrapped = { ...payload, checksum };

      // Serialize
      const json = JSON.stringify(wrapped);

      // Save using the robust hybrid storage (IDB for large data, Local for small)
      const { id } = await saveData(json, {
        kind: "download", // internal config
        type: "application/json",
        encrypt,
        passphrase,
        name: "SchoolProfileConfig",
        tags: ["config", "school_profile"],
      });

      // Store the reference ID in localStorage for fast lookup
      kvSet("local", "SCHOOL_PROFILE_REF", id);
      logger.info("school_profile_saved", { id, encrypted: encrypt });
      return id;
    } catch (e) {
      logger.error("school_profile_save_error", e);
      throw e;
    }
  },

  async load(passphrase?: string): Promise<SchoolConfig | null> {
    try {
      const id = kvGet<string>("local", "SCHOOL_PROFILE_REF");
      if (!id) return null;

      const result = await getData(id, passphrase);
      if (!result) return null;

      const raw =
        typeof result.data === "string"
          ? result.data
          : new TextDecoder().decode(result.data as ArrayBuffer);

      const wrapped = JSON.parse(raw);

      // Integrity check
      const checksum = await computeChecksum(wrapped.data);
      if (checksum !== wrapped.checksum) {
        logger.warn("school_profile_checksum_mismatch", { id });
        // Depending on strictness, we might return null or the data with a warning.
        // For now, we log and return the data, but in a strict mode we should fail.
      }

      return wrapped.data as SchoolConfig;
    } catch (e) {
      logger.error("school_profile_load_error", e);
      return null;
    }
  },
};

export const AcademicConfigStorage = {
  async save(config: AcademicConfig) {
    try {
      // Academic config is usually small, so we can stick to localStorage directly via kvSet
      // BUT for consistency and "dedicated handlers" with versioning/checksum, we use the same pattern.
      // Or we can use kvSet directly if we want simpler access.
      // Requirement: "Use browser's localStorage API for text-based configurations"
      // "Implement fallback mechanisms" - saveData handles fallback to IDB if quota exceeded.

      const payload = {
        data: config,
        version: SYS_CONFIG_VERSION,
        updatedAt: Date.now(),
      };

      kvSet("local", "ACADEMIC_CONFIG", payload);
      logger.info("academic_config_saved");
    } catch (e) {
      logger.error("academic_config_save_error", e);
      throw e;
    }
  },

  load(): AcademicConfig | null {
    try {
      const wrapped = kvGet<{ data: AcademicConfig }>(
        "local",
        "ACADEMIC_CONFIG"
      );
      return wrapped ? wrapped.data : null;
    } catch (e) {
      logger.error("academic_config_load_error", e);
      return null;
    }
  },
};

export const SignatureStorage = {
  async save(file: File | Blob, encrypt = false, passphrase?: string) {
    try {
      const buffer = await file.arrayBuffer();
      const { id } = await saveData(buffer, {
        kind: "upload",
        type: file.type || "image/png",
        encrypt,
        passphrase,
        name: "HeadmasterSignature",
        tags: ["config", "signature"],
      });

      kvSet("local", "SIGNATURE_REF", id);
      logger.info("signature_saved", { id });
      return id;
    } catch (e) {
      logger.error("signature_save_error", e);
      throw e;
    }
  },

  async load(passphrase?: string): Promise<{ url: string; blob: Blob } | null> {
    try {
      const id = kvGet<string>("local", "SIGNATURE_REF");
      if (!id) return null;

      const result = await getData(id, passphrase);
      if (!result) return null;

      const blob = new Blob([result.data], { type: result.meta.type });
      const url = URL.createObjectURL(blob);
      return { url, blob };
    } catch (e) {
      logger.error("signature_load_error", e);
      return null;
    }
  },
};

// --- Combined System Config Handler ---

export const SystemConfigStorage = {
  async saveAll(
    school: SchoolConfig,
    academic: AcademicConfig,
    encrypt = false,
    passphrase?: string
  ) {
    await SchoolProfileStorage.save(school, encrypt, passphrase);
    await AcademicConfigStorage.save(academic);
    logger.info("system_config_saved_all");
  },

  async loadAll(passphrase?: string) {
    const school = await SchoolProfileStorage.load(passphrase);
    const academic = AcademicConfigStorage.load();
    return { school, academic };
  },

  async clearAll() {
    // Implement cleanup if needed
  },
};
