import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Customer, CustomerCreateInput } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: CustomerCreateInput;
  try {
    body = (await req.json()) as CustomerCreateInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const customer = await apiFetch<Customer>("/v1/customers", {
      method: "POST",
      body,
      jwt,
    });
    return NextResponse.json({ customer });
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
