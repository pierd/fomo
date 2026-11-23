import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Check, ExternalLink, ImagePlus, Lock, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useTranslation } from "react-i18next";
import { durationToInput, parseDuration } from "../../convex/lib/duration";
import type { Item, Tag } from "../lib/types";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage, formatMinutes } from "../lib/format";
import { Modal } from "./Modal";
import { TagInput } from "./TagInput";
import { Cover } from "./Cover";

type Props = {
  tags: Tag[];
  aiEnabled: boolean;
  onClose: () => void;
} & ({ mode: "add"; initialTags: string[] } | { mode: "edit"; item: Item });


export function ItemForm(props: Props) {
  const { t } = useTranslation();
  const words = { pages: t("duration.pagesWord"), na: t("duration.naWord") };
  const shortcuts = [
    { label: t("form.shortcutNa"), value: words.na },
    { label: t("form.shortcutPages"), value: "pages" },
    { label: t("form.shortcutAuto"), value: "?" },
  ];
  const item = props.mode === "edit" ? props.item : null;
  const tagById = useMemo(() => new Map(props.tags.map((t) => [t._id, t.name])), [props.tags]);
  const [title, setTitle] = useState(item?.title ?? "");
  const [creator, setCreator] = useState(item?.creator ?? "");
  const [tagNames, setTagNames] = useState<string[]>(
    item ? item.tagIds.flatMap((id) => tagById.get(id) ?? []) : props.mode === "add" ? props.initialTags : [],
  );
  const [duration, setDuration] = useState(item ? durationToInput(item, words) : "");
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

  const awaitingPages = duration.trim() !== "" && duration.trim() === words.pages;
  const parsed = awaitingPages ? parseDuration("") : parseDuration(duration);
  const durationHint = awaitingPages
    ? t("form.typePages")
    : parsed === null
      ? t("form.durationUnreadable")
      : parsed.mode === "minutes"
        ? formatMinutes(parsed.minutes)
        : parsed.mode === "pages"
          ? t("form.pagesEstimate", { time: formatMinutes(parsed.minutes) })
          : parsed.mode === "na"
            ? t("form.notApplicable")
            : parsed.mode === "auto"
              ? props.aiEnabled
                ? t("form.aiWillEstimate")
                : t("form.aiLockedUnknown")
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
    <Modal title={item ? t("form.editTitle") : t("form.addTitle")} onClose={props.onClose}>
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
                  title={t("form.uploadCover")}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={14} />
                </button>
                {item.coverUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost p-1"
                    title={t("form.removeCover")}
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
                {t("form.name")}
              </label>
              <input
                id="item-title"
                className="input text-base"
                autoFocus
                value={title}
                placeholder={t("form.namePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="item-creator">
                {t("form.by")} <span className="normal-case">{t("common.optional")}</span>
              </label>
              <input
                id="item-creator"
                className="input"
                value={creator}
                placeholder={t("form.byPlaceholder")}
                onChange={(e) => setCreator(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <span className="label">{t("form.tags")}</span>
          <TagInput value={tagNames} onChange={setTagNames} existing={props.tags.map((t) => t.name)} />
        </div>

        <div>
          <label className="label" htmlFor="item-duration">
            {t("form.duration")}
          </label>
          <input
            id="item-duration"
            ref={durationRef}
            className={`input ${parsed === null ? "border-red-400" : ""}`}
            value={duration}
            placeholder={t("form.durationPlaceholder")}
            onChange={(e) => setDuration(e.target.value)}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {shortcuts.map((s) => (
              <button
                key={s.label}
                type="button"
                className="chip hover:border-accent"
                onClick={() => {
                  if (s.value === "pages") {
                    setDuration(` ${words.pages}`);
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
            {t("form.notes")}
          </label>
          <textarea
            id="item-description"
            className="input min-h-20"
            value={description}
            placeholder={t("form.notesPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {item && (
          <div>
            <label className="label" htmlFor="item-source">
              {t("form.link")}{" "}
              {item.source && <span className="normal-case">{t("form.importedFrom", { source: item.source })}</span>}
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
                <a className="btn" href={sourceUrl} target="_blank" rel="noreferrer" title={t("common.open")}>
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        )}

        {item?.aiStatus === "failed" && (
          <p className="text-sm text-red-600">{t("form.aiFailed")}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {item ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || parsed === null}>
              {t("common.save")}
            </button>
            <AiButton
              aiEnabled={props.aiEnabled}
              disabled={busy || item.aiStatus === "pending"}
              onClick={() => void run(async () => {
                await update({ itemId: item._id, ...fields, sourceUrl: sourceUrl || undefined });
                await cleanup({ itemId: item._id });
              })}
            >
              {item.aiStatus === "pending" ? t("form.cleaningUp") : t("form.saveAndCleanUp")}
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
                    <Check size={14} /> {t("item.done")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void run(() => setStatus({ itemId: item._id, status: "discarded" }))}
                  >
                    <X size={14} /> {t("item.discard")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void run(() => setStatus({ itemId: item._id, status: "active" }))}
                >
                  <RotateCcw size={14} /> {t("item.backToList")}
                </button>
              )}
              <button
                type="button"
                className="btn text-red-600"
                disabled={busy}
                title={t("form.deleteForGood")}
                onClick={() => {
                  if (confirm(t("form.confirmDelete", { title: item.title }))) {
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
              {t("form.addAndCleanUp")}
            </AiButton>
            <button type="submit" className="btn" disabled={busy || !title.trim() || parsed === null}>
              {t("form.add")}
            </button>
            <button type="button" className="btn btn-ghost ml-auto" onClick={props.onClose}>
              {t("form.discard")}
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
  const { t } = useTranslation();
  if (!aiEnabled) {
    return (
      <button
        type="button"
        className="btn"
        disabled
        title={t("ai.lockedHint")}
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
