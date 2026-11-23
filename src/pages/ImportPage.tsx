import { useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ArrowLeft, Check, ChevronDown, ChevronUp, ExternalLink, FileUp, Loader2, Lock, Sparkles, Undo2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { formatMinutes, parseDuration } from "../../convex/lib/duration";
import { parseFile, parseText, SOURCES, titleKey, type Draft, type Source, type Status } from "../lib/importers";
import type { Item, Tag } from "../lib/types";
import { errorMessage, plural } from "../lib/format";
import { navigate } from "../lib/router";
import { TagInput } from "../components/TagInput";

type Row = Draft & { key: number; discarded: boolean; duplicate?: string; selected: boolean };

const BATCH = 200;

export function ImportPage({ items, tags, aiEnabled }: { items: Item[]; tags: Tag[]; aiEnabled: boolean }) {
  const [source, setSource] = useState<Source | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  if (rows !== null && source !== null) {
    return (
      <Review
        source={source}
        initial={rows}
        tags={tags}
        aiEnabled={aiEnabled}
        onBack={() => setRows(null)}
      />
    );
  }
  if (source !== null) {
    return (
      <SourceStep
        source={source}
        aiEnabled={aiEnabled}
        tags={tags}
        onBack={() => setSource(null)}
        onParsed={(drafts) => setRows(markDuplicates(drafts, items))}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="text-sm text-muted">
          Bring over what you already track elsewhere. Nothing is added until you've reviewed it.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SOURCES.map((s) => (
          <li key={s.id}>
            <button className="card w-full p-4 text-left transition-colors hover:border-accent" onClick={() => setSource(s)}>
              <div className="font-semibold">{s.name}</div>
              <div className="text-sm text-muted">
                {s.accepts === "csv" ? "From its CSV export, no login needed" : "Paste a list or rough notes"}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function markDuplicates(drafts: Draft[], items: Item[]): Row[] {
  const existing = new Map<string, Item>();
  for (const i of items) existing.set(titleKey(i.title), i);
  const seen = new Set<string>();
  return drafts.map((d, key) => {
    const k = titleKey(d.title);
    const match = existing.get(k);
    // Same title but clearly different years: e.g. a remake.
    const sameWork = match && !(match.year && d.year && Math.abs(match.year - d.year) > 1);
    let duplicate: string | undefined;
    if (sameWork) {
      duplicate = `Already in your list${match.status === "active" ? "" : ` (${match.status})`}`;
    } else if (seen.has(k)) {
      duplicate = "Appears earlier in this import";
    }
    seen.add(k);
    return { ...d, key, discarded: duplicate !== undefined, duplicate, selected: false };
  });
}

function SourceStep({
  source,
  aiEnabled,
  tags,
  onBack,
  onParsed,
}: {
  source: Source;
  aiEnabled: boolean;
  tags: Tag[];
  onBack: () => void;
  onParsed: (drafts: Draft[]) => void;
}) {
  const [text, setText] = useState("");
  const [textTags, setTextTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parseNotes = useAction(api.imports.parseNotes);

  const handle = (drafts: Draft[]) => {
    if (drafts.length === 0) setError("Found nothing to import.");
    else onParsed(drafts);
  };

  return (
    <div className="space-y-4">
      <button className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink" onClick={onBack}>
        <ArrowLeft size={14} /> Import
      </button>
      <h1 className="text-2xl font-bold">Import from {source.name}</h1>
      <ol className="card list-inside list-decimal space-y-1.5 p-5 text-sm">
        {source.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      {source.accepts === "csv" ? (
        <label className="card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center hover:border-accent">
          <FileUp size={24} className="text-muted" />
          <span className="font-medium">Choose the CSV file</span>
          <span className="text-xs text-muted">It's read in your browser.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError(null);
              try {
                handle(parseFile(source.id, await file.text(), file.name));
              } catch (err) {
                setError(errorMessage(err));
              }
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-3">
          <textarea
            className="input min-h-56 font-mono text-sm"
            placeholder={"Crime and Punishment by Fyodor Dostoevsky\n- Dune: Part Two\n- that podcast about the history of Rome Ana mentioned"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div>
            <span className="label">Tag everything with</span>
            <TagInput value={textTags} onChange={setTextTags} existing={tags.map((t) => t.name)} placeholder="Optional" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => handle(parseText(text, textTags))}>
              One item per line
            </button>
            {aiEnabled ? (
              <button
                className="btn"
                disabled={!text.trim() || busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  parseNotes({ text })
                    .then((found) =>
                      handle(
                        found.map((f) => ({
                          ...f,
                          tagNames: [...new Set([...f.tagNames, ...textTags])],
                          status: "active" as const,
                        })),
                      ),
                    )
                    .catch((err) => setError(errorMessage(err)))
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Read with AI
              </button>
            ) : (
              <button className="btn" disabled title="AI features are locked for your account. Ask an admin to unlock them.">
                <Lock size={14} /> Read with AI
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Review({
  source,
  initial,
  tags,
  aiEnabled,
  onBack,
}: {
  source: Source;
  initial: Row[];
  tags: Tag[];
  aiEnabled: boolean;
  onBack: () => void;
}) {
  const [rows, setRows] = useState(initial);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [fetchCovers, setFetchCovers] = useState(true);
  const [estimate, setEstimate] = useState(aiEnabled);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useMutation(api.imports.commit);

  const existingTags = useMemo(() => tags.map((t) => t.name), [tags]);
  const kept = rows.filter((r) => !r.discarded);
  const selected = rows.filter((r) => r.selected);
  const target = selected.length ? selected : rows;
  const dupes = rows.filter((r) => r.duplicate).length;
  const missingTime = kept.filter((r) => r.durationMinutes === undefined).length;
  const allTagsInImport = useMemo(() => [...new Set(rows.flatMap((r) => r.tagNames))].sort(), [rows]);

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const patchTarget = (fn: (r: Row) => Partial<Row>) => {
    const keys = new Set(target.map((r) => r.key));
    setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, ...fn(r) } : r)));
  };

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: kept.length });
    try {
      for (let i = 0; i < kept.length; i += BATCH) {
        const batch = kept.slice(i, i + BATCH).map((r) => ({
          title: r.title,
          creator: r.creator,
          year: r.year,
          tagNames: r.tagNames,
          description: r.description,
          durationMinutes: r.durationMinutes,
          pages: r.pages,
          status: r.status,
          addedAt: r.addedAt,
          finishedAt: r.finishedAt,
          source: r.source,
          sourceUrl: r.sourceUrl,
          kind: r.kind,
          isbn: r.isbn,
        }));
        await commit({ items: batch, fetchCovers, estimateWithAi: estimate, startDelayMs: i * 1500 });
        setProgress({ done: Math.min(kept.length, i + BATCH), total: kept.length });
      }
      navigate("/");
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <button className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink" onClick={onBack}>
        <ArrowLeft size={14} /> {source.name}
      </button>
      <div>
        <h1 className="text-2xl font-bold">Review the import</h1>
        <p className="text-sm text-muted">
          {plural(kept.length, "item")} will be added
          {dupes > 0 && <>; {plural(dupes, "duplicate")} set aside (undiscard them to add anyway)</>}.
        </p>
      </div>

      {/* Bulk actions apply to the selected rows, or to all when none are. */}
      <div className="card sticky top-2 z-10 space-y-2 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-accent"
              checked={selected.length === rows.length && rows.length > 0}
              ref={(el) => {
                if (el) el.indeterminate = selected.length > 0 && selected.length < rows.length;
              }}
              onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))}
            />
            {selected.length ? `${selected.length} selected` : "Select"}
          </label>
          <span className="text-muted">·</span>
          <span className="text-muted">{selected.length ? "For the selected:" : "For all:"}</span>
          <button className="btn py-1 text-xs" onClick={() => patchTarget(() => ({ discarded: true }))}>
            <X size={12} /> Discard
          </button>
          <button className="btn py-1 text-xs" onClick={() => patchTarget(() => ({ discarded: false }))}>
            <Undo2 size={12} /> Undiscard
          </button>
          <select
            className="input w-auto py-1 text-xs"
            value=""
            onChange={(e) => {
              const status = e.target.value as Status;
              if (status) patchTarget(() => ({ status }));
            }}
            aria-label="Set status"
          >
            <option value="">Set status…</option>
            <option value="active">To do</option>
            <option value="done">Done</option>
            <option value="discarded">Discarded</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-52 flex-1">
            <TagInput value={bulkTags} onChange={setBulkTags} existing={existingTags} placeholder="Tags to add or remove…" />
          </div>
          <button
            className="btn py-1.5 text-xs"
            disabled={!bulkTags.length}
            onClick={() => patchTarget((r) => ({ tagNames: [...new Set([...r.tagNames, ...bulkTags])] }))}
          >
            Add tags
          </button>
          <button
            className="btn py-1.5 text-xs"
            disabled={!bulkTags.length}
            onClick={() => patchTarget((r) => ({ tagNames: r.tagNames.filter((t) => !bulkTags.includes(t)) }))}
          >
            Remove tags
          </button>
        </div>
        {allTagsInImport.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
            In this import:
            {allTagsInImport.map((t) => (
              <button
                key={t}
                className={`chip ${existingTags.includes(t) ? "" : "border-dashed border-new bg-new-soft text-new"}`}
                title={existingTags.includes(t) ? "Click to pick for bulk actions" : "New tag. Click to pick for bulk actions"}
                onClick={() => setBulkTags((b) => (b.includes(t) ? b : [...b, t]))}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {rows.map((r) => (
          <ReviewRow
            key={r.key}
            row={r}
            expanded={expanded === r.key}
            existingTags={existingTags}
            onToggle={() => setExpanded(expanded === r.key ? null : r.key)}
            onChange={(p) => patch(r.key, p)}
          />
        ))}
      </ul>

      <div className="card space-y-3 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-accent" checked={fetchCovers} onChange={(e) => setFetchCovers(e.target.checked)} />
          Download covers{source.id === "goodreads" || source.id === "letterboxd" ? ` from ${source.name}` : ""} in the background
        </label>
        <label className={`flex items-center gap-2 text-sm ${aiEnabled ? "" : "text-muted"}`}>
          <input
            type="checkbox"
            className="accent-accent"
            checked={estimate && aiEnabled}
            disabled={!aiEnabled}
            onChange={(e) => setEstimate(e.target.checked)}
          />
          {aiEnabled ? <Sparkles size={14} /> : <Lock size={14} />}
          Let AI estimate the time to finish for {plural(missingTime, "item")} without one
          {!aiEnabled && " (AI is locked for your account)"}
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn btn-primary px-4" disabled={kept.length === 0 || progress !== null} onClick={() => void run()}>
            {progress ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Add {plural(kept.length, "item")}
          </button>
          {progress && (
            <span className="text-sm text-muted">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({
  row,
  expanded,
  existingTags,
  onToggle,
  onChange,
}: {
  row: Row;
  expanded: boolean;
  existingTags: string[];
  onToggle: () => void;
  onChange: (p: Partial<Row>) => void;
}) {
  const [duration, setDuration] = useState(row.durationMinutes ? formatMinutes(row.durationMinutes) : "");
  return (
    <li className={row.discarded ? "bg-sunken" : ""}>
      <div className="flex items-start gap-3 px-3 py-2">
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={row.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          aria-label="Select"
        />
        <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className={`text-sm font-medium ${row.discarded ? "text-muted line-through" : ""}`}>
            {row.title}
            {row.year && <span className="ml-1 font-normal text-muted">({row.year})</span>}
            {row.creator && <span className="font-normal text-muted"> · {row.creator}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
            {row.duplicate && <span className="rounded bg-new-soft px-1.5 text-new">{row.duplicate}</span>}
            {row.status !== "active" && <span className="rounded bg-sunken px-1.5">{row.status}</span>}
            {row.durationMinutes !== undefined && <span>{formatMinutes(row.durationMinutes)}</span>}
            {row.tagNames.map((t) => (
              <span key={t} className={existingTags.includes(t) ? "chip" : "chip border-dashed border-new bg-new-soft text-new"}>
                {t}
              </span>
            ))}
          </div>
        </button>
        {row.sourceUrl && (
          <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost p-1.5" title="Open source">
            <ExternalLink size={14} />
          </a>
        )}
        <button className="btn btn-ghost p-1.5" onClick={onToggle} aria-label="Edit">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          className="btn py-1 text-xs"
          onClick={() => onChange({ discarded: !row.discarded })}
          title={row.discarded ? "Add it after all" : "Don't add it"}
        >
          {row.discarded ? "Undiscard" : "Discard"}
        </button>
      </div>
      {expanded && (
        <div className="grid gap-3 border-t border-line px-10 py-3 sm:grid-cols-2">
          <div>
            <span className="label">Name</span>
            <input className="input" value={row.title} onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <div>
            <span className="label">By</span>
            <input
              className="input"
              value={row.creator ?? ""}
              onChange={(e) => onChange({ creator: e.target.value || undefined })}
            />
          </div>
          <div className="sm:col-span-2">
            <span className="label">Tags</span>
            <TagInput value={row.tagNames} onChange={(tagNames) => onChange({ tagNames })} existing={existingTags} />
          </div>
          <div>
            <span className="label">Time to finish</span>
            <input
              className="input"
              value={duration}
              placeholder="2h 15m · 320 pages"
              onChange={(e) => {
                setDuration(e.target.value);
                const d = parseDuration(e.target.value);
                if (d?.mode === "minutes") onChange({ durationMinutes: d.minutes, pages: undefined });
                else if (d?.mode === "pages") onChange({ durationMinutes: d.minutes, pages: d.pages });
                else if (d) onChange({ durationMinutes: undefined, pages: undefined });
              }}
            />
          </div>
          <div>
            <span className="label">Status</span>
            <select className="input" value={row.status} onChange={(e) => onChange({ status: e.target.value as Status })}>
              <option value="active">To do</option>
              <option value="done">Done</option>
              <option value="discarded">Discarded</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <span className="label">Notes</span>
            <textarea
              className="input"
              value={row.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value || undefined })}
            />
          </div>
        </div>
      )}
    </li>
  );
}
