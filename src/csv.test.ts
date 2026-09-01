import { describe, expect, it } from "vitest";
import { canonicalLinkedInProfileUrl, parseProfileCsv } from "./csv";

describe("canonicalLinkedInProfileUrl", () => {
  it("normalizes public profile URLs", () => {
    expect(canonicalLinkedInProfileUrl("linkedin.com/in/franz-schrepf/?trk=abc")).toBe(
      "https://www.linkedin.com/in/franz-schrepf",
    );
  });

  it("rejects company and unrelated URLs", () => {
    expect(canonicalLinkedInProfileUrl("https://linkedin.com/company/example")).toBeNull();
    expect(canonicalLinkedInProfileUrl("https://example.com/in/person")).toBeNull();
  });
});

describe("parseProfileCsv", () => {
  it("accepts quoted names, reports invalid rows, and removes duplicates", () => {
    const result = parseProfileCsv(
      'name,linkedin_url\n"Schrepf, Franz",https://linkedin.com/in/franz-schrepf\nDuplicate,https://www.linkedin.com/in/franz-schrepf/\nNope,https://example.com/nope',
    );
    expect(result.profiles).toEqual([
      { name: "Schrepf, Franz", linkedinUrl: "https://www.linkedin.com/in/franz-schrepf" },
    ]);
    expect(result.errors).toEqual([{ row: 4, message: "Use a public linkedin.com/in/... profile URL." }]);
  });

  it("requires a LinkedIn URL column", () => {
    expect(parseProfileCsv("name,email\nFranz,f@example.com").errors[0]?.message).toMatch("linkedin_url");
  });
});
