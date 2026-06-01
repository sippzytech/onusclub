import { NextResponse } from "next/server";
import type { ForgotPasswordInput, ForgotPasswordResult } from "@stampdeck/shared";
import { ApiCallError, apiFetch } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  let body: ForgotPasswordInput;
  try {
    body = (await req.json()) as ForgotPasswordInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await apiFetch<ForgotPasswordResult>("/v1/auth/forgot-password", {
      method: "POST",
      body,
    });
    return NextResponse.json(result);
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
