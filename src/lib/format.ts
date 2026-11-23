import { ConvexError } from "convex/values";
import i18n from "../i18n";

export function formatMinutes(minutes: number) {
  const t = i18n.t.bind(i18n);
  if (minutes < 60) return t("duration.m", { m: Math.round(minutes) });
  const totalHours = minutes / 60;
  if (totalHours < 48) {
    const h = Math.floor(totalHours);
    const m = Math.round(minutes - h * 60);
    return m ? t("duration.hm", { h, m }) : t("duration.h", { h });
  }
  const days = totalHours / 24;
  if (days < 60) return t("duration.d", { d: Math.round(days) });
  return t("duration.mo", { n: (days / 30.4).toLocaleString(i18n.language, { maximumFractionDigits: 1 }) });
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" });
}

export function formatNumber(n: number) {
  return n.toLocaleString(i18n.language);
}

// Server errors carry a code (see convex/lib/errors.ts); anything else is
// unexpected.
export function errorMessage(e: unknown) {
  if (e instanceof ConvexError && typeof e.data === "object" && e.data !== null && "code" in e.data) {
    const data = e.data as { code: string } & Record<string, unknown>;
    return i18n.t(`errors.${data.code}`, { ...data, defaultValue: i18n.t("errors.generic") });
  }
  console.error(e);
  return i18n.t("errors.generic");
}

// Calendar time: "3 days", "5 weeks", "8 months", "2.5 years".
export function formatSpan(days: number) {
  const t = i18n.t.bind(i18n);
  const num = (n: number, digits = 0) => n.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  if (days < 1) return t("span.lessThanDay");
  if (days < 14) {
    const n = Math.round(days);
    return t("span.days", { count: n, n: num(n) });
  }
  if (days < 60) {
    const n = Math.round(days / 7);
    return t("span.weeks", { count: n, n: num(n) });
  }
  if (days < 730) {
    const n = Math.round(days / 30.4);
    return t("span.months", { count: n, n: num(n) });
  }
  const years = Math.round((days / 365) * 10) / 10;
  return t("span.years", { count: years, n: num(years, 1) });
}
