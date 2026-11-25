import type { Draft, Status } from "./importers";
import { num, parseCsv } from "./importers";
import { parseDuration } from "../../convex/lib/duration";
import { kindOfTags } from "../../convex/lib/tags";
import type { Locale } from "../../convex/lib/locales";
import { normalizeTag } from "./tags";

// Importing any CSV: the user says which column is what.

export const FIELDS = [
  "title",
  "creator",
  "year",
  "tags",
  "status",
  "duration",
  "played",
  "addedAt",
  "finishedAt",
  "source",
  "sourceUrl",
  "description",
] as const;
export type Field = (typeof FIELDS)[number];
export type Unit = "seconds" | "minutes" | "hours";
export type DateOrder = "dmy" | "mdy";
export type CsvTable = { fields: string[]; rows: Record<string, string>[] };

export type Mapping = {
  columns: Partial<Record<Field, string>>;
  // What a plain number means.
  durationUnit: Unit;
  playedUnit: Unit;
  dateOrder: DateOrder;
  statuses: Record<string, Status>;
};

// Compared with spaces and punctuation removed.
const GUESSES: Record<Field, string[]> = {
  title: ["title", "name", "game", "tytul", "tytuł", "nazwa", "titulo", "título", "nombre"],
  creator: ["creator", "author", "authors", "director", "directors", "developer", "developers", "studio", "autor"],
  year: ["year", "releaseyear", "releasedate", "rok", "año"],
  tags: ["tags", "tag", "genres", "genre", "tagi", "etiquetas"],
  status: ["status", "completionstatus", "state", "shelf", "estado"],
  duration: ["duration", "timetofinish", "timetobeat", "runtime", "length"],
  played: ["playtime", "played", "timeplayed", "hoursplayed", "playtimeforever"],
  addedAt: ["added", "dateadded", "addedat", "addeddate", "created"],
  finishedAt: ["finished", "datefinished", "finishedat", "completed", "datecompleted", "lastplayed", "lastactivity"],
  source: ["source", "store", "library", "platform"],
  sourceUrl: ["url", "link", "sourceurl"],
  description: ["notes", "note", "description", "comment", "comments"],
};

const simplify = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function readTable(text: string): CsvTable {
  const { rows, fields } = parseCsv(text);
  return { rows, fields: fields.filter(Boolean) };
}

export function columnValues(table: CsvTable, column: string | undefined) {
  return column === undefined ? [] : table.rows.map((r) => r[column]?.trim() ?? "").filter(Boolean);
}

// Distinct statuses, the commonest first.
export function statusValues(table: CsvTable, column: string | undefined) {
  const counts = new Map<string, number>();
  for (const s of columnValues(table, column)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

const DONE = new Set(["done", "finished", "completed", "beaten", "read", "watched", "ukończone", "terminado"]);
const DROPPED = new Set(["discarded", "dropped", "abandoned", "dnf", "didnotfinish", "porzucone", "abandonado"]);

export function guessStatuses(values: string[]): Record<string, Status> {
  return Object.fromEntries(
    values.map((s) => {
      const k = simplify(s);
      return [s, DONE.has(k) ? "done" : DROPPED.has(k) ? "discarded" : "active"];
    }),
  );
}

const SLASHED = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/;

export function guessDateOrder(values: string[], locale: Locale): DateOrder {
  for (const s of values) {
    const m = s.match(SLASHED);
    if (m && Number(m[1]) > 12) return "dmy";
    if (m && Number(m[2]) > 12) return "mdy";
  }
  return locale === "en" ? "mdy" : "dmy";
}

export function guessUnit(column: string | undefined): Unit {
  const k = simplify(column ?? "");
  return /hour|godz|hora/.test(k) ? "hours" : /second|sekund|segund/.test(k) ? "seconds" : "minutes";
}

export function guessMapping(table: CsvTable, locale: Locale): Mapping {
  const columns: Mapping["columns"] = {};
  const taken = new Set<string>();
  for (const field of FIELDS) {
    for (const guess of GUESSES[field]) {
      const column = table.fields.find((f) => !taken.has(f) && simplify(f) === guess);
      if (column === undefined) continue;
      columns[field] = column;
      taken.add(column);
      break;
    }
  }
  return {
    columns,
    durationUnit: guessUnit(columns.duration),
    playedUnit: guessUnit(columns.played),
    dateOrder: guessDateOrder(
      [...columnValues(table, columns.addedAt), ...columnValues(table, columns.finishedAt)],
      locale,
    ),
    statuses: guessStatuses(statusValues(table, columns.status)),
  };
}

export function parseDate(raw: string | undefined, order: DateOrder): number | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  const m = s.match(SLASHED);
  if (m) {
    const [day, month] = order === "dmy" ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    const at = new Date(Date.UTC(Number(m[3]), month - 1, day));
    return at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? at.getTime() : undefined;
  }
  const iso = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  // A bare number isn't a date, whatever Date.parse makes of it.
  if (!iso && /^\d+$/.test(s)) return undefined;
  const t = iso ? Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : Date.parse(s);
  // Before 1980: an "unknown" placeholder such as 0001-01-01 or 1970-01-01.
  return Number.isFinite(t) && t > Date.UTC(1980, 0, 1) ? t : undefined;
}

const PER_MINUTE: Record<Unit, number> = { seconds: 1 / 60, minutes: 1, hours: 60 };

export function parseTime(raw: string | undefined, unit: Unit) {
  const s = raw?.trim() ?? "";
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    return { minutes: Math.round(Number(s.replace(",", ".")) * PER_MINUTE[unit]) };
  }
  const clock = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (clock) return { minutes: Number(clock[1]) * 60 + Number(clock[2]) };
  const d = parseDuration(s);
  if (d?.mode === "minutes") return { minutes: d.minutes };
  if (d?.mode === "pages") return { minutes: d.minutes, pages: d.pages };
  return d?.mode === "na" ? { na: true } : {};
}

export function toDrafts(table: CsvTable, mapping: Mapping, extraTags: string[]): Draft[] {
  const { columns } = mapping;
  return table.rows.flatMap((r) => {
    const get = (f: Field) => {
      const column = columns[f];
      return column === undefined ? undefined : r[column]?.trim() || undefined;
    };
    const title = get("title");
    if (!title) return [];
    const tags = (get("tags") ?? "").split(/[,;|]/).map(normalizeTag).filter(Boolean);
    const tagNames = [...new Set([...extraTags, ...tags])];
    const time: { minutes?: number; pages?: number; na?: boolean } = parseTime(get("duration"), mapping.durationUnit);
    const played: { minutes?: number } = parseTime(get("played"), mapping.playedUnit);
    const year = get("year")?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[0];
    const url = get("sourceUrl");
    const status = get("status");
    return [
      {
        title,
        creator: get("creator"),
        year: num(year),
        tagNames,
        description: get("description"),
        durationMinutes: time.minutes || undefined,
        pages: time.pages,
        noDuration: time.na,
        playedMinutes: columns.played === undefined ? undefined : (played.minutes ?? 0),
        status: (status && mapping.statuses[status]) || "active",
        addedAt: parseDate(get("addedAt"), mapping.dateOrder),
        finishedAt: parseDate(get("finishedAt"), mapping.dateOrder),
        source: get("source"),
        sourceUrl: url && /^https?:\/\//i.test(url) ? url : undefined,
        kind: kindOfTags(tagNames) ?? undefined,
      } satisfies Draft,
    ];
  });
}
