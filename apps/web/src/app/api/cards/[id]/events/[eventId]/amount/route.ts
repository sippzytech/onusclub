import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CardDetail } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

// Attaches a sale amount to an event that already happened. The scanner uses
// this: the stamp lands the instant the QR is read, then staff can optionally
// type what the customer spent.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; eventId: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { amount?: number };
  if (typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  try {
    const detail = await apiFetch<CardDetail>(
      `/v1/cards/${params.id}/events/${params.eventId}/amount`,
      { method: "PATCH", jwt, body: { amount: body.amount } }
    );
    return NextResponse.json(detail);
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
