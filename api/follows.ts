import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canonicalSocialProfileUrl, type SocialProfileUrl } from "../src/social.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { adminClient, requireUser } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!request.method || !["POST", "DELETE"].includes(request.method)) return methodNotAllowed(response, ["POST", "DELETE"]);
  try {
    const user = await requireUser(request);
    const db = adminClient();
    if (request.method === "DELETE") {
      const profileId = typeof request.body?.profileId === "string" ? request.body.profileId : "";
      if (!profileId) throw new Error("Choose a profile to remove.");
      const { error } = await db.from("user_follows").delete().eq("user_id", user.id).eq("profile_id", profileId);
      if (error) throw error;
      return response.status(200).json({ removed: true });
    }

    const candidates = Array.isArray(request.body?.urls) ? request.body.urls : [];
    const parsed: SocialProfileUrl[] = candidates.flatMap((value: unknown): SocialProfileUrl[] => {
      if (typeof value !== "string") return [];
      const canonical = canonicalSocialProfileUrl(value);
      return canonical ? [canonical] : [];
    });
    const profilesByUrl = new Map(parsed.map((profile) => [profile.url, profile]));
    const profileInputs = [...profilesByUrl.values()].slice(0, 100);
    const urls = profileInputs.map((profile) => profile.url);
    if (urls.length === 0) throw new Error("Add at least one public LinkedIn or X profile URL.");

    const { error: profileError } = await db
      .from("profiles")
      .upsert(profileInputs.map(({ url: linkedin_url, platform }) => ({ linkedin_url, platform, updated_at: new Date().toISOString() })), {
        onConflict: "linkedin_url",
        ignoreDuplicates: true,
      });
    if (profileError) throw profileError;
    const { data: profiles, error: selectError } = await db.from("profiles").select("id").in("linkedin_url", urls);
    if (selectError) throw selectError;
    const profileRows = (profiles ?? []) as Array<{ id: string }>;
    const follows = profileRows.map((profile) => ({ user_id: user.id, profile_id: profile.id }));
    const { error: followError } = await db.from("user_follows").upsert(follows, { onConflict: "user_id,profile_id" });
    if (followError) throw followError;
    const { count, error: countError } = await db
      .from("user_follows")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (countError) throw countError;
    return response.status(200).json({ added: follows.length, total: count ?? follows.length });
  } catch (error) {
    return apiError(response, error);
  }
}
