import Papa from "papaparse";
import { minutesFromPages } from "../../convex/lib/duration";
import { normalizeTag } from "./tags";

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
  status: Status;
  addedAt?: number;
  finishedAt?: number;
  source?: string;
  sourceUrl?: string;
  kind?: string;
  isbn?: string;
};

export type SourceId = "goodreads" | "storygraph" | "letterboxd" | "imdb" | "text";

export type Source = {
  id: SourceId;
  name: string;
  accepts: "csv" | "text";
  steps: string[];
};

export const SOURCES: Source[] = [
  {
    id: "goodreads",
    name: "Goodreads",
    accepts: "csv",
    steps: [
      "On goodreads.com, open My Books.",
      "In the left sidebar under Tools, click Import and export (or go to goodreads.com/review/import).",
      "Click Export Library and wait until a link to the file appears (it can take a minute; refresh the page).",
      "Download goodreads_library_export.csv and choose it below.",
    ],
  },
  {
    id: "storygraph",
    name: "StoryGraph",
    accepts: "csv",
    steps: [
      "On app.thestorygraph.com, open your profile menu and go to Manage Account.",
      "Scroll to Manage Your Data and click Export StoryGraph Library.",
      "Click Generate export, then download the CSV when it's ready.",
      "Choose the file below.",
    ],
  },
  {
    id: "letterboxd",
    name: "Letterboxd",
    accepts: "csv",
    steps: [
      "On letterboxd.com, go to Settings → Data and click Export your data.",
      "Unzip the downloaded file.",
      "Choose watchlist.csv below (films you want to see). You can also import watched.csv: those films are added as done.",
    ],
  },
  {
    id: "imdb",
    name: "IMDb",
    accepts: "csv",
    steps: [
      "On imdb.com, open your Watchlist (or Your Ratings).",
      "Click the ⋯ menu (or the share icon) next to the list title and choose Export.",
      "Open Exports from your account menu and download the CSV when it's ready.",
      "Choose the file below. Rated titles are added as done.",
    ],
  },
  {
    id: "text",
    name: "List or notes",
    accepts: "text",
    steps: [
      "Paste a list, one item per line. “Title by Author” and “Title - Author” are understood; bullets and numbers are stripped.",
      "Got messy notes instead? Use “Read with AI” to pick out what's in them.",
    ],
  },
];

function parseCsv(text: string) {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return { rows: res.data, fields: res.meta.fields ?? [] };
}

function num(s: string | undefined) {
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

export function parseGoodreads(text: string): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Book Id") || !fields.includes("Exclusive Shelf")) {
    throw new Error("This doesn't look like a Goodreads export (no “Book Id” / “Exclusive Shelf” columns).");
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
      tagNames: ["books", ...shelves],
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

export function parseStoryGraph(text: string): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Read Status") || !fields.includes("Title")) {
    throw new Error("This doesn't look like a StoryGraph export (no “Title” / “Read Status” columns).");
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
      tagNames: [format === "audio" ? "audiobooks" : "books", ...tags],
      status: done ? "done" : dnf ? "discarded" : "active",
      addedAt,
      finishedAt: done || dnf ? (date(r["Last Date Read"]) ?? addedAt) : undefined,
      source: "StoryGraph",
      kind: "book",
      isbn: isbn(r["ISBN/UID"]),
    } satisfies Draft;
  });
}

export function parseLetterboxd(text: string, fileName: string): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Letterboxd URI") || !fields.includes("Name")) {
    throw new Error("This doesn't look like a Letterboxd export (no “Name” / “Letterboxd URI” columns).");
  }
  const watched = /watched|diary|ratings|reviews/i.test(fileName);
  return rows.map((r) => {
    const at = date(r["Watched Date"]) ?? date(r["Date"]);
    return {
      title: r["Name"]?.trim() ?? "",
      year: num(r["Year"]),
      tagNames: ["movies"],
      status: watched ? "done" : "active",
      addedAt: date(r["Date"]),
      finishedAt: watched ? at : undefined,
      source: "Letterboxd",
      sourceUrl: r["Letterboxd URI"]?.trim() || undefined,
      kind: "movie",
    } satisfies Draft;
  });
}

const IMDB_KIND: Record<string, { tag: string; kind: string }> = {
  movie: { tag: "movies", kind: "movie" },
  "tv movie": { tag: "movies", kind: "movie" },
  short: { tag: "movies", kind: "movie" },
  video: { tag: "movies", kind: "movie" },
  "tv series": { tag: "series", kind: "series" },
  "tv mini series": { tag: "series", kind: "series" },
  "tv special": { tag: "series", kind: "series" },
  "tv episode": { tag: "series", kind: "series" },
  "video game": { tag: "games", kind: "game" },
  podcast: { tag: "podcasts", kind: "podcast" },
};

export function parseImdb(text: string): Draft[] {
  const { rows, fields } = parseCsv(text);
  if (!fields.includes("Const") || !fields.includes("Title")) {
    throw new Error("This doesn't look like an IMDb export (no “Const” / “Title” columns).");
  }
  return rows.map((r) => {
    const type = IMDB_KIND[(r["Title Type"] ?? "").trim().toLowerCase()] ?? { tag: "movies", kind: "movie" };
    const rated = Boolean(r["Your Rating"]?.trim());
    const runtime = num(r["Runtime (mins)"]);
    const addedAt = date(r["Created"]) ?? date(r["Date Rated"]);
    return {
      title: r["Title"]?.trim() ?? "",
      creator: r["Directors"]?.split(",")[0]?.trim() || undefined,
      year: num(r["Year"]),
      tagNames: [type.tag],
      description: r["Description"]?.trim() || undefined,
      // For series the runtime is one episode's: not a time to finish.
      durationMinutes: type.kind === "movie" ? runtime : undefined,
      status: rated ? "done" : "active",
      addedAt,
      finishedAt: rated ? (date(r["Date Rated"]) ?? addedAt) : undefined,
      source: "IMDb",
      sourceUrl: r["URL"]?.trim() || (r["Const"] ? `https://www.imdb.com/title/${r["Const"].trim()}/` : undefined),
      kind: type.kind,
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
      const by = line.match(/^(.+?)\s+(?:by|—|–| - )\s+(.+)$/i);
      return {
        title: by ? by[1].trim() : line,
        creator: by ? by[2].trim() : undefined,
        tagNames,
        status: "active",
      } satisfies Draft;
    });
}

export function parseFile(source: SourceId, text: string, fileName: string): Draft[] {
  const drafts =
    source === "goodreads"
      ? parseGoodreads(text)
      : source === "storygraph"
        ? parseStoryGraph(text)
        : source === "letterboxd"
          ? parseLetterboxd(text, fileName)
          : source === "imdb"
            ? parseImdb(text)
            : parseText(text, []);
  return drafts.filter((d) => d.title);
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
