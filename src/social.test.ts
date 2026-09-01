import { describe, expect, it } from "vitest";
import { canonicalSocialProfileUrl, parseSocialUrls } from "./social";

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
