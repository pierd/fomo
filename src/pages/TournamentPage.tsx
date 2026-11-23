import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Clock, Equal, Trash2, Trophy, Undo2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildBracket, buildRanking, hashString, type Bracket, type Result } from "../../convex/lib/ranking";
import { errorMessage, formatDate, formatMinutes, plural } from "../lib/format";
import { navigate } from "../lib/router";
import { Cover } from "../components/Cover";

type Data = NonNullable<FunctionReturnType<typeof api.tournaments.get>>;
type TItem = Data["items"][number];
type ItemId = Id<"items">;

export function TournamentPage({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const data = useQuery(api.tournaments.get, { tournamentId });
  if (data === undefined) return <p className="text-muted">Loading…</p>;
  return <TournamentView data={data} />;
}

function TournamentView({ data }: { data: Data }) {
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

  useEffect(() => {
    if (tournament.status !== "active") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") answer("a");
      else if (e.key === "ArrowRight") answer("b");
      else if (e.key === "ArrowDown" || e.key === "=") answer("draw");
      else if (e.key === "z" || e.key === "Backspace") doUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-6">
      <div>
        <a href="#/tournaments" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={14} /> Tournaments
        </a>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-2xl font-bold">{tournament.name}</h1>
          <span className="text-sm text-muted">
            {plural(items.length, "item")} · {plural(asked, "answer")}
            {tournament.importedCount > 0 && <> · {plural(tournament.importedCount, "imported result")}</>}
            {tournament.conflictCount > 0 && <> · {plural(tournament.conflictCount, "conflict")} skipped</>}
          </span>
        </div>
      </div>

      {tournament.status === "active" && pair ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>
                {progress.ruledOut} of {progress.total} out of the running for the top 4
              </span>
              <span>{plural(progress.open, "open question")}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${Math.max(3, (progress.ruledOut / Math.max(1, progress.total - Math.min(4, progress.total))) * 100)}%`,
                }}
              />
            </div>
          </div>
          <p className="text-center text-sm text-muted">Which one would you rather do next?</p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-4">
            <Contender item={byId.get(pair[0])!} onPick={() => answer("a")} disabled={pending} hint="←" />
            <div className="flex flex-col items-center justify-center">
              <button
                className="btn h-12 w-12 rounded-full p-0"
                onClick={() => answer("draw")}
                disabled={pending}
                title="Can't decide: a draw (↓)"
                aria-label="Draw"
              >
                <Equal size={20} />
              </button>
            </div>
            <Contender item={byId.get(pair[1])!} onPick={() => answer("b")} disabled={pending} hint="→" />
          </div>
          <div className="flex items-center justify-center gap-3 text-xs text-muted">
            <button className="btn btn-ghost text-xs" onClick={doUndo} disabled={!canUndo || pending}>
              <Undo2 size={14} /> Undo
            </button>
            <span className="hidden sm:inline">Keys: ← left · → right · ↓ draw · z undo</span>
          </div>
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <Results data={data} byId={byId} ranking={ranking} onUndo={canUndo ? doUndo : undefined} />
      )}

      <div className="border-t border-line pt-4">
        <button
          className="btn btn-ghost text-sm text-red-600"
          onClick={() => {
            if (confirm(`Delete the tournament “${tournament.name}”?`)) {
              void remove({ tournamentId: tournament._id }).then(() => navigate("/tournaments"));
            }
          }}
        >
          <Trash2 size={14} /> Delete tournament
        </button>
      </div>
    </div>
  );
}

function Contender({
  item,
  onPick,
  disabled,
  hint,
}: {
  item: TItem;
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
  const standings = ranking.standings();
  const winner = standings[0]?.itemId;
  const bracket = winner ? buildBracket<ItemId>(data.comparisons, winner) : null;
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Final standing</h2>
          {data.tournament.completedAt && (
            <span className="text-xs text-muted">finished {formatDate(data.tournament.completedAt)}</span>
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
                  {item.status !== "active" && <div className="text-xs text-muted">(already {item.status})</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {onUndo && (
          <button className="btn btn-ghost mt-2 text-xs" onClick={onUndo}>
            <Undo2 size={14} /> Undo the last answer
          </button>
        )}
      </div>

      {bracket && bracket.kind === "match" && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">How the winner got there</h2>
          <div className="card overflow-x-auto p-4">
            <BracketView node={bracket} byId={byId} />
          </div>
        </div>
      )}
    </div>
  );
}

function BracketEntry({ item, winner }: { item: TItem | undefined; winner: boolean }) {
  return (
    <div
      className={`w-40 truncate rounded-md border px-2 py-1 text-xs ${
        winner ? "border-accent bg-accent-soft font-semibold" : "border-line bg-surface text-muted"
      }`}
      title={item?.title}
    >
      {item?.title ?? "(deleted)"}
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
