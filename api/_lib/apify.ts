import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { canonicalLinkedInProfileUrl } from "../../src/linkedin.js";
import type { PostImage, PostMedia } from "../../src/types.js";
import { adminClient, publicAppUrl } from "./supabase.js";

type ActorPost = {
  id: string;
  profileId: string;
  linkedinUrl: string;
  content: string;
  kind: "original" | "repost" | "quote";
  publishedAt: string;
  likes: number;
  comments: number;
  reposts: number;
  profileName: string | null;
  profileHeadline: string | null;
  profileAvatarUrl: string | null;
  media: PostMedia | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nested(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function optionalNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function httpsUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

function postImage(value: unknown): PostImage | null {
  if (!isRecord(value)) return null;
  const url = httpsUrl(value.url);
  return url ? { url, width: optionalNumber(value, "width"), height: optionalNumber(value, "height") } : null;
}

function actorMedia(item: Record<string, unknown>): PostMedia | null {
  const repost = nested(item, "repost");
  const source =
    (Array.isArray(item.postImages) && item.postImages.length > 0) || isRecord(item.postVideo) || isRecord(item.document)
      ? item
      : repost ?? item;
  const images = Array.isArray(source.postImages)
    ? source.postImages.map(postImage).filter((image): image is PostImage => image !== null).slice(0, 4)
    : [];
  const rawVideo = nested(source, "postVideo");
  const videoUrl = httpsUrl(rawVideo?.videoUrl);
  const video = videoUrl ? { url: videoUrl, thumbnailUrl: httpsUrl(rawVideo?.thumbnailUrl) } : null;
  const rawDocument = nested(source, "document");
  const coverPages = Array.isArray(rawDocument?.coverPages) ? rawDocument.coverPages : [];
  const firstCover = coverPages.find(isRecord);
  const coverUrls = Array.isArray(firstCover?.imageUrls) ? firstCover.imageUrls : [];
  const document = rawDocument ? {
    title: stringValue(rawDocument, "title"),
    url: httpsUrl(rawDocument.transcribedDocumentUrl),
    coverUrl: coverUrls.map(httpsUrl).find((url): url is string => url !== null) ?? null,
    pageCount: optionalNumber(rawDocument, "totalPageCount"),
  } : null;
  return images.length > 0 || video || document ? { images, video, document } : null;
}

function findTrackedProfile(
  item: Record<string, unknown>,
  profiles: Map<string, { id: string; url: string }>,
): { id: string; url: string } | null {
  const author = nested(item, "author");
  const repostedBy = nested(item, "repostedBy");
  const header = nested(item, "header");
  const query = nested(item, "query");
  const candidates = [
    stringValue(item, "profileUrl"), stringValue(item, "targetUrl"), stringValue(item, "profile"),
    stringValue(author, "linkedinUrl"), stringValue(repostedBy, "linkedinUrl"),
    stringValue(header, "imageLink"), stringValue(query, "targetUrl"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const canonical = canonicalLinkedInProfileUrl(candidate);
    if (canonical && profiles.has(canonical)) return profiles.get(canonical) ?? null;
  }
  return null;
}

function normalizeActorPost(
  value: unknown,
  profiles: Map<string, { id: string; url: string }>,
): ActorPost | null {
  if (!isRecord(value)) return null;
  const tracked = findTrackedProfile(value, profiles);
  if (!tracked) return null;
  const linkedinUrl = stringValue(value, "linkedinUrl") ?? stringValue(value, "postUrl") ?? stringValue(value, "url");
  if (!linkedinUrl?.startsWith("https://www.linkedin.com/")) return null;
  const postedAt = nested(value, "postedAt");
  const repostedAt = nested(value, "repostedAt");
  const rawDate = stringValue(repostedAt, "date") ?? stringValue(postedAt, "date") ?? stringValue(value, "publishedAt");
  if (!rawDate || Number.isNaN(Date.parse(rawDate))) return null;
  const engagement = nested(value, "engagement") ?? nested(value, "stats");
  const rawType = (stringValue(value, "postType") ?? stringValue(value, "type") ?? "").toLowerCase();
  const hasRepost = ["repost", "repostedPost", "resharedPost", "sharedPost", "repostedBy", "repostedAt"]
    .some((key) => isRecord(value[key]));
  const kind: ActorPost["kind"] = rawType.includes("quote") ? "quote" : rawType.includes("repost") || hasRepost ? "repost" : "original";
  const author = nested(value, "author");
  const avatar = nested(author, "avatar");
  const headerImage = nested(nested(value, "header"), "image");
  const authorCanonical = canonicalLinkedInProfileUrl(stringValue(author, "linkedinUrl") ?? "");
  const authorIsTracked = authorCanonical === tracked.url;
  return {
    id: stringValue(value, "id") ?? stringValue(value, "postId") ?? linkedinUrl,
    profileId: tracked.id,
    linkedinUrl,
    content: stringValue(value, "content") ?? stringValue(value, "text") ?? "",
    kind,
    publishedAt: new Date(rawDate).toISOString(),
    likes: numberValue(engagement, "likes") || numberValue(engagement, "total_reactions"),
    comments: numberValue(engagement, "comments"),
    reposts: numberValue(engagement, "shares") || numberValue(engagement, "reposts"),
    profileName: authorIsTracked ? stringValue(author, "name") : stringValue(nested(value, "repostedBy"), "name"),
    profileHeadline: authorIsTracked ? stringValue(author, "info") : null,
    profileAvatarUrl: authorIsTracked ? httpsUrl(avatar?.url) : httpsUrl(headerImage?.url),
    media: actorMedia(value),
  };
}

export async function startActorRun(request: VercelRequest, targetUrls: string[], userId: string | null, days: number) {
  const token = process.env.APIFY_API_TOKEN;
  const secret = process.env.APIFY_WEBHOOK_SECRET;
  if (!token || !secret) throw new Error("Apify is not configured.");
  const db = adminClient();
  const { data: run, error: createError } = await db.from("refresh_runs").insert({
    user_id: userId, status: "starting", started_at: new Date().toISOString(),
  }).select("id").single();
  if (createError) throw createError;
  const callbackUrl = `${publicAppUrl(request)}/api/apify-webhook`;
  if (!callbackUrl.startsWith("https://")) throw new Error("A public APP_BASE_URL is required for refreshes.");
  const webhooks = Buffer.from(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
    requestUrl: callbackUrl,
    payloadTemplate: '{"eventType":{{eventType}},"resource":{{resource}}}',
    headersTemplate: JSON.stringify({ Authorization: `Bearer ${secret}` }),
  }])).toString("base64");
  const actorId = process.env.APIFY_ACTOR_ID || "harvestapi~linkedin-profile-posts";
  const actorUrl = new URL(`https://api.apify.com/v2/acts/${actorId}/runs`);
  actorUrl.searchParams.set("webhooks", webhooks);
  const actorResponse = await fetch(actorUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrls, maxPosts: 0,
      postedLimitDate: new Date(Date.now() - days * 86_400_000).toISOString(),
      includeReposts: true, includeQuotePosts: true, scrapeComments: false, scrapeReactions: false,
    }),
  });
  const payload: unknown = await actorResponse.json();
  const data = isRecord(payload) ? nested(payload, "data") : undefined;
  const actorRunId = stringValue(data, "id");
  if (!actorResponse.ok || !actorRunId) {
    const message = stringValue(nested(isRecord(payload) ? payload : undefined, "error"), "message") ?? "Apify rejected the refresh.";
    await db.from("refresh_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", run.id);
    throw new Error(message);
  }
  const { error: updateError } = await db.from("refresh_runs").update({ status: "running", actor_run_id: actorRunId }).eq("id", run.id);
  if (updateError) throw updateError;
  return actorRunId;
}

export async function ingestDataset(datasetId: string): Promise<number> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("Apify is not configured.");
  const db = adminClient();
  const { data: profileRows, error: profileError } = await db.from("profiles").select("id, linkedin_url").limit(5000);
  if (profileError) throw profileError;
  const typedProfiles = (profileRows ?? []) as Array<{ id: string; linkedin_url: string }>;
  const profiles = new Map<string, { id: string; url: string }>(typedProfiles.map((profile) => [profile.linkedin_url, { id: profile.id, url: profile.linkedin_url }]));
  const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${datasetId}/items`);
  datasetUrl.searchParams.set("clean", "true");
  datasetUrl.searchParams.set("format", "json");
  datasetUrl.searchParams.set("limit", "1000");
  const response = await fetch(datasetUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Could not fetch Apify dataset (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Apify returned an unexpected dataset shape.");
  const normalized = payload.map((item) => normalizeActorPost(item, profiles)).filter((post): post is ActorPost => post !== null);
  if (normalized.length === 0) return 0;
  const now = new Date().toISOString();
  const { error: postsError } = await db.from("posts").upsert(normalized.map((post) => ({
    id: post.id, profile_id: post.profileId, linkedin_url: post.linkedinUrl, content: post.content,
    post_kind: post.kind, published_at: post.publishedAt, likes: post.likes, comments: post.comments,
    reposts: post.reposts, media: post.media, last_observed_at: now,
  })), { onConflict: "id" });
  if (postsError) throw postsError;
  const profileUpdates = new Map<string, ActorPost>();
  for (const post of normalized) {
    const previous = profileUpdates.get(post.profileId);
    profileUpdates.set(post.profileId, {
      ...post,
      profileName: post.profileName ?? previous?.profileName ?? null,
      profileHeadline: post.profileHeadline ?? previous?.profileHeadline ?? null,
      profileAvatarUrl: post.profileAvatarUrl ?? previous?.profileAvatarUrl ?? null,
    });
  }
  await Promise.all([...profileUpdates.values()].map(async (post) => {
    const values: Record<string, string> = { last_scraped_at: now, updated_at: now };
    if (post.profileName) values.name = post.profileName;
    if (post.profileHeadline) values.headline = post.profileHeadline;
    if (post.profileAvatarUrl) values.avatar_url = post.profileAvatarUrl;
    const { error: updateError } = await db.from("profiles").update(values).eq("id", post.profileId);
    if (updateError) throw updateError;
  }));
  return normalized.length;
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
