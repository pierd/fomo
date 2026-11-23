import { useMutation } from "convex/react";
import { Check, Clock, ExternalLink, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../convex/_generated/api";
import type { Item } from "../lib/types";
import { formatDate, formatMinutes } from "../lib/format";
import { Cover } from "./Cover";

export function ItemCard({
  item,
  tagNames,
  onEdit,
  onTagClick,
  selectedTags,
}: {
  item: Item;
  tagNames: string[];
  onEdit: () => void;
  onTagClick: (tag: string) => void;
  selectedTags: string[];
}) {
  const { t } = useTranslation();
  const setStatus = useMutation(api.items.setStatus);
  return (
    <li className="group card flex gap-3 p-3">
      <button onClick={onEdit} className="shrink-0" aria-label={t("item.editNamed", { title: item.title })}>
        <Cover item={item} tags={tagNames} className="h-20 w-14" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button onClick={onEdit} className="min-w-0 flex-1 text-left">
            <h3 className="leading-snug font-semibold">
              {item.title}
              {item.year && <span className="ml-1 font-normal text-muted">({item.year})</span>}
            </h3>
            {item.creator && <p className="text-sm text-muted">{t("item.by", { creator: item.creator })}</p>}
          </button>
          <div className="flex shrink-0 gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {item.status === "active" ? (
              <>
                <button
                  className="btn btn-ghost p-1.5"
                  title={t("item.markDone")}
                  onClick={() => void setStatus({ itemId: item._id, status: "done" })}
                >
                  <Check size={16} />
                </button>
                <button
                  className="btn btn-ghost p-1.5"
                  title={t("item.discard")}
                  onClick={() => void setStatus({ itemId: item._id, status: "discarded" })}
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <button
                className="btn btn-ghost p-1.5"
                title={t("item.backToList")}
                onClick={() => void setStatus({ itemId: item._id, status: "active" })}
              >
                <RotateCcw size={16} />
              </button>
            )}
            <button className="btn btn-ghost p-1.5" title={t("item.edit")} onClick={onEdit}>
              <Pencil size={16} />
            </button>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {item.aiStatus === "pending" && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Loader2 size={12} className="animate-spin" /> {t("item.cleaningUp")}
            </span>
          )}
          {item.durationMinutes !== undefined && item.durationMode !== "na" && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {formatMinutes(item.durationMinutes)}
              {item.pages ? ` · ${t("item.pagesShort", { count: item.pages })}` : ""}
            </span>
          )}
          {tagNames.map((t) => (
            <button
              key={t}
              className={`chip ${selectedTags.includes(t) ? "border-accent bg-accent-soft" : "hover:border-accent"}`}
              onClick={() => onTagClick(t)}
            >
              {t}
            </button>
          ))}
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-ink"
            >
              <ExternalLink size={12} /> {item.source ?? t("item.link")}
            </a>
          )}
          {item.status !== "active" && item.finishedAt && (
            <span>
              {item.status === "done"
                ? t("item.doneOn", { date: formatDate(item.finishedAt) })
                : t("item.discardedOn", { date: formatDate(item.finishedAt) })}
            </span>
          )}
        </div>
        {item.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{item.description}</p>}
      </div>
    </li>
  );
}
