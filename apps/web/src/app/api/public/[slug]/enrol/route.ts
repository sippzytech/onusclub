import { NextResponse } from "next/server";
import type { PublicEnrolInput, PublicEnrolResult } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";

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
      { method: "POST", body }
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
