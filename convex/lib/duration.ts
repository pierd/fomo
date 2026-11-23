// "Time to finish" input: free text the user types, shared by the add form
// and imports.

// Roughly an audiobook's pace: ~300 words a page at ~160 words a minute.
export const MINUTES_PER_PAGE = 1.8;

export type DurationInput =
  | { mode: "minutes"; minutes: number }
  | { mode: "pages"; pages: number; minutes: number }
  | { mode: "na" }
  | { mode: "auto" }
  | { mode: "unset" };

export function minutesFromPages(pages: number) {
  return Math.round(pages * MINUTES_PER_PAGE);
}

// Accepts "2h 30m", "2:30", "142 min", "142", "1.5h", "320 pages", "320p",
// "n/a", "?" / "figure this out" / "auto", and the same in Spanish and Polish
// ("2 horas", "300 páginas", "2 godz. 30 min", "300 stron", "n/d", "no sé",
// "nie wiem"). Returns null if unreadable.
export function parseDuration(raw: string): DurationInput | null {
  const s = raw.trim().toLowerCase();
  if (s === "") return { mode: "unset" };
  if (/^(n\/?a|n\/?d|none|nada|brak|nie dotyczy|no aplica|-)$/.test(s)) return { mode: "na" };
  if (/^(\?|auto|figure.*|ai|ia|dunno|unknown|no s[eé].*|nie wiem.*|ustal.*|averígualo|calcula.*)$/.test(s)) {
    return { mode: "auto" };
  }
  const pages = s.match(/^(\d+)\s*(p|pp|pg|pgs|pages?|str|stron[ay]?|strony|pág|págs|páginas?|paginas?)\.?$/);
  if (pages) {
    const n = Number(pages[1]);
    return { mode: "pages", pages: n, minutes: minutesFromPages(n) };
  }
  const clock = s.match(/^(\d+):(\d{1,2})$/);
  if (clock) return { mode: "minutes", minutes: Number(clock[1]) * 60 + Number(clock[2]) };
  const hm = s.match(
    /^(?:(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?|horas?|godz|godzin[ay]?|godzina)\.?)?\s*(?:(\d+)\s*(?:m|mins?|minutes?|minutos?|minut[ay]?)\.?)?$/,
  );
  if (hm && (hm[1] || hm[2])) {
    const h = hm[1] ? Number(hm[1].replace(",", ".")) : 0;
    const m = hm[2] ? Number(hm[2]) : 0;
    return { mode: "minutes", minutes: Math.round(h * 60 + m) };
  }
  if (/^\d+$/.test(s)) return { mode: "minutes", minutes: Number(s) };
  return null;
}

// Text to put back into the input when editing an item, using words the
// parser understands in the current language.
export type DurationWords = { pages: string; na: string };
const EN_WORDS: DurationWords = { pages: "pages", na: "n/a" };

export function durationToInput(
  item: {
    durationMode: string;
    durationMinutes?: number;
    pages?: number;
  },
  words: DurationWords = EN_WORDS,
): string {
  switch (item.durationMode) {
    case "pages":
      return item.pages ? `${item.pages} ${words.pages}` : "";
    case "minutes": {
      if (item.durationMinutes === undefined) return "";
      const h = Math.floor(item.durationMinutes / 60);
      const m = item.durationMinutes % 60;
      return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    }
    case "na":
      return words.na;
    case "auto":
      return item.durationMinutes
        ? durationToInput({ durationMode: "minutes", durationMinutes: item.durationMinutes }, words)
        : "?";
    default:
      return "";
  }
}
