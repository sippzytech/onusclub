import type { Page } from "@playwright/test";

const API = process.env.E2E_API_BASE ?? "http://localhost:4000";

/**
 * Fixtures are created through the API, not the UI.
 *
 * Deliberate: a test about the card builder should fail when the card builder
 * breaks, not when signup does. Every test sets up its world over HTTP and
 * then drives only the thing it is actually testing through the browser.
 *
 * The one exception is the signup/onboarding test, which drives signup in the
 * browser because signup IS what it is testing.
 */
export interface Merchant {
  email: string;
  password: string;
  businessName: string;
  jwt: string;
  merchantId: string;
  userId: string;
  publicSlug: string;
}

export const PASSWORD = "e2e-password-12345";

/**
 * A fresh RFC-5737 documentation address per request.
 *
 * Day 26 added IP-keyed rate limiting, and this suite immediately tripped the
 * signup limiter: it creates a merchant per test, and the real limit is 5 per
 * hour per address. Each test represents a different client, so presenting a
 * different address is the accurate thing to do rather than a way around it.
 */
function syntheticIp(): string {
  const n = (): number => Math.floor(Math.random() * 254) + 1;
  return `203.0.113.${n()}`;
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  jwt?: string
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": syntheticIp(),
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** A unique-per-run suffix, so a rerun never collides on the unique email. */
export function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createMerchant(label: string): Promise<Merchant> {
  const s = stamp();
  const email = `e2e-${label}-${s}@example.com`;
  const businessName = `E2E ${label} ${s}`;
  const res = await api<{
    jwt: string;
    merchant: { id: string };
    user: { id: string };
    publicSlug?: string;
  }>("POST", "/v1/auth/signup", {
    businessName,
    ownerEmail: email,
    ownerName: "E2E Runner",
    password: PASSWORD,
  });
  return {
    email,
    password: PASSWORD,
    businessName,
    jwt: res.jwt,
    merchantId: res.merchant.id,
    userId: res.user.id,
    publicSlug: res.publicSlug ?? "",
  };
}

export async function createProgram(m: Merchant, stampsRequired = 6): Promise<string> {
  const p = await api<{ id: string }>(
    "POST",
    "/v1/programs",
    { name: "E2E Coffee card", stampsRequired, rewardText: "Free coffee" },
    m.jwt
  );
  return p.id;
}

export async function createCard(
  m: Merchant,
  programId: string
): Promise<{ cardId: string; customerId: string }> {
  const customer = await api<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "E2E Customer", email: `e2e-cust-${stamp()}@example.com` },
    m.jwt
  );
  const card = await api<{ id: string }>(
    "POST",
    "/v1/cards",
    { customerId: customer.id, programId },
    m.jwt
  );
  return { cardId: card.id, customerId: customer.id };
}

/**
 * Log in through the real form.
 *
 * Not by injecting the session cookie directly: the cookie is httpOnly and set
 * by a Next route handler, so faking it would skip the one part of auth that
 * only a browser exercises.
 */
export async function login(page: Page, m: Merchant): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(m.email);
  await page.getByLabel("Password").fill(m.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Grant platform admin. SQL-only by design, so this goes through the API's own test seam. */
export async function grantPlatformAdmin(userId: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required to grant platform admin");
  const mysql = await import("mysql2/promise");
  const db = await mysql.default.createConnection({ uri: url });
  try {
    await db.execute(
      "INSERT IGNORE INTO platform_admins (staff_user_id, note) VALUES (?, 'e2e')",
      [userId]
    );
  } finally {
    await db.end();
  }
}

export async function revokePlatformAdmin(userId: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const mysql = await import("mysql2/promise");
  const db = await mysql.default.createConnection({ uri: url });
  try {
    await db.execute("DELETE FROM platform_admins WHERE staff_user_id = ?", [userId]);
  } finally {
    await db.end();
  }
}
