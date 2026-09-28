import { beforeEach, expect, it, vi } from "vitest";
import { trackPostClick } from "./api";
import { postClickHandlers } from "./post-clicks";

vi.mock("./api", () => ({ trackPostClick: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.clearAllMocks());

it("records ordinary/keyboard clicks and middle clicks once, ignoring right clicks", () => {
  const handlers = postClickHandlers("post-1", "history", "image");
  handlers.onClick({ button: 0 });
  handlers.onAuxClick({ button: 1 });
  handlers.onClick({ button: 1 });
  handlers.onAuxClick({ button: 2 });
  expect(trackPostClick).toHaveBeenCalledTimes(2);
  expect(trackPostClick).toHaveBeenCalledWith("post-1", "history", "image");
});

it("allows navigation to proceed when tracking fails", async () => {
  vi.mocked(trackPostClick).mockRejectedValueOnce(new Error("Offline"));
  expect(() => postClickHandlers("post-1", "feed").onClick({ button: 0 })).not.toThrow();
  await Promise.resolve();
});
