import type { VercelResponse } from "@vercel/node";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Something went wrong.";
}

export function apiError(response: VercelResponse, error: unknown): void {
  const message = errorMessage(error);
  const status = message === "Unauthorized" ? 401 : 400;
  response.status(status).json({ error: message });
}

export function methodNotAllowed(response: VercelResponse, allowed: string[]): void {
  response.setHeader("Allow", allowed.join(", "));
  response.status(405).json({ error: "Method not allowed." });
}
