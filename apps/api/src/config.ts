import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  GOOGLE_WALLET_ISSUER_ID: z.string().min(1),
  GOOGLE_WALLET_SA_KEY_PATH: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  BASE_URL_WEB: z.string().url(),
  // Public URL of this api (where iOS / customer browsers hit us directly,
  // e.g. for the Apple Wallet .pkpass download). Defaults to localhost:4000
  // for local dev. In prod set to https://api.<domain>.
  BASE_URL_API: z.string().url().default("http://localhost:4000"),
  // Empty string → degrade to console-only email (matches the wallet pattern).
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("OnUsClub <onboarding@resend.dev>"),
  // Apple Wallet. All empty → endpoint returns 503 "not configured".
  // P12_PASSWORD empty is the canonical "wallet offline" signal.
  APPLE_TEAM_ID: z.string().optional().default(""),
  APPLE_PASS_TYPE_ID: z.string().optional().default(""),
  APPLE_PASS_P12_PATH: z.string().optional().default(""),
  APPLE_PASS_P12_PASSWORD: z.string().optional().default(""),
  APPLE_WWDR_PATH: z.string().optional().default(""),
  // APNs push cert for Apple Wallet live updates (Day 12). Different from the
  // pass signing cert above — Apple issues this as a separate certificate
  // tied to the same Pass Type ID. Empty → push silently disabled, passes
  // still download but won't auto-update on the device.
  APPLE_APNS_P12_PATH: z.string().optional().default(""),
  APPLE_APNS_P12_PASSWORD: z.string().optional().default(""),
  // Preferred path on Node 20: pre-extracted PEM cert + key files. Set these
  // and the apns client skips the .p12 + node-forge dance (which Node 20's
  // OpenSSL silently rejects during the TLS client-cert handshake).
  APPLE_APNS_CERT_PEM_PATH: z.string().optional().default(""),
  APPLE_APNS_KEY_PEM_PATH: z.string().optional().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

export const SERVICE_NAME = "api";
export const SERVICE_VERSION = "0.0.1";
