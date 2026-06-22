import { NextResponse } from "next/server";
import type { AuthRequestInput, AuthRequestResult } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  let body: AuthRequestInput;
  try {
    body = (await req.json()) as AuthRequestInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<AuthRequestResult>("/v1/auth/request", {
      method: "POST",
      body,
    });
    return NextResponse.json({ ok: true, devMagicLink: result.devMagicLink ?? null });
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
