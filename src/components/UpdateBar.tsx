import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";

// A new version waits until asked for: reloading could lose a form or an
// import under review.
export function UpdateBar() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // An installed app can stay open for days.
      if (registration) setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="card fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-center gap-2 p-3 text-sm shadow-lg"
    >
      <span className="flex-1">{t("offline.update")}</span>
      <button className="btn btn-ghost" onClick={() => setNeedRefresh(false)}>
        {t("offline.later")}
      </button>
      <button className="btn btn-primary" onClick={() => void updateServiceWorker(true)}>
        {t("offline.reload")}
      </button>
    </div>
  );
}
