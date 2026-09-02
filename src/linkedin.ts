import { canonicalSocialProfileUrl, parseSocialUrls } from "./social.js";

export function canonicalLinkedInProfileUrl(value: string): string | null {
  const result = canonicalSocialProfileUrl(value);
  return result?.platform === "linkedin" ? result.url : null;
}

export function parseLinkedInUrls(input: string): { urls: string[]; invalid: string[] } {
  const parsed = parseSocialUrls(input);
  const urls = parsed.urls.filter((url) => url.startsWith("https://www.linkedin.com/"));
  return { urls, invalid: [...parsed.invalid, ...parsed.urls.filter((url) => !urls.includes(url))] };
}
