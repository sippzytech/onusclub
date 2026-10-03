import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Merchant, MerchantPreferences, SessionUser, TrialStatus } from "@onusclub/shared";
import { apiFetch, SESSION_COOKIE } from "./api";

export async function requireSession(): Promise<{
  jwt: string;
  user: SessionUser;
  merchant: Merchant;
  publicSlug: string;
  preferences: MerchantPreferences;
  trial: TrialStatus;
}> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) redirect("/login");
  try {
    const me = await apiFetch<{
      user: SessionUser;
      merchant: Merchant;
      publicSlug: string;
      preferences: MerchantPreferences;
      trial: TrialStatus;
    }>("/v1/me", { jwt });
    return { jwt, ...me };
  } catch {
    redirect("/login?error=session_invalid");
  }
}
