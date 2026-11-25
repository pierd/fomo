import Papa from "papaparse";
import { minutesFromPages } from "../../convex/lib/duration";
import { normalizeTag } from "./tags";
import { KIND_TAGS, type Kind } from "../../convex/lib/tags";
import type { SteamGame, WishlistGame } from "../../convex/lib/steam";
import type { Locale } from "../../convex/lib/locales";

// Thrown for a file that isn't the expected export; the message is a
// translation key.
export class ImportFormatError extends Error {}

export type Status = "active" | "done" | "discarded";

// One row of an import, before it's reviewed and added.
export type Draft = {
  title: string;
  creator?: string;
  year?: number;
  tagNames: string[];
  description?: string;
  durationMinutes?: number;
  pages?: number;
  // "Time to finish" makes no sense for it.
  noDuration?: boolean;
  // Only to help choose in the review.
  playedMinutes?: number;
  wishlist?: boolean;
  status: Status;
  addedAt?: number;
  finishedAt?: number;
  source?: string;
  sourceUrl?: string;
  kind?: string;
  isbn?: string;
  coverUrl?: string;
};

export type SourceId = "goodreads" | "storygraph" | "letterboxd" | "imdb" | "steam" | "csv" | "text";
export type FileSourceId = Exclude<SourceId, "steam" | "csv">;

export type Source = {
  id: SourceId;
  name: string;
  accepts: "csv" | "mappedCsv" | "profile" | "text";
  // Nothing is added unless picked: libraries full of things you never meant to play.
  optIn?: boolean;
};

// Step-by-step instructions live in the translations: import.steps.<id>.
export const SOURCES: Source[] = [
  { id: "goodreads", name: "Goodreads", accepts: "csv" },
  { id: "storygraph", name: "StoryGraph", accepts: "csv" },
  { id: "letterboxd", name: "Letterboxd", accepts: "csv" },
  { id: "imdb", name: "IMDb", accepts: "csv" },
  { id: "steam", name: "Steam", accepts: "profile", optIn: true },
  { id: "csv", name: "", accepts: "mappedCsv" },
  { id: "text", name: "", accepts: "text" },
];

export function parseCsv(text: string) {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return { rows: res.data, fields: res.meta.fields ?? [] };
}

export function num(s: string | undefined) {
  if (!s) return undefined;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function date(s: string | undefined) {
  if (!s?.trim()) return undefined;
  // Goodreads uses 2023/05/17; others ISO.
  const t = Date.parse(s.trim().replace(/\//g, "-"));
  return Number.isFinite(t) ? t : undefined;
}

// Goodreads wraps ISBNs as ="0451526538".
function isbn(s: string | undefined) {
  const clean = (s ?? "").replace(/[^0-9Xx]/g, "");
  return clean.length >= 10 ? clean : undefined;
}

const GOODREADS_BUILTIN = new Set(["to-read", "read", "currently-reading"]);

export function parseGoodreads(text: string, locale: Locale): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Book Id") || !fields.includes("Exclusive Shelf")) {
    throw new ImportFormatError("goodreads");
  }
  return rows.map((r) => {
    const shelf = r["Exclusive Shelf"]?.trim();
    const shelves = (r["Bookshelves"] ?? "")
      .split(",")
      .map((s) => normalizeTag(s))
      .filter((s) => s && !GOODREADS_BUILTIN.has(s));
    const pages = num(r["Number of Pages"]);
    const done = shelf === "read";
    const addedAt = date(r["Date Added"]);
    return {
      title: r["Title"]?.trim() ?? "",
      creator: r["Author"]?.trim() || undefined,
      year: num(r["Original Publication Year"]) ?? num(r["Year Published"]),
      tagNames: [KIND_TAGS.book[locale], ...shelves],
      description: r["Private Notes"]?.trim() || undefined,
      pages,
      durationMinutes: pages ? minutesFromPages(pages) : undefined,
      status: done ? "done" : "active",
      addedAt,
      finishedAt: done ? (date(r["Date Read"]) ?? addedAt) : undefined,
      source: "Goodreads",
      sourceUrl: r["Book Id"] ? `https://www.goodreads.com/book/show/${r["Book Id"].trim()}` : undefined,
      kind: "book",
      isbn: isbn(r["ISBN13"]) ?? isbn(r["ISBN"]),
    } satisfies Draft;
  });
}

export function parseStoryGraph(text: string, locale: Locale): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Read Status") || !fields.includes("Title")) {
    throw new ImportFormatError("storygraph");
  }
  return rows.map((r) => {
    const status = r["Read Status"]?.trim();
    const addedAt = date(r["Date Added"]);
    const done = status === "read";
    const dnf = status === "did-not-finish";
    const tags = (r["Tags"] ?? "")
      .split(",")
      .map((s) => normalizeTag(s))
      .filter(Boolean);
    const format = r["Format"]?.trim().toLowerCase();
    return {
      title: r["Title"]?.trim() ?? "",
      creator: r["Authors"]?.split(",")[0]?.trim() || undefined,
      tagNames: [KIND_TAGS[format === "audio" ? "audiobook" : "book"][locale], ...tags],
      status: done ? "done" : dnf ? "discarded" : "active",
      addedAt,
      finishedAt: done || dnf ? (date(r["Last Date Read"]) ?? addedAt) : undefined,
      source: "StoryGraph",
      kind: "book",
      isbn: isbn(r["ISBN/UID"]),
    } satisfies Draft;
  });
}

export function parseLetterboxd(text: string, fileName: string, locale: Locale): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Letterboxd URI") || !fields.includes("Name")) {
    throw new ImportFormatError("letterboxd");
  }
  const watched = /watched|diary|ratings|reviews/i.test(fileName);
  return rows.map((r) => {
    const at = date(r["Watched Date"]) ?? date(r["Date"]);
    return {
      title: r["Name"]?.trim() ?? "",
      year: num(r["Year"]),
      tagNames: [KIND_TAGS.movie[locale]],
      status: watched ? "done" : "active",
      addedAt: date(r["Date"]),
      finishedAt: watched ? at : undefined,
      source: "Letterboxd",
      sourceUrl: r["Letterboxd URI"]?.trim() || undefined,
      kind: "movie",
    } satisfies Draft;
  });
}

const IMDB_KIND: Record<string, Kind> = {
  movie: "movie",
  "tv movie": "movie",
  short: "movie",
  video: "movie",
  "tv series": "series",
  "tv mini series": "series",
  "tv special": "series",
  "tv episode": "series",
  "video game": "game",
  podcast: "podcast",
};

export function parseImdb(text: string, locale: Locale): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Const") || !fields.includes("Title")) {
    throw new ImportFormatError("imdb");
  }
  return rows.map((r) => {
    const kind = IMDB_KIND[(r["Title Type"] ?? "").trim().toLowerCase()] ?? "movie";
    const rated = Boolean(r["Your Rating"]?.trim());
    const runtime = num(r["Runtime (mins)"]);
    const addedAt = date(r["Created"]) ?? date(r["Date Rated"]);
    return {
      title: r["Title"]?.trim() ?? "",
      creator: r["Directors"]?.split(",")[0]?.trim() || undefined,
      year: num(r["Year"]),
      tagNames: [KIND_TAGS[kind][locale]],
      description: r["Description"]?.trim() || undefined,
      // For series the runtime is one episode's: not a time to finish.
      durationMinutes: kind === "movie" ? runtime : undefined,
      status: rated ? "done" : "active",
      addedAt,
      finishedAt: rated ? (date(r["Date Rated"]) ?? addedAt) : undefined,
      source: "IMDb",
      sourceUrl: r["URL"]?.trim() || (r["Const"] ? `https://www.imdb.com/title/${r["Const"].trim()}/` : undefined),
      kind,
    } satisfies Draft;
  });
}

// One item per line; "Title by Author" / "Title - Author".
export function parseText(text: string, tagNames: string[]): Draft[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•·>]+|\d+[.)]|\[[ xX]?\])\s*/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((line) => {
      // "by" / Polish "autorstwa" / a dash. Not Spanish "de": too common in titles.
      const by = line.match(/^(.+?)\s+(?:by|autorstwa|—|–|-)\s+(.+)$/i);
      return {
        title: by ? by[1].trim() : line,
        creator: by ? by[2].trim() : undefined,
        tagNames,
        status: "active",
      } satisfies Draft;
    });
}

export function parseFile(source: FileSourceId, text: string, fileName: string, locale: Locale): Draft[] {
  const drafts =
    source === "goodreads"
      ? parseGoodreads(text, locale)
      : source === "storygraph"
        ? parseStoryGraph(text, locale)
        : source === "letterboxd"
          ? parseLetterboxd(text, fileName, locale)
          : source === "imdb"
            ? parseImdb(text, locale)
            : parseText(text, []);
  return drafts.filter((d) => d.title);
}

// The wishlist first: what you already said you want to play.
export function steamDrafts(games: SteamGame[], wishlist: WishlistGame[], locale: Locale): Draft[] {
  const common = (appId: number) => ({
    tagNames: [KIND_TAGS.game[locale]],
    status: "active" as const,
    source: "Steam",
    sourceUrl: `https://store.steampowered.com/app/${appId}/`,
    coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
    kind: "game",
  });
  return [
    ...wishlist.map((g) => ({
      ...common(g.appId),
      title: g.title,
      creator: g.creator,
      year: g.year,
      addedAt: g.addedAt,
      ...(g.coverUrl ? { coverUrl: g.coverUrl } : {}),
      wishlist: true,
    })),
    ...games.map((g) => ({
      ...common(g.appId),
      title: g.title,
      playedMinutes: g.playedMinutes,
      // Only used if marked as done or discarded in the review.
      finishedAt: g.lastPlayedAt,
    })),
  ];
}

// For duplicate detection: case, punctuation, series info and leading
// articles don't matter.
export function titleKey(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ")
    .trim();
}
