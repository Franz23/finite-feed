import type { VercelRequest, VercelResponse } from "@vercel/node";
import { startActorRun } from "./_lib/apify.js";
import { adminClient } from "./_lib/supabase.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) return response.status(401).json({ error: "Unauthorized." });
  const db = adminClient();
  const { data: profiles, error } = await db.from("profiles").select("linkedin_url").order("linkedin_url").limit(5000);
  if (error) return response.status(500).json({ error: error.message });
  const profileRows = (profiles ?? []) as Array<{ linkedin_url: string }>;
  const urls = [...new Set(profileRows.map((profile) => profile.linkedin_url))];
  if (urls.length === 0) return response.status(200).json({ status: "empty" });
  try {
    await startActorRun(request, urls, null, 3);
    return response.status(202).json({ status: "running", profiles: urls.length });
  } catch (runError) {
    return response.status(500).json({ error: runError instanceof Error ? runError.message : "Refresh failed." });
  }
}
