import type { VercelRequest } from "@vercel/node";
import { canonicalLinkedInProfileUrl } from "../../src/linkedin.js";
import type { DiscoveryCandidate, DiscoveryStatus } from "../../src/types.js";
import { adminClient, publicAppUrl } from "./supabase.js";

export type DiscoveryKind = "posts" | "comments" | "reactions";

type Signal = {
  discovery_run_id: string;
  signal_type: "repost" | "comment" | "reaction";
  source_id: string;
  candidate_url: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  candidate_avatar_url: string | null;
  occurred_at: string | null;
};

type SignalRow = Omit<Signal, "discovery_run_id" | "source_id">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nested(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const child = value?.[key];
  return isRecord(child) ? child : undefined;
}

function stringValue(value: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function dateValue(value: string | null): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function authorSignal(
  author: Record<string, unknown> | undefined,
  signalType: SignalRow["signal_type"],
  sourceProfileUrl: string,
  occurredAt: string | null,
): SignalRow | null {
  const rawUrl = stringValue(author, "linkedinUrl", "profileUrl", "url");
  const candidateUrl = rawUrl ? canonicalLinkedInProfileUrl(rawUrl) : null;
  if (!candidateUrl || candidateUrl === sourceProfileUrl) return null;
  const avatar = nested(author, "avatar") ?? nested(author, "picture");
  return {
    signal_type: signalType,
    candidate_url: candidateUrl,
    candidate_name: stringValue(author, "name"),
    candidate_headline: stringValue(author, "info", "position", "headline"),
    candidate_avatar_url: stringValue(avatar, "url") ?? stringValue(author, "pictureUrl", "avatarUrl"),
    occurred_at: dateValue(occurredAt),
  };
}

function signalFromItem(value: unknown, kind: DiscoveryKind, sourceProfileUrl: string, index: number): SignalRow & { source_id: string } | null {
  if (!isRecord(value)) return null;
  const sourceId = stringValue(value, "id", "postId", "linkedinUrl") ?? `${kind}:${index}`;
  if (kind === "comments" || kind === "reactions") {
    const post = nested(value, "post");
    const postedAt = nested(post, "postedAt");
    const signal = authorSignal(
      nested(post, "author"),
      kind === "comments" ? "comment" : "reaction",
      sourceProfileUrl,
      stringValue(value, "createdAt") ?? stringValue(postedAt, "date"),
    );
    return signal ? { ...signal, source_id: sourceId } : null;
  }

  const repostedAt = nested(value, "repostedAt");
  const postedAt = nested(value, "postedAt");
  const candidates = [nested(value, "author"), nested(nested(value, "repost"), "author")];
  const signal = candidates.map((author) => authorSignal(
    author,
    "repost",
    sourceProfileUrl,
    stringValue(repostedAt, "date") ?? stringValue(postedAt, "date"),
  )).find((candidate): candidate is SignalRow => candidate !== null);
  return signal ? { ...signal, source_id: sourceId } : null;
}

function actorInput(kind: DiscoveryKind, profileUrl: string): Record<string, unknown> {
  if (kind === "posts") return {
    targetUrls: [profileUrl], maxPosts: 20, includeReposts: true, includeQuotePosts: true,
    scrapeComments: false, scrapeReactions: false,
  };
  return { profiles: [profileUrl], maxItems: 30 };
}

function actorId(kind: DiscoveryKind): string {
  if (kind === "comments") return process.env.APIFY_LINKEDIN_COMMENTS_ACTOR_ID || "harvestapi~linkedin-profile-comments";
  if (kind === "reactions") return process.env.APIFY_LINKEDIN_REACTIONS_ACTOR_ID || "harvestapi~linkedin-profile-reactions";
  return process.env.APIFY_ACTOR_ID || "harvestapi~linkedin-profile-posts";
}

export async function startDiscoveryActor(request: VercelRequest, actorRowId: string, kind: DiscoveryKind, profileUrl: string) {
  const token = process.env.APIFY_API_TOKEN;
  const secret = process.env.APIFY_WEBHOOK_SECRET;
  if (!token || !secret) throw new Error("Apify is not configured.");
  const db = adminClient();
  const callbackUrl = `${publicAppUrl(request)}/api/apify-webhook`;
  if (!callbackUrl.startsWith("https://")) throw new Error("A public APP_BASE_URL is required for discovery.");
  const webhooks = Buffer.from(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
    requestUrl: callbackUrl,
    payloadTemplate: '{"eventType":{{eventType}},"resource":{{resource}}}',
    headersTemplate: JSON.stringify({ Authorization: `Bearer ${secret}` }),
  }])).toString("base64");
  const url = new URL(`https://api.apify.com/v2/acts/${actorId(kind)}/runs`);
  url.searchParams.set("webhooks", webhooks);
  const actorResponse = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(actorInput(kind, profileUrl)),
  });
  const payload: unknown = await actorResponse.json();
  const data = isRecord(payload) ? nested(payload, "data") : undefined;
  const actorRunId = stringValue(data, "id");
  if (!actorResponse.ok || !actorRunId) {
    const message = stringValue(nested(isRecord(payload) ? payload : undefined, "error"), "message") ?? `Apify could not scan ${kind}.`;
    await db.from("discovery_actor_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", actorRowId);
    throw new Error(message);
  }
  const { error: updateError } = await db.from("discovery_actor_runs").update({ status: "running", actor_run_id: actorRunId }).eq("id", actorRowId);
  if (updateError) throw updateError;
  return actorRunId;
}

export async function finishDiscoveryRun(discoveryRunId: string): Promise<void> {
  const db = adminClient();
  const { data: actors, error } = await db.from("discovery_actor_runs").select("status, error").eq("discovery_run_id", discoveryRunId);
  if (error) throw error;
  if ((actors ?? []).some((actor) => actor.status === "starting" || actor.status === "running")) return;
  const succeeded = (actors ?? []).filter((actor) => actor.status === "succeeded").length;
  const failures = (actors ?? []).filter((actor) => actor.status === "failed");
  const status = succeeded > 0 ? "succeeded" : "failed";
  const runError = status === "failed"
    ? failures.map((actor) => actor.error).filter(Boolean).join(" ") || "We could not read public activity from that profile."
    : failures.length > 0 ? "Some activity sources were unavailable, so these recommendations may be narrower." : null;
  await db.from("discovery_runs").update({ status, finished_at: new Date().toISOString(), error: runError }).eq("id", discoveryRunId);
}

export async function failDiscoveryActor(actorRunId: string, message: string): Promise<boolean> {
  const db = adminClient();
  const { data: actor, error } = await db.from("discovery_actor_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), error: message })
    .eq("actor_run_id", actorRunId)
    .select("discovery_run_id")
    .maybeSingle();
  if (error) throw error;
  if (!actor) return false;
  await finishDiscoveryRun(actor.discovery_run_id);
  return true;
}

export async function finalizeDiscoveryActor(actorRunId: string, datasetId: string): Promise<number | null> {
  const db = adminClient();
  const { data: actor, error: actorError } = await db.from("discovery_actor_runs")
    .select("id, discovery_run_id, kind, discovery_runs(profile_url)")
    .eq("actor_run_id", actorRunId)
    .maybeSingle();
  if (actorError) throw actorError;
  if (!actor) return null;
  const parent = Array.isArray(actor.discovery_runs) ? actor.discovery_runs[0] : actor.discovery_runs;
  const sourceProfileUrl = typeof parent?.profile_url === "string" ? parent.profile_url : "";
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("Apify is not configured.");
  const url = new URL(`https://api.apify.com/v2/datasets/${datasetId}/items`);
  url.searchParams.set("clean", "true");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "100");
  const datasetResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!datasetResponse.ok) throw new Error(`Could not fetch discovery results (${datasetResponse.status}).`);
  const payload: unknown = await datasetResponse.json();
  if (!Array.isArray(payload)) throw new Error("Apify returned unexpected discovery results.");
  const signals: Signal[] = payload.flatMap((item, index) => {
    const signal = signalFromItem(item, actor.kind as DiscoveryKind, sourceProfileUrl, index);
    return signal ? [{ discovery_run_id: actor.discovery_run_id, ...signal }] : [];
  });
  if (signals.length > 0) {
    const { error: signalError } = await db.from("discovery_signals").upsert(signals, {
      onConflict: "discovery_run_id,signal_type,source_id",
    });
    if (signalError) throw signalError;
  }
  const { error: updateError } = await db.from("discovery_actor_runs").update({
    status: "succeeded", finished_at: new Date().toISOString(), items_received: payload.length, error: null,
  }).eq("id", actor.id);
  if (updateError) throw updateError;
  await finishDiscoveryRun(actor.discovery_run_id);
  return signals.length;
}

function scoreMultiplier(occurredAt: string | null): number {
  if (!occurredAt) return 1;
  const ageDays = Math.max(0, (Date.now() - Date.parse(occurredAt)) / 86_400_000);
  return ageDays <= 30 ? 1.5 : ageDays <= 90 ? 1.2 : 1;
}

export function rankSignals(signals: SignalRow[]): DiscoveryCandidate[] {
  const candidates = new Map<string, DiscoveryCandidate>();
  for (const signal of signals) {
    const candidate = candidates.get(signal.candidate_url) ?? {
      linkedinUrl: signal.candidate_url,
      name: signal.candidate_name,
      headline: signal.candidate_headline,
      avatarUrl: signal.candidate_avatar_url,
      comments: 0,
      reactions: 0,
      reposts: 0,
      score: 0,
      reason: "",
    };
    if (signal.candidate_name) candidate.name = signal.candidate_name;
    if (signal.candidate_headline) candidate.headline = signal.candidate_headline;
    if (signal.candidate_avatar_url) candidate.avatarUrl = signal.candidate_avatar_url;
    if (signal.signal_type === "comment") candidate.comments += 1;
    if (signal.signal_type === "reaction") candidate.reactions += 1;
    if (signal.signal_type === "repost") candidate.reposts += 1;
    const weight = signal.signal_type === "comment" ? 5 : signal.signal_type === "repost" ? 4 : 1;
    candidate.score += weight * scoreMultiplier(signal.occurred_at);
    candidates.set(signal.candidate_url, candidate);
  }
  return [...candidates.values()].map((candidate) => {
    const evidence = [
      candidate.comments ? `${candidate.comments} ${candidate.comments === 1 ? "comment" : "comments"}` : null,
      candidate.reposts ? `${candidate.reposts} ${candidate.reposts === 1 ? "repost" : "reposts"}` : null,
      candidate.reactions ? `${candidate.reactions} ${candidate.reactions === 1 ? "reaction" : "reactions"}` : null,
    ].filter((value): value is string => Boolean(value));
    return { ...candidate, score: Math.round(candidate.score * 10) / 10, reason: evidence.join(" · ") };
  }).sort((a, b) => b.score - a.score || b.comments - a.comments || b.reposts - a.reposts).slice(0, 20);
}

export async function getDiscoveryStatus(userId: string): Promise<DiscoveryStatus> {
  const db = adminClient();
  const { data: run, error } = await db.from("discovery_runs")
    .select("id, profile_url, status, started_at, finished_at, error")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!run) return { id: null, status: "idle", profileUrl: null, startedAt: null, finishedAt: null, error: null, candidates: [] };
  const { data: signals, error: signalsError } = await db.from("discovery_signals")
    .select("signal_type, candidate_url, candidate_name, candidate_headline, candidate_avatar_url, occurred_at")
    .eq("discovery_run_id", run.id);
  if (signalsError) throw signalsError;
  return {
    id: run.id,
    status: run.status,
    profileUrl: run.profile_url,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    error: run.error,
    candidates: rankSignals(signals ?? []),
  };
}
