import { describe, expect, it } from "vitest";
import { refreshSince } from "./refresh-window.js";

describe("refreshSince", () => {
  it("uses the newest stored post with a 24-hour overlap", () => {
    expect(refreshSince([{ newest_post_at: "2026-09-02T12:00:00.000Z", last_scraped_at: "2026-09-03T12:00:00.000Z" }], Date.parse("2026-09-04T00:00:00.000Z")))
      .toBe("2026-09-01T12:00:00.000Z");
  });
  it("uses a thirty-day anchor for unscripted profiles", () => {
    expect(refreshSince([{ newest_post_at: null, last_scraped_at: null }], Date.parse("2026-09-02T18:00:00.000Z")))
      .toBe("2026-08-02T18:00:00.000Z");
  });
  it("uses the oldest target anchor", () => {
    expect(refreshSince([
      { newest_post_at: "2026-09-02T12:00:00.000Z", last_scraped_at: null },
      { newest_post_at: "2026-09-02T11:30:00.000Z", last_scraped_at: null },
    ], Date.parse("2026-09-03T00:00:00.000Z"))).toBe("2026-09-01T11:30:00.000Z");
  });
});
