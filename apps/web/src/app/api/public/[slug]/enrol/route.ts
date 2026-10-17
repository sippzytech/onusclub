import { NextResponse } from "next/server";
import type { PublicEnrolInput, PublicEnrolResult } from "@onusclub/shared";
import { ApiCallError, apiFetch, forwardedFor } from "@/lib/api";

// No auth — this is the customer-facing QR signup path.
export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
): Promise<NextResponse> {
  let body: PublicEnrolInput;
  try {
    body = (await req.json()) as PublicEnrolInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<PublicEnrolResult>(
      `/v1/public/m/${params.slug}/enrol`,
      {
        method: "POST",
        body,
        // ⚠️ This was MISSING, and it mattered more here than anywhere else.
        //
        // Day 26 added publicEnrolLimiter — 30 enrolments per 10 minutes —
        // keyed on the client address. Without the address forwarded, the api
        // saw only this web container, so every customer of every café on the
        // platform shared ONE bucket. On a launch morning with 150 people
        // scanning the QR at a counter, the 31st person would be rate-limited
        // and told to come back later.
        //
        // The limiter was sized for exactly that scenario and then could not
        // see it. This is the trap CLAUDE.md names: any route handler acting
        // for a browser passes forwardedFor(req), no exceptions.
        clientIp: forwardedFor(req),
      }
    );
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
