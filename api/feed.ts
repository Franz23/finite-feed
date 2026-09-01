import type { VercelRequest, VercelResponse } from "@vercel/node";
import { reconcileActorRun } from "./_lib/apify.js";
import { apiError, errorMessage, methodNotAllowed } from "./_lib/http.js";
import { adminClient, requireUser } from "./_lib/supabase.js";
import type { Bootstrap, FeedPost, HistoryItem, Profile, RefreshStatus } from "../src/types.js";

type ProfileRow = {
  id: string;
  name: string | null;
  linkedin_url: string;
  headline: string | null;
  avatar_url: string | null;
  last_scraped_at: string | null;
  platform: "linkedin" | "x";
};

type PostRow = {
  id: string;
  profile_id: string;
  linkedin_url: string;
  content: string | null;
  post_kind: FeedPost["kind"];
  published_at: string;
  likes: number;
  comments: number;
  reposts: number;
  media: FeedPost["media"];
  platform: "linkedin" | "x";
};

type RefreshRow = {
  id: string;
  batch_id: string | null;
  status: RefreshStatus["status"];
  started_at: string;
  finished_at: string | null;
  error: string | null;
  actor_run_id: string | null;
  target_urls: unknown;
  posts_received: number;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  try {
    const user = await requireUser(request);
    const db = adminClient();
    const { data: follows, error: followsError } = await db
      .from("user_follows")
      .select("profile_id, profiles(id, name, linkedin_url, headline, avatar_url, last_scraped_at, platform)")
      .eq("user_id", user.id);
    if (followsError) throw followsError;

    const followRows = (follows ?? []) as Array<{ profile_id: string; profiles: ProfileRow[] }>;
    const profileRows = followRows.flatMap((follow) => follow.profiles ?? []);
    const profiles: Profile[] = profileRows.map((profile) => ({
      id: profile.id,
      name: profile.name,
      linkedinUrl: profile.linkedin_url,
      platform: profile.platform,
      lastScrapedAt: profile.last_scraped_at,
    }));
    const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
    const profileIds = profiles.map((profile) => profile.id);
    if (profileIds.length === 0) {
      const payload: Bootstrap = {
        feed: [], profiles: [], history: [],
        refresh: { status: "idle", startedAt: null, finishedAt: null, error: null, profileCount: 0, postsReceived: 0 },
      };
      return response.status(200).json(payload);
    }

    const refreshSelect = "id, batch_id, status, started_at, finished_at, error, actor_run_id, target_urls, posts_received";
    const { data: latestRefresh } = await db
      .from("refresh_runs")
      .select(refreshSelect)
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let refreshRows: RefreshRow[] = latestRefresh
      ? latestRefresh.batch_id
        ? (await db.from("refresh_runs").select(refreshSelect).eq("batch_id", latestRefresh.batch_id)).data ?? []
        : [latestRefresh]
      : [];
    await Promise.all(refreshRows.filter((run) => run.actor_run_id && ["starting", "running"].includes(run.status)).map(async (run) => {
      try {
        if (run.actor_run_id) await reconcileActorRun(run.actor_run_id);
      } catch (error) {
        console.error("Apify reconciliation failed:", errorMessage(error));
      }
    }));
    if (latestRefresh?.batch_id) {
      refreshRows = (await db.from("refresh_runs").select(refreshSelect).eq("batch_id", latestRefresh.batch_id)).data ?? [];
    } else if (latestRefresh) {
      refreshRows = [(await db.from("refresh_runs").select(refreshSelect).eq("id", latestRefresh.id).single()).data ?? latestRefresh];
    }
    const activeRuns = refreshRows.filter((run) => ["starting", "running"].includes(run.status));
    const failedRun = refreshRows.find((run) => run.status === "failed");
    const startedAt = refreshRows.map((run) => run.started_at).sort()[0] ?? null;
    const finishedAt = refreshRows.map((run) => run.finished_at).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
    let refresh: RefreshStatus = refreshRows.length ? {
      status: activeRuns.length ? "running" : failedRun ? "failed" : "succeeded",
      startedAt,
      finishedAt,
      error: failedRun?.error ?? null,
      profileCount: refreshRows.reduce((total, run) => total + (Array.isArray(run.target_urls) ? run.target_urls.length : 0), 0),
      postsReceived: refreshRows.reduce((total, run) => total + (typeof run.posts_received === "number" ? run.posts_received : 0), 0),
    } : { status: "idle", startedAt: null, finishedAt: null, error: null, profileCount: 0, postsReceived: 0 };
    if (
      (refresh.status === "starting" || refresh.status === "running") &&
      refresh.startedAt &&
      Date.parse(refresh.startedAt) < Date.now() - 3 * 60_000
    ) {
      const finishedAt = new Date().toISOString();
      const error = "The refresh did not finish within three minutes. No more waiting—try it again.";
      await db.from("refresh_runs").update({ status: "failed", finished_at: finishedAt, error }).in("id", activeRuns.map((run) => run.id));
      refresh = { ...refresh, status: "failed", finishedAt, error };
    }

    const { data: posts, error: postsError } = await db
      .from("posts")
      .select("id, profile_id, linkedin_url, content, post_kind, published_at, likes, comments, reposts, media, platform")
      .in("profile_id", profileIds)
      .order("published_at", { ascending: false })
      .limit(250);
    if (postsError) throw postsError;
    const postRows = (posts ?? []) as PostRow[];
    const postIds = postRows.map((post) => post.id);
    const { data: reads, error: readsError } = postIds.length
      ? await db.from("post_reads").select("post_id, seen_at").eq("user_id", user.id).in("post_id", postIds)
      : { data: [], error: null };
    if (readsError) throw readsError;
    const readRows = (reads ?? []) as Array<{ post_id: string; seen_at: string }>;
    const readById = new Map(readRows.map((read) => [read.post_id, read.seen_at]));

    const feed: FeedPost[] = postRows.filter((post) => !readById.has(post.id)).flatMap((post) => {
      const profile = profileById.get(post.profile_id);
      if (!profile) return [];
      return [{
        id: post.id,
        profileId: profile.id,
        profileName: profile.name || profile.linkedin_url.split("/").filter(Boolean).at(-1) || "LinkedIn member",
        profileUrl: profile.linkedin_url,
        profileHeadline: profile.headline,
        profileAvatarUrl: profile.avatar_url,
        linkedinUrl: post.linkedin_url,
        platform: post.platform,
        content: post.content || `Open this post on ${post.platform === "x" ? "X" : "LinkedIn"} to read it.`,
        kind: post.post_kind,
        publishedAt: post.published_at,
        likes: post.likes,
        comments: post.comments,
        reposts: post.reposts,
        media: post.media,
      }];
    });

    const { data: historyReads, error: historyError } = await db
      .from("post_reads")
      .select("seen_at, posts!inner(id, linkedin_url, published_at, platform, profiles!inner(name))")
      .eq("user_id", user.id)
      .order("seen_at", { ascending: false })
      .limit(1000);
    if (historyError) throw historyError;
    type HistoryPostRow = {
      id: string;
      linkedin_url: string;
      published_at: string;
      platform: "linkedin" | "x";
      profiles: { name: string | null } | Array<{ name: string | null }>;
    };
    const history: HistoryItem[] = (historyReads ?? []).flatMap((read: { seen_at: string; posts: unknown }) => {
      const rawPost = read.posts as HistoryPostRow | HistoryPostRow[];
      const post = Array.isArray(rawPost) ? rawPost[0] : rawPost;
      if (!post) return [];
      const rawProfile = post.profiles;
      const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
      return [{
        id: post.id,
        profileName: profile?.name || "LinkedIn member",
        linkedinUrl: post.linkedin_url,
        platform: post.platform,
        publishedAt: post.published_at,
        seenAt: read.seen_at,
      }];
    });

    return response.status(200).json({ feed, profiles, history, refresh } satisfies Bootstrap);
  } catch (error) {
    return apiError(response, error);
  }
}
