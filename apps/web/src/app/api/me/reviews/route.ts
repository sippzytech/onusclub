import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { MerchantReviewInput, MerchantReviewSettings } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

/** Proxy so the JWT stays in the httpOnly cookie, as with every other write. */
export async function PATCH(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: MerchantReviewInput;
  try {
    body = (await req.json()) as MerchantReviewInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const settings = await apiFetch<MerchantReviewSettings>("/v1/me/reviews", {
      method: "PATCH",
      body,
      jwt,
    });
    return NextResponse.json({ settings });
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
