import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CampaignDraftInput, CampaignDraftResponse } from "@onusclub/shared";
import { ApiCallError, apiFetch, forwardedFor, SESSION_COOKIE } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: CampaignDraftInput;
  try {
    body = (await req.json()) as CampaignDraftInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<CampaignDraftResponse>("/v1/broadcasts/drafts", {
      method: "POST",
      body,
      jwt,
      // The drafts limiter keys on the merchant, not the address, so this is
      // not what caps the spend here. Passed anyway because the Day 26 rule is
      // unconditional: any route handler acting for a browser forwards the
      // real address, or the platform shares one bucket for everything that
      // *is* address-keyed.
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
