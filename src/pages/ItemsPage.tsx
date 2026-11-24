import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import { Bot, Plus, Search, Tag as TagIcon, X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Item, Status, Tag } from "../lib/types";
import { useTranslation } from "react-i18next";
import { formatMinutes } from "../lib/format";
import { ItemCard } from "../components/ItemCard";
import { ItemForm } from "../components/ItemForm";
import { usePersistentState } from "../lib/usePersistentState";

type StatusFilter = Status | "all";
type SortKey = "added" | "finished";

const STATUS_TABS: StatusFilter[] = ["active", "done", "discarded", "all"];

export function ItemsPage({ items, tags, aiEnabled }: { items: Item[]; tags: Tag[]; aiEnabled: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = usePersistentState<StatusFilter>("fomo.status", "active");
  const [selectedTags, setSelectedTags] = usePersistentState<string[]>("fomo.tags", []);
  const [sort, setSort] = usePersistentState<SortKey>("fomo.sort", "added");
  const [search, setSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; itemId: Item["_id"] } | null>(null);

  const tagName = useMemo(() => new Map(tags.map((tag) => [tag._id, tag.name])), [tags]);
  const namesOf = (item: Item) => item.tagIds.flatMap((id) => tagName.get(id) ?? []);
  // Drop selections of tags that were renamed or no longer exist.
  const activeTags = selectedTags.filter((tag) => tags.some((x) => x.name === tag));
  const effectiveSort: SortKey = status === "active" ? "added" : sort;

  const filtered = useMemo(() => {
    const out = items.filter(
      (i) =>
        (status === "all" || i.status === status) &&
        activeTags.every((tag) => i.tagIds.some((id) => tagName.get(id) === tag)),
    );
    if (effectiveSort === "finished") {
      out.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    } else {
      out.sort((a, b) => b.addedAt - a.addedAt);
    }
    return out;
  }, [items, status, activeTags, tagName, effectiveSort]);

  const fuse = useMemo(
    () =>
      new Fuse(
        filtered.map((item) => ({ item, tags: item.tagIds.map((id) => tagName.get(id) ?? "") })),
        {
          keys: [
            { name: "item.title", weight: 3 },
            { name: "item.creator", weight: 2 },
            { name: "tags", weight: 1 },
            { name: "item.description", weight: 0.5 },
          ],
          threshold: 0.4,
          ignoreLocation: true,
        },
      ),
    [filtered, tagName],
  );
  const shown = search.trim() ? fuse.search(search.trim()).map((r) => r.item.item) : filtered;

  const totalMinutes = shown.reduce((sum, i) => sum + (i.durationMode !== "na" ? (i.durationMinutes ?? 0) : 0), 0);
  const unknown = shown.filter((i) => i.durationMinutes === undefined && i.durationMode !== "na").length;

  const toggleTag = (tag: string) =>
    setSelectedTags(activeTags.includes(tag) ? activeTags.filter((x) => x !== tag) : [...activeTags, tag]);

  const editing = form?.mode === "edit" ? items.find((i) => i._id === form.itemId) : undefined;

  // Tags used by the items in the current status, most used first.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) {
      if (status !== "all" && i.status !== status) continue;
      for (const id of i.tagIds) {
        const n = tagName.get(id);
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, status, tagName]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === tab ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
              }`}
              onClick={() => setStatus(tab)}
            >
              {t(`status.${tab}`)}
            </button>
          ))}
        </div>
        {status !== "active" && (
          <select
            className="input w-auto py-1.5"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label={t("list.sortBy")}
          >
            <option value="added">{t("list.sortAdded")}</option>
            <option value="finished">{t("list.sortFinished")}</option>
          </select>
        )}
        <button className="btn btn-primary ml-auto px-4" onClick={() => setForm({ mode: "add" })}>
          <Plus size={16} /> {t("list.add")}
        </button>
      </div>

      {/* Search, scoped to the selected tags. */}
      <div className="card mb-2 flex flex-wrap items-center gap-1.5 px-3 py-2 focus-within:border-accent">
        <Search size={16} className="text-muted" />
        {activeTags.length > 0 && <span className="text-xs text-muted">{t("list.searchIn")}</span>}
        {activeTags.map((tag) => (
          <span key={tag} className="chip border-accent bg-accent-soft">
            <TagIcon size={11} /> {tag}
            <button onClick={() => toggleTag(tag)} aria-label={t("list.stopFiltering", { tag: tag })} className="opacity-60 hover:opacity-100">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-w-40 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted"
          placeholder={
            activeTags.length
              ? t("list.searchTagged", { count: filtered.length, tags: activeTags.join(" + ") })
              : t("list.search", { count: filtered.length })
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="text-muted hover:text-ink" onClick={() => setSearch("")} aria-label={t("list.clearSearch")}>
            <X size={14} />
          </button>
        )}
        <button
          className={`chip ${tagPickerOpen ? "border-accent" : ""}`}
          onClick={() => setTagPickerOpen((o) => !o)}
        >
          <TagIcon size={11} /> {t("list.tags")}
        </button>
      </div>
      {tagPickerOpen && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tagCounts.length === 0 && <span className="text-sm text-muted">{t("list.noTags")}</span>}
          {tagCounts.map(([tag, n]) => (
            <button
              key={tag}
              className={`chip ${activeTags.includes(tag) ? "border-accent bg-accent-soft" : "hover:border-accent"}`}
              onClick={() => toggleTag(tag)}
            >
              {tag} <span className="text-muted">{n}</span>
            </button>
          ))}
          {activeTags.length > 0 && (
            <button className="text-xs text-muted underline" onClick={() => setSelectedTags([])}>
              {t("list.clearTags")}
            </button>
          )}
        </div>
      )}

      <p className="mb-3 text-sm text-muted">
        {t("count.item", { count: shown.length })}
        {totalMinutes > 0 && <> · {t("list.inTotal", { time: formatMinutes(totalMinutes) })}</>}
        {unknown > 0 && totalMinutes > 0 && <> {t("list.withoutTime", { count: unknown })}</>}
      </p>

      {shown.length === 0 ? (
        <EmptyState
          hasAny={items.length > 0}
          filtered={search !== "" || activeTags.length > 0}
          onAdd={() => setForm({ mode: "add" })}
        />
      ) : (
        <ul className="grid gap-2">
          {shown.map((item) => (
            <ItemCard
              key={item._id}
              item={item}
              tagNames={namesOf(item)}
              selectedTags={activeTags}
              onEdit={() => setForm({ mode: "edit", itemId: item._id })}
              onTagClick={toggleTag}
            />
          ))}
        </ul>
      )}

      <AgentsHint itemCount={items.length} />

      {form?.mode === "add" && (
        <ItemForm
          mode="add"
          initialTags={activeTags}
          tags={tags}
          aiEnabled={aiEnabled}
          onClose={() => setForm(null)}
        />
      )}
      {editing && (
        <ItemForm mode="edit" item={editing} tags={tags} aiEnabled={aiEnabled} onClose={() => setForm(null)} />
      )}
    </div>
  );
}

function EmptyState({ hasAny, filtered, onAdd }: { hasAny: boolean; filtered: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  if (filtered) return <p className="py-12 text-center text-muted">{t("list.nothingMatches")}</p>;
  if (hasAny) return <p className="py-12 text-center text-muted">{t("list.nothingHere")}</p>;
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-lg font-semibold">{t("list.emptyTitle")}</p>
      <p className="mt-1 text-sm text-muted">{t("list.emptyText")}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} /> {t("list.addFirst")}
        </button>
        <a className="btn" href="#/import">
          {t("list.importList")}
        </a>
      </div>
    </div>
  );
}

// A quiet pointer to the Agents page, for people with a list worth managing
// who haven't connected an agent yet. Dismissible for good.
function AgentsHint({ itemCount }: { itemCount: number }) {
  const { t } = useTranslation();
  const tokens = useQuery(api.apiTokens.list);
  const [dismissed, setDismissed] = usePersistentState("fomo.agentsHintDismissed", false);
  if (dismissed || itemCount < 3 || tokens === undefined || tokens.length > 0) return null;
  return (
    <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted">
      <Bot size={13} aria-hidden />
      <span>
        {t("agents.hint")}{" "}
        <a href="#/agents" className="underline hover:text-ink">
          {t("agents.hintLink")}
        </a>
      </span>
      <button className="ml-1 opacity-60 hover:opacity-100" onClick={() => setDismissed(true)} aria-label={t("common.close")}>
        <X size={12} />
      </button>
    </p>
  );
}
