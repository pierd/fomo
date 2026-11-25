import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import { ArrowLeft, Check, ChevronDown, ChevronUp, ExternalLink, FileUp, Loader2, Lock, Sparkles, Undo2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useOnlineMutation } from "../lib/offline/context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { parseDuration } from "../../convex/lib/duration";
import { currentLocale } from "../i18n";
import {
  ImportFormatError,
  parseFile,
  parseText,
  SOURCES,
  titleKey,
  type Draft,
  type Source,
  type Status,
} from "../lib/importers";
import type { Item, Tag } from "../lib/types";
import { errorMessage, formatMinutes } from "../lib/format";
import { navigate } from "../lib/router";
import { TagInput } from "../components/TagInput";
import { CsvMapper } from "../components/CsvMapper";
import { SteamForm } from "../components/SteamForm";
import { readTable, type CsvTable } from "../lib/csvMapping";

type Row = Draft & { key: number; discarded: boolean; duplicate?: string; selected: boolean };

const BATCH = 200;

const FILTERS = ["all", "picked", "wishlist", "never", "short", "long"] as const;
type Filter = (typeof FILTERS)[number];

function matches(r: Row, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "picked") return !r.discarded;
  if (filter === "wishlist") return r.wishlist === true;
  if (r.playedMinutes === undefined) return false;
  if (filter === "never") return r.playedMinutes === 0;
  return filter === "short" ? r.playedMinutes > 0 && r.playedMinutes < 120 : r.playedMinutes >= 120;
}

export function ImportPage({ items, tags, aiEnabled }: { items: Item[]; tags: Tag[]; aiEnabled: boolean }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [optIn, setOptIn] = useState(false);

  if (rows !== null && source !== null) {
    return (
      <Review
        source={source}
        optIn={optIn}
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
        onParsed={(drafts, pickFromNothing) => {
          setOptIn(pickFromNothing);
          const marked = markDuplicates(drafts, items, t);
          setRows(pickFromNothing ? marked.map((r) => ({ ...r, discarded: true })) : marked);
        }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("import.title")}</h1>
        <p className="text-sm text-muted">{t("import.intro")}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SOURCES.map((s) => (
          <li key={s.id}>
            <button className="card w-full p-4 text-left transition-colors hover:border-accent" onClick={() => setSource(s)}>
              <div className="font-semibold">{sourceName(s, t)}</div>
              <div className="text-sm text-muted">{t(SOURCE_HINTS[s.accepts])}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_HINTS: Record<Source["accepts"], string> = {
  csv: "import.fromCsv",
  mappedCsv: "import.fromMapped",
  profile: "import.fromProfile",
  text: "import.fromText",
};

function sourceName(s: Source, t: TFunction) {
  return s.id === "text" ? t("import.textSource") : s.id === "csv" ? t("import.csvSource") : s.name;
}

function markDuplicates(drafts: Draft[], items: Item[], t: TFunction): Row[] {
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
      duplicate = t(`import.duplicate.${match.status}`);
    } else if (seen.has(k)) {
      duplicate = t("import.duplicate.inImport");
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
  onParsed: (drafts: Draft[], optIn: boolean) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [textTags, setTextTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parseNotes = useAction(api.imports.parseNotes);

  const handle = (drafts: Draft[], optIn = source.optIn ?? false) => {
    if (drafts.length === 0) setError(t("import.nothingFound"));
    else onParsed(drafts, optIn);
  };

  return (
    <div className="space-y-4">
      <button
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        onClick={() => (table !== null ? setTable(null) : onBack())}
      >
        <ArrowLeft size={14} /> {table !== null ? sourceName(source, t) : t("import.title")}
      </button>
      <h1 className="text-2xl font-bold">{t("import.from", { source: sourceName(source, t) })}</h1>
      <ol className="card list-inside list-decimal space-y-1.5 p-5 text-sm">
        {(t(`import.steps.${source.id}`, { returnObjects: true }) as string[]).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      {source.accepts === "profile" ? (
        <SteamForm onParsed={handle} onError={setError} />
      ) : table !== null ? (
        <CsvMapper table={table} tags={tags} onParsed={handle} />
      ) : source.accepts !== "text" ? (
        <label className="card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center hover:border-accent">
          <FileUp size={24} className="text-muted" />
          <span className="font-medium">{t("import.chooseFile")}</span>
          <span className="text-xs text-muted">{t("import.readLocally")}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError(null);
              try {
                const content = await file.text();
                if (source.id === "csv") {
                  const read = readTable(content);
                  if (read.rows.length === 0) setError(t("import.nothingFound"));
                  else setTable(read);
                } else if (source.id !== "steam") {
                  handle(parseFile(source.id, content, file.name, currentLocale()));
                }
              } catch (err) {
                setError(
                  err instanceof ImportFormatError
                    ? t("import.wrongFormat", { source: source.name })
                    : t("import.unreadable"),
                );
              }
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-3">
          <textarea
            className="input min-h-56 font-mono text-sm"
            placeholder={t("import.textPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div>
            <span className="label">{t("import.tagEverything")}</span>
            <TagInput
              value={textTags}
              onChange={setTextTags}
              existing={tags.map((tag) => tag.name)}
              placeholder={t("import.optionalTags")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => handle(parseText(text, textTags))}>
              {t("import.onePerLine")}
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
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t("import.readWithAi")}
              </button>
            ) : (
              <button className="btn" disabled title={t("ai.lockedHint")}>
                <Lock size={14} /> {t("import.readWithAi")}
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
  optIn,
  initial,
  tags,
  aiEnabled,
  onBack,
}: {
  source: Source;
  optIn: boolean;
  initial: Row[];
  tags: Tag[];
  aiEnabled: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [timeVersion, setTimeVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [fetchCovers, setFetchCovers] = useState(true);
  const [estimate, setEstimate] = useState(aiEnabled);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = useOnlineMutation(api.imports.commit);

  const existingTags = useMemo(() => tags.map((t) => t.name), [tags]);
  const kept = rows.filter((r) => !r.discarded);
  const hasWishlist = rows.some((r) => r.wishlist);
  const hasPlayed = rows.some((r) => r.playedMinutes !== undefined);
  const needle = search.trim().toLowerCase();
  const visible = rows.filter((r) => matches(r, filter) && r.title.toLowerCase().includes(needle));
  // Hidden rows are never touched by bulk actions, even if selected before.
  const selected = visible.filter((r) => r.selected);
  const target = selected.length ? selected : visible;
  const dupes = rows.filter((r) => r.duplicate).length;
  const missingTime = kept.filter((r) => r.durationMinutes === undefined && !r.noDuration).length;
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
          noDuration: r.noDuration,
          status: r.status,
          addedAt: r.addedAt,
          finishedAt: r.finishedAt,
          source: r.source,
          sourceUrl: r.sourceUrl,
          kind: r.kind,
          isbn: r.isbn,
          coverUrl: r.coverUrl,
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
        <ArrowLeft size={14} /> {sourceName(source, t)}
      </button>
      <div>
        <h1 className="text-2xl font-bold">{t("review.title")}</h1>
        <p className="text-sm text-muted">
          {t("review.willBeAdded", { count: kept.length })}
          {dupes > 0 && <> {t("review.duplicatesSetAside", { count: dupes })}</>}
        </p>
      </div>

      {/* Bulk actions apply to the selected rows, or to all shown when none are. */}
      <div className="card sticky top-2 z-10 space-y-2 p-3 shadow-sm">
        {(hasPlayed || optIn) && (
          <div className="flex flex-wrap gap-2">
            <select
              className="input w-auto py-1 text-xs"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              aria-label={t("review.filter.label")}
            >
              {FILTERS.filter((f) => f === "all" || f === "picked" || (f === "wishlist" ? hasWishlist : hasPlayed)).map((f) => (
                <option key={f} value={f}>
                  {t(`review.filter.${f}`)}
                </option>
              ))}
            </select>
            <input
              className="input min-w-40 flex-1 py-1 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("review.search")}
              aria-label={t("review.search")}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-accent"
              checked={selected.length === visible.length && visible.length > 0}
              ref={(el) => {
                if (el) el.indeterminate = selected.length > 0 && selected.length < visible.length;
              }}
              onChange={(e) => {
                const keys = new Set(visible.map((r) => r.key));
                const checked = e.target.checked;
                setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, selected: checked } : r)));
              }}
            />
            {selected.length ? t("review.selected", { count: selected.length }) : t("review.select")}
          </label>
          <span className="text-muted">·</span>
          <span className="text-muted">{selected.length ? t("review.forSelected") : t("review.forAll")}</span>
          <button className="btn py-1 text-xs" onClick={() => patchTarget(() => ({ discarded: true }))}>
            <X size={12} /> {t(optIn ? "review.unpick" : "review.discard")}
          </button>
          <button
            className="btn py-1 text-xs"
            // Picking everything shown leaves duplicates out; selecting them adds them anyway.
            onClick={() => patchTarget((r) => (optIn && r.duplicate && !r.selected ? {} : { discarded: false }))}
          >
            {optIn ? <Check size={12} /> : <Undo2 size={12} />} {t(optIn ? "review.pick" : "review.undiscard")}
          </button>
          <button
            className="btn py-1 text-xs"
            title={t("review.noTimeHint")}
            onClick={() => {
              patchTarget(() => ({ noDuration: true, durationMinutes: undefined, pages: undefined }));
              setTimeVersion((n) => n + 1);
            }}
          >
            {t("review.noTime")}
          </button>
          <select
            className="input w-auto py-1 text-xs"
            value=""
            onChange={(e) => {
              const status = e.target.value as Status;
              if (status) patchTarget(() => ({ status }));
            }}
            aria-label={t("review.setStatus")}
          >
            <option value="">{t("review.setStatus")}…</option>
            <option value="active">{t("status.active")}</option>
            <option value="done">{t("status.done")}</option>
            <option value="discarded">{t("status.discarded")}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-52 flex-1">
            <TagInput value={bulkTags} onChange={setBulkTags} existing={existingTags} placeholder={t("review.bulkTagsPlaceholder")} />
          </div>
          <button
            className="btn py-1.5 text-xs"
            disabled={!bulkTags.length}
            onClick={() => patchTarget((r) => ({ tagNames: [...new Set([...r.tagNames, ...bulkTags])] }))}
          >
            {t("review.addTags")}
          </button>
          <button
            className="btn py-1.5 text-xs"
            disabled={!bulkTags.length}
            onClick={() => patchTarget((r) => ({ tagNames: r.tagNames.filter((t) => !bulkTags.includes(t)) }))}
          >
            {t("review.removeTags")}
          </button>
        </div>
        {allTagsInImport.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {t("review.inThisImport")}
            {allTagsInImport.map((tag) => (
              <button
                key={tag}
                className={`chip ${existingTags.includes(tag) ? "" : "border-dashed border-new bg-new-soft text-new"}`}
                title={existingTags.includes(tag) ? t("review.pickTag") : t("review.pickNewTag")}
                onClick={() => setBulkTags((b) => (b.includes(tag) ? b : [...b, tag]))}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {visible.length === 0 && <li className="p-4 text-sm text-muted">{t("review.noMatches")}</li>}
        {visible.map((r) => (
          <ReviewRow
            // Remounts after the bulk change, so the time being edited follows it.
            key={`${r.key}-${timeVersion}`}
            row={r}
            optIn={optIn}
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
          {source.id === "goodreads" || source.id === "steam" || source.id === "letterboxd"
            ? t("review.coversFrom", { source: source.name })
            : t("review.covers")}
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
          {t("review.estimate", { count: missingTime })}
          {!aiEnabled && ` ${t("review.aiLocked")}`}
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn btn-primary px-4" disabled={kept.length === 0 || progress !== null} onClick={() => void run()}>
            {progress ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{" "}
            {t("review.add", { count: kept.length })}
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
  optIn,
  expanded,
  existingTags,
  onToggle,
  onChange,
}: {
  row: Row;
  optIn: boolean;
  expanded: boolean;
  existingTags: string[];
  onToggle: () => void;
  onChange: (p: Partial<Row>) => void;
}) {
  const { t } = useTranslation();
  const [duration, setDuration] = useState(
    row.noDuration ? t("review.noTimeInput") : row.durationMinutes ? formatMinutes(row.durationMinutes) : "",
  );
  return (
    <li className={row.discarded ? "bg-sunken" : ""}>
      <div className="flex items-start gap-3 px-3 py-2">
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={row.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          aria-label={t("review.select")}
        />
        <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className={`text-sm font-medium ${row.discarded ? (optIn ? "text-muted" : "text-muted line-through") : ""}`}>
            {row.title}
            {row.year && <span className="ml-1 font-normal text-muted">({row.year})</span>}
            {row.creator && <span className="font-normal text-muted"> · {row.creator}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
            {row.duplicate && <span className="rounded bg-new-soft px-1.5 text-new">{row.duplicate}</span>}
            {row.status !== "active" && <span className="rounded bg-sunken px-1.5">{t(`status.${row.status}`)}</span>}
            {row.wishlist && <span className="rounded bg-sunken px-1.5">{t("review.onWishlist")}</span>}
            {row.playedMinutes !== undefined && (
              <span>
                {row.playedMinutes > 0
                  ? t("review.played", { time: formatMinutes(row.playedMinutes) })
                  : t("review.neverPlayed")}
              </span>
            )}
            {row.noDuration && <span className="rounded bg-sunken px-1.5">{t("review.noTime")}</span>}
            {row.durationMinutes !== undefined && <span>{formatMinutes(row.durationMinutes)}</span>}
            {row.tagNames.map((tag) => (
              <span key={tag} className={existingTags.includes(tag) ? "chip" : "chip border-dashed border-new bg-new-soft text-new"}>
                {tag}
              </span>
            ))}
          </div>
        </button>
        {row.sourceUrl && (
          <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost p-1.5" title={t("common.open")}>
            <ExternalLink size={14} />
          </a>
        )}
        <button className="btn btn-ghost p-1.5" onClick={onToggle} aria-label={t("item.edit")}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          className="btn py-1 text-xs"
          onClick={() => onChange({ discarded: !row.discarded })}
          title={row.discarded ? t("review.addAfterAll") : t("review.dontAdd")}
        >
          {optIn
            ? t(row.discarded ? "review.pick" : "review.unpick")
            : t(row.discarded ? "review.undiscard" : "review.discard")}
        </button>
      </div>
      {expanded && (
        <div className="grid gap-3 border-t border-line px-10 py-3 sm:grid-cols-2">
          <div>
            <span className="label">{t("form.name")}</span>
            <input className="input" value={row.title} onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <div>
            <span className="label">{t("form.by")}</span>
            <input
              className="input"
              value={row.creator ?? ""}
              onChange={(e) => onChange({ creator: e.target.value || undefined })}
            />
          </div>
          <div className="sm:col-span-2">
            <span className="label">{t("form.tags")}</span>
            <TagInput value={row.tagNames} onChange={(tagNames) => onChange({ tagNames })} existing={existingTags} />
          </div>
          <div>
            <span className="label">{t("form.duration")}</span>
            <input
              className="input"
              value={duration}
              placeholder={t("form.durationPlaceholder")}
              onChange={(e) => {
                setDuration(e.target.value);
                const d = parseDuration(e.target.value);
                if (d?.mode === "minutes") onChange({ durationMinutes: d.minutes, pages: undefined, noDuration: false });
                else if (d?.mode === "pages") onChange({ durationMinutes: d.minutes, pages: d.pages, noDuration: false });
                else if (d) onChange({ durationMinutes: undefined, pages: undefined, noDuration: d.mode === "na" });
              }}
            />
          </div>
          <div>
            <span className="label">{t("review.status")}</span>
            <select className="input" value={row.status} onChange={(e) => onChange({ status: e.target.value as Status })}>
              <option value="active">{t("status.active")}</option>
              <option value="done">{t("status.done")}</option>
              <option value="discarded">{t("status.discarded")}</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <span className="label">{t("form.notes")}</span>
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
