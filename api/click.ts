import type { VercelRequest, VercelResponse } from "@vercel/node";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { adminClient, requireUser } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const user = await requireUser(request);
    const { eventId, postId, surface, linkKind } = request.body ?? {};
    if (typeof eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || typeof postId !== "string" || !postId || postId.length > 512
      || !["feed", "history"].includes(surface) || !["post", "image", "document", "video"].includes(linkKind)) {
      throw new Error("Invalid click event.");
    }
    const db = adminClient();
    const { data: post, error: postError } = await db.from("posts").select("profile_id").eq("id", postId).maybeSingle();
    if (postError) throw postError;
    if (!post) return response.status(404).json({ error: "Post not found." });
    const [follow, read] = await Promise.all([
      db.from("user_follows").select("user_id").eq("user_id", user.id).eq("profile_id", post.profile_id).maybeSingle(),
      db.from("post_reads").select("user_id").eq("user_id", user.id).eq("post_id", postId).maybeSingle(),
    ]);
    if (follow.error) throw follow.error;
    if (read.error) throw read.error;
    if (!follow.data && !read.data) return response.status(403).json({ error: "Post is not in your feed or history." });
    const { error } = await db.from("post_clicks").upsert({
      id: eventId, user_id: user.id, post_id: postId, surface, link_kind: linkKind,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    return response.status(200).json({ recorded: true });
  } catch (error) {
    return apiError(response, error);
  }
}
