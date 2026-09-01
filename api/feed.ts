import type { VercelRequest, VercelResponse } from "@vercel/node";
import { apiError, methodNotAllowed } from "./_lib/http.js";
import { adminClient, requireUser } from "./_lib/supabase.js";
import type { Bootstrap, FeedPost, HistoryItem, Profile, RefreshStatus } from "../src/types.js";

type ProfileRow = {
  id: string;
  name: string | null;
  linkedin_url: string;
  headline: string | null;
  avatar_url: string | null;
  last_scraped_at: string | null;
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
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  try {
    const user = await requireUser(request);
    const db = adminClient();
    const { data: follows, error: followsError } = await db
      .from("user_follows")
      .select("profile_id, profiles(id, name, linkedin_url, headline, avatar_url, last_scraped_at)")
      .eq("user_id", user.id);
    if (followsError) throw followsError;

    const followRows = (follows ?? []) as Array<{ profile_id: string; profiles: ProfileRow[] }>;
    const profileRows = followRows.flatMap((follow) => follow.profiles ?? []);
    const profiles: Profile[] = profileRows.map((profile) => ({
      id: profile.id,
      name: profile.name,
      linkedinUrl: profile.linkedin_url,
      lastScrapedAt: profile.last_scraped_at,
    }));
    const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
    const profileIds = profiles.map((profile) => profile.id);
    if (profileIds.length === 0) {
      const payload: Bootstrap = {
        feed: [], profiles: [], history: [],
        refresh: { status: "idle", startedAt: null, finishedAt: null, error: null },
      };
      return response.status(200).json(payload);
    }

    const { data: posts, error: postsError } = await db
      .from("posts")
      .select("id, profile_id, linkedin_url, content, post_kind, published_at, likes, comments, reposts, media")
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
        content: post.content || "Open this post on LinkedIn to read it.",
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
      .select("seen_at, posts!inner(id, linkedin_url, published_at, profiles!inner(name))")
      .eq("user_id", user.id)
      .order("seen_at", { ascending: false })
      .limit(1000);
    if (historyError) throw historyError;
    type HistoryPostRow = {
      id: string;
      linkedin_url: string;
      published_at: string;
      profiles: { name: string | null } | Array<{ name: string | null }>;
    };
    const history: HistoryItem[] = (historyReads ?? []).flatMap((read) => {
      const rawPost = read.posts as HistoryPostRow | HistoryPostRow[];
      const post = Array.isArray(rawPost) ? rawPost[0] : rawPost;
      if (!post) return [];
      const rawProfile = post.profiles;
      const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
      return [{
        id: post.id,
        profileName: profile?.name || "LinkedIn member",
        linkedinUrl: post.linkedin_url,
        publishedAt: post.published_at,
        seenAt: read.seen_at,
      }];
    });

    const { data: latestRefresh } = await db
      .from("refresh_runs")
      .select("status, started_at, finished_at, error")
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let refresh: RefreshStatus = latestRefresh ? {
      status: latestRefresh.status,
      startedAt: latestRefresh.started_at,
      finishedAt: latestRefresh.finished_at,
      error: latestRefresh.error,
    } : { status: "idle", startedAt: null, finishedAt: null, error: null };
    if (
      (refresh.status === "starting" || refresh.status === "running") &&
      refresh.startedAt &&
      Date.parse(refresh.startedAt) < Date.now() - 10 * 60_000
    ) {
      const finishedAt = new Date().toISOString();
      const error = "The refresh took too long to finish. Try it again.";
      await db.from("refresh_runs").update({ status: "failed", finished_at: finishedAt, error }).eq("started_at", refresh.startedAt);
      refresh = { ...refresh, status: "failed", finishedAt, error };
    }

    return response.status(200).json({ feed, profiles, history, refresh } satisfies Bootstrap);
  } catch (error) {
    return apiError(response, error);
  }
}
