import { NextResponse } from "next/server";
import type { GoogleAuthInput, GoogleAuthResult } from "@onusclub/shared";
import { ApiCallError, apiFetch, forwardedFor, SESSION_COOKIE } from "@/lib/api";

const SEVEN_DAYS = 60 * 60 * 24 * 7;

/**
 * Proxy for POST /v1/auth/google — café owner sign-in and signup.
 *
 * Exists for the same reason /api/login does: the session JWT is set as an
 * httpOnly cookie, which only a server can do. The browser never holds the
 * token.
 *
 * The ID token is passed straight through without being decoded here. It is
 * verified by the api against Google's keys and our client id; a check done in
 * this handler would be a check the api could not rely on.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: GoogleAuthInput;
  try {
    body = (await req.json()) as GoogleAuthInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<GoogleAuthResult>("/v1/auth/google", {
      method: "POST",
      body,
      // Real browser address — this route is behind loginLimiter, which keys
      // on it. Without this every sign-in on the platform shares one bucket.
      clientIp: forwardedFor(req),
    });

    // "No account yet, what is the café called?" — relayed as-is so the page
    // can reveal its business-name field. No cookie: nobody is signed in.
    if (result.status === "needs_business_name") {
      return NextResponse.json(result);
    }

    const res = NextResponse.json({ status: "authenticated" });
    res.cookies.set(SESSION_COOKIE, result.jwt, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SEVEN_DAYS,
    });
    return res;
  } catch (err) {
    if (err instanceof ApiCallError) {
      return NextResponse.json(
        { error: typeof err.body === "string" ? err.body : err.body.error.message },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
