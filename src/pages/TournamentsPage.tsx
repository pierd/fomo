import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Swords, Trophy } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Item, Tag } from "../lib/types";
import { errorMessage, formatDate, plural } from "../lib/format";
import { navigate } from "../lib/router";

export function TournamentsPage({ tags, items }: { tags: Tag[]; items: Item[] }) {
  const tournaments = useQuery(api.tournaments.list);
  const [creating, setCreating] = useState(false);
  const tagName = useMemo(() => new Map(tags.map((t) => [t._id, t.name])), [tags]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tournaments</h1>
          <p className="text-sm text-muted">Can't decide what's next? Let them fight it out, two at a time.</p>
        </div>
        {!creating && (
          <button className="btn btn-primary px-4" onClick={() => setCreating(true)}>
            <Swords size={16} /> New tournament
          </button>
        )}
      </div>

      {creating && (
        <NewTournament
          tags={tags}
          items={items}
          past={(tournaments ?? []).map((t) => ({ _id: t._id, name: t.name, status: t.status }))}
          onCancel={() => setCreating(false)}
        />
      )}

      {tournaments === undefined ? null : tournaments.length === 0 ? (
        !creating && (
          <div className="card px-6 py-12 text-center text-muted">
            No tournaments yet. Start one to find out what you want to read or watch next.
          </div>
        )
      ) : (
        <ul className="grid gap-2">
          {tournaments.map((t) => (
            <li key={t._id}>
              <a href={`#/tournaments/${t._id}`} className="card block p-4 transition-colors hover:border-accent">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-semibold">{t.name}</h3>
                  <span className="text-xs text-muted">
                    {formatDate(t._creationTime)} · {plural(t.participantCount, "item")}
                    {t.tagIds.length > 0 && <> · {t.tagIds.map((id) => tagName.get(id) ?? "?").join(" + ")}</>}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.status === "active" ? "bg-new-soft text-new" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {t.status === "active" ? "In progress" : "Finished"}
                  </span>
                </div>
                {t.top.length > 0 && (
                  <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {t.top.map((s) => (
                      <li key={s.itemId} className="flex items-center gap-1">
                        {s.rank === 1 ? <Trophy size={14} className="text-amber-500" /> : <span className="text-muted">{s.rank}.</span>}
                        <span className={s.rank === 1 ? "font-medium" : ""}>{s.title}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTournament({
  tags,
  items,
  past,
  onCancel,
}: {
  tags: Tag[];
  items: Item[];
  past: { _id: Id<"tournaments">; name: string; status: string }[];
  onCancel: () => void;
}) {
  const [tagIds, setTagIds] = useState<Id<"tags">[]>([]);
  const [importFrom, setImportFrom] = useState<Id<"tournaments">[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useQuery(api.tournaments.preview, { tagIds, importFrom });
  const create = useMutation(api.tournaments.create);

  // Only offer tags that unfinished items actually have.
  const usable = useMemo(() => {
    const counts = new Map<Id<"tags">, number>();
    for (const i of items) {
      if (i.status !== "active") continue;
      if (!tagIds.every((t) => i.tagIds.includes(t))) continue;
      for (const id of i.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return tags
      .filter((t) => counts.has(t._id) || tagIds.includes(t._id))
      .map((t) => ({ ...t, count: counts.get(t._id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [tags, items, tagIds]);

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  return (
    <div className="card space-y-5 p-5">
      <div>
        <span className="label">Who takes part</span>
        <p className="mb-2 text-sm text-muted">
          Unfinished items with all of these tags. Pick none to include everything.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {usable.map((t) => (
            <button
              key={t._id}
              className={`chip ${tagIds.includes(t._id) ? "border-accent bg-accent-soft" : "hover:border-accent"}`}
              onClick={() => setTagIds(toggle(tagIds, t._id))}
            >
              {t.name} <span className="text-muted">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {past.length > 0 && (
        <div>
          <span className="label">Start from earlier results</span>
          <p className="mb-2 text-sm text-muted">
            Results from these tournaments count as already decided. Pairs they disagree on are ignored.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {past.map((t) => (
              <label key={t._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-sunken">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={importFrom.includes(t._id)}
                  onChange={() => setImportFrom(toggle(importFrom, t._id))}
                />
                <span className="truncate">{t.name}</span>
                {t.status === "active" && <span className="text-xs text-muted">(in progress)</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="t-name">
          Name <span className="normal-case">(optional)</span>
        </label>
        <input
          id="t-name"
          className="input"
          value={name}
          placeholder="e.g. Next book for the holidays"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="rounded-lg bg-sunken px-4 py-3 text-sm">
        {preview === undefined ? (
          <span className="text-muted">Counting…</span>
        ) : (
          <>
            <strong>{plural(preview.participantCount, "item")}</strong> will take part.
            {importFrom.length > 0 && (
              <>
                {" "}
                Imported <strong>{plural(preview.imported, "result")}</strong>
                {preview.conflicts > 0 && (
                  <>
                    , skipped <strong className="text-new">{plural(preview.conflicts, "conflict")}</strong>
                  </>
                )}
                .
              </>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          className="btn btn-primary px-4"
          disabled={busy || preview === undefined || preview.participantCount < 2}
          onClick={() => {
            setBusy(true);
            setError(null);
            create({ tagIds, importFrom, name: name || undefined })
              .then((id) => navigate(`/tournaments/${id}`))
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          <Swords size={16} /> Start
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
