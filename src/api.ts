import { supabase } from "./supabase";
import type { Bootstrap, FollowResult } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    if (!response.ok) throw new Error(`The server could not complete that request (${response.status}). Please try again.`);
    throw new Error("The server returned an unexpected response.");
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Something went wrong.";
    throw new Error(message);
  }
  return payload as T;
}

async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to continue.");
  return fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

export async function getBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  return parseResponse<Bootstrap>(await authorizedFetch("/api/feed", { signal }));
}

export async function addFollows(urls: string[]): Promise<FollowResult> {
  return parseResponse<FollowResult>(
    await authorizedFetch("/api/follows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    }),
  );
}

export async function removeFollow(profileId: string): Promise<void> {
  await parseResponse<{ removed: boolean }>(
    await authorizedFetch("/api/follows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    }),
  );
}

export async function markSeen(ids: string[]): Promise<void> {
  await parseResponse<{ updated: number }>(
    await authorizedFetch("/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

export async function startRefresh(force = false): Promise<string> {
  const result = await parseResponse<{ status: string }>(await authorizedFetch("/api/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  }));
  return result.status;
}
