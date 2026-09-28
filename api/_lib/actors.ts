import { canonicalLinkedInProfileUrl } from "../../src/linkedin.js";
import { canonicalSocialProfileUrl, type SocialPlatform } from "../../src/social.js";
import type { PostImage, PostMedia } from "../../src/types.js";

export type ActorTarget = { url: string; handle: string; profileId: string };
export type ActorAdapter = {
  id: string;
  platform: SocialPlatform;
  maxTargetsPerRun: number;
  buildInput(targets: ActorTarget[], sinceIso: string): Record<string, unknown>;
  isErrorItem(item: unknown): boolean;
  normalize(item: unknown, profiles: Map<string, { id: string; url: string }>): ActorPost | null;
};

export type ActorPost = {
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
  platform: SocialPlatform;
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

function normalizeLinkedInPost(
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
    platform: "linkedin",
  };
}

function xMedia(item: Record<string, unknown>): PostMedia | null {
  const extended = nested(item, "extendedEntities");
  const entries = (Array.isArray(extended?.media) && extended.media.length ? extended.media : Array.isArray(item.media) && item.media.length ? item.media : Array.isArray(item.videos) ? item.videos : []).filter(isRecord);
  const images = entries.flatMap((entry) => {
    const type = (stringValue(entry, "type") ?? "").toLowerCase();
    const url = httpsUrl(entry.url) ?? httpsUrl(entry.mediaUrl) ?? httpsUrl(entry.media_url_https);
    return type === "photo" && url ? [{ url, width: optionalNumber(entry, "width"), height: optionalNumber(entry, "height") }] : [];
  }).slice(0, 4);
  const videoEntry = entries.find((entry) => ["video", "animated_gif"].includes((stringValue(entry, "type") ?? "").toLowerCase()))
    ?? (Array.isArray(item.videos) ? item.videos.filter(isRecord)[0] : undefined);
  const videoInfo = nested(videoEntry, "video_info");
  const variants = Array.isArray(videoInfo?.variants) ? videoInfo.variants.filter(isRecord)
    : Array.isArray(videoEntry?.videoVariants) ? videoEntry.videoVariants.filter(isRecord) : [];
  const bestMp4 = variants.filter((variant) => stringValue(variant, "content_type") === "video/mp4" || stringValue(variant, "contentType") === "video/mp4")
    .sort((a, b) => numberValue(b, "bitrate") - numberValue(a, "bitrate"))[0];
  const videoUrl = httpsUrl(bestMp4?.url) ?? httpsUrl(videoEntry?.videoUrl) ?? httpsUrl(videoEntry?.url);
  const video = videoUrl ? {
    url: videoUrl,
    thumbnailUrl: httpsUrl(videoEntry?.media_url_https) ?? httpsUrl(videoEntry?.mediaUrl) ?? httpsUrl(videoEntry?.previewImageUrl) ?? httpsUrl(videoEntry?.thumbnailUrl),
  } : null;
  return images.length > 0 || video ? { images, video, document: null } : null;
}

function normalizeXPost(
  value: unknown,
  profiles: Map<string, { id: string; url: string }>,
): ActorPost | null {
  if (!isRecord(value) || value.isReply === true) return null;
  const username = stringValue(value, "authorUserName") ?? stringValue(value, "authorUsername") ?? stringValue(nested(value, "author"), "userName") ?? stringValue(nested(value, "author"), "username");
  const canonical = username ? canonicalSocialProfileUrl(`https://x.com/${username}`) : null;
  const tracked = canonical ? profiles.get(canonical.url) : null;
  if (!tracked) return null;
  const id = stringValue(value, "id") ?? stringValue(value, "tweetId");
  const postUrl = stringValue(value, "twitterUrl") ?? stringValue(value, "url") ?? (id ? `${tracked.url}/status/${id}` : null);
  const rawDate = stringValue(value, "createdAt");
  if (!id || !postUrl || !rawDate || Number.isNaN(Date.parse(rawDate))) return null;
  const author = nested(value, "author");
  const retweet = nested(value, "retweet") ?? nested(value, "retweeted_tweet");
  return {
    id: `x:${id}`,
    profileId: tracked.id,
    linkedinUrl: postUrl,
    content: value.isRetweet === true && stringValue(retweet, "fullText")
      ? `RT @${stringValue(nested(retweet, "author"), "userName") ?? stringValue(nested(retweet, "author"), "username") ?? "unknown"}: ${stringValue(retweet, "fullText")}`
      : stringValue(value, "fullText") ?? stringValue(value, "text") ?? "",
    kind: value.isQuote === true || value.isQuoteStatus === true ? "quote" : value.isRetweet === true ? "repost" : "original",
    publishedAt: new Date(rawDate).toISOString(),
    likes: numberValue(value, "likeCount"),
    comments: numberValue(value, "replyCount"),
    reposts: numberValue(value, "retweetCount") + numberValue(value, "quoteCount"),
    profileName: stringValue(author, "name") ?? username,
    profileHeadline: stringValue(author, "description"),
    profileAvatarUrl: httpsUrl(author?.profilePicture),
    media: xMedia(value),
    platform: "x",
  };
}


export const harvestapiLinkedInPosts: ActorAdapter = {
  id: "harvestapi~linkedin-profile-posts", platform: "linkedin", maxTargetsPerRun: 25,
  buildInput: (targets, sinceIso) => ({ targetUrls: targets.map((target) => target.url), maxPosts: 0,
    postedLimitDate: sinceIso, includeReposts: true, includeQuotePosts: true,
    scrapeComments: false, scrapeReactions: false }),
  isErrorItem: (item) => isRecord(item) && (Boolean(item.error) || !stringValue(item, "linkedinUrl") && !stringValue(item, "postUrl") && !stringValue(item, "url") && !stringValue(item, "content") && !stringValue(item, "text")),
  normalize: normalizeLinkedInPost,
};
export const apidojoTweets: ActorAdapter = {
  id: "apidojo~tweet-scraper", platform: "x", maxTargetsPerRun: 1,
  buildInput: (targets, sinceIso) => ({ twitterHandles: targets.map((target) => target.handle),
    start: new Date(sinceIso).toISOString().slice(0, 10),
    maxItems: targets.length * 40, sort: "Latest" }),
  isErrorItem: (item) => isRecord(item) && (item.error === true || item.type === "error" || !stringValue(item, "id")),
  normalize: normalizeXPost,
};
export const xquikTweets: ActorAdapter = {
  id: "xquik~x-tweet-scraper", platform: "x", maxTargetsPerRun: 25,
  buildInput: (targets, sinceIso) => ({ twitterHandles: targets.map((target) => target.handle),
    since: new Date(sinceIso).toISOString().replace("T", "_").replace(/\.\d{3}Z$/, "_UTC"),
    maxItemsPerTarget: 40, maxItems: targets.length * 40 }),
  isErrorItem: (item) => apidojoTweets.isErrorItem(item) || isRecord(item) && (item.resultType === "diagnostic" || (stringValue(item, "id") ?? "").startsWith("diag:")),
  normalize: normalizeXPost,
};
const adapters = [harvestapiLinkedInPosts, apidojoTweets, xquikTweets];
export function adapterById(id: string): ActorAdapter | null { return adapters.find((adapter) => adapter.id === id) ?? null; }
export function actorChain(platform: SocialPlatform): ActorAdapter[] {
  const legacy = platform === "x" ? process.env.APIFY_X_ACTOR_ID : null;
  if (legacy) console.warn("APIFY_X_ACTOR_ID is deprecated; use APIFY_X_ACTOR_CHAIN.");
  const defaultXChain = "apidojo~tweet-scraper,xquik~x-tweet-scraper";
  const raw = platform === "x"
    ? process.env.APIFY_X_ACTOR_CHAIN ?? (legacy === "nick.cheng~x-twitter-profile-tweets-scraper" ? defaultXChain : legacy ?? defaultXChain)
    : process.env.APIFY_LINKEDIN_ACTOR_CHAIN ?? process.env.APIFY_ACTOR_ID ?? "harvestapi~linkedin-profile-posts";
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.length) throw new Error(`Empty ${platform} actor chain.`);
  return ids.map((id) => {
    const adapter = adapterById(id);
    if (!adapter || adapter.platform !== platform) throw new Error(`Unknown ${platform} actor adapter: ${id}`);
    return adapter;
  });
}

export function chunkActorTargets<T>(targets: T[], adapter: ActorAdapter): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < targets.length; index += adapter.maxTargetsPerRun) {
    chunks.push(targets.slice(index, index + adapter.maxTargetsPerRun));
  }
  return chunks;
}
