export function canonicalLinkedInProfileUrl(value: string): string | null {
  const trimmed = value.trim().replace(/[.;]+$/, "");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (hostname !== "linkedin.com" || segments[0]?.toLowerCase() !== "in" || !segments[1]) return null;
    const slug = segments[1].trim();
    if (!/^[a-zA-Z0-9%_-]+$/.test(slug)) return null;
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return null;
  }
}

export function parseLinkedInUrls(input: string): { urls: string[]; invalid: string[] } {
  const candidates = input.split(/[,\n\r]+/).map((value) => value.trim()).filter(Boolean);
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const canonical = canonicalLinkedInProfileUrl(candidate);
    if (!canonical) {
      invalid.push(candidate);
      continue;
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      urls.push(canonical);
    }
  }
  return { urls, invalid };
}
