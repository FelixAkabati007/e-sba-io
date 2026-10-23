import express, { Router, Request, Response } from "express";
import Stripe from "stripe";
import { pool } from "../lib/db";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PLANS = {
  starter: { name: "Starter", priceId: process.env.STRIPE_STARTER_PRICE_ID || "", seats: 5, monthlyCents: 2900 },
  growth: { name: "Growth", priceId: process.env.STRIPE_GROWTH_PRICE_ID || "", seats: 25, monthlyCents: 7900 },
  scale: { name: "Scale", priceId: process.env.STRIPE_SCALE_PRICE_ID || "", seats: 250, monthlyCents: 19900 },
} as const;

type PlanId = keyof typeof PLANS;

function currentPlan(value: unknown): PlanId {
  return value === "growth" || value === "scale" ? value : "starter";
}

async function ensureBillingSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS organization_billing (
    organization_id INT PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'starter',
    status TEXT NOT NULL DEFAULT 'trialing',
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
    current_period_end TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS organization_usage (
    organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    period_start DATE NOT NULL,
    value INT NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, metric, period_start)
  )`);
}

async function organizationId(req: AuthRequest) {
  const userId = req.user!.userId;
  const { rows } = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 ORDER BY organization_id LIMIT 1`,
    [userId],
  );
  return rows[0]?.organization_id as number | undefined;
}

router.get("/plans", (_req, res) => {
  res.json(Object.entries(PLANS).map(([id, plan]) => ({ id, ...plan })));
});

router.get("/status", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await ensureBillingSchema();
    const orgId = await organizationId(req);
    if (!orgId) return res.status(404).json({ error: "Organization not found" });
    const { rows } = await pool.query(`SELECT * FROM organization_billing WHERE organization_id = $1`, [orgId]);
    const billing = rows[0] || { plan: "starter", status: "trialing" };
    const plan = PLANS[currentPlan(billing.plan)];
    res.json({ ...billing, limits: { seats: plan.seats } });
  } catch (error) {
    res.status(500).json({ error: "Unable to load billing status" });
  }
});

router.post("/checkout", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Billing is not configured" });
    const planId = req.body?.plan as PlanId;
    if (!planId || !PLANS[planId] || !PLANS[planId].priceId) return res.status(400).json({ error: "Invalid billing plan" });
    const orgId = await organizationId(req);
    if (!orgId) return res.status(404).json({ error: "Organization not found" });
    const { rows } = await pool.query(`SELECT * FROM organization_billing WHERE organization_id = $1`, [orgId]);
    const existing = rows[0];
    const customer = existing?.stripe_customer_id
      ? existing.stripe_customer_id
      : (await stripe.customers.create({ metadata: { organization_id: String(orgId) } })).id;
    const origin = `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: PLANS[planId].priceId, quantity: 1 }],
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancelled`,
      client_reference_id: String(orgId),
      metadata: { organization_id: String(orgId), plan: planId },
      integration_identifier: `e-sba-${Math.random().toString(36).slice(2, 10)}`,
    });
    await pool.query(`INSERT INTO organization_billing (organization_id, plan, stripe_customer_id) VALUES ($1, $2, $3)
      ON CONFLICT (organization_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = NOW()`, [orgId, planId, customer]);
    res.json({ url: session.url });
  } catch (error) {
    console.error("[billing] checkout failed", error);
    res.status(500).json({ error: "Unable to start checkout" });
  }
});

router.post("/webhook", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).end();
  try {
    const signature = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, signature as string, process.env.STRIPE_WEBHOOK_SECRET);
    const session = event.data.object as Stripe.Checkout.Session;
    if (event.type === "checkout.session.completed" && session.metadata?.organization_id) {
      await ensureBillingSchema();
      await pool.query(`UPDATE organization_billing SET status = 'active', stripe_customer_id = $1, stripe_subscription_id = $2, updated_at = NOW() WHERE organization_id = $3`, [session.customer, session.subscription, session.metadata.organization_id]);
    }
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await pool.query(`UPDATE organization_billing SET status = 'canceled', updated_at = NOW() WHERE stripe_subscription_id = $1`, [subscription.id]);
    }
    res.json({ received: true });
  } catch {
    res.status(400).send("Invalid webhook");
  }
});

export default router;
