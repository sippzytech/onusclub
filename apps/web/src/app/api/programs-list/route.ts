import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Program } from "@stampdeck/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

// Lightweight wrapper around GET /v1/programs for client components that
// don't want to call the api directly.
export async function GET(): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ programs: [] });
  try {
    const data = await apiFetch<{ programs: Program[] }>("/v1/programs", { jwt });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 401) {
      return NextResponse.json({ programs: [] }, { status: 401 });
    }
    return NextResponse.json({ programs: [] }, { status: 500 });
  }
}
