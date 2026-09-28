import type { VercelRequest, VercelResponse } from "@vercel/node";
import { finalizeActorRun, verifyWebhookSecret, webhookDetails } from "./_lib/apify.js";
import { failDiscoveryActor, finalizeDiscoveryActor } from "./_lib/discovery.js";
import { apiError, errorMessage, methodNotAllowed } from "./_lib/http.js";

export const config = { maxDuration: 60 };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const authorization = request.headers.authorization ?? "";
    const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!verifyWebhookSecret(provided)) return response.status(401).json({ error: "Unauthorized." });
    const details = webhookDetails(request.body);
    if (!details) throw new Error("Invalid webhook payload.");
    if (details.status !== "SUCCEEDED" || !details.datasetId) {
      const reason = details.status === "SUCCEEDED" ? "Apify completed without a dataset." : `Apify run ended with ${details.status}.`;
      const discoveryHandled = await failDiscoveryActor(details.actorRunId, reason);
      if (discoveryHandled) return response.status(202).json({ accepted: true });
      if (["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(details.status)) {
        await finalizeActorRun(details.actorRunId, details.datasetId, details.status as "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED");
      }
      return response.status(202).json({ accepted: true });
    }
    try {
      const discoveryCount = await finalizeDiscoveryActor(details.actorRunId, details.datasetId);
      if (discoveryCount !== null) return response.status(202).json({ accepted: true, signals: discoveryCount });
    } catch (discoveryError) {
      const discoveryHandled = await failDiscoveryActor(details.actorRunId, errorMessage(discoveryError));
      if (discoveryHandled) return response.status(202).json({ accepted: true, signals: 0 });
      throw discoveryError;
    }
    const count = await finalizeActorRun(details.actorRunId, details.datasetId);
    return response.status(202).json({ accepted: true, posts: count });
  } catch (error) {
    console.error("Apify webhook failed:", errorMessage(error));
    return apiError(response, error);
  }
}
