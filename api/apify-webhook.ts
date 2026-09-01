import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ingestDataset, verifyWebhookSecret, webhookDetails } from "./_lib/apify.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { adminClient } from "./_lib/supabase.js";

export const config = { maxDuration: 60 };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const authorization = request.headers.authorization ?? "";
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!verifyWebhookSecret(provided)) return response.status(401).json({ error: "Unauthorized." });
    const details = webhookDetails(request.body);
    if (!details) throw new Error("Invalid webhook payload.");
    const db = adminClient();
    if (details.status !== "SUCCEEDED" || !details.datasetId) {
      await db.from("refresh_runs").update({
        status: "failed", finished_at: new Date().toISOString(), error: `Apify run ended with ${details.status}.`,
      }).eq("actor_run_id", details.actorRunId);
      return response.status(202).json({ accepted: true });
    }
    const count = await ingestDataset(details.datasetId);
    const now = new Date().toISOString();
    const { data: refreshRun, error: refreshError } = await db
      .from("refresh_runs")
      .select("target_urls")
      .eq("actor_run_id", details.actorRunId)
      .maybeSingle();
    if (refreshError) throw refreshError;
    const targetUrls = Array.isArray(refreshRun?.target_urls)
      ? refreshRun.target_urls.filter((url): url is string => typeof url === "string")
      : [];
    if (targetUrls.length > 0) {
      const { error: profileError } = await db
        .from("profiles")
        .update({ last_scraped_at: now, updated_at: now })
        .in("linkedin_url", targetUrls);
      if (profileError) throw profileError;
    }
    const { error } = await db.from("refresh_runs").update({
      status: "succeeded", finished_at: now, posts_received: count, error: null,
    }).eq("actor_run_id", details.actorRunId);
    if (error) throw error;
    return response.status(202).json({ accepted: true, posts: count });
  } catch (error) {
    console.error("Apify webhook failed:", error instanceof Error ? error.message : "Unknown error");
    return apiError(response, error);
  }
}
