import type { Bootstrap, ImportResult } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Something went wrong.";
    throw new Error(message);
  }
  return payload as T;
}

export async function getBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  return parseResponse<Bootstrap>(await fetch("/api/bootstrap", { signal }));
}

export async function importCsv(csv: string): Promise<ImportResult> {
  return parseResponse<ImportResult>(
    await fetch("/api/profiles/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv; charset=utf-8" },
      body: csv,
    }),
  );
}

export async function markSeen(ids: string[]): Promise<void> {
  await parseResponse<{ updated: number }>(
    await fetch("/api/posts/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

export async function startRefresh(): Promise<void> {
  await parseResponse<{ status: string }>(await fetch("/api/refresh", { method: "POST" }));
}

export async function loadDemo(): Promise<void> {
  await parseResponse<{ inserted: number }>(await fetch("/api/demo", { method: "POST" }));
}
