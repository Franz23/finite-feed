import { describe, expect, it } from "vitest";
import { canonicalSocialProfileUrl, parseSocialUrls, discoveryProfileUrls } from "./social";

describe("canonicalSocialProfileUrl", () => {
  it("normalizes X and legacy Twitter profile URLs", () => {
    expect(canonicalSocialProfileUrl("https://twitter.com/Levelsio?ref=home")).toEqual({
      url: "https://x.com/levelsio",
      platform: "x",
    });
  });

  it("rejects X post and navigation URLs", () => {
    expect(canonicalSocialProfileUrl("https://x.com/levelsio/status/123")).toBeNull();
    expect(canonicalSocialProfileUrl("https://x.com/home")).toBeNull();
  });
});

describe("parseSocialUrls", () => {
  it("accepts a mixed LinkedIn and X list", () => {
    expect(parseSocialUrls("linkedin.com/in/person, x.com/paulg, twitter.com/paulg")).toEqual({
      urls: ["https://www.linkedin.com/in/person", "https://x.com/paulg"],
      invalid: [],
    });
  });
});


describe("discoveryProfileUrls", () => {
  it("accepts either platform or both, including legacy Twitter URLs", () => {
    expect(discoveryProfileUrls(["linkedin.com/in/person", "twitter.com/Person"]))
      .toEqual(["https://www.linkedin.com/in/person", "https://x.com/person"]);
    expect(discoveryProfileUrls(["", "x.com/person"])).toEqual(["https://x.com/person"]);
    expect(discoveryProfileUrls(["linkedin.com/in/person", ""])).toEqual(["https://www.linkedin.com/in/person"]);
  });
  it("rejects empty, invalid, duplicate-platform, and oversized submissions", () => {
    for (const input of [[], ["", " "], [null], ["example.com/person"], ["x.com/a", "twitter.com/b"], ["x.com/a", "x.com/b", "x.com/c"]]) {
      expect(() => discoveryProfileUrls(input)).toThrow();
    }
  });
});
