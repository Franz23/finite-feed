import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { startActorRun } from "./_lib/apify.js";
import { startDueDiscoveryRuns } from "./_lib/discovery.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { refreshSince } from "./_lib/refresh-window.js";
import { adminClient } from "./_lib/supabase.js";

type RefreshTarget = {
  linkedin_url: string;
  last_scraped_at: string | null;
  platform: "linkedin" | "x";
};

function authorized(request: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.authorization;
  if (!expected || !provided) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });

  try {
    const db = adminClient();
    const discoveryRunsStarted = await startDueDiscoveryRuns(request);
    const { data: follows, error: followsError } = await db
      .from("user_follows")
      .select("profiles(linkedin_url, last_scraped_at, platform)")
      .limit(5000);
    if (followsError) throw followsError;

    const followRows = (follows ?? []) as Array<{ profiles: RefreshTarget[] }>;
    const profiles = [...new Map(
      followRows.flatMap((follow) => follow.profiles ?? []).map((profile) => [profile.linkedin_url, profile]),
    ).values()];
    const staleCutoff = Date.now() - 5 * 60 * 60_000;
    let targets = profiles.filter((profile) =>
      !profile.last_scraped_at || Date.parse(profile.last_scraped_at) < staleCutoff,
    );

    if (targets.length === 0) return response.status(200).json({ status: "fresh", profiles: 0, discoveryRunsStarted });

    // Vercel may deliver the same cron event more than once. Avoid starting another
    // scrape for a profile that is already part of a recent active run.
    const activeCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: active, error: activeError } = await db
      .from("refresh_runs")
      .select("target_urls")
      .in("status", ["starting", "running"])
      .gte("started_at", activeCutoff)
      .limit(100);
    if (activeError) throw activeError;
    const activeUrls = new Set(
      (active ?? []).flatMap((run) => Array.isArray(run.target_urls) ? run.target_urls : []),
    );
    targets = targets.filter((profile) => !activeUrls.has(profile.linkedin_url));
    if (targets.length === 0) return response.status(202).json({ status: "running", profiles: 0, discoveryRunsStarted });

    const batchId = randomUUID();
    const byPlatform = new Map<"linkedin" | "x", RefreshTarget[]>();
    for (const profile of targets) {
      byPlatform.set(profile.platform, [...(byPlatform.get(profile.platform) ?? []), profile]);
    }
    await Promise.all([...byPlatform.entries()].map(([platform, platformTargets]) =>
      startActorRun(
        request,
        platformTargets.map((profile) => profile.linkedin_url),
        null,
        refreshSince(platformTargets),
        platform,
        batchId,
      ),
    ));

    return response.status(202).json({ status: "running", profiles: targets.length, discoveryRunsStarted });
  } catch (error) {
    return apiError(response, error);
  }
}
