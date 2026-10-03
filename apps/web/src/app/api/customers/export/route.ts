// Proxies the CSV export so the browser can download it.
//
// The session JWT is an httpOnly cookie on this origin, so the browser cannot
// call the api directly — the same reason every other call goes through a
// route handler. Here it also means streaming the file back with its download
// headers intact rather than handing the client a URL it cannot authenticate.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/api";

const API_BASE =
  process.env.API_BASE_INTERNAL ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:4000";

export async function GET(): Promise<NextResponse | Response> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const upstream = await fetch(`${API_BASE}/v1/customers/export.csv`, {
    headers: { authorization: `Bearer ${jwt}` },
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "export failed" }, { status: upstream.status });
  }

  // Pass the bytes through untouched. Decoding to a string here would strip
  // the UTF-8 BOM, and Excel needs it to read accented names correctly.
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "content-disposition":
        upstream.headers.get("content-disposition") ?? 'attachment; filename="customers.csv"',
      "cache-control": "no-store",
    },
  });
}
