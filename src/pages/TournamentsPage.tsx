import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Swords, Trophy } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Item, Tag } from "../lib/types";
import { useTranslation } from "react-i18next";
import { errorMessage, formatDate } from "../lib/format";
import { navigate } from "../lib/router";

export function TournamentsPage({ tags, items }: { tags: Tag[]; items: Item[] }) {
  const { t } = useTranslation();
  const tournaments = useQuery(api.tournaments.list);
  const [creating, setCreating] = useState(false);
  const tagName = useMemo(() => new Map(tags.map((t) => [t._id, t.name])), [tags]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("tournaments.title")}</h1>
          <p className="text-sm text-muted">{t("tournaments.intro")}</p>
        </div>
        {!creating && (
          <button className="btn btn-primary px-4" onClick={() => setCreating(true)}>
            <Swords size={16} /> {t("tournaments.new")}
          </button>
        )}
      </div>

      {creating && (
        <NewTournament
          tags={tags}
          items={items}
          past={(tournaments ?? []).map((x) => ({ _id: x._id, name: x.name, status: x.status }))}
          onCancel={() => setCreating(false)}
        />
      )}

      {tournaments === undefined ? null : tournaments.length === 0 ? (
        !creating && (
          <div className="card px-6 py-12 text-center text-muted">
            {t("tournaments.empty")}
          </div>
        )
      ) : (
        <ul className="grid gap-2">
          {tournaments.map((tour) => (
            <li key={tour._id}>
              <a href={`#/tournaments/${tour._id}`} className="card block p-4 transition-colors hover:border-accent">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-semibold">{tour.name}</h3>
                  <span className="text-xs text-muted">
                    {formatDate(tour._creationTime)} · {t("count.item", { count: tour.participantCount })}
                    {tour.tagIds.length > 0 && <> · {tour.tagIds.map((id) => tagName.get(id) ?? "?").join(" + ")}</>}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                      tour.status === "active" ? "bg-new-soft text-new" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {tour.status === "active" ? t("tournaments.inProgress") : t("tournaments.finished")}
                  </span>
                </div>
                {tour.top.length > 0 && (
                  <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {tour.top.map((s) => (
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
  const { t } = useTranslation();
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
      .filter((tag) => counts.has(tag._id) || tagIds.includes(tag._id))
      .map((tag) => ({ ...tag, count: counts.get(tag._id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [tags, items, tagIds]);

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  return (
    <div className="card space-y-5 p-5">
      <div>
        <span className="label">{t("tournaments.whoTakesPart")}</span>
        <p className="mb-2 text-sm text-muted">{t("tournaments.whoTakesPartHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {usable.map((tag) => (
            <button
              key={tag._id}
              className={`chip ${tagIds.includes(tag._id) ? "border-accent bg-accent-soft" : "hover:border-accent"}`}
              onClick={() => setTagIds(toggle(tagIds, tag._id))}
            >
              {tag.name} <span className="text-muted">{tag.count}</span>
            </button>
          ))}
        </div>
      </div>

      {past.length > 0 && (
        <div>
          <span className="label">{t("tournaments.importLabel")}</span>
          <p className="mb-2 text-sm text-muted">{t("tournaments.importHint")}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {past.map((p) => (
              <label key={p._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-sunken">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={importFrom.includes(p._id)}
                  onChange={() => setImportFrom(toggle(importFrom, p._id))}
                />
                <span className="truncate">{p.name}</span>
                {p.status === "active" && <span className="text-xs text-muted">{t("tournaments.inProgressParen")}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="t-name">
          {t("tournaments.name")} <span className="normal-case">{t("common.optional")}</span>
        </label>
        <input
          id="t-name"
          className="input"
          value={name}
          placeholder={t("tournaments.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="rounded-lg bg-sunken px-4 py-3 text-sm">
        {preview === undefined ? (
          <span className="text-muted">{t("tournaments.counting")}</span>
        ) : (
          <>
            {t("tournaments.willTakePart", { count: preview.participantCount })}
            {importFrom.length > 0 && (
              <>
                {" "}
                {t("tournaments.importedResults", { count: preview.imported })}
                {preview.conflicts > 0 && (
                  <>
                    {" "}
                    <span className="text-new">{t("tournaments.skippedConflicts", { count: preview.conflicts })}</span>
                  </>
                )}
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
          <Swords size={16} /> {t("tournaments.start")}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
