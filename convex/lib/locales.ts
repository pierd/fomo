// The single list of UI locales, shared by backend and frontend.
import { v } from "convex/values";

export const LOCALES = ["en", "es", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
export const localeValidator = v.union(v.literal("en"), v.literal("es"), v.literal("pl"));

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español", pl: "Polski" };

// For AI prompts.
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", es: "Spanish", pl: "Polish" };

export function toLocale(value: unknown): Locale {
  const s = typeof value === "string" ? value.slice(0, 2).toLowerCase() : "";
  return (LOCALES as readonly string[]).includes(s) ? (s as Locale) : "en";
}
