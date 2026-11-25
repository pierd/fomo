import { CloudOff, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOffline, useOutbox } from "../lib/offline/context";

export function OfflineBar() {
  const { t } = useTranslation();
  const { offline, skipped, dismissSkipped, syncFailed, flush } = useOffline();
  const waiting = useOutbox().ops.length;
  const bar = "mb-4 flex items-center gap-2 rounded-lg bg-new-soft px-3 py-2 text-sm text-new";
  return (
    <div role="status">
      {offline ? (
        <div className={bar}>
          <CloudOff size={16} className="shrink-0" />
          <span>
            {t("offline.banner")} {waiting > 0 && t("offline.waiting", { count: waiting })}
          </span>
        </div>
      ) : (
        syncFailed &&
        waiting > 0 && (
          <div className={bar}>
            <span>{t("offline.syncFailed", { count: waiting })}</span>
            <button className="btn btn-ghost ml-auto p-1.5 text-xs" onClick={() => void flush()}>
              <RefreshCw size={14} /> {t("offline.retry")}
            </button>
          </div>
        )
      )}
      {skipped > 0 && (
        <div className={bar}>
          <span>{t("offline.skipped", { count: skipped })}</span>
          <button className="btn btn-ghost ml-auto p-1.5" onClick={dismissSkipped} aria-label={t("common.close")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
