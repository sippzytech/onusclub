import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiCallError, apiFetch, forwardedFor, SESSION_COOKIE } from "@/lib/api";

/** DELETE /api/customers/:id — remove a customer from this café. */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const result = await apiFetch<{ removed: true }>(`/v1/customers/${params.id}`, {
      method: "DELETE",
      jwt,
      // Day 26 rule: any route handler acting for a browser forwards the real
      // address, or the whole platform shares one rate-limit bucket.
      clientIp: forwardedFor(req),
    });
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
