export type FeedPost = {
  id: string;
  profileId: string;
  profileName: string;
  profileUrl: string;
  linkedinUrl: string;
  content: string;
  kind: "original" | "repost" | "quote";
  publishedAt: string;
  likes: number;
  comments: number;
  reposts: number;
};

export type Profile = {
  id: string;
  name: string | null;
  linkedinUrl: string;
  lastScrapedAt: string | null;
};

export type HistoryItem = {
  id: string;
  profileName: string;
  linkedinUrl: string;
  publishedAt: string;
  seenAt: string;
};

export type RefreshStatus = {
  status: "idle" | "starting" | "running" | "succeeded" | "partial" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type Bootstrap = {
  feed: FeedPost[];
  profiles: Profile[];
  history: HistoryItem[];
  refresh: RefreshStatus;
  apifyConfigured: boolean;
  demoMode: boolean;
};

export type ImportResult = {
  imported: number;
  deactivated: number;
  errors: Array<{ row: number; message: string }>;
};
