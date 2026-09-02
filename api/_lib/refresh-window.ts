type ScrapedTarget = { last_scraped_at: string | null };

export function refreshSince(targets: ScrapedTarget[], now = Date.now()): string {
  const timestamps = targets.map((target) => target.last_scraped_at ? Date.parse(target.last_scraped_at) : Number.NaN);
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return new Date(now - 7 * 86_400_000).toISOString();
  }
  return new Date(Math.min(...timestamps)).toISOString();
}
