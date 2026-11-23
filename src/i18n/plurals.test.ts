import { describe, expect, it } from "vitest";
import i18n from "i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pl from "./locales/pl.json";

describe("plurals", () => {
  it("picks the right form", async () => {
    const t = i18n.createInstance();
    await t.init({ resources: { en: { translation: en }, es: { translation: es }, pl: { translation: pl } }, lng: "pl" });
    expect([1, 2, 5, 22, 25].map((count) => t.t("count.item", { count }))).toEqual([
      "1 pozycja",
      "2 pozycje",
      "5 pozycji",
      "22 pozycje",
      "25 pozycji",
    ]);
    await t.changeLanguage("es");
    expect(t.t("review.willBeAdded", { count: 1 })).toBe("Se añadirá 1 elemento.");
    expect(t.t("review.willBeAdded", { count: 3 })).toBe("Se añadirán 3 elementos.");
    expect(t.t("errors.tooManyItems", { count: 1200, max: 1000 })).toContain("1200");
  });
});

describe("calendar spans", () => {
  it("reads naturally in every language", async () => {
    const { formatSpan } = await import("../lib/format");
    const { default: app } = await import("./index");
    await app.changeLanguage("en");
    expect(formatSpan(5 * 365)).toBe("5 years");
    expect(formatSpan(90)).toBe("3 months");
    await app.changeLanguage("pl");
    expect(formatSpan(5 * 365)).toBe("5 lat");
    expect(formatSpan(2 * 365)).toBe("2 lata");
    expect(formatSpan(2.5 * 365)).toBe("2,5 roku");
    await app.changeLanguage("es");
    expect(formatSpan(1.5 * 365)).toBe("18 meses");
  });
});
