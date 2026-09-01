import { canonicalLinkedInProfileUrl, parseProfileCsv } from "./csv";
import type { Bootstrap, FeedPost, HistoryItem, Profile, RefreshStatus } from "./types";
import { timingSafeEqual } from "node:crypto";

type DbFeedRow = {
  id: string;
  profile_id: string;
  profile_name: string | null;
  profile_url: string;
  linkedin_url: string;
  content: string | null;
  post_kind: "original" | "repost" | "quote";
  published_at: string;
  likes: number;
  comments: number;
  reposts: number;
};

type DbProfileRow = {
  id: string;
  name: string | null;
  linkedin_url: string;
  last_scraped_at: string | null;
};

type DbHistoryRow = {
  id: string;
  profile_name: string | null;
  profile_url: string;
  linkedin_url: string;
  published_at: string;
  seen_at: string;
};

type DbRefreshRow = {
  status: "starting" | "running" | "succeeded" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

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
};

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), { ...init, headers: { ...jsonHeaders, ...init.headers } });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function profileLabel(name: string | null, profileUrl: string): string {
  return name?.trim() || profileUrl.split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ") || "LinkedIn member";
}

async function getBootstrap(request: Request, env: Env): Promise<Response> {
  const [feedResult, profilesResult, historyResult, refreshRow] = await Promise.all([
    env.DB.prepare(
      `SELECT posts.id, posts.profile_id, profiles.name AS profile_name,
        profiles.linkedin_url AS profile_url, posts.linkedin_url, posts.content,
        posts.post_kind, posts.published_at, posts.likes, posts.comments, posts.reposts
       FROM posts JOIN profiles ON profiles.id = posts.profile_id
       WHERE posts.seen_at IS NULL AND posts.archived_reason IS NULL
       ORDER BY posts.published_at DESC LIMIT 250`,
    ).all<DbFeedRow>(),
    env.DB.prepare(
      `SELECT id, name, linkedin_url, last_scraped_at
       FROM profiles WHERE active = 1 ORDER BY COALESCE(name, linkedin_url) COLLATE NOCASE`,
    ).all<DbProfileRow>(),
    env.DB.prepare(
      `SELECT posts.id, profiles.name AS profile_name, profiles.linkedin_url AS profile_url,
        posts.linkedin_url, posts.published_at, posts.seen_at
       FROM posts JOIN profiles ON profiles.id = posts.profile_id
       WHERE posts.seen_at IS NOT NULL
       ORDER BY posts.seen_at DESC LIMIT 100`,
    ).all<DbHistoryRow>(),
    env.DB.prepare(
      `SELECT status, started_at, finished_at, error
       FROM refresh_runs ORDER BY started_at DESC LIMIT 1`,
    ).first<DbRefreshRow>(),
  ]);

  const feed: FeedPost[] = feedResult.results.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    profileName: profileLabel(row.profile_name, row.profile_url),
    profileUrl: row.profile_url,
    linkedinUrl: row.linkedin_url,
    content: row.content ?? "Open this post on LinkedIn to read it.",
    kind: row.post_kind,
    publishedAt: row.published_at,
    likes: row.likes,
    comments: row.comments,
    reposts: row.reposts,
  }));

  const profiles: Profile[] = profilesResult.results.map((row) => ({
    id: row.id,
    name: row.name,
    linkedinUrl: row.linkedin_url,
    lastScrapedAt: row.last_scraped_at,
  }));

  const history: HistoryItem[] = historyResult.results.map((row) => ({
    id: row.id,
    profileName: profileLabel(row.profile_name, row.profile_url),
    linkedinUrl: row.linkedin_url,
    publishedAt: row.published_at,
    seenAt: row.seen_at,
  }));

  const refresh: RefreshStatus = refreshRow
    ? {
        status: refreshRow.status,
        startedAt: refreshRow.started_at,
        finishedAt: refreshRow.finished_at,
        error: refreshRow.error,
      }
    : { status: "idle", startedAt: null, finishedAt: null, error: null };

  const payload: Bootstrap = {
    feed,
    profiles,
    history,
    refresh,
    apifyConfigured: Boolean(env.APIFY_API_TOKEN && env.APIFY_WEBHOOK_SECRET),
    demoMode: ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname),
  };
  return json(payload);
}

async function importProfiles(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0) return errorResponse("Choose a CSV file to upload.");
  if (contentLength > 512_000) return errorResponse("Keep the CSV under 500 KB.", 413);

  const csv = await request.text();
  let parsed: ReturnType<typeof parseProfileCsv>;
  try {
    parsed = parseProfileCsv(csv);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "The CSV could not be read.");
  }
  if (parsed.profiles.length === 0) return errorResponse(parsed.errors[0]?.message ?? "No valid profiles were found.");

  const existing = await env.DB.prepare("SELECT linkedin_url FROM profiles WHERE active = 1").all<{
    linkedin_url: string;
  }>();
  const incomingUrls = new Set(parsed.profiles.map((profile) => profile.linkedinUrl));
  const deactivated = existing.results.filter((row) => !incomingUrls.has(row.linkedin_url)).length;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [env.DB.prepare("UPDATE profiles SET active = 0, updated_at = ?").bind(now)];

  for (const profile of parsed.profiles) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO profiles (id, linkedin_url, name, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(linkedin_url) DO UPDATE SET
           name = COALESCE(excluded.name, profiles.name), active = 1, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), profile.linkedinUrl, profile.name, now, now),
    );
  }

  await env.DB.batch(statements);
  return json({ imported: parsed.profiles.length, deactivated, errors: parsed.errors });
}

async function markPostsSeen(request: Request, env: Env): Promise<Response> {
  const body: unknown = await request.json();
  if (!isRecord(body) || !Array.isArray(body.ids)) return errorResponse("Send an array of post IDs.");
  const ids = [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length <= 200))].slice(0, 100);
  if (ids.length === 0) return errorResponse("No valid post IDs were supplied.");
  const seenAt = new Date().toISOString();
  const statements = ids.map((id) =>
    env.DB.prepare(
      `UPDATE posts SET content = NULL, seen_at = COALESCE(seen_at, ?),
       archived_reason = COALESCE(archived_reason, 'seen') WHERE id = ?`,
    ).bind(seenAt, id),
  );
  const results = await env.DB.batch(statements);
  const updated = results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
  return json({ updated });
}

async function verifySecret(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
}

async function startRefresh(env: Env): Promise<Response> {
  if (!env.APIFY_API_TOKEN || !env.APIFY_WEBHOOK_SECRET) {
    return errorResponse("Apify is not connected yet. Add the two secrets in .dev.vars, then restart the app.", 503);
  }

  const current = await env.DB.prepare(
    "SELECT id FROM refresh_runs WHERE status IN ('starting', 'running') ORDER BY started_at DESC LIMIT 1",
  ).first<{ id: string }>();
  if (current) return json({ status: "running" }, { status: 202 });

  const profiles = await env.DB.prepare("SELECT linkedin_url FROM profiles WHERE active = 1").all<{
    linkedin_url: string;
  }>();
  if (profiles.results.length === 0) return errorResponse("Upload at least one LinkedIn profile first.");

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO refresh_runs (id, status, started_at) VALUES (?, 'starting', ?)",
  ).bind(id, startedAt).run();

  const callbackUrl = new URL("/api/apify/webhook", env.APP_BASE_URL).toString();
  const webhookConfig = [
    {
      eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
      requestUrl: callbackUrl,
      payloadTemplate: '{"eventType":{{eventType}},"resource":{{resource}}}',
      headersTemplate: JSON.stringify({ Authorization: `Bearer ${env.APIFY_WEBHOOK_SECRET}` }),
    },
  ];
  const webhooks = btoa(JSON.stringify(webhookConfig));
  const actorUrl = new URL(`https://api.apify.com/v2/acts/${env.APIFY_ACTOR_ID}/runs`);
  actorUrl.searchParams.set("webhooks", webhooks);

  const postedLimitDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(actorUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.APIFY_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrls: profiles.results.map((profile) => profile.linkedin_url),
      maxPosts: 3,
      postedLimitDate,
      includeReposts: true,
      includeQuotePosts: true,
      scrapeComments: false,
      scrapeReactions: false,
    }),
  });

  const payload: unknown = await response.json();
  const data = isRecord(payload) ? nestedRecord(payload, "data") : undefined;
  const actorRunId = stringValue(data, "id");
  if (!response.ok || !actorRunId) {
    const message = stringValue(isRecord(payload) ? nestedRecord(payload, "error") : undefined, "message") ?? "Apify rejected the refresh.";
    await env.DB.prepare(
      "UPDATE refresh_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
    ).bind(new Date().toISOString(), message, id).run();
    return errorResponse(message, 502);
  }

  await env.DB.prepare("UPDATE refresh_runs SET status = 'running', actor_run_id = ? WHERE id = ?")
    .bind(actorRunId, id)
    .run();
  return json({ status: "running" }, { status: 202 });
}

function findTrackedProfile(
  item: Record<string, unknown>,
  profiles: Map<string, { id: string; url: string }>,
): { id: string; url: string } | null {
  const author = nestedRecord(item, "author");
  const candidates = [
    stringValue(item, "profileUrl"),
    stringValue(item, "targetUrl"),
    stringValue(item, "profile"),
    stringValue(author, "linkedinUrl"),
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
  if (!linkedinUrl || !linkedinUrl.startsWith("https://www.linkedin.com/")) return null;
  const postedAt = nestedRecord(value, "postedAt");
  const rawDate = stringValue(postedAt, "date") ?? stringValue(value, "publishedAt") ?? stringValue(value, "createdAt");
  if (!rawDate || Number.isNaN(Date.parse(rawDate))) return null;
  const engagement = nestedRecord(value, "engagement") ?? nestedRecord(value, "stats");
  const rawType = (stringValue(value, "postType") ?? stringValue(value, "type") ?? "").toLowerCase();
  const hasRepost = ["repost", "repostedPost", "resharedPost", "sharedPost"].some((key) => isRecord(value[key]));
  const kind: ActorPost["kind"] = rawType.includes("quote") ? "quote" : rawType.includes("repost") || hasRepost ? "repost" : "original";
  const id = stringValue(value, "id") ?? stringValue(value, "postId") ?? linkedinUrl;

  return {
    id,
    profileId: tracked.id,
    linkedinUrl,
    content: stringValue(value, "content") ?? stringValue(value, "text") ?? "",
    kind,
    publishedAt: new Date(rawDate).toISOString(),
    likes: numberValue(engagement, "likes") || numberValue(engagement, "total_reactions"),
    comments: numberValue(engagement, "comments"),
    reposts: numberValue(engagement, "shares") || numberValue(engagement, "reposts"),
  };
}

async function ingestDataset(env: Env, datasetId: string): Promise<number> {
  const profilesResult = await env.DB.prepare("SELECT id, linkedin_url FROM profiles").all<{
    id: string;
    linkedin_url: string;
  }>();
  const profiles = new Map(profilesResult.results.map((profile) => [profile.linkedin_url, { id: profile.id, url: profile.linkedin_url }]));
  const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${datasetId}/items`);
  datasetUrl.searchParams.set("clean", "true");
  datasetUrl.searchParams.set("format", "json");
  datasetUrl.searchParams.set("limit", "500");
  const response = await fetch(datasetUrl, { headers: { Authorization: `Bearer ${env.APIFY_API_TOKEN}` } });
  if (!response.ok) throw new Error(`Could not fetch Apify dataset (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Apify returned an unexpected dataset shape.");
  const normalized = payload.map((item) => normalizeActorPost(item, profiles)).filter((post): post is ActorPost => post !== null);
  const now = new Date().toISOString();
  const statements = normalized.map((post) =>
    env.DB.prepare(
      `INSERT INTO posts (
        id, profile_id, linkedin_url, content, post_kind, published_at,
        likes, comments, reposts, first_seen_at, last_observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        likes = excluded.likes, comments = excluded.comments, reposts = excluded.reposts,
        last_observed_at = excluded.last_observed_at,
        content = CASE WHEN posts.seen_at IS NULL THEN excluded.content ELSE posts.content END`,
    ).bind(
      post.id,
      post.profileId,
      post.linkedinUrl,
      post.content,
      post.kind,
      post.publishedAt,
      post.likes,
      post.comments,
      post.reposts,
      now,
      now,
    ),
  );
  if (statements.length > 0) await env.DB.batch(statements);
  return normalized.length;
}

async function handleApifyWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.APIFY_WEBHOOK_SECRET) return errorResponse("Webhook secret is not configured.", 503);
  const authorization = request.headers.get("Authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!(await verifySecret(provided, env.APIFY_WEBHOOK_SECRET))) return errorResponse("Unauthorized.", 401);

  const body: unknown = await request.json();
  if (!isRecord(body)) return errorResponse("Invalid webhook payload.");
  const resource = nestedRecord(body, "resource");
  const actorRunId = stringValue(resource, "id");
  const status = stringValue(resource, "status");
  const datasetId = stringValue(resource, "defaultDatasetId");
  if (!actorRunId || !status) return errorResponse("Webhook payload is missing run details.");

  ctx.waitUntil(
    (async () => {
      try {
        if (status !== "SUCCEEDED" || !datasetId) {
          await env.DB.prepare(
            "UPDATE refresh_runs SET status = 'failed', finished_at = ?, error = ? WHERE actor_run_id = ?",
          ).bind(new Date().toISOString(), `Apify run ended with ${status}.`, actorRunId).run();
          return;
        }
        const count = await ingestDataset(env, datasetId);
        const completedAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE refresh_runs SET status = 'succeeded', finished_at = ?, posts_received = ? WHERE actor_run_id = ?",
          ).bind(completedAt, count, actorRunId),
          env.DB.prepare("UPDATE profiles SET last_scraped_at = ? WHERE active = 1").bind(completedAt),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dataset import failed.";
        console.error(JSON.stringify({ message: "apify webhook import failed", error: message, actorRunId }));
        await env.DB.prepare(
          "UPDATE refresh_runs SET status = 'failed', finished_at = ?, error = ? WHERE actor_run_id = ?",
        ).bind(new Date().toISOString(), message, actorRunId).run();
      }
    })(),
  );
  return json({ accepted: true }, { status: 202 });
}

async function loadDemo(request: Request, env: Env): Promise<Response> {
  if (!["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) {
    return errorResponse("Demo data is disabled.", 404);
  }
  const now = new Date();
  const people = [
    { id: "demo-maya", name: "Maya Chen", slug: "maya-chen" },
    { id: "demo-julian", name: "Julian Bell", slug: "julian-bell" },
    { id: "demo-nora", name: "Nora Singh", slug: "nora-singh" },
  ];
  const statements: D1PreparedStatement[] = [];
  for (const person of people) {
    const url = `https://www.linkedin.com/in/${person.slug}`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO profiles (id, linkedin_url, name, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(linkedin_url) DO UPDATE SET active = 1, name = excluded.name`,
      ).bind(person.id, url, person.name, now.toISOString(), now.toISOString()),
    );
  }
  const samples = [
    ["demo-post-1", "demo-maya", 2, "original", "The best customer conversations happen when the agenda has room to be wrong. Three questions I now ask before every research call.", 184, 23, 7],
    ["demo-post-2", "demo-julian", 7, "repost", "A sharp breakdown of why small teams should optimize for learning speed before delivery speed.", 91, 12, 4],
    ["demo-post-3", "demo-nora", 22, "original", "We spent six weeks simplifying onboarding. The winning change was not a new step—it was removing the moment where users had to choose a path too early.", 326, 41, 18],
    ["demo-post-4", "demo-maya", 31, "original", "A useful signal: when prospects repeat your product language back to you without prompting, positioning is beginning to stick.", 73, 8, 2],
  ] as const;
  for (const [id, profileId, hoursAgo, kind, content, likes, comments, reposts] of samples) {
    const publishedAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
    statements.push(
      env.DB.prepare(
        `INSERT INTO posts (
          id, profile_id, linkedin_url, content, post_kind, published_at,
          likes, comments, reposts, first_seen_at, last_observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET content = excluded.content, seen_at = NULL, archived_reason = NULL`,
      ).bind(
        id,
        profileId,
        `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
        content,
        kind,
        publishedAt,
        likes,
        comments,
        reposts,
        now.toISOString(),
        now.toISOString(),
      ),
    );
  }
  await env.DB.batch(statements);
  return json({ inserted: samples.length });
}

async function expireOldPosts(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE posts SET content = NULL, seen_at = COALESCE(seen_at, ?), archived_reason = 'expired'
     WHERE seen_at IS NULL AND published_at < ?`,
  ).bind(new Date().toISOString(), cutoff).run();
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/bootstrap") return getBootstrap(request, env);
  if (request.method === "POST" && url.pathname === "/api/profiles/import") return importProfiles(request, env);
  if (request.method === "POST" && url.pathname === "/api/posts/seen") return markPostsSeen(request, env);
  if (request.method === "POST" && url.pathname === "/api/refresh") return startRefresh(env);
  if (request.method === "POST" && url.pathname === "/api/apify/webhook") return handleApifyWebhook(request, env, ctx);
  if (request.method === "POST" && url.pathname === "/api/demo") return loadDemo(request, env);
  if (url.pathname.startsWith("/api/")) return errorResponse("Not found.", 404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(JSON.stringify({ message: "request failed", error: message, path: new URL(request.url).pathname }));
      return errorResponse("The app hit an unexpected error.", 500);
    }
  },
  scheduled(_controller, env, ctx): void {
    ctx.waitUntil(
      (async () => {
        await expireOldPosts(env);
        const response = await startRefresh(env);
        if (!response.ok && response.status !== 503) {
          console.error(JSON.stringify({ message: "scheduled refresh failed to start", status: response.status }));
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
