import { NextResponse } from "next/server";
import type {
  AuthRequestResult,
  MerchantSignupInput,
  MerchantSignupResult,
} from "@stampdeck/shared";
import { ApiCallError, apiFetch } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  let body: MerchantSignupInput;
  try {
    body = (await req.json()) as MerchantSignupInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    await apiFetch<MerchantSignupResult>("/v1/merchants", {
      method: "POST",
      body,
    });
    // Immediately send a magic link so the user can sign in.
    const link = await apiFetch<AuthRequestResult>("/v1/auth/request", {
      method: "POST",
      body: { email: body.ownerEmail },
    });
    return NextResponse.json({ ok: true, devMagicLink: link.devMagicLink ?? null });
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
