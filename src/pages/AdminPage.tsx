import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatDate } from "../lib/format";

export function AdminPage() {
  const users = useQuery(api.admin.listUsers);
  const setAi = useMutation(api.admin.setAiEnabled);
  if (users === undefined) return <p className="text-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted">AI features (clean-up, covers via AI, reading notes) are locked until unlocked here.</p>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {users.map((u) => (
          <li key={u._id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{u.email ?? "(no email)"}</div>
              <div className="text-xs text-muted">
                joined {formatDate(u.createdAt)}
                {u.isAdmin && " · admin"}
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
              AI unlocked
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
