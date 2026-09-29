import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { actorChain, adapterById, chunkActorTargets, type ActorAdapter, type ActorTarget } from "./actors.js";
import { canonicalSocialProfileUrl, type SocialPlatform } from "../../src/social.js";
import { adminClient, publicAppUrl } from "./supabase.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nested(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key]; return isRecord(value) ? value : undefined;
}
function stringValue(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key]; return typeof value === "string" && value.trim() ? value : null;
}

export type RunDecision = { outcome: "succeeded" | "failed" | "fallback"; reason: string | null };
export function chunksOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function databaseError(stage: string, error: { message: string; code?: string }): Error {
  return new Error(`${stage} failed (${error.code ?? "unknown"}): ${error.message}`);
}

export function decideRunOutcome(input: {
  apifyStatus: "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";
  rawItems: number; errorItems: number; posts: number;
  targetsWithPostInLast14Days: number; attempt: number; chainLength: number;
  missingDataset?: boolean;
}): RunDecision {
  const reason = input.missingDataset ? "Apify completed without a dataset."
    : input.apifyStatus !== "SUCCEEDED" ? `Apify run ended with ${input.apifyStatus}.`
    : input.errorItems > 0 && input.posts === 0 ? "actor returned only error records"
    : input.rawItems === 0 && input.targetsWithPostInLast14Days > 0 ? "actor returned nothing for accounts that posted recently"
    : null;
  return reason ? { outcome: input.attempt < input.chainLength ? "fallback" : "failed", reason }
    : { outcome: "succeeded", reason: null };
}

function webhookConfig(callbackUrl: string, secret: string): string {
  return Buffer.from(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
    requestUrl: callbackUrl,
    payloadTemplate: '{"eventType":{{eventType}},"resource":{{resource}}}',
    headersTemplate: JSON.stringify({ Authorization: `Bearer ${secret}` }),
  }])).toString("base64");
}

export async function startActorRun(
  request: VercelRequest,
  targetUrls: string[],
  userId: string | null,
  since: string,
  platform: SocialPlatform = "linkedin",
  batchId?: string,
  adapter: ActorAdapter = actorChain(platform)[0],
  attempt = 1,
): Promise<string[]> {
  const token = process.env.APIFY_API_TOKEN;
  const secret = process.env.APIFY_WEBHOOK_SECRET;
  if (!token || !secret) throw new Error("Apify is not configured.");
  const callbackUrl = `${publicAppUrl(request)}/api/apify-webhook`;
  if (!callbackUrl.startsWith("https://")) throw new Error("A public APP_BASE_URL is required for refreshes.");
  const db = adminClient();
  const { data: profileRows, error: profileError } = await db.from("profiles")
    .select("id, linkedin_url").in("linkedin_url", targetUrls);
  if (profileError) throw profileError;
  const profileByUrl = new Map((profileRows ?? []).map((row) => [row.linkedin_url as string, row.id as string]));
  const targets: ActorTarget[] = targetUrls.map((url) => ({
    url, handle: new URL(url).pathname.split("/").filter(Boolean)[0], profileId: profileByUrl.get(url) ?? "",
  }));
  const runIds: string[] = [];
  for (const chunk of chunkActorTargets(targets, adapter)) {
    const chunkUrls = chunk.map((target) => target.url);
    const { data: run, error: createError } = await db.from("refresh_runs").insert({
      user_id: userId, status: "starting", target_urls: chunkUrls, platform, batch_id: batchId,
      actor_id: adapter.id, attempt, since_iso: since, callback_url: callbackUrl,
      started_at: new Date().toISOString(),
    }).select("id").single();
    if (createError) throw createError;
    const actorUrl = new URL(`https://api.apify.com/v2/acts/${adapter.id}/runs`);
    actorUrl.searchParams.set("webhooks", webhookConfig(callbackUrl, secret));
    let response: Response;
    try {
      response = await fetch(actorUrl, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(adapter.buildInput(chunk, since)),
      });
    } catch (error) {
      response = new Response(JSON.stringify({ error: { message: error instanceof Error ? error.message : "Apify request failed." } }), { status: 503 });
    }
    const payload: unknown = await response.json();
    const data = isRecord(payload) ? nested(payload, "data") : undefined;
    const actorRunId = stringValue(data, "id");
    if (!response.ok || !actorRunId) {
      const message = stringValue(nested(isRecord(payload) ? payload : undefined, "error"), "message") ?? "Apify rejected the refresh.";
      const next = actorChain(platform)[attempt];
      await db.from("refresh_runs").update({ status: "failed", finished_at: new Date().toISOString(),
        error: next ? `fallback: ${message}` : message }).eq("id", run.id);
      if (next) {
        runIds.push(...await startActorRun(request, chunkUrls, userId, since, platform, batchId, next, attempt + 1));
        continue;
      }
      throw new Error(message);
    }
    const { error: updateError } = await db.from("refresh_runs").update({ status: "running", actor_run_id: actorRunId }).eq("id", run.id);
    if (updateError) throw updateError;
    runIds.push(actorRunId);
  }
  return runIds;
}

export async function ingestDataset(datasetId: string, adapter: ActorAdapter): Promise<{ rawItems: number; errorItems: number; posts: number }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("Apify is not configured.");
  const db = adminClient();
  const { data: profileRows, error: profileError } = await db.from("profiles").select("id, linkedin_url").eq("platform", adapter.platform).limit(5000);
  if (profileError) throw profileError;
  const profiles = new Map<string, { id: string; url: string }>((profileRows ?? []).map((profile) => {
    const canonical = canonicalSocialProfileUrl(profile.linkedin_url);
    return [canonical?.url ?? profile.linkedin_url, { id: profile.id, url: profile.linkedin_url }];
  }));
  const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${datasetId}/items`);
  datasetUrl.searchParams.set("clean", "true"); datasetUrl.searchParams.set("format", "json");
  datasetUrl.searchParams.set("limit", "1000");
  const response = await fetch(datasetUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Could not fetch Apify dataset (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Apify returned an unexpected dataset shape.");
  const errorItems = payload.filter((item) => adapter.isErrorItem(item)).length;
  const candidates = payload.filter((item) => !adapter.isErrorItem(item))
    .map((item) => adapter.normalize(item, profiles)).filter((post) => post !== null);
  const uniqueByUrl = [...new Map(candidates.map((post) => [post.linkedinUrl, post])).values()];
  if (uniqueByUrl.length === 0) return { rawItems: payload.length, errorItems, posts: 0 };
  const existingIdByUrl = new Map<string, string>();
  for (const posts of chunksOf(uniqueByUrl, 50)) {
    const { data, error } = await db.from("posts").select("id, linkedin_url")
      .in("linkedin_url", posts.map((post) => post.linkedinUrl));
    if (error) throw databaseError("Post lookup", error);
    for (const post of data ?? []) existingIdByUrl.set(post.linkedin_url, post.id);
  }
  const normalized = uniqueByUrl.map((post) => ({ ...post, id: existingIdByUrl.get(post.linkedinUrl) ?? post.id }));
  const now = new Date().toISOString();
  for (const posts of chunksOf(normalized, 50)) {
    const { error } = await db.from("posts").upsert(posts.map((post) => ({
      id: post.id, profile_id: post.profileId, linkedin_url: post.linkedinUrl, content: post.content,
      post_kind: post.kind, published_at: post.publishedAt, likes: post.likes, comments: post.comments,
      reposts: post.reposts, media: post.media, platform: post.platform, last_observed_at: now,
    })), { onConflict: "id" });
    if (error) throw databaseError("Post save", error);
  }
  const profileUpdates = new Map<string, typeof normalized[number]>();
  for (const post of normalized) profileUpdates.set(post.profileId, post);
  await Promise.all([...profileUpdates.values()].map(async (post) => {
    const values: Record<string, string> = { updated_at: now };
    if (post.profileName) values.name = post.profileName;
    if (post.profileHeadline) values.headline = post.profileHeadline;
    if (post.profileAvatarUrl) values.avatar_url = post.profileAvatarUrl;
    const { error } = await db.from("profiles").update(values).eq("id", post.profileId);
    if (error) throw error;
  }));
  return { rawItems: payload.length, errorItems, posts: uniqueByUrl.length };
}

export async function finalizeActorRun(
  actorRunId: string, datasetId: string | null, apifyStatus: "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED" = "SUCCEEDED",
): Promise<number> {
  const db = adminClient();
  const { data: run, error: runError } = await db.from("refresh_runs")
    .select("id, user_id, target_urls, platform, batch_id, actor_id, attempt, since_iso, callback_url, started_at, status")
    .eq("actor_run_id", actorRunId).maybeSingle();
  if (runError) throw runError;
  if (!run || run.status === "succeeded" || run.status === "failed") return 0;
  const platform: SocialPlatform = run.platform === "x" ? "x" : "linkedin";
  const adapter = adapterById(run.actor_id);
  if (!adapter) throw new Error(`Unknown stored actor adapter: ${run.actor_id}`);
  const chain = actorChain(platform);
  const attempt = Number(run.attempt) || 1;
  const targetUrls = Array.isArray(run.target_urls) ? run.target_urls.filter((url: unknown): url is string => typeof url === "string") : [];
  let stats: { rawItems: number; errorItems: number; posts: number };
  try {
    stats = apifyStatus === "SUCCEEDED" && datasetId ? await ingestDataset(datasetId, adapter) : { rawItems: 0, errorItems: 0, posts: 0 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown dataset processing error";
    console.error(JSON.stringify({ event: "refresh_ingest_failed", actor_run_id: actorRunId, reason }));
    const { error: failError } = await db.from("refresh_runs").update({
      status: "failed", finished_at: new Date().toISOString(), error: `Could not process scraped posts: ${reason}`,
    }).eq("id", run.id).eq("status", "running");
    if (failError) throw failError;
    return 0;
  }
  const { data: profileRows, error: profileError } = await db.from("profiles").select("id").in("linkedin_url", targetUrls);
  if (profileError) throw profileError;
  const ids = (profileRows ?? []).map((row) => row.id);
  let targetsWithPostInLast14Days = 0;
  if (ids.length) {
    const { data: recent, error: recentError } = await db.from("posts").select("profile_id")
      .in("profile_id", ids).gte("published_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
    if (recentError) throw recentError;
    targetsWithPostInLast14Days = new Set((recent ?? []).map((row) => row.profile_id)).size;
  }
  const decision = decideRunOutcome({ apifyStatus, ...stats, targetsWithPostInLast14Days,
    attempt, chainLength: chain.length, missingDataset: apifyStatus === "SUCCEEDED" && !datasetId });
  console.info(JSON.stringify({ event: "refresh_outcome", platform, actor_id: adapter.id, attempt,
    outcome: decision.outcome, reason: decision.reason, rawItems: stats.rawItems,
    errorItems: stats.errorItems, posts: stats.posts }));
  const now = new Date().toISOString();
  const { data: transitioned, error: updateError } = await db.from("refresh_runs").update({
    status: decision.outcome === "succeeded" ? "succeeded" : "failed", finished_at: now,
    items_received: stats.rawItems, error_items: stats.errorItems, posts_received: stats.posts,
    error: decision.outcome === "fallback" ? `fallback: ${decision.reason}` : decision.reason,
  }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
  if (updateError) throw updateError;
  if (!transitioned) return 0;
  if (decision.outcome === "succeeded" && targetUrls.length) {
    const checkedThrough = typeof run.started_at === "string" ? run.started_at : now;
    const { error } = await db.from("profiles").update({ last_scraped_at: checkedThrough, updated_at: now }).in("linkedin_url", targetUrls);
    if (error) throw error;
  }
  if (decision.outcome === "fallback") {
    const next = chain[attempt];
    if (!next) throw new Error("Fallback adapter is missing.");
    const callbackBase = typeof run.callback_url === "string" ? run.callback_url.replace(/\/api\/apify-webhook$/, "") : process.env.APP_BASE_URL;
    if (!callbackBase) throw new Error("Missing callback URL for actor fallback.");
    const fallbackRequest = { headers: { host: new URL(callbackBase).host } } as VercelRequest;
    await startActorRun(fallbackRequest, targetUrls, run.user_id, run.since_iso, platform, run.batch_id, next, attempt + 1);
  }
  return stats.posts;
}

export async function reconcileActorRun(actorRunId: string): Promise<"running" | "succeeded" | "failed"> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("Apify is not configured.");
  const response = await fetch(`https://api.apify.com/v2/actor-runs/${actorRunId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload: unknown = await response.json();
  const data = isRecord(payload) ? nested(payload, "data") : undefined;
  if (!response.ok || !data) throw new Error(`Could not check Apify run (${response.status}).`);
  const status = stringValue(data, "status");
  if (status === "SUCCEEDED" || status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") {
    await finalizeActorRun(actorRunId, stringValue(data, "defaultDatasetId"), status);
    return status === "SUCCEEDED" ? "succeeded" : "failed";
  }
  return "running";
}

export function verifyWebhookSecret(provided: string): boolean {
  const expected = process.env.APIFY_WEBHOOK_SECRET ?? "";
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function webhookDetails(value: unknown): { actorRunId: string; status: string; datasetId: string | null } | null {
  if (!isRecord(value)) return null;
  const resource = nested(value, "resource");
  const actorRunId = stringValue(resource, "id");
  const status = stringValue(resource, "status");
  if (!actorRunId || !status) return null;
  return { actorRunId, status, datasetId: stringValue(resource, "defaultDatasetId") };
}
