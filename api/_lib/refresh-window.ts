export type WindowTarget = { last_scraped_at: string | null; newest_post_at?: string | null };

export function refreshSince(targets: WindowTarget[], now = Date.now()): string {
  const fallback = now - 30 * 86_400_000;
  const anchors = targets.map((target) => {
    const raw = target.newest_post_at ?? target.last_scraped_at;
    const parsed = raw ? Date.parse(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  });
  const overlapHours = Number(process.env.REFRESH_OVERLAP_HOURS ?? 24);
  if (!Number.isFinite(overlapHours) || overlapHours < 0) throw new Error("REFRESH_OVERLAP_HOURS must be a nonnegative number.");
  return new Date(Math.min(...(anchors.length ? anchors : [fallback])) - overlapHours * 3_600_000).toISOString();
}
