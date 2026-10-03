import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { MerchantBranding, MerchantBrandingInput } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function PATCH(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: MerchantBrandingInput;
  try {
    body = (await req.json()) as MerchantBrandingInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const branding = await apiFetch<MerchantBranding>("/v1/me/branding", {
      method: "PATCH",
      body,
      jwt,
    });
    return NextResponse.json({ branding });
  } catch (err) {
    if (err instanceof ApiCallError) {
      // The api's messages here are written for a merchant to read — image too
      // small, not a PNG — so they pass straight through.
      return NextResponse.json(
        { error: typeof err.body === "string" ? err.body : err.body.error.message },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "could not save" }, { status: 500 });
  }
}
