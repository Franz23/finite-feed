import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { startActorRun } from "./_lib/apify.js";
import { actorChain, chunkActorTargets } from "./_lib/actors.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { refreshSince } from "./_lib/refresh-window.js";
import { adminClient, requireUser } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const user = await requireUser(request);
    const db = adminClient();
    const force = request.body?.force === true;
    const { data: follows, error } = await db
      .from("user_follows")
      .select("profiles(id, linkedin_url, last_scraped_at, platform)")
      .eq("user_id", user.id);
    if (error) throw error;
    const followRows = (follows ?? []) as Array<{
      profiles: Array<{ id: string; linkedin_url: string; last_scraped_at: string | null; newest_post_at?: string | null; platform: "linkedin" | "x" }>;
    }>;
    const profiles = followRows.flatMap((follow) => follow.profiles ?? []);
    if (profiles.length < 3) throw new Error("Follow at least three people before refreshing.");
    const { data: watermarks, error: watermarkError } = await db.from("profile_post_watermarks")
      .select("profile_id, newest_post_at").in("profile_id", profiles.map((profile) => profile.id));
    if (watermarkError) throw watermarkError;
    const watermarkById = new Map((watermarks ?? []).map((row) => [row.profile_id, row.newest_post_at]));
    for (const profile of profiles) profile.newest_post_at = watermarkById.get(profile.id) ?? null;
    const staleCutoff = Date.now() - 12 * 60 * 60_000;
    let targets = force ? profiles : profiles.filter((profile) =>
      !profile.last_scraped_at || Date.parse(profile.last_scraped_at) < staleCutoff,
    );
    if (targets.length === 0) return response.status(200).json({ status: "fresh" });
    const activeCutoff = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const { data: active, error: activeError } = await db
      .from("refresh_runs")
      .select("target_urls")
      .in("status", ["starting", "running"])
      .gte("started_at", activeCutoff)
      .order("started_at", { ascending: false })
      .limit(100);
    if (activeError) throw activeError;
    if (active?.length) {
      const activeUrls = new Set(active.flatMap((run) => Array.isArray(run.target_urls) ? run.target_urls : []));
      targets = targets.filter((profile) => !activeUrls.has(profile.linkedin_url));
      if (targets.length === 0) return response.status(202).json({ status: "running" });
    }
    const batchId = randomUUID();
    const byPlatform = new Map<"linkedin" | "x", typeof targets>();
    for (const profile of targets) byPlatform.set(profile.platform, [...(byPlatform.get(profile.platform) ?? []), profile]);
    await Promise.all([...byPlatform.entries()].flatMap(([platform, platformTargets]) => {
      const adapter = actorChain(platform)[0];
      return chunkActorTargets(platformTargets, adapter).map((chunk) => startActorRun(
        request, chunk.map((profile) => profile.linkedin_url), user.id,
        refreshSince(chunk), platform, batchId, adapter,
      ));
    }));
    return response.status(202).json({ status: "running", profiles: targets.length });
  } catch (error) {
    return apiError(response, error);
  }
}
