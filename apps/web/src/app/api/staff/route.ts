import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { StaffCreateInput, StaffMember } from "@stampdeck/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  let body: StaffCreateInput;
  try {
    body = (await req.json()) as StaffCreateInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const staff = await apiFetch<StaffMember>("/v1/staff", { method: "POST", body, jwt });
    return NextResponse.json({ staff });
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
