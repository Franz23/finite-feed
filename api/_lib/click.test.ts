import { beforeEach, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../click.js";
import { adminClient, requireUser } from "./supabase.js";

vi.mock("./supabase.js", () => ({ adminClient: vi.fn(), requireUser: vi.fn() }));
const insert = vi.fn().mockResolvedValue({ error: null });
let followed = true;
let read = false;
let found = true;
const body = { eventId: "bf655890-b0ce-46e7-a3c8-5e39f87e242a", postId: "post-1", surface: "feed", linkKind: "post", user_id: "forged" };

beforeEach(() => {
  vi.clearAllMocks(); followed = true; read = false; found = true;
  vi.mocked(requireUser).mockResolvedValue({ id: "real-user" });
  vi.mocked(adminClient).mockReturnValue({ from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ error: null,
      data: table === "posts" ? (found ? { profile_id: "profile-1" } : null) : (table === "user_follows" ? followed : read) ? { user_id: "real-user" } : null,
    }), upsert: insert };
    return chain;
  } } as unknown as ReturnType<typeof adminClient>);
});

async function request(payload: unknown = body) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "POST", body: payload } as VercelRequest, response as unknown as VercelResponse);
  return response;
}

it("attributes clicks to the authenticated user and deduplicates event retries", async () => {
  expect((await request()).status).toHaveBeenCalledWith(200);
  expect(insert).toHaveBeenCalledWith({ id: body.eventId, user_id: "real-user", post_id: "post-1", surface: "feed", link_kind: "post" }, { onConflict: "id", ignoreDuplicates: true });
});

it("rejects unauthenticated events", async () => {
  vi.mocked(requireUser).mockRejectedValueOnce(new Error("Unauthorized"));
  expect((await request()).status).toHaveBeenCalledWith(401);
  expect(insert).not.toHaveBeenCalled();
});

it("rejects clicks on another user's posts", async () => {
  followed = false;
  expect((await request()).status).toHaveBeenCalledWith(403);
  expect(insert).not.toHaveBeenCalled();
});

it("accepts history clicks after unfollowing", async () => {
  followed = false; read = true;
  expect((await request({ ...body, surface: "history" })).status).toHaveBeenCalledWith(200);
});

it("rejects missing posts and invalid event fields", async () => {
  found = false;
  expect((await request()).status).toHaveBeenCalledWith(404);
  expect((await request({ ...body, surface: "unknown" })).status).toHaveBeenCalledWith(400);
  expect(insert).not.toHaveBeenCalled();
});
