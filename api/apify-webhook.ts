import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ingestDataset, verifyWebhookSecret, webhookDetails } from "./_lib/apify";
import { apiError, methodNotAllowed } from "./_lib/http";
import { adminClient } from "./_lib/supabase";

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
    const { error } = await db.from("refresh_runs").update({
      status: "succeeded", finished_at: new Date().toISOString(), posts_received: count, error: null,
    }).eq("actor_run_id", details.actorRunId);
    if (error) throw error;
    return response.status(202).json({ accepted: true, posts: count });
  } catch (error) {
    return apiError(response, error);
  }
}
