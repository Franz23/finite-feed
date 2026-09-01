import type { VercelRequest, VercelResponse } from "@vercel/node";
import { startActorRun } from "./_lib/apify";
import { apiError, methodNotAllowed } from "./_lib/http";
import { adminClient, requireUser } from "./_lib/supabase";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const user = await requireUser(request);
    const db = adminClient();
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: recent } = await db.from("refresh_runs").select("status").eq("user_id", user.id).gte("started_at", cutoff).limit(1).maybeSingle();
    if (recent) return response.status(202).json({ status: recent.status });
    const { data: follows, error } = await db
      .from("user_follows")
      .select("profiles(linkedin_url, last_scraped_at)")
      .eq("user_id", user.id);
    if (error) throw error;
    const profiles = (follows ?? []).flatMap((follow) => follow.profiles ?? []);
    if (profiles.length < 3) throw new Error("Follow at least three people before refreshing.");
    const days = profiles.some((profile) => !profile.last_scraped_at) ? 7 : 3;
    await startActorRun(request, profiles.map((profile) => profile.linkedin_url), user.id, days);
    return response.status(202).json({ status: "running" });
  } catch (error) {
    return apiError(response, error);
  }
}
