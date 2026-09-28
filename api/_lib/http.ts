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
  if (typeof error === "object" && error !== null && "code" in error && error.code === "PGRST303"
    && "message" in error && error.message === "JWT issued at future") {
    response.status(503).json({ error: "The data service is temporarily unavailable. Please try again." });
    return;
  }
  const message = errorMessage(error);
  const status = message === "Unauthorized" ? 401 : 400;
  response.status(status).json({ error: message });
}

export function methodNotAllowed(response: VercelResponse, allowed: string[]): void {
  response.setHeader("Allow", allowed.join(", "));
  response.status(405).json({ error: "Method not allowed." });
}
