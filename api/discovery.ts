import type { VercelRequest, VercelResponse } from "@vercel/node";
import { discoveryProfileUrls } from "../src/social.js";
import { createDiscoveryRun, getDiscoveryStatus } from "./_lib/discovery.js";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { requireUser } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!request.method || !["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
  try {
    const user = await requireUser(request);
    if (request.method === "GET") return response.status(200).json(await getDiscoveryStatus(user.id));

    const profileUrls = discoveryProfileUrls(request.body?.profileUrls ?? [request.body?.profileUrl]);
    const current = await getDiscoveryStatus(user.id);
    if (current.status === "starting" || current.status === "running") return response.status(202).json(current);

    return response.status(202).json(await createDiscoveryRun(request, user.id, profileUrls));
  } catch (error) {
    return apiError(response, error);
  }
}
