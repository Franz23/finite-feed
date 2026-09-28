import { trackPostClick } from "./api";

// Native links stay usable even if analytics or authentication is unavailable.
export function postClickHandlers(postId: string, surface: "feed" | "history", kind: "post" | "image" | "document" | "video" = "post") {
  const record = () => { void trackPostClick(postId, surface, kind).catch(() => undefined); };
  return {
    onClick: (event: { button: number }) => { if (event.button === 0) record(); },
    onAuxClick: (event: { button: number }) => { if (event.button === 1) record(); },
  };
}
