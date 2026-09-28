import { afterEach, describe, expect, it } from "vitest";
import apidojo from "./__fixtures__/apidojo-tweets.json";
import xquik from "./__fixtures__/xquik-tweets.json";
import errors from "./__fixtures__/nickcheng-error-items.json";
import { actorChain, apidojoTweets, chunkActorTargets, xquikTweets } from "./actors.js";

const profiles = new Map([
  ["https://x.com/garrytan", { id: "garry", url: "https://x.com/garrytan" }],
  ["https://x.com/levelsio", { id: "levels", url: "https://x.com/levelsio" }],
]);

afterEach(() => { delete process.env.APIFY_X_ACTOR_CHAIN; delete process.env.APIFY_X_ACTOR_ID; });
describe("actor adapters", () => {
  it("normalizes real apidojo posts, photos, videos, quotes and excludes replies", () => {
    const posts = apidojo.map((item) => apidojoTweets.normalize(item, profiles)).filter((post) => post !== null);
    expect(posts).toHaveLength(apidojo.filter((item) => !item.isReply).length);
    expect(posts.some((post) => post.media?.images.length)).toBe(true);
    expect(posts.some((post) => post.media?.video?.url.includes(".mp4"))).toBe(true);
    expect(posts.some((post) => post.kind === "quote")).toBe(true);
    expect(posts.every((post) => post.profileId === "garry" || post.profileId === "levels")).toBe(true);
  });
  it("normalizes real xquik posts and flags diagnostic and legacy errors", () => {
    const posts = xquik.map((item) => xquikTweets.normalize(item, profiles)).filter((post) => post !== null);
    expect(posts).toHaveLength(xquik.filter((item) => !item.isReply).length);
    expect(posts.some((post) => post.media?.images.length)).toBe(true);
    expect(posts.some((post) => post.media?.video?.url.includes(".mp4"))).toBe(true);
    expect(posts.some((post) => post.kind === "quote")).toBe(true);
    expect(xquikTweets.isErrorItem({ id: "diag:target", resultType: "diagnostic", status: "zero-output" })).toBe(true);
    expect(errors.every((item) => apidojoTweets.isErrorItem(item))).toBe(true);
  });
  it("uses the already-overlapped date without subtracting another day", () => {
    expect(apidojoTweets.buildInput([{ url: "https://x.com/garrytan", handle: "garrytan", profileId: "garry" }], "2026-09-01T12:00:00.000Z"))
      .toHaveProperty("start", "2026-09-01");
  });
  it("isolates apidojo targets so the global cap cannot starve later handles", () => {
    expect(chunkActorTargets(["garrytan", "levelsio"], apidojoTweets)).toEqual([["garrytan"], ["levelsio"]]);
    expect(chunkActorTargets(["garrytan", "levelsio"], xquikTweets)).toEqual([["garrytan", "levelsio"]]);
  });
  it("parses the ordered chain and rejects unknown adapters", () => {
    expect(actorChain("x").map((adapter) => adapter.id)).toEqual(["apidojo~tweet-scraper", "xquik~x-tweet-scraper"]);
    process.env.APIFY_X_ACTOR_CHAIN = "xquik~x-tweet-scraper";
    expect(actorChain("x")[0].id).toBe("xquik~x-tweet-scraper");
    process.env.APIFY_X_ACTOR_CHAIN = "dead";
    expect(() => actorChain("x")).toThrow(/Unknown/);
    delete process.env.APIFY_X_ACTOR_CHAIN;
    process.env.APIFY_X_ACTOR_ID = "apidojo~tweet-scraper";
    expect(actorChain("x").map((adapter) => adapter.id)).toEqual(["apidojo~tweet-scraper"]);
    process.env.APIFY_X_ACTOR_ID = "nick.cheng~x-twitter-profile-tweets-scraper";
    expect(actorChain("x").map((adapter) => adapter.id)).toEqual(["apidojo~tweet-scraper", "xquik~x-tweet-scraper"]);
    process.env.APIFY_X_ACTOR_CHAIN = "xquik~x-tweet-scraper";
    expect(actorChain("x").map((adapter) => adapter.id)).toEqual(["xquik~x-tweet-scraper"]);
  });
});
