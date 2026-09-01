import type { VercelRequest, VercelResponse } from "@vercel/node";
import { startActorRun } from "./_lib/apify.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { adminClient, requireUser } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const user = await requireUser(request);
    const db = adminClient();
    const force = request.body?.force === true;
    const { data: follows, error } = await db
      .from("user_follows")
      .select("profiles(linkedin_url, last_scraped_at)")
      .eq("user_id", user.id);
    if (error) throw error;
    const followRows = (follows ?? []) as Array<{
      profiles: Array<{ linkedin_url: string; last_scraped_at: string | null }>;
    }>;
    const profiles = followRows.flatMap((follow) => follow.profiles ?? []);
    if (profiles.length < 3) throw new Error("Follow at least three people before refreshing.");
    const staleCutoff = Date.now() - 12 * 60 * 60_000;
    let targets = force ? profiles : profiles.filter((profile) =>
      !profile.last_scraped_at || Date.parse(profile.last_scraped_at) < staleCutoff,
    );
    if (targets.length === 0) return response.status(200).json({ status: "fresh" });
    const activeCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: active } = await db
      .from("refresh_runs")
      .select("status, target_urls")
      .eq("user_id", user.id)
      .in("status", ["starting", "running"])
      .gte("started_at", activeCutoff)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active) {
      const activeUrls = new Set(Array.isArray(active.target_urls) ? active.target_urls : []);
      targets = targets.filter((profile) => !activeUrls.has(profile.linkedin_url));
      if (targets.length === 0) return response.status(202).json({ status: active.status });
    }
    const days = targets.some((profile) => !profile.last_scraped_at) ? 7 : 3;
    await startActorRun(request, targets.map((profile) => profile.linkedin_url), user.id, days);
    return response.status(202).json({ status: "running", profiles: targets.length });
  } catch (error) {
    return apiError(response, error);
  }
}
