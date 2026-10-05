/** @type {import('next').NextConfig} */

/**
 * Headers every response gets.
 *
 * No Content-Security-Policy, deliberately. Next's App Router inlines
 * bootstrap scripts and streams RSC payloads, so a useful CSP needs per-request
 * nonces threaded through middleware — and this app has no middleware.md on
 * purpose (see lib/admin-session.ts). A CSP loose enough to work without
 * nonces would need 'unsafe-inline', which is a CSP that permits exactly the
 * thing it exists to prevent. Better to have none and know it than to have one
 * and believe it.
 *
 * The rest are cheap and do real work.
 */
const baseSecurityHeaders = [
  // Stop a browser second-guessing a declared content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing here is meant to be embedded. The dashboard in an iframe is a
  // clickjack against a session that can issue rewards and change balances.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // The modern browser default, stated rather than assumed.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Traefik terminates TLS and always redirects to HTTPS; this tells the
  // browser not to try port 80 in the first place.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  // Was "@stampdeck/shared" — a package that has not existed since the Day 13
  // rename, so this option had been silently doing nothing.
  transpilePackages: ["@onusclub/shared"],
  output: "standalone",
  // Express already strips its own; this is Next's.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: baseSecurityHeaders,
      },
      {
        // ⚠️ The customer card page carries `qr_token` IN THE URL, and that
        // token is a bearer credential: anyone holding it can view the card
        // and add the pass. `strict-origin-when-cross-origin` already strips
        // the path cross-origin, but these pages link out to Google Wallet and
        // Apple Wallet, so the stakes of a referrer leak are concrete rather
        // than theoretical. no-referrer sends nothing at all.
        source: "/c/:path*",
        headers: [
          ...baseSecurityHeaders.filter((h) => h.key !== "Referrer-Policy"),
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
