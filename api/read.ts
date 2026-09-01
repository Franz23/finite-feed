import type { VercelRequest, VercelResponse } from "@vercel/node";
import { apiError, methodNotAllowed } from "./_lib/http";
import { adminClient, requireUser } from "./_lib/supabase";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const user = await requireUser(request);
    const ids = Array.isArray(request.body?.ids)
      ? [...new Set(request.body.ids.filter((id: unknown): id is string => typeof id === "string"))].slice(0, 100)
      : [];
    if (ids.length === 0) throw new Error("No posts were supplied.");
    const db = adminClient();
    const seenAt = new Date().toISOString();
    const { error } = await db.from("post_reads").upsert(
      ids.map((post_id) => ({ user_id: user.id, post_id, seen_at: seenAt })),
      { onConflict: "user_id,post_id" },
    );
    if (error) throw error;
    return response.status(200).json({ updated: ids.length });
  } catch (error) {
    return apiError(response, error);
  }
}
