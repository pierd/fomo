import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import { Plus, Search, Tag as TagIcon, X } from "lucide-react";
import type { Item, Status, Tag } from "../lib/types";
import { formatMinutes, plural } from "../lib/format";
import { ItemCard } from "../components/ItemCard";
import { ItemForm } from "../components/ItemForm";
import { usePersistentState } from "../lib/usePersistentState";

type StatusFilter = Status | "all";
type SortKey = "added" | "finished";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "To do" },
  { value: "done", label: "Done" },
  { value: "discarded", label: "Discarded" },
  { value: "all", label: "All" },
];

export function ItemsPage({ items, tags, aiEnabled }: { items: Item[]; tags: Tag[]; aiEnabled: boolean }) {
  const [status, setStatus] = usePersistentState<StatusFilter>("fomo.status", "active");
  const [selectedTags, setSelectedTags] = usePersistentState<string[]>("fomo.tags", []);
  const [sort, setSort] = usePersistentState<SortKey>("fomo.sort", "added");
  const [search, setSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; itemId: Item["_id"] } | null>(null);

  const tagName = useMemo(() => new Map(tags.map((t) => [t._id, t.name])), [tags]);
  const namesOf = (item: Item) => item.tagIds.flatMap((id) => tagName.get(id) ?? []);
  // Drop selections of tags that were renamed or no longer exist.
  const activeTags = selectedTags.filter((t) => tags.some((x) => x.name === t));
  const effectiveSort: SortKey = status === "active" ? "added" : sort;

  const filtered = useMemo(() => {
    const out = items.filter(
      (i) =>
        (status === "all" || i.status === status) &&
        activeTags.every((t) => i.tagIds.some((id) => tagName.get(id) === t)),
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

  const toggleTag = (t: string) =>
    setSelectedTags(activeTags.includes(t) ? activeTags.filter((x) => x !== t) : [...activeTags, t]);

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
              key={tab.value}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === tab.value ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
              }`}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {status !== "active" && (
          <select
            className="input w-auto py-1.5"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort by"
          >
            <option value="added">Newest added</option>
            <option value="finished">Recently finished</option>
          </select>
        )}
        <button className="btn btn-primary ml-auto px-4" onClick={() => setForm({ mode: "add" })}>
          <Plus size={16} /> Add
        </button>
      </div>

      {/* Search, scoped to the selected tags. */}
      <div className="card mb-2 flex flex-wrap items-center gap-1.5 px-3 py-2 focus-within:border-accent">
        <Search size={16} className="text-muted" />
        {activeTags.length > 0 && <span className="text-xs text-muted">in</span>}
        {activeTags.map((t) => (
          <span key={t} className="chip border-accent bg-accent-soft">
            <TagIcon size={11} /> {t}
            <button onClick={() => toggleTag(t)} aria-label={`Stop filtering by ${t}`} className="opacity-60 hover:opacity-100">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-w-40 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted"
          placeholder={
            activeTags.length
              ? `Search ${plural(filtered.length, "item")} tagged ${activeTags.join(" + ")}…`
              : `Search ${plural(filtered.length, "item")}…`
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="text-muted hover:text-ink" onClick={() => setSearch("")} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
        <button
          className={`chip ${tagPickerOpen ? "border-accent" : ""}`}
          onClick={() => setTagPickerOpen((o) => !o)}
        >
          <TagIcon size={11} /> Tags
        </button>
      </div>
      {tagPickerOpen && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tagCounts.length === 0 && <span className="text-sm text-muted">No tags in this view.</span>}
          {tagCounts.map(([t, n]) => (
            <button
              key={t}
              className={`chip ${activeTags.includes(t) ? "border-accent bg-accent-soft" : "hover:border-accent"}`}
              onClick={() => toggleTag(t)}
            >
              {t} <span className="text-muted">{n}</span>
            </button>
          ))}
          {activeTags.length > 0 && (
            <button className="text-xs text-muted underline" onClick={() => setSelectedTags([])}>
              clear
            </button>
          )}
        </div>
      )}

      <p className="mb-3 text-sm text-muted">
        {plural(shown.length, "item")}
        {totalMinutes > 0 && <> · {formatMinutes(totalMinutes)} in total</>}
        {unknown > 0 && totalMinutes > 0 && <> (+{unknown} without a time)</>}
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
  if (filtered) return <p className="py-12 text-center text-muted">Nothing matches.</p>;
  if (hasAny) return <p className="py-12 text-center text-muted">Nothing here.</p>;
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-lg font-semibold">Your list is empty</p>
      <p className="mt-1 text-sm text-muted">Add the books, movies and games you don't want to miss.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} /> Add the first one
        </button>
        <a className="btn" href="#/import">
          Import a list
        </a>
      </div>
    </div>
  );
}
