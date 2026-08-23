import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CardDetail } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Optional sale amount (Day 15 revenue capture). Absent or malformed =
  // no amount recorded, and the redeem behaves exactly as it always has.
  const body = (await req.json().catch(() => ({}))) as { amount?: number };
  const amount =
    typeof body.amount === "number" && body.amount > 0 ? body.amount : undefined;

  try {
    const detail = await apiFetch<CardDetail>(`/v1/cards/${params.id}/redeem`, {
      method: "POST",
      jwt,
      body: amount === undefined ? {} : { amount },
    });
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
