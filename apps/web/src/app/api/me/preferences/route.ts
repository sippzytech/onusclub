import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { MerchantPreferences, MerchantPreferencesInput } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function PATCH(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: MerchantPreferencesInput;
  try {
    body = (await req.json()) as MerchantPreferencesInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const prefs = await apiFetch<MerchantPreferences>("/v1/me/preferences", {
      method: "PATCH",
      body,
      jwt,
    });
    return NextResponse.json(prefs);
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
