import { describe, expect, it } from "vitest";
import { actorInput, rankSignals, xSignalsFromItem } from "./discovery.js";

describe("rankSignals", () => {
  it("aggregates evidence and favors comments over lightweight reactions", () => {
    const candidates = rankSignals([
      { signal_type: "reaction", candidate_url: "https://www.linkedin.com/in/reacted", candidate_name: "Reacted Person", candidate_headline: null, candidate_avatar_url: null, occurred_at: "2020-01-01T00:00:00.000Z" },
      { signal_type: "reaction", candidate_url: "https://www.linkedin.com/in/reacted", candidate_name: "Reacted Person", candidate_headline: null, candidate_avatar_url: null, occurred_at: "2020-01-02T00:00:00.000Z" },
      { signal_type: "comment", candidate_url: "https://www.linkedin.com/in/commented", candidate_name: "Commented Person", candidate_headline: "Builder", candidate_avatar_url: null, occurred_at: "2020-01-01T00:00:00.000Z" },
    ]);

    expect(candidates.map((candidate) => candidate.name)).toEqual(["Commented Person", "Reacted Person"]);
    expect(candidates[0]?.reason).toBe("1 comment");
    expect(candidates[1]?.reason).toBe("2 reactions");
  });

  it("combines different signals for the same person", () => {
    const [candidate] = rankSignals([
      { signal_type: "comment", candidate_url: "https://www.linkedin.com/in/person", candidate_name: "Person", candidate_headline: null, candidate_avatar_url: null, occurred_at: null },
      { signal_type: "repost", candidate_url: "https://www.linkedin.com/in/person", candidate_name: "Person", candidate_headline: null, candidate_avatar_url: null, occurred_at: null },
      { signal_type: "reaction", candidate_url: "https://www.linkedin.com/in/person", candidate_name: "Person", candidate_headline: null, candidate_avatar_url: null, occurred_at: null },
    ]);

    expect(candidate).toMatchObject({ comments: 1, reposts: 1, reactions: 1, reason: "1 comment · 1 repost · 1 reaction" });
  });
});


describe("X discovery", () => {
  const source = "https://x.com/reader";
  const tweet = { id: "123", authorUserName: "Reader", createdAt: "2026-09-01T00:00:00Z" };

  it("requests replies and reposts without consuming shared feed refresh state", () => {
    expect(actorInput("posts", source, "initial")).toMatchObject({
      twitterHandles: ["reader"], includeReplies: true, includeRetweets: true,
      incremental: false, maxTweetsPerProfile: 80,
    });
    expect(actorInput("posts", source, "initial")).not.toHaveProperty("stateStoreName");
    expect(actorInput("comments", "https://www.linkedin.com/in/reader", "initial"))
      .toEqual({ profiles: ["https://www.linkedin.com/in/reader"], maxItems: 30, postedLimit: "year" });
  });

  it("deduplicates mentions, excludes self, and preserves stronger reply evidence", () => {
    const signals = xSignalsFromItem({ ...tweet, isReply: true, inReplyToUsername: "Builder",
      mentions: [{ userName: "builder", name: "Builder" }, { userName: "Other" }, { userName: "OTHER" }, { userName: "reader" }],
    }, source);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ candidate_url: "https://x.com/builder", signal_type: "comment" });
    expect(rankSignals(signals).map((candidate) => candidate.reason)).toEqual(["1 reply", "1 mention"]);
    expect(new Set(signals.map((signal) => signal.source_id)).size).toBe(2);
  });

  it("uses repost authors and never counts received likes as recommendations", () => {
    const signals = xSignalsFromItem({ ...tweet, isRetweet: true,
      retweetedAuthor: { userName: "Builder", name: "A Builder", description: "Builds things" },
      mentions: [{ userName: "builder" }], likeCount: 100,
    }, source);
    expect(signals).toHaveLength(1);
    expect(rankSignals(signals)[0]).toMatchObject({ name: "A Builder", reposts: 1, reactions: 0, reason: "1 repost" });
    expect(xSignalsFromItem({ ...tweet, likeCount: 100 }, source)).toEqual([]);
  });

  it("does not assume the first mentioned person is the reply target", () => {
    const signals = xSignalsFromItem({ ...tweet, isReply: true, mentions: [{ userName: "builder" }] }, source);
    expect(rankSignals(signals)[0]).toMatchObject({ comments: 0, reason: "1 mention" });
  });

  it("ignores malformed records, profile rows, and other users' activity", () => {
    for (const item of [null, {}, { ...tweet, itemType: "profile" }, { ...tweet, authorUserName: "someoneelse", mentions: [{ userName: "builder" }] }]) {
      expect(xSignalsFromItem(item, source)).toEqual([]);
    }
    expect(xSignalsFromItem({ ...tweet, mentions: [{ userName: "home" }, { userName: "../bad" }] }, source)).toEqual([]);
  });
});
