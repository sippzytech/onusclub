import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CustomerImportInput, CustomerImportResult } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: CustomerImportInput;
  try {
    body = (await req.json()) as CustomerImportInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await apiFetch<CustomerImportResult>("/v1/customers/import", {
      method: "POST",
      body,
      jwt,
    });
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof ApiCallError) {
      return NextResponse.json(
        { error: typeof err.body === "string" ? err.body : err.body.error.message },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}
