import type { VercelRequest, VercelResponse } from "@vercel/node";
import { apiError, methodNotAllowed } from "./_lib/http";
import { adminClient, requireUser } from "./_lib/supabase";
import type { Bootstrap, FeedPost, HistoryItem, Profile, RefreshStatus } from "../src/types";

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

    const profileRows = (follows ?? []).flatMap((follow) => follow.profiles ?? []);
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
    const postIds = (posts ?? []).map((post) => post.id);
    const { data: reads, error: readsError } = postIds.length
      ? await db.from("post_reads").select("post_id, seen_at").eq("user_id", user.id).in("post_id", postIds)
      : { data: [], error: null };
    if (readsError) throw readsError;
    const readById = new Map((reads ?? []).map((read) => [read.post_id, read.seen_at]));

    const feed: FeedPost[] = (posts ?? []).filter((post) => !readById.has(post.id)).flatMap((post) => {
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

    const history: HistoryItem[] = (posts ?? []).filter((post) => readById.has(post.id)).slice(0, 100).flatMap((post) => {
      const profile = profileById.get(post.profile_id);
      const seenAt = readById.get(post.id);
      if (!profile || !seenAt) return [];
      return [{
        id: post.id,
        profileName: profile.name || "LinkedIn member",
        linkedinUrl: post.linkedin_url,
        publishedAt: post.published_at,
        seenAt,
      }];
    });

    const { data: latestRefresh } = await db
      .from("refresh_runs")
      .select("status, started_at, finished_at, error")
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const refresh: RefreshStatus = latestRefresh ? {
      status: latestRefresh.status,
      startedAt: latestRefresh.started_at,
      finishedAt: latestRefresh.finished_at,
      error: latestRefresh.error,
    } : { status: "idle", startedAt: null, finishedAt: null, error: null };

    return response.status(200).json({ feed, profiles, history, refresh } satisfies Bootstrap);
  } catch (error) {
    return apiError(response, error);
  }
}
