import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Program } from "@onusclub/shared";
import { ApiCallError, apiFetch, SESSION_COOKIE } from "@/lib/api";

/**
 * Proxy for the card-design PATCH. The body is passed through untouched — the
 * api validates it with CardDesignInput, so validation lives in exactly one
 * place rather than being duplicated (and drifting) here.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as unknown;

  try {
    const program = await apiFetch<Program>(`/v1/programs/${params.id}/design`, {
      method: "PATCH",
      jwt,
      body,
    });
    return NextResponse.json(program);
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
