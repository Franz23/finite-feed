import type { FeedPost } from "./types";

export type SortMode = "recent" | "balanced" | "engaged";

export function sortFeed(posts: FeedPost[], sort: SortMode): FeedPost[] {
  const remaining = [...posts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (sort === "recent") return remaining;
  if (sort === "engaged") {
    const score = (post: FeedPost) => post.likes + post.comments * 4 + post.reposts * 2;
    return remaining.sort((a, b) => score(b) - score(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }
  const balanced: FeedPost[] = [];
  while (remaining.length > 0) {
    const lastTwo = balanced.slice(-2);
    const repeatedAuthor = lastTwo.length === 2 && lastTwo.every((post) => post.profileId === remaining[0]?.profileId);
    const alternateIndex = repeatedAuthor
      ? remaining.slice(0, 8).findIndex((post) => post.profileId !== remaining[0]?.profileId)
      : -1;
    balanced.push(remaining.splice(alternateIndex > 0 ? alternateIndex : 0, 1)[0]);
  }
  return balanced;
}

// Keep cards already on screen in place for the rest of this reading session.
// A fresh page load starts with the selected sort; later arrivals go at the end.
export function appendNewPosts(current: FeedPost[] | null, incoming: FeedPost[], sort: SortMode): FeedPost[] {
  if (current === null) return sortFeed(incoming, sort);
  const shownIds = new Set(current.map((post) => post.id));
  return [...current, ...sortFeed(incoming.filter((post) => !shownIds.has(post.id)), sort)];
}
