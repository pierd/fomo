import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useTranslation } from "react-i18next";
import { formatDate } from "../lib/format";

export function AdminPage() {
  const { t } = useTranslation();
  const users = useQuery(api.admin.listUsers);
  const setAi = useMutation(api.admin.setAiEnabled);
  if (users === undefined) return <p className="text-muted">{t("common.loading")}</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.admin")}</h1>
        <p className="text-sm text-muted">{t("admin.intro")}</p>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {users.map((u) => (
          <li key={u._id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{u.email ?? t("admin.noEmail")}</div>
              <div className="text-xs text-muted">
                {t("admin.joined", { date: formatDate(u.createdAt) })}
                {u.isAdmin && ` · ${t("admin.isAdmin")}`}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-accent"
                checked={u.aiEnabled || u.isAdmin}
                disabled={u.isAdmin}
                onChange={(e) => void setAi({ userId: u._id, enabled: e.target.checked })}
              />
              {t("admin.aiUnlocked")}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
