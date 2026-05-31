import { NextResponse } from "next/server";
import type { AuthVerifyResult } from "@stampdeck/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

const SEVEN_DAYS = 60 * 60 * 24 * 7;

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", req.url));
  }

  try {
    const result = await apiFetch<AuthVerifyResult>("/v1/auth/verify", {
      method: "POST",
      body: { token },
    });
    const res = NextResponse.redirect(new URL("/dashboard", req.url));
    res.cookies.set(SESSION_COOKIE, result.jwt, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SEVEN_DAYS,
    });
    return res;
  } catch (err) {
    const reason =
      err instanceof ApiCallError
        ? typeof err.body === "string"
          ? "invalid"
          : err.body.error.code
        : "unexpected";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, req.url));
  }
}
