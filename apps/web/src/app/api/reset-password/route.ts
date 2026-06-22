import { NextResponse } from "next/server";
import type { PasswordAuthResult, ResetPasswordInput } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

const SEVEN_DAYS = 60 * 60 * 24 * 7;

export async function POST(req: Request): Promise<NextResponse> {
  let body: ResetPasswordInput;
  try {
    body = (await req.json()) as ResetPasswordInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await apiFetch<PasswordAuthResult>("/v1/auth/reset-password", {
      method: "POST",
      body,
    });
    const res = NextResponse.json({ ok: true });
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
