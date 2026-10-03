import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Merchant, MerchantPreferences, SessionUser, TrialStatus } from "@onusclub/shared";
import { apiFetch, SESSION_COOKIE } from "./api";

export interface Session {
  jwt: string;
  user: SessionUser;
  merchant: Merchant;
  publicSlug: string;
  preferences: MerchantPreferences;
  trial: TrialStatus;
  /**
   * Whether to render the platform-admin link. Advisory only: /admin and
   * /v1/admin both re-check against the database, so a tampered value changes
   * nothing but whether a link appears.
   */
  isPlatformAdmin: boolean;
}

export async function requireSession(): Promise<Session> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) redirect("/login");
  try {
    const me = await apiFetch<Omit<Session, "jwt">>("/v1/me", { jwt });
    return { jwt, ...me };
  } catch {
    redirect("/login?error=session_invalid");
  }
}
