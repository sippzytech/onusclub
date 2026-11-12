import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type {
  AdminMerchantPatch,
  AdminMerchantSummary,
  MerchantDeleteInput,
} from "@onusclub/shared";
import { ApiCallError, apiFetch, forwardedFor, SESSION_COOKIE } from "@/lib/api";

/**
 * Proxy for merchant account changes, so the JWT stays in the httpOnly cookie.
 *
 * Does not check platform-admin membership — the api's gate does, against the
 * database, on every request. A check here would be a second, weaker copy of
 * that rule, and the dangerous kind: one that looks authoritative.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: AdminMerchantPatch;
  try {
    body = (await req.json()) as AdminMerchantPatch;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const merchant = await apiFetch<AdminMerchantSummary>(`/v1/admin/merchants/${params.id}`, {
      method: "PATCH",
      body,
      jwt,
    });
    return NextResponse.json({ merchant });
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

/**
 * DELETE — remove a café entirely. Day 32, Stage 2.
 *
 * Like the PATCH above, this does not check platform-admin membership or
 * validate the deletion code: both are enforced in the api against the
 * database. A copy here would be a second, weaker rule that merely looks
 * authoritative — and a code checked in a proxy is a code sitting in a place
 * it does not need to be.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: MerchantDeleteInput;
  try {
    body = (await req.json()) as MerchantDeleteInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<{ deleted: true; businessName: string }>(
      `/v1/admin/merchants/${params.id}`,
      { method: "DELETE", body, jwt, clientIp: forwardedFor(req) }
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
