export type FeedPost = {
  id: string;
  profileId: string;
  profileName: string;
  profileUrl: string;
  profileHeadline: string | null;
  profileAvatarUrl: string | null;
  linkedinUrl: string;
  platform: "linkedin" | "x";
  content: string;
  kind: "original" | "repost" | "quote";
  publishedAt: string;
  likes: number;
  comments: number;
  reposts: number;
  media: PostMedia | null;
};

export type PostImage = {
  url: string;
  width: number | null;
  height: number | null;
};

export type PostMedia = {
  images: PostImage[];
  video: { url: string; thumbnailUrl: string | null } | null;
  document: {
    title: string | null;
    url: string | null;
    coverUrl: string | null;
    pageCount: number | null;
  } | null;
};

export type Profile = {
  id: string;
  name: string | null;
  linkedinUrl: string;
  platform: "linkedin" | "x";
  lastScrapedAt: string | null;
};

export type HistoryItem = FeedPost & {
  seenAt: string;
  display: "full" | "link";
};

export type RefreshStatus = {
  status: "idle" | "starting" | "running" | "succeeded" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  profileCount: number;
  postsReceived: number;
};

export type Bootstrap = {
  feed: FeedPost[];
  profiles: Profile[];
  history: HistoryItem[];
  refresh: RefreshStatus;
};

export type FollowResult = {
  added: number;
  total: number;
};
