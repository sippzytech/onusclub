import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { MessageFeedItem } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

// Polled by the live feed while broadcasts / sweeps are in flight.
export async function GET(): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ items: [] });

  try {
    const result = await apiFetch<{ items: MessageFeedItem[] }>("/v1/messages", { jwt });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiCallError) {
      return NextResponse.json({ items: [] }, { status: err.status });
    }
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}
