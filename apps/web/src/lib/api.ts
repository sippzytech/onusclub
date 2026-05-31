// Server-side API client. We always talk to the api from Next.js server code
// (route handlers + server components), never from the browser, so we can keep
// the JWT in an httpOnly cookie on the web origin.
// In docker compose, the api is reachable at http://api:4000 from inside the
// web container; outside docker, the host runs the api on localhost:4000.
// API_BASE_INTERNAL takes precedence when set so the server uses the docker DNS,
// while NEXT_PUBLIC_API_BASE remains the browser-facing URL.
const API_BASE =
  process.env.API_BASE_INTERNAL ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:4000";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiCallError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | string;
  constructor(status: number, body: ApiErrorBody | string) {
    super(typeof body === "string" ? body : body.error.message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; jwt?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.jwt) headers["authorization"] = `Bearer ${opts.jwt}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: ApiErrorBody | string;
    try {
      parsed = JSON.parse(text) as ApiErrorBody;
    } catch {
      parsed = text;
    }
    throw new ApiCallError(res.status, parsed);
  }
  return (await res.json()) as T;
}

export const SESSION_COOKIE = "sd_session";
