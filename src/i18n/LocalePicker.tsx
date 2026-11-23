import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { Languages } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { LOCALES, LOCALE_NAMES, toLocale } from "../../convex/lib/locales";

// Changes the UI language; when signed in, also remembers it on the account
// (default tags and AI answers follow it).
export function LocalePicker({ signedIn = false }: { signedIn?: boolean }) {
  const { i18n, t } = useTranslation();
  const setLocale = useMutation(api.admin.setLocale);
  return (
    <label className="inline-flex items-center gap-1 text-sm text-muted">
      <Languages size={15} aria-hidden />
      <select
        className="cursor-pointer bg-transparent py-1 outline-none hover:text-ink"
        value={toLocale(i18n.language)}
        aria-label={t("nav.language")}
        onChange={(e) => {
          const locale = toLocale(e.target.value);
          void i18n.changeLanguage(locale);
          if (signedIn) void setLocale({ locale });
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
