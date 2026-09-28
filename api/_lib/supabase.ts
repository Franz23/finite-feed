import { createClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

export type AuthenticatedUser = { id: string };

type AuthClient = {
  getUser(token: string): Promise<{
    data: { user: AuthenticatedUser | null };
    error: unknown;
  }>;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function isPostgrestClockSkew(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body: unknown = await response.clone().json();
    return typeof body === "object" && body !== null && "code" in body && body.code === "PGRST303"
      && "message" in body && body.message === "JWT issued at future";
  } catch {
    return false;
  }
}

// Supabase can briefly reject its own service-key JWT while PostgREST's clock
// catches up. Retry only that specific rejection; other 401s remain failures.
export async function fetchWithPostgrestClockRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  request = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/rest/v1/")) return request(input, init);
  const retryableRequest = new Request(input, init);
  for (const delay of [1_000, 3_000]) {
    const response = await request(retryableRequest.clone());
    if (!await isPostgrestClockSkew(response)) return response;
    await wait(delay);
  }
  return request(retryableRequest.clone());
}

export function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithPostgrestClockRetry },
  });
}

export async function requireUser(request: VercelRequest): Promise<AuthenticatedUser> {
  const authorization = request.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("Unauthorized");
  const client = createClient(required("SUPABASE_URL"), required("SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await (client.auth as unknown as AuthClient).getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user;
}

export function publicAppUrl(request: VercelRequest): string {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const value = Array.isArray(host) ? host[0] : host;
  if (value) return `https://${value}`;
  return (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
}
