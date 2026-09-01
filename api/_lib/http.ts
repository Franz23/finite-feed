import type { VercelResponse } from "@vercel/node";

export function apiError(response: VercelResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const status = message === "Unauthorized" ? 401 : 400;
  response.status(status).json({ error: message });
}

export function methodNotAllowed(response: VercelResponse, allowed: string[]): void {
  response.setHeader("Allow", allowed.join(", "));
  response.status(405).json({ error: "Method not allowed." });
}
