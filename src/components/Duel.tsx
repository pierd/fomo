import { useEffect } from "react";
import { Clock, Equal, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Result } from "../../convex/lib/ranking";
import { formatMinutes } from "../lib/format";
import { Cover } from "./Cover";

type Contestant = Parameters<typeof Cover>[0]["item"] & {
  title: string;
  creator?: string;
  year?: number;
  durationMinutes?: number;
};

// Two items, pick one (or a draw): used by tournaments and ranking duels.
export function Duel({
  a,
  b,
  pending,
  error,
  onAnswer,
  onUndo,
}: {
  a: Contestant;
  b: Contestant;
  pending: boolean;
  error: string | null;
  onAnswer: (result: Result) => void;
  onUndo?: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") onAnswer("a");
      else if (e.key === "ArrowRight") onAnswer("b");
      else if (e.key === "ArrowDown" || e.key === "=") onAnswer("draw");
      else if (e.key === "z" || e.key === "Backspace") onUndo?.();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <p className="text-center text-sm text-muted">{t("play.question")}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-4">
        <Contender item={a} onPick={() => onAnswer("a")} disabled={pending} hint="←" />
        <div className="flex flex-col items-center justify-center">
          <button
            className="btn h-12 w-12 rounded-full p-0"
            onClick={() => onAnswer("draw")}
            disabled={pending}
            title={t("play.drawHint")}
            aria-label={t("play.draw")}
          >
            <Equal size={20} />
          </button>
        </div>
        <Contender item={b} onPick={() => onAnswer("b")} disabled={pending} hint="→" />
      </div>
      <div className="flex items-center justify-center gap-3 text-xs text-muted">
        <button className="btn btn-ghost text-xs" onClick={onUndo} disabled={!onUndo || pending}>
          <Undo2 size={14} /> {t("play.undo")}
        </button>
        <span className="hidden sm:inline">{t("play.keys")}</span>
      </div>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </>
  );
}

function Contender({
  item,
  onPick,
  disabled,
  hint,
}: {
  item: Contestant;
  onPick: () => void;
  disabled: boolean;
  hint: string;
}) {
  return (
    <button
      className="card group flex flex-col items-center gap-3 p-3 text-center transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md disabled:opacity-60 sm:p-5"
      onClick={onPick}
      disabled={disabled}
    >
      <Cover item={item} className="aspect-[2/3] w-full max-w-40" />
      <div>
        <div className="leading-snug font-semibold sm:text-lg">{item.title}</div>
        {item.creator && <div className="text-sm text-muted">{item.creator}</div>}
        <div className="mt-1 flex items-center justify-center gap-2 text-xs text-muted">
          {item.year && <span>{item.year}</span>}
          {item.durationMinutes !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> {formatMinutes(item.durationMinutes)}
            </span>
          )}
        </div>
      </div>
      <span className="hidden text-xs text-muted opacity-0 group-hover:opacity-100 sm:inline">{hint}</span>
    </button>
  );
}
