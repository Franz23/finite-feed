export type SocialPlatform = "linkedin" | "x";

export type SocialProfileUrl = {
  url: string;
  platform: SocialPlatform;
};

export function canonicalSocialProfileUrl(value: string): SocialProfileUrl | null {
  const trimmed = value.trim().replace(/[.;]+$/, "");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (hostname === "linkedin.com" && segments[0]?.toLowerCase() === "in" && segments[1]) {
      const slug = segments[1].trim();
      if (!/^[a-zA-Z0-9%_-]+$/.test(slug)) return null;
      return { url: `https://www.linkedin.com/in/${slug}`, platform: "linkedin" };
    }
    if (["x.com", "twitter.com"].includes(hostname) && segments.length === 1) {
      const handle = segments[0].replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{1,15}$/.test(handle) || ["home", "explore", "notifications", "messages", "search", "settings", "i"].includes(handle)) return null;
      return { url: `https://x.com/${handle}`, platform: "x" };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseSocialUrls(input: string): { urls: string[]; invalid: string[] } {
  const candidates = input.split(/[,\n\r]+/).map((value) => value.trim()).filter(Boolean);
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const canonical = canonicalSocialProfileUrl(candidate);
    if (!canonical) {
      invalid.push(candidate);
      continue;
    }
    if (!seen.has(canonical.url)) {
      seen.add(canonical.url);
      urls.push(canonical.url);
    }
  }
  return { urls, invalid };
}

export function discoveryProfileUrls(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > 2) throw new Error("Add one LinkedIn profile and one X profile at most.");
  const profiles = values.filter((value) => typeof value !== "string" || value.trim()).map((value) => {
    const profile = typeof value === "string" ? canonicalSocialProfileUrl(value) : null;
    if (!profile) throw new Error("Enter a valid LinkedIn or X profile URL.");
    return profile;
  });
  if (!profiles.length) throw new Error("Add your LinkedIn profile, X profile, or both.");
  if (new Set(profiles.map((profile) => profile.platform)).size !== profiles.length) throw new Error("Add one profile per platform.");
  return profiles.map((profile) => profile.url);
}
