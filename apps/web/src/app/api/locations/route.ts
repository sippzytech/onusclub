import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { LocationInput, ShopLocation } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

/** Proxy so the JWT stays in the httpOnly cookie, as with every other write. */
export async function POST(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: LocationInput;
  try {
    body = (await req.json()) as LocationInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const location = await apiFetch<ShopLocation>("/v1/locations", {
      method: "POST",
      body,
      jwt,
    });
    return NextResponse.json({ location });
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
