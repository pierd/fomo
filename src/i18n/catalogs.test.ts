import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pl from "./locales/pl.json";

// Flattens to dotted keys, folding plural suffixes into the base key.
function keys(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj) || typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");
const plurals = (catalog: unknown) => [...new Set(keys(catalog).map(base))].sort();

describe("translation catalogs", () => {
  it("have the same keys in every language", () => {
    expect(plurals(es)).toEqual(plurals(en));
    expect(plurals(pl)).toEqual(plurals(en));
  });

  it("have every plural form each language needs", () => {
    const need: Record<string, string[]> = { en: ["one", "other"], es: ["one", "many", "other"], pl: ["one", "few", "many", "other"] };
    for (const [lang, catalog] of Object.entries({ en, es, pl })) {
      const all = keys(catalog);
      const pluralBases = new Set(all.filter((k) => /_(one|other)$/.test(k)).map(base));
      for (const b of pluralBases) {
        for (const form of need[lang]) expect(all, `${lang}: ${b}_${form}`).toContain(`${b}_${form}`);
      }
    }
  });
});
