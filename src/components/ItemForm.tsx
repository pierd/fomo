import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Check, ExternalLink, ImagePlus, Lock, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { durationToInput, formatMinutes, parseDuration } from "../../convex/lib/duration";
import type { Item, Tag } from "../lib/types";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../lib/format";
import { Modal } from "./Modal";
import { TagInput } from "./TagInput";
import { Cover } from "./Cover";

type Props = {
  tags: Tag[];
  aiEnabled: boolean;
  onClose: () => void;
} & ({ mode: "add"; initialTags: string[] } | { mode: "edit"; item: Item });

const DURATION_SHORTCUTS = [
  { label: "N/A", value: "n/a" },
  { label: "Pages…", value: "pages" },
  { label: "Figure it out", value: "?" },
];

export function ItemForm(props: Props) {
  const item = props.mode === "edit" ? props.item : null;
  const tagById = useMemo(() => new Map(props.tags.map((t) => [t._id, t.name])), [props.tags]);
  const [title, setTitle] = useState(item?.title ?? "");
  const [creator, setCreator] = useState(item?.creator ?? "");
  const [tagNames, setTagNames] = useState<string[]>(
    item ? item.tagIds.flatMap((id) => tagById.get(id) ?? []) : props.mode === "add" ? props.initialTags : [],
  );
  const [duration, setDuration] = useState(item ? durationToInput(item) : "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [sourceUrl, setSourceUrl] = useState(item?.sourceUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const durationRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = useMutation(api.items.create);
  const update = useMutation(api.items.update);
  const cleanup = useMutation(api.items.cleanup);
  const setStatus = useMutation(api.items.setStatus);
  const remove = useMutation(api.items.remove);
  const setCover = useMutation(api.items.setCover);
  const uploadUrl = useMutation(api.items.generateUploadUrl);

  const awaitingPages = /^\s*pages?\s*$/i.test(duration);
  const parsed = awaitingPages ? parseDuration("") : parseDuration(duration);
  const durationHint = awaitingPages
    ? "Type the number of pages in front"
    : parsed === null
      ? "Try “2h 15m”, “320 pages”, “n/a” or “?”"
      : parsed.mode === "minutes"
        ? formatMinutes(parsed.minutes)
        : parsed.mode === "pages"
          ? `≈ ${formatMinutes(parsed.minutes)} at audiobook pace`
          : parsed.mode === "na"
            ? "Not applicable"
            : parsed.mode === "auto"
              ? props.aiEnabled
                ? "AI will estimate it"
                : "AI is locked: left unknown"
              : "";

  const run = async (fn: () => Promise<unknown>, close = true) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      if (close) props.onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const fields = {
    title,
    creator: creator || undefined,
    tagNames,
    description: description || undefined,
    duration: duration.trim() || undefined,
  };

  const submitAdd = (withAi: boolean) => run(() => create({ ...fields, cleanup: withAi }));
  const submitEdit = () =>
    run(() => update({ itemId: item!._id, ...fields, sourceUrl: sourceUrl || undefined }));

  return (
    <Modal title={item ? "Edit item" : "Add something"} onClose={props.onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || parsed === null) return;
          if (item) void submitEdit();
          else void submitAdd(false);
        }}
      >
        <div className="flex gap-4">
          {item && (
            <div className="shrink-0">
              <Cover item={item} className="h-28 w-20" />
              <div className="mt-1 flex justify-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost p-1"
                  title="Upload a cover"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={14} />
                </button>
                {item.coverUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost p-1"
                    title="Remove cover"
                    onClick={() => void run(() => setCover({ itemId: item._id, storageId: null }), false)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    const url = await uploadUrl();
                    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
                    const { storageId } = (await res.json()) as { storageId: string };
                    await setCover({ itemId: item._id, storageId: storageId as Id<"_storage"> });
                  }, false);
                }}
              />
            </div>
          )}
          <div className="flex-1 space-y-3">
            <div>
              <label className="label" htmlFor="item-title">
                Name
              </label>
              <input
                id="item-title"
                className="input text-base"
                autoFocus
                value={title}
                placeholder="crime and punishment"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="item-creator">
                By <span className="normal-case">(optional)</span>
              </label>
              <input
                id="item-creator"
                className="input"
                value={creator}
                placeholder="Author, director, studio…"
                onChange={(e) => setCreator(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <span className="label">Tags</span>
          <TagInput value={tagNames} onChange={setTagNames} existing={props.tags.map((t) => t.name)} />
        </div>

        <div>
          <label className="label" htmlFor="item-duration">
            Time to finish
          </label>
          <input
            id="item-duration"
            ref={durationRef}
            className={`input ${parsed === null ? "border-red-400" : ""}`}
            value={duration}
            placeholder="2h 15m · 320 pages · n/a · ?"
            onChange={(e) => setDuration(e.target.value)}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {DURATION_SHORTCUTS.map((s) => (
              <button
                key={s.label}
                type="button"
                className="chip hover:border-accent"
                onClick={() => {
                  if (s.value === "pages") {
                    setDuration(" pages");
                    requestAnimationFrame(() => {
                      durationRef.current?.focus();
                      durationRef.current?.setSelectionRange(0, 0);
                    });
                  } else setDuration(s.value);
                }}
              >
                {s.label}
              </button>
            ))}
            <span className={`ml-1 text-xs ${parsed === null ? "text-red-500" : "text-muted"}`}>{durationHint}</span>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="item-description">
            Notes
          </label>
          <textarea
            id="item-description"
            className="input min-h-20"
            value={description}
            placeholder="Who recommended it, why you want it…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {item && (
          <div>
            <label className="label" htmlFor="item-source">
              Link {item.source && <span className="normal-case">(imported from {item.source})</span>}
            </label>
            <div className="flex gap-2">
              <input
                id="item-source"
                className="input"
                value={sourceUrl}
                placeholder="https://…"
                onChange={(e) => setSourceUrl(e.target.value)}
              />
              {sourceUrl && (
                <a className="btn" href={sourceUrl} target="_blank" rel="noreferrer" title="Open">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        )}

        {item?.aiStatus === "failed" && (
          <p className="text-sm text-red-600">AI clean-up failed: {item.aiError}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {item ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || parsed === null}>
              Save
            </button>
            <AiButton
              aiEnabled={props.aiEnabled}
              disabled={busy || item.aiStatus === "pending"}
              onClick={() => void run(async () => {
                await update({ itemId: item._id, ...fields, sourceUrl: sourceUrl || undefined });
                await cleanup({ itemId: item._id });
              })}
            >
              {item.aiStatus === "pending" ? "Cleaning up…" : "Save & clean up"}
            </AiButton>
            <div className="ml-auto flex gap-1">
              {item.status === "active" ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void run(() => setStatus({ itemId: item._id, status: "done" }))}
                  >
                    <Check size={14} /> Done
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void run(() => setStatus({ itemId: item._id, status: "discarded" }))}
                  >
                    <X size={14} /> Discard
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void run(() => setStatus({ itemId: item._id, status: "active" }))}
                >
                  <RotateCcw size={14} /> Back to list
                </button>
              )}
              <button
                type="button"
                className="btn text-red-600"
                disabled={busy}
                title="Delete for good"
                onClick={() => {
                  if (confirm(`Delete “${item.title}” for good? Marking it done or discarded keeps it in your stats.`)) {
                    void run(() => remove({ itemId: item._id }));
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <AiButton
              aiEnabled={props.aiEnabled}
              primary
              disabled={busy || !title.trim() || parsed === null}
              onClick={() => void submitAdd(true)}
            >
              Add & clean up
            </AiButton>
            <button type="submit" className="btn" disabled={busy || !title.trim() || parsed === null}>
              Add
            </button>
            <button type="button" className="btn btn-ghost ml-auto" onClick={props.onClose}>
              Discard
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function AiButton({
  aiEnabled,
  primary = false,
  disabled,
  onClick,
  children,
}: {
  aiEnabled: boolean;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (!aiEnabled) {
    return (
      <button
        type="button"
        className="btn"
        disabled
        title="AI features are locked for your account. Ask an admin to unlock them."
      >
        <Lock size={14} /> {children}
      </button>
    );
  }
  return (
    <button type="button" className={`btn ${primary ? "btn-primary" : ""}`} disabled={disabled} onClick={onClick}>
      <Sparkles size={14} /> {children}
    </button>
  );
}
