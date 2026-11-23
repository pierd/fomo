import type { Locale } from "./locales";

export function normalizeTag(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/^#/, "");
}

export type Kind = "book" | "audiobook" | "movie" | "series" | "game" | "podcast";

// Tags that say what kind of thing an item is, in each UI language. New
// accounts get them in their language; imports and AI use them too.
export const KIND_TAGS: Record<Kind, Record<Locale, string>> = {
  book: { en: "books", es: "libros", pl: "książki" },
  audiobook: { en: "audiobooks", es: "audiolibros", pl: "audiobooki" },
  movie: { en: "movies", es: "películas", pl: "filmy" },
  series: { en: "series", es: "series", pl: "seriale" },
  game: { en: "games", es: "videojuegos", pl: "gry" },
  podcast: { en: "podcasts", es: "pódcasts", pl: "podcasty" },
};

const OTHER_DEFAULTS: Record<Locale, string[]> = {
  en: ["fiction", "non-fiction", "documentary"],
  es: ["ficción", "no ficción", "documental"],
  pl: ["beletrystyka", "literatura faktu", "dokument"],
};

export function defaultTags(locale: Locale) {
  const kinds: Kind[] = ["book", "movie", "series", "game", "podcast"];
  return [...kinds.map((k) => KIND_TAGS[k][locale]), ...OTHER_DEFAULTS[locale]];
}

export function kindTag(kind: string | undefined, locale: Locale): string | null {
  return kind && kind in KIND_TAGS ? KIND_TAGS[kind as Kind][locale] : null;
}

// Which kind a set of tags points at, whatever language they're in.
export function kindOfTags(tags: string[]): Kind | null {
  for (const [kind, names] of Object.entries(KIND_TAGS) as [Kind, Record<Locale, string>][]) {
    if (Object.values(names).some((n) => tags.includes(n))) return kind;
  }
  return null;
}
