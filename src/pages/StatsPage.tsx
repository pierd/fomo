import { useEffect, useMemo, useRef, useState } from "react";
import type { Item, Tag } from "../lib/types";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { formatMinutes, formatNumber } from "../lib/format";

const DAY = 24 * 60 * 60 * 1000;

export function StatsPage({ items, tags, now }: { items: Item[]; tags: Tag[]; now: number }) {
  const { t } = useTranslation();
  const active = items.filter((i) => i.status === "active");
  const done = items.filter((i) => i.status === "done");
  const timed = active.filter((i) => i.durationMinutes !== undefined && i.durationMode !== "na");
  const remaining = timed.reduce((s, i) => s + (i.durationMinutes ?? 0), 0);
  const untimed = active.filter((i) => i.durationMinutes === undefined && i.durationMode !== "na").length;

  const yearAgo = now - 365 * DAY;
  const doneThisYear = done.filter((i) => (i.finishedAt ?? 0) >= yearAgo);
  // Pace: time's worth of items finished over the last 90 days.
  const recent = done.filter((i) => (i.finishedAt ?? 0) >= now - 90 * DAY);
  const recentMinutes = recent.reduce((s, i) => s + (i.durationMinutes ?? 0), 0);
  const perDay = recentMinutes / 90;
  const daysToClear = perDay > 0 ? remaining / perDay : null;

  const waits = done
    .filter((i) => i.finishedAt !== undefined)
    .map((i) => (i.finishedAt! - i.addedAt) / DAY)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const medianWait = waits.length ? waits[Math.floor(waits.length / 2)] : null;

  const byTag = (() => {
    const m = new Map<string, { count: number; minutes: number }>();
    const name = new Map(tags.map((tag) => [tag._id, tag.name]));
    for (const i of active) {
      for (const id of i.tagIds) {
        const n = name.get(id);
        if (!n) continue;
        const e = m.get(n) ?? { count: 0, minutes: 0 };
        e.count++;
        e.minutes += i.durationMode !== "na" ? (i.durationMinutes ?? 0) : 0;
        m.set(n, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].minutes - a[1].minutes || b[1].count - a[1].count).slice(0, 10);
  })();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("nav.stats")}</h1>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile
          label={t("stats.toDo")}
          value={formatNumber(active.length)}
          sub={t("stats.doneSoFar", { count: done.length })}
        />
        <Tile
          label={t("stats.timeToFinishAll")}
          value={remaining ? formatMinutes(remaining) : "—"}
          sub={untimed ? t("stats.untimed", { count: untimed }) : t("stats.forEverything")}
        />
        <Tile
          label={t("stats.atYourPace")}
          value={daysToClear === null ? "—" : formatMinutes(daysToClear * 24 * 60)}
          sub={daysToClear === null ? t("stats.paceUnknown") : t("stats.paceSub", { time: formatMinutes(perDay * 7) })}
        />
        <Tile
          label={t("stats.doneLastYear")}
          value={formatNumber(doneThisYear.length)}
          sub={medianWait === null ? "" : t("stats.typicalWait", { count: Math.round(medianWait) })}
        />
      </div>

      <AddedVsDone items={items} now={now} />

      {byTag.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold">{t("stats.byTag")}</h2>
          <p className="mb-3 text-sm text-muted">{t("stats.byTagHint")}</p>
          <ul className="space-y-2">
            {byTag.map(([tag, v]) => (
              <li key={tag} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate">{tag}</span>
                <div className="h-3 rounded-r bg-sunken">
                  <div
                    className="h-full rounded-r bg-series-1"
                    style={{ width: `${(v.minutes / Math.max(1, byTag[0][1].minutes)) * 100}%` }}
                  />
                </div>
                <span className="text-right text-muted tabular-nums">
                  {v.minutes ? formatMinutes(v.minutes) : "—"} · {v.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </div>
  );
}

type Point = { t: number; added: number; done: number };

// Cumulative items added vs finished, one point per week (or month for long
// histories).
function series(items: Item[], now: number): Point[] {
  if (items.length === 0) return [];
  const start = Math.min(...items.map((i) => i.addedAt));
  const span = now - start;
  const step = span > 2 * 365 * DAY ? 30 * DAY : span > 60 * DAY ? 7 * DAY : DAY;
  const added = items.map((i) => i.addedAt).sort((a, b) => a - b);
  const done = items
    .filter((i) => i.status === "done" && i.finishedAt !== undefined)
    .map((i) => i.finishedAt!)
    .sort((a, b) => a - b);
  const out: Point[] = [];
  let ai = 0;
  let di = 0;
  for (let t = start; ; t += step) {
    const at = Math.min(t, now);
    while (ai < added.length && added[ai] <= at) ai++;
    while (di < done.length && done[di] <= at) di++;
    out.push({ t: at, added: ai, done: di });
    if (at >= now) break;
  }
  return out;
}

function AddedVsDone({ items, now }: { items: Item[]; now: number }) {
  const { t } = useTranslation();
  const data = useMemo(() => series(items, now), [items, now]);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length < 2) {
    return (
      <div className="card p-4 text-sm text-muted">
        {t("stats.chartEmpty")}
      </div>
    );
  }

  const height = 240;
  const pad = { l: 36, r: 64, t: 12, b: 24 };
  const w = Math.max(100, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const maxY = niceMax(Math.max(...data.map((d) => d.added)));
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v: number) => pad.t + h - (v / maxY) * h;
  const path = (key: "added" | "done") => data.map((d, i) => `${i ? "L" : "M"}${x(d.t)},${y(d[key])}`).join("");
  const ticks = [0, maxY / 2, maxY];
  const last = data[data.length - 1];
  const hovered = hover === null ? null : data[hover];
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(i18n.language, { month: "short", year: "numeric" });
  const day = (ms: number) => new Date(ms).toLocaleDateString(i18n.language);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("stats.chartTitle")}</h2>
          <p className="text-sm text-muted">{t("stats.chartHint")}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-series-1" /> {t("stats.added")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-series-2" /> {t("stats.done")}
          </span>
          <button className="underline" onClick={() => setTable((t) => !t)}>
            {table ? t("stats.showChart") : t("stats.showTable")}
          </button>
        </div>
      </div>
      <div ref={ref} className="relative mt-3">
        {table ? (
          <div className="max-h-64 overflow-auto text-sm">
            <table className="w-full tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">{t("stats.date")}</th>
                  <th className="py-1 text-right font-medium">{t("stats.added")}</th>
                  <th className="py-1 text-right font-medium">{t("stats.done")}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.t} className="border-t border-line">
                    <td className="py-1">{day(d.t)}</td>
                    <td className="py-1 text-right">{d.added}</td>
                    <td className="py-1 text-right">{d.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              className="block"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const px = e.clientX - rect.left;
                const at = t0 + ((px - pad.l) / w) * (t1 - t0);
                let best = 0;
                for (let i = 1; i < data.length; i++) {
                  if (Math.abs(data[i].t - at) < Math.abs(data[best].t - at)) best = i;
                }
                setHover(best);
              }}
              onMouseLeave={() => setHover(null)}
              role="img"
              aria-label={t("stats.chartAria", { added: last.added, done: last.done })}
            >
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={pad.l} x2={pad.l + w} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
                  <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
                    {Math.round(v)}
                  </text>
                </g>
              ))}
              <text x={pad.l} y={height - 6} fontSize={11} fill="var(--muted)">
                {fmt(t0)}
              </text>
              <text x={pad.l + w} y={height - 6} fontSize={11} fill="var(--muted)" textAnchor="end">
                {fmt(t1)}
              </text>
              <path d={path("added")} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
              <path d={path("done")} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" />
              {/* Direct labels at the line ends. */}
              <text x={pad.l + w + 6} y={y(last.added) + 4} fontSize={11} fill="var(--ink)">
                {t("stats.addedLabel", { count: last.added })}
              </text>
              <text
                x={pad.l + w + 6}
                y={Math.max(y(last.done) + 4, y(last.added) + 18)}
                fontSize={11}
                fill="var(--ink)"
              >
                {t("stats.doneLabel", { count: last.done })}
              </text>
              {hovered && (
                <g>
                  <line x1={x(hovered.t)} x2={x(hovered.t)} y1={pad.t} y2={pad.t + h} stroke="var(--muted)" strokeWidth={1} />
                  <circle cx={x(hovered.t)} cy={y(hovered.added)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
                  <circle cx={x(hovered.t)} cy={y(hovered.done)} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              )}
            </svg>
            {hovered && (
              <div
                className="pointer-events-none absolute top-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md"
                style={{
                  left: Math.min(x(hovered.t) + 10, width - 150),
                }}
              >
                <div className="mb-1 font-medium">{day(hovered.t)}</div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-series-1" /> {t("stats.added")} <b className="ml-auto pl-3">{hovered.added}</b>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-series-2" /> {t("stats.done")} <b className="ml-auto pl-3">{hovered.done}</b>
                </div>
                <div className="mt-1 text-muted">{t("stats.notDone", { count: hovered.added - hovered.done })}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}
