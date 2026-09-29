import { describe, expect, it } from "vitest";
import { refreshSince } from "./refresh-window.js";

describe("refreshSince", () => {
  it("uses the last successful scrape with a 24-hour overlap", () => {
    expect(refreshSince([{ newest_post_at: "2026-09-02T12:00:00.000Z", last_scraped_at: "2026-09-03T12:00:00.000Z" }], Date.parse("2026-09-04T00:00:00.000Z")))
      .toBe("2026-09-02T12:00:00.000Z");
  });
  it("bounds a first scrape to seven days", () => {
    expect(refreshSince([{ newest_post_at: null, last_scraped_at: null }], Date.parse("2026-09-02T18:00:00.000Z")))
      .toBe("2026-08-26T18:00:00.000Z");
  });
  it("uses the oldest target's successful scrape", () => {
    expect(refreshSince([
      { newest_post_at: "2026-09-01T12:00:00.000Z", last_scraped_at: "2026-09-02T12:00:00.000Z" },
      { newest_post_at: "2026-08-01T11:30:00.000Z", last_scraped_at: "2026-09-02T11:30:00.000Z" },
    ], Date.parse("2026-09-03T00:00:00.000Z"))).toBe("2026-09-01T11:30:00.000Z");
  });
  it("does not repeatedly buy an old post history", () => {
    expect(refreshSince([{ newest_post_at: "2026-08-01T00:00:00.000Z", last_scraped_at: "2026-09-29T00:00:00.000Z" }], Date.parse("2026-09-29T12:00:00.000Z")))
      .toBe("2026-09-28T00:00:00.000Z");
  });
  it("caps an old or invalid anchor before the overlap", () => {
    expect(refreshSince([{ newest_post_at: "2026-08-01T00:00:00.000Z", last_scraped_at: null }], Date.parse("2026-09-29T12:00:00.000Z")))
      .toBe("2026-09-22T12:00:00.000Z");
  });
});
