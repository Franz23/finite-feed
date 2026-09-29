import { describe, expect, it } from "vitest";
import { chunksOf, decideRunOutcome } from "./apify.js";

it("keeps every post while bounding database batches", () => {
  const items = Array.from({ length: 121 }, (_, index) => index);
  const batches = chunksOf(items, 50);
  expect(batches.map((batch) => batch.length)).toEqual([50, 50, 21]);
  expect(batches.flat()).toEqual(items);
});

const base = { apifyStatus: "SUCCEEDED" as const, rawItems: 1, errorItems: 0, posts: 1, targetsWithPostInLast14Days: 1, attempt: 1, chainLength: 2 };
describe("decideRunOutcome", () => {
  it.each([
    [{ apifyStatus: "FAILED" as const }, "fallback", "Apify run ended with FAILED."],
    [{ missingDataset: true, rawItems: 0, posts: 0 }, "fallback", "Apify completed without a dataset."],
    [{ rawItems: 2, errorItems: 2, posts: 0 }, "fallback", "actor returned only error records"],
    [{ rawItems: 0, posts: 0 }, "fallback", "actor returned nothing for accounts that posted recently"],
    [{ rawItems: 0, posts: 0, targetsWithPostInLast14Days: 0 }, "succeeded", null],
    [{ attempt: 2, rawItems: 0, posts: 0 }, "failed", "actor returned nothing for accounts that posted recently"],
    [{}, "succeeded", null],
  ])("decides %#", (override, outcome, reason) => {
    expect(decideRunOutcome({ ...base, ...override })).toEqual({ outcome, reason });
  });
});
