/**
 * The Google OAuth client id, for server components only.
 *
 * 🚨 TWO WAYS THIS GOES SILENTLY WRONG, both of which produce an empty string
 * in production while `.env` looks perfectly correct. The symptom is identical
 * in both cases: no button, no error, nothing in the logs.
 *
 * 1. **Reading it in a client component.** Next inlines `NEXT_PUBLIC_*` into
 *    client bundles at BUILD time, and docker-compose.prod.yml supplies env at
 *    RUNTIME. That is why there is no `NEXT_PUBLIC_` twin of this variable at
 *    all, and why `GoogleButton` takes the id as a prop. Every pre-existing
 *    `NEXT_PUBLIC_*` read in this repo happens to be in a server component,
 *    which is the only reason the runtime-only compose block works today.
 *
 * 2. **Reading it in a STATICALLY PRERENDERED page.** A page without
 *    `force-dynamic` is rendered once at build time, so `process.env` is the
 *    build environment, not the container's. `/signup` was static before this
 *    feature; `/login` and `/m/[slug]` were already dynamic. Any page calling
 *    this function must also export
 *    `export const dynamic = "force-dynamic";`
 *
 * The value is public by design — it ships in the page HTML either way. There
 * is no secret anywhere in this flow: the ID-token flow has no redirect and
 * never uses Google's client secret.
 *
 * Returns "" when unconfigured, which `GoogleButton` renders as nothing at
 * all, so a deployment without a client id shows no broken button.
 */
export function googleClientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
}
