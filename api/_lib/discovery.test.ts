import { describe, expect, it } from "vitest";
import { rankSignals } from "./discovery.js";

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
