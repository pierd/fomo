import { useState } from "react";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../convex/_generated/api";
import { currentLocale } from "../i18n";
import { errorMessage } from "../lib/format";
import { steamDrafts, type Draft } from "../lib/importers";

export function SteamForm({ onParsed, onError }: { onParsed: (drafts: Draft[]) => void; onError: (e: string | null) => void }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState("");
  const [wishlist, setWishlist] = useState(true);
  const [busy, setBusy] = useState(false);
  const library = useAction(api.steam.library);
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        library({ profile, wishlist })
          .then((found) => onParsed(steamDrafts(found.games, found.wishlist, currentLocale())))
          .catch((err) => onError(errorMessage(err)))
          .finally(() => setBusy(false));
      }}
    >
      <input
        className="input min-w-52 flex-1"
        value={profile}
        onChange={(e) => setProfile(e.target.value)}
        placeholder="https://steamcommunity.com/id/…"
        aria-label={t("import.steam.profile")}
      />
      <button className="btn btn-primary" disabled={!profile.trim() || busy}>
        {busy && <Loader2 size={14} className="animate-spin" />} {t("import.steam.load")}
      </button>
      <label className="flex w-full items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-accent"
          checked={wishlist}
          onChange={(e) => setWishlist(e.target.checked)}
        />
        {t("import.steam.wishlist")}
      </label>
    </form>
  );
}
