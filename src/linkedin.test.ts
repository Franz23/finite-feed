import { describe, expect, it } from "vitest";
import { canonicalLinkedInProfileUrl, parseLinkedInUrls } from "./linkedin";

describe("canonicalLinkedInProfileUrl", () => {
  it("normalizes public profile URLs", () => {
    expect(canonicalLinkedInProfileUrl("linkedin.com/in/example-person/?trk=abc")).toBe(
      "https://www.linkedin.com/in/example-person",
    );
  });

  it("rejects company and unrelated URLs", () => {
    expect(canonicalLinkedInProfileUrl("https://linkedin.com/company/example")).toBeNull();
    expect(canonicalLinkedInProfileUrl("https://example.com/in/person")).toBeNull();
  });
});

describe("parseLinkedInUrls", () => {
  it("accepts comma and newline separated URLs and removes duplicates", () => {
    expect(parseLinkedInUrls("linkedin.com/in/one, https://www.linkedin.com/in/two\nlinkedin.com/in/one")).toEqual({
      urls: ["https://www.linkedin.com/in/one", "https://www.linkedin.com/in/two"],
      invalid: [],
    });
  });

  it("reports invalid entries", () => {
    expect(parseLinkedInUrls("linkedin.com/in/one, not-a-profile").invalid).toEqual(["not-a-profile"]);
  });
});
