import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CustomerBlockInput } from "@onusclub/shared";
import { ApiCallError, apiFetch, forwardedFor, SESSION_COOKIE } from "@/lib/api";

/**
 * POST /api/customers/:id/block — block a customer from this café.
 *
 * The body is passed straight through. `scope` is not set here: the api
 * refuses "platform" from a café-owner token anyway, so the restriction lives
 * where it is enforced rather than being duplicated in a proxy that could
 * drift from it.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: CustomerBlockInput;
  try {
    body = (await req.json()) as CustomerBlockInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<{ blocked: true }>(
      `/v1/customers/${params.id}/block`,
      { method: "POST", body, jwt, clientIp: forwardedFor(req) }
    );
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
