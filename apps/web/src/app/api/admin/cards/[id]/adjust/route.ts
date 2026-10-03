import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { AdminAdjustInput, AdminAdjustResult } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

/**
 * Proxy for the balance adjustment, so the JWT stays in the httpOnly cookie
 * and never reaches the browser — same arrangement as every other write in
 * this app.
 *
 * Note this handler does NOT check platform-admin membership. It forwards the
 * session and lets the api's own gate decide, which checks the
 * `platform_admins` table on every request. A check here would be a second,
 * weaker copy of that rule, and the dangerous kind of second copy: one that
 * looks authoritative. A caller without the grant gets the api's 404.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: AdminAdjustInput;
  try {
    body = (await req.json()) as AdminAdjustInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<AdminAdjustResult>(
      `/v1/admin/cards/${params.id}/adjust`,
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
