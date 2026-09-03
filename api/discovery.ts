import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canonicalLinkedInProfileUrl } from "../src/linkedin.js";
import { finishDiscoveryRun, getDiscoveryStatus, startDiscoveryActor, type DiscoveryKind } from "./_lib/discovery.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { adminClient, requireUser } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!request.method || !["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
  try {
    const user = await requireUser(request);
    if (request.method === "GET") return response.status(200).json(await getDiscoveryStatus(user.id));

    const rawUrl = typeof request.body?.profileUrl === "string" ? request.body.profileUrl : "";
    const profileUrl = canonicalLinkedInProfileUrl(rawUrl);
    if (!profileUrl) throw new Error("Enter a public LinkedIn profile URL, like linkedin.com/in/your-name.");
    const current = await getDiscoveryStatus(user.id);
    if (current.status === "starting" || current.status === "running") return response.status(202).json(current);

    const db = adminClient();
    const { data: run, error } = await db.from("discovery_runs").insert({
      user_id: user.id, profile_url: profileUrl, status: "running",
    }).select("id").single();
    if (error) throw error;
    const kinds: DiscoveryKind[] = ["posts", "comments", "reactions"];
    const { data: actorRows, error: actorRowsError } = await db.from("discovery_actor_runs")
      .insert(kinds.map((kind) => ({ discovery_run_id: run.id, kind, status: "starting" })))
      .select("id, kind");
    if (actorRowsError) throw actorRowsError;
    await Promise.allSettled((actorRows ?? []).map((actor) =>
      startDiscoveryActor(request, actor.id, actor.kind as DiscoveryKind, profileUrl),
    ));
    await finishDiscoveryRun(run.id);
    return response.status(202).json(await getDiscoveryStatus(user.id));
  } catch (error) {
    return apiError(response, error);
  }
}
