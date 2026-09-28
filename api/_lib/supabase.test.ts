import { describe, expect, it, vi } from "vitest";
import { fetchWithPostgrestClockRetry } from "./supabase.js";

const endpoint = "https://example.supabase.co/rest/v1/post_reads";
const skew = () => new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), {
  status: 401, headers: { "Content-Type": "application/json" },
});

describe("Supabase PostgREST clock-skew retry", () => {
  it("retries the exact transient JWT rejection and preserves the request body", async () => {
    const calls: string[] = [];
    const request = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(await (input as Request).text());
      return calls.length === 1 ? skew() : new Response("{}", { status: 200 });
    });
    const wait = vi.fn((ms: number) => { void ms; return Promise.resolve(); });
    const response = await fetchWithPostgrestClockRetry(endpoint, {
      method: "POST", body: JSON.stringify({ post_id: "one" }),
    }, request, wait);
    expect(response.status).toBe(200);
    expect(calls).toEqual(['{"post_id":"one"}', '{"post_id":"one"}']);
    expect(wait).toHaveBeenCalledExactlyOnceWith(1_000);
  });

  it("returns ordinary authorization failures without retrying", async () => {
    const request = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "PGRST301", message: "JWT expired" }), { status: 401 })));
    const wait = vi.fn((ms: number) => { void ms; return Promise.resolve(); });
    const response = await fetchWithPostgrestClockRetry(endpoint, undefined, request, wait);
    expect(response.status).toBe(401);
    expect(request).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("bounds retries when Supabase keeps rejecting the token", async () => {
    const request = vi.fn(() => Promise.resolve(skew()));
    const wait = vi.fn((ms: number) => { void ms; return Promise.resolve(); });
    const response = await fetchWithPostgrestClockRetry(endpoint, undefined, request, wait);
    expect(request).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1_000, 3_000]);
    expect(await response.json()).toEqual({ code: "PGRST303", message: "JWT issued at future" });
  });
});
