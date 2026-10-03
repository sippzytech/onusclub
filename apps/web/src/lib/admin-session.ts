import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { AdminWhoami } from "@onusclub/shared";
import { apiFetch, SESSION_COOKIE } from "./api";

/**
 * Gate for every page under /admin.
 *
 * Deliberately NOT `requireSession` plus a role check. It asks the api, which
 * checks the `platform_admins` table on every request, so a revoked grant
 * locks the page as soon as the next request is made — the same property the
 * API gate exists for, rather than a second copy of the rule that could drift.
 *
 * On any failure — no cookie, expired session, no grant — this renders Next's
 * not-found page. Not a redirect to /login, which would confirm that /admin
 * exists and is worth attacking. Same reasoning as the 404 the api returns.
 *
 * There is intentionally no `middleware.ts` doing a cheaper version of this.
 * Next middleware runs on the edge runtime and cannot talk to the api without
 * real cost, and a second half-authorization is mostly useful for being
 * trusted by mistake. If someone adds one later, it must not become the only
 * check.
 */
export async function requireAdminSession(): Promise<{ jwt: string; admin: AdminWhoami }> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) notFound();
  try {
    const admin = await apiFetch<AdminWhoami>("/v1/admin/whoami", { jwt });
    return { jwt, admin };
  } catch {
    notFound();
  }
}
