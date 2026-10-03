import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { AdminPasswordResetInput, AdminPasswordResetResult } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

/** Proxy for the admin-issued password reset. Authorization is the api's job. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: AdminPasswordResetInput;
  try {
    body = (await req.json()) as AdminPasswordResetInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<AdminPasswordResetResult>(
      `/v1/admin/merchants/${params.id}/password-reset`,
      { method: "POST", body, jwt }
    );
    return NextResponse.json({ result });
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
