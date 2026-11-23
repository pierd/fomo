import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { toLocale, type Locale } from "../../convex/lib/locales";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pl from "./locales/pl.json";

const STORAGE_KEY = "fomo.locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return toLocale(saved);
  } catch {
    // Storage unavailable.
  }
  const languages = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const lang of languages) {
    const l = lang.slice(0, 2).toLowerCase();
    if (l === "en" || l === "es" || l === "pl") return l;
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, pl: { translation: pl } },
  lng: initialLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

const setHtmlLang = (lng: string) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
};

i18n.on("languageChanged", (lng) => {
  setHtmlLang(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Storage unavailable.
  }
});
setHtmlLang(i18n.language);

export function currentLocale(): Locale {
  return toLocale(i18n.language);
}

export default i18n;
