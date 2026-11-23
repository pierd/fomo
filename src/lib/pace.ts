// How fast you actually get through things, and so how long (in calendar
// time) the rest of the list would take.

export const DAY = 24 * 60 * 60 * 1000;
const MIN_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

type PaceItem = {
  status: string;
  addedAt: number;
  finishedAt?: number;
  durationMinutes?: number;
  durationMode: string;
};

const timed = (i: PaceItem) => i.durationMinutes !== undefined && i.durationMode !== "na";

export function computePace(items: PaceItem[], now: number) {
  const remainingMinutes = items
    .filter((i) => i.status === "active" && timed(i))
    .reduce((s, i) => s + i.durationMinutes!, 0);
  const untimed = items.filter((i) => i.status === "active" && !timed(i) && i.durationMode !== "na").length;

  // The last year, or the whole history if it's shorter (but at least a
  // month, so a first busy week doesn't promise miracles).
  const firstAdded = items.length ? Math.min(...items.map((i) => i.addedAt)) : now;
  const windowDays = Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, (now - firstAdded) / DAY));
  const since = now - windowDays * DAY;
  const finishedMinutes = items
    .filter((i) => i.status === "done" && timed(i) && (i.finishedAt ?? 0) >= since)
    .reduce((s, i) => s + i.durationMinutes!, 0);
  const perDay = finishedMinutes / windowDays;

  return {
    remainingMinutes,
    untimed,
    windowDays,
    fullYear: windowDays >= MAX_WINDOW_DAYS,
    finishedMinutes,
    perDay,
    // Calendar days to clear the list at that pace; null when there's no pace yet.
    daysToClear: perDay > 0 ? remainingMinutes / perDay : null,
  };
}
