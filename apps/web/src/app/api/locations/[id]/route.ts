import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { LocationPatch, ShopLocation } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

function failure(err: unknown): NextResponse {
  if (err instanceof ApiCallError) {
    return NextResponse.json(
      { error: typeof err.body === "string" ? err.body : err.body.error.message },
      { status: err.status }
    );
  }
  return NextResponse.json({ error: "unexpected error" }, { status: 500 });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: LocationPatch;
  try {
    body = (await req.json()) as LocationPatch;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const location = await apiFetch<ShopLocation>(`/v1/locations/${params.id}`, {
      method: "PATCH",
      body,
      jwt,
    });
    return NextResponse.json({ location });
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    // The api answers 204 with no body; apiFetch always parses JSON, so this
    // one goes through a plain fetch rather than making apiFetch handle an
    // empty-body case for a single caller.
    const base =
      process.env.API_BASE_INTERNAL ??
      process.env.NEXT_PUBLIC_API_BASE ??
      "http://localhost:4000";
    const res = await fetch(`${base}/v1/locations/${params.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        /* leave the raw body as the message */
      }
      return NextResponse.json({ error: message }, { status: res.status });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return failure(err);
  }
}
