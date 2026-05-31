import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

// Dev-only: manually fire a sweep so the owner doesn't have to wait until
// 08:00 / 10:00. The api itself blocks this in production.
export async function POST(
  _req: Request,
  { params }: { params: { type: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const result = await apiFetch<{
      id: string;
      scanned: number;
      sent: number;
      failed: number;
    }>(`/v1/sweeps/run/${params.type}`, { method: "POST", jwt });
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
