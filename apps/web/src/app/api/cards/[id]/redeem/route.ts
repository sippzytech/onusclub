import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CardDetail } from "@stampdeck/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const detail = await apiFetch<CardDetail>(`/v1/cards/${params.id}/redeem`, {
      method: "POST",
      jwt,
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
