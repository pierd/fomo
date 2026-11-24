import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Trash2, Trophy, Undo2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildBracket, buildRanking, hashString, type Bracket, type Result } from "../../convex/lib/ranking";
import { useTranslation } from "react-i18next";
import { errorMessage, formatDate } from "../lib/format";
import { navigate } from "../lib/router";
import { Cover } from "../components/Cover";
import { Duel } from "../components/Duel";

type Data = NonNullable<FunctionReturnType<typeof api.tournaments.get>>;
type TItem = Data["items"][number];
type ItemId = Id<"items">;

export function TournamentPage({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const { t } = useTranslation();
  const data = useQuery(api.tournaments.get, { tournamentId });
  if (data === undefined) return <p className="text-muted">{t("common.loading")}</p>;
  return <TournamentView data={data} />;
}

function TournamentView({ data }: { data: Data }) {
  const { t } = useTranslation();
  const { tournament, items, comparisons } = data;
  const record = useMutation(api.tournaments.record);
  const undo = useMutation(api.tournaments.undo);
  const remove = useMutation(api.tournaments.remove);
  const [pendingAt, setPendingAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i._id, i])), [items]);
  const ranking = useMemo(
    () => buildRanking<ItemId>(items.map((i) => i._id), comparisons),
    [items, comparisons],
  );
  const asked = comparisons.filter((c) => !c.imported).length;
  const pair = useMemo(
    () => ranking.nextPair(hashString(tournament._id) + comparisons.length),
    [ranking, tournament._id, comparisons.length],
  );
  const progress = ranking.progress();
  // Waiting for the server to confirm the last answer.
  const pending = pendingAt !== null && pendingAt === comparisons.length;

  const answer = (result: Result) => {
    if (!pair || pending) return;
    setPendingAt(comparisons.length);
    setError(null);
    record({ tournamentId: tournament._id, a: pair[0], b: pair[1], result }).catch((e) => {
      setPendingAt(null);
      setError(errorMessage(e));
    });
  };
  const canUndo = asked > 0;
  const doUndo = () => {
    if (!canUndo || pending) return;
    setPendingAt(comparisons.length);
    undo({ tournamentId: tournament._id }).catch((e) => {
      setPendingAt(null);
      setError(errorMessage(e));
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <a href="#/tournaments" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={14} /> {t("nav.tournaments")}
        </a>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-2xl font-bold">{tournament.name}</h1>
          <span className="text-sm text-muted">
            {t("count.item", { count: items.length })} · {t("count.answer", { count: asked })}
            {tournament.importedCount > 0 && <> · {t("count.importedResult", { count: tournament.importedCount })}</>}
            {tournament.conflictCount > 0 && <> · {t("tournaments.skippedConflicts", { count: tournament.conflictCount })}</>}
          </span>
        </div>
      </div>

      {tournament.status === "active" && pair ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>
                {t("play.ruledOut", { ruledOut: progress.ruledOut, total: progress.total })}
              </span>
              <span>{t("play.questionsLeft", { count: progress.left })}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${Math.max(3, (asked / Math.max(1, asked + progress.left)) * 100)}%`,
                }}
              />
            </div>
          </div>
          <Duel
            a={byId.get(pair[0])!}
            b={byId.get(pair[1])!}
            pending={pending}
            error={error}
            onAnswer={answer}
            onUndo={canUndo ? doUndo : undefined}
          />
        </div>
      ) : (
        <Results data={data} byId={byId} ranking={ranking} onUndo={canUndo ? doUndo : undefined} />
      )}

      <div className="border-t border-line pt-4">
        <button
          className="btn btn-ghost text-sm text-red-600"
          onClick={() => {
            if (confirm(t("tournaments.confirmDelete", { name: tournament.name }))) {
              void remove({ tournamentId: tournament._id }).then(() => navigate("/tournaments"));
            }
          }}
        >
          <Trash2 size={14} /> {t("tournaments.delete")}
        </button>
      </div>
    </div>
  );
}

function Results({
  data,
  byId,
  ranking,
  onUndo,
}: {
  data: Data;
  byId: Map<ItemId, TItem>;
  ranking: ReturnType<typeof buildRanking<ItemId>>;
  onUndo?: () => void;
}) {
  const { t } = useTranslation();
  const standings = ranking.standings();
  const winner = standings[0]?.itemId;
  const bracket = winner ? buildBracket<ItemId>(data.comparisons, winner) : null;
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{t("results.title")}</h2>
          {data.tournament.completedAt && (
            <span className="text-xs text-muted">{t("results.finishedOn", { date: formatDate(data.tournament.completedAt) })}</span>
          )}
        </div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {standings.map((s, i) => {
            const item = byId.get(s.itemId);
            if (!item) return null;
            return (
              <li
                key={s.itemId}
                className={`card flex items-center gap-3 p-3 ${i === 0 ? "border-accent sm:col-span-2" : ""}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    s.rank === 1 ? "bg-amber-400 text-amber-950" : "bg-sunken"
                  }`}
                >
                  {s.rank === 1 ? <Trophy size={16} /> : s.rank}
                </span>
                <Cover item={item} className={i === 0 ? "h-24 w-16" : "h-14 w-10"} />
                <div className="min-w-0">
                  <div className={`font-semibold ${i === 0 ? "text-lg" : ""}`}>{item.title}</div>
                  {item.creator && <div className="text-sm text-muted">{item.creator}</div>}
                  {item.status !== "active" && <div className="text-xs text-muted">{t(`results.already.${item.status}`)}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {onUndo && (
          <button className="btn btn-ghost mt-2 text-xs" onClick={onUndo}>
            <Undo2 size={14} /> {t("results.undoLast")}
          </button>
        )}
      </div>

      {bracket && bracket.kind === "match" && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">{t("results.bracket")}</h2>
          <div className="card overflow-x-auto p-4">
            <BracketView node={bracket} byId={byId} />
          </div>
        </div>
      )}
    </div>
  );
}

function BracketEntry({ item, winner }: { item: TItem | undefined; winner: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={`w-40 truncate rounded-md border px-2 py-1 text-xs ${
        winner ? "border-accent bg-accent-soft font-semibold" : "border-line bg-surface text-muted"
      }`}
      title={item?.title}
    >
      {item?.title ?? t("common.deleted")}
    </div>
  );
}

// Earlier rounds on the left, the final on the right.
function BracketView({ node, byId }: { node: Bracket<ItemId>; byId: Map<ItemId, TItem> }) {
  if (node.kind === "leaf") return <BracketEntry item={byId.get(node.itemId)} winner={false} />;
  return (
    <div className="flex items-center">
      <div className="flex flex-col">
        {[node.left, node.right].map((child, i) => (
          <div
            key={i}
            className={`relative py-1 pr-4 before:absolute before:top-1/2 before:right-0 before:w-4 before:border-t before:border-line after:absolute after:right-0 after:h-1/2 after:border-r after:border-line ${
              i === 0 ? "after:top-1/2" : "after:top-0"
            }`}
          >
            <BracketView node={child} byId={byId} />
          </div>
        ))}
      </div>
      <div className="w-4 border-t border-line" />
      <BracketEntry item={byId.get(node.itemId)} winner />
    </div>
  );
}
