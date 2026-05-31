import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  GOOGLE_WALLET_ISSUER_ID: z.string().min(1),
  GOOGLE_WALLET_SA_KEY_PATH: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  BASE_URL_WEB: z.string().url(),
  // Empty string → degrade to console-only email (matches the wallet pattern).
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("Stampdeck <onboarding@resend.dev>"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

export const SERVICE_NAME = "api";
export const SERVICE_VERSION = "0.0.1";
