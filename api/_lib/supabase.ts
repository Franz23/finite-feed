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

export function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
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
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const value = Array.isArray(host) ? host[0] : host;
  return value ? `https://${value}` : "";
}
