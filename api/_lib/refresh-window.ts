export type WindowTarget = { last_scraped_at: string | null; newest_post_at?: string | null };

export function refreshSince(targets: WindowTarget[], now = Date.now()): string {
  // A successful scrape checked through its start time even when the profile was
  // quiet. Reusing its last post as the anchor rebuys the same history every run.
  const oldestAllowed = now - 7 * 86_400_000;
  const anchors = targets.map((target) => {
    const raw = target.last_scraped_at ?? target.newest_post_at;
    const parsed = raw ? Date.parse(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : oldestAllowed;
  });
  const overlapHours = Number(process.env.REFRESH_OVERLAP_HOURS ?? 24);
  if (!Number.isFinite(overlapHours) || overlapHours < 0) throw new Error("REFRESH_OVERLAP_HOURS must be a nonnegative number.");
  return new Date(Math.max(oldestAllowed, Math.min(...(anchors.length ? anchors : [oldestAllowed])) - overlapHours * 3_600_000)).toISOString();
}
