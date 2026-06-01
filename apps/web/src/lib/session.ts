import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Merchant, MerchantPreferences, SessionUser } from "@stampdeck/shared";
import { apiFetch, SESSION_COOKIE } from "./api";

export async function requireSession(): Promise<{
  jwt: string;
  user: SessionUser;
  merchant: Merchant;
  publicSlug: string;
  preferences: MerchantPreferences;
}> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) redirect("/login");
  try {
    const me = await apiFetch<{
      user: SessionUser;
      merchant: Merchant;
      publicSlug: string;
      preferences: MerchantPreferences;
    }>("/v1/me", { jwt });
    return { jwt, ...me };
  } catch {
    redirect("/login?error=session_invalid");
  }
}
