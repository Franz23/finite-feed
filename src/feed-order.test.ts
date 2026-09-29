import { describe, expect, it } from "vitest";
import { appendNewPosts, sortFeed } from "./feed-order";
import type { FeedPost } from "./types";

function post(id: string, publishedAt: string, likes = 0, profileId = id): FeedPost {
  return {
    id, profileId, profileName: id, profileUrl: "https://x.com/example",
    profileHeadline: null, profileAvatarUrl: null, linkedinUrl: `https://x.com/example/status/${id}`,
    platform: "x", content: id, kind: "original", publishedAt, likes, comments: 0,
    reposts: 0, media: null,
  };
}

describe("feed ordering during a reading session", () => {
  const older = post("older", "2026-09-28T09:00:00Z");
  const newer = post("newer", "2026-09-29T09:00:00Z");
  const newest = post("newest", "2026-09-29T10:00:00Z");

  it("sorts the first load, then appends new posts without moving or removing shown cards", () => {
    const first = appendNewPosts(null, [older, newer], "recent");
    expect(first.map((item) => item.id)).toEqual(["newer", "older"]);
    const afterRefresh = appendNewPosts(first, [newest, newer], "recent");
    expect(afterRefresh.map((item) => item.id)).toEqual(["newer", "older", "newest"]);
    expect(appendNewPosts(afterRefresh, [newest], "recent").map((item) => item.id))
      .toEqual(["newer", "older", "newest"]);
  });

  it("orders incoming posts among themselves without reordering shown cards", () => {
    const mostEngaged = post("engaged", "2026-09-29T08:00:00Z", 20);
    const afterRefresh = appendNewPosts([older], [newest, mostEngaged], "engaged");
    expect(afterRefresh.map((item) => item.id)).toEqual(["older", "engaged", "newest"]);
    expect(sortFeed(afterRefresh, "recent").map((item) => item.id))
      .toEqual(["newest", "engaged", "older"]);
  });
});
