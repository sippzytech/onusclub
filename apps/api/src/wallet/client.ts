import { readFile } from "node:fs/promises";
import { GoogleAuth, type AuthClient } from "google-auth-library";
import { env } from "../config.js";
import { logger } from "../logger.js";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface WalletAuth {
  sa: ServiceAccountKey;
  client: AuthClient;
}

const WALLET_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPES = ["https://www.googleapis.com/auth/wallet_object.issuer"];

let cached: WalletAuth | null = null;
let loadError: string | null = null;

async function load(): Promise<WalletAuth | null> {
  if (cached) return cached;
  if (loadError) return null; // fail-once: don't keep re-reading a missing file
  try {
    const raw = await readFile(env.GOOGLE_WALLET_SA_KEY_PATH, "utf8");
    const sa = JSON.parse(raw) as ServiceAccountKey;
    if (!sa.client_email || !sa.private_key) {
      throw new Error("service account JSON missing client_email or private_key");
    }
    const auth = new GoogleAuth({
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      scopes: SCOPES,
    });
    const client = await auth.getClient();
    cached = { sa, client };
    logger.info({ saEmail: sa.client_email }, "wallet client initialized");
    return cached;
  } catch (err) {
    loadError = (err as Error).message;
    logger.warn(
      { path: env.GOOGLE_WALLET_SA_KEY_PATH, err: loadError },
      "wallet client unavailable — wallet operations will be no-ops"
    );
    return null;
  }
}

export async function walletEnabled(): Promise<boolean> {
  return (await load()) !== null;
}

export async function getServiceAccount(): Promise<ServiceAccountKey | null> {
  return (await load())?.sa ?? null;
}

export interface WalletRequestOptions {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: unknown;
}

export interface WalletResponse {
  status: number;
  data: unknown;
}

/**
 * Low-level wallet API call. Returns { status, data } so callers can branch on
 * 404 (e.g. "class doesn't exist yet, create it") without try/catch noise.
 * Returns null if the wallet client is not configured.
 */
export async function walletRequest(opts: WalletRequestOptions): Promise<WalletResponse | null> {
  const wa = await load();
  if (!wa) return null;
  try {
    const res = await wa.client.request({
      url: `${WALLET_BASE}${opts.path}`,
      method: opts.method,
      data: opts.body,
      // Don't throw on non-2xx — we want to inspect 404s.
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    // Network / auth errors. Surface to the caller as a synthetic 5xx.
    logger.error({ err: (err as Error).message, path: opts.path }, "wallet request failed");
    return { status: 599, data: { error: (err as Error).message } };
  }
}

export const WALLET_ISSUER_ID = env.GOOGLE_WALLET_ISSUER_ID;
