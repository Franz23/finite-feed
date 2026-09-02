import { describe, expect, it } from "vitest";
import { refreshSince } from "./refresh-window.js";

describe("refreshSince", () => {
  it("uses a seven-day window when any profile has never been scraped", () => {
    expect(refreshSince([
      { last_scraped_at: "2026-09-02T12:00:00.000Z" },
      { last_scraped_at: null },
    ], Date.parse("2026-09-02T18:00:00.000Z"))).toBe("2026-08-26T18:00:00.000Z");
  });

  it("uses the oldest successful profile watermark", () => {
    expect(refreshSince([
      { last_scraped_at: "2026-09-02T12:00:00.000Z" },
      { last_scraped_at: "2026-09-02T11:30:00.000Z" },
    ])).toBe("2026-09-02T11:30:00.000Z");
  });
});
