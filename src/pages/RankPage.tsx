import { useMemo, useState } from "react";
import { ArrowLeft, RotateCcw, Search, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "../../convex/_generated/dataModel";
import { confirmedTop, nextPlacement, nextSharpening, SHARPEN_TOP } from "../../convex/lib/globalRanking";
import { buildRanking, type Comparison, type Result } from "../../convex/lib/ranking";
import type { Item, Ranked, Tag } from "../lib/types";
import { useOffline } from "../lib/offline/context";
import { newId } from "../lib/offline/outbox";
import { usePersistentState } from "../lib/usePersistentState";
import { Cover } from "../components/Cover";
import { Duel } from "../components/Duel";

type ItemId = Id<"items">;
type SessionDuel = Comparison<ItemId> & { id: string };

// Improving the ranking: `#/rank` sharpens its top, `#/rank/<item>` finds one
// item's place. Both stay among the items with the tags selected in the list.
export function RankPage({
  itemId,
  items,
  tags,
  ranking,
}: {
  itemId?: string;
  items: Item[];
  tags: Tag[];
  ranking: Ranked;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = usePersistentState<string[]>("fomo.tags", []);
  const pickedTags = tags.filter((tag) => selected.includes(tag.name));
  const focus = items.find((i) => i._id === itemId);
  const pool = items.filter(
    (i) => i.status === "active" && i._id !== itemId && pickedTags.every((tag) => i.tagIds.includes(tag._id)),
  );
  // A different pool is a different set of questions: start over.
  const key = pickedTags.map((tag) => tag._id).join();

  return (
    <div className="space-y-6">
      <div>
        <a href="#/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={14} /> {t("nav.list")}
        </a>
        <h1 className="mt-1 text-2xl font-bold">
          {focus ? t("rank.placeTitle", { title: focus.title }) : t("rank.sharpen")}
        </h1>
        {!itemId && <p className="text-sm text-muted">{t("rank.sharpenIntro")}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {t("rank.among")}
          {pickedTags.length === 0 && <span>{t("rank.everything")}</span>}
          {pickedTags.map((tag) => (
            <span key={tag._id} className="chip border-accent bg-accent-soft">
              {tag.name}
              <button
                onClick={() => setSelected(selected.filter((x) => x !== tag.name))}
                aria-label={t("list.stopFiltering", { tag: tag.name })}
                className="opacity-60 hover:opacity-100"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <span>· {t("count.item", { count: pool.length })}</span>
        </div>
      </div>
      {itemId && !focus ? (
        <p className="text-muted">{t("errors.notFound")}</p>
      ) : pool.length < (focus ? 1 : 2) ? (
        <p className="text-muted">{t("rank.tooFew")}</p>
      ) : focus ? (
        <Place key={key} focus={focus} pool={pool} ranking={ranking} />
      ) : (
        <Sharpen key={key} pool={pool} ranking={ranking} />
      )}
    </div>
  );
}

// The answers given on this visit, and giving and undoing them. They take
// effect at once and are synced in the background.
function useSession() {
  const { outbox } = useOffline();
  const [session, setSession] = useState<SessionDuel[]>([]);
  const answer = (a: ItemId, b: ItemId, result: Result) => {
    const id = newId();
    outbox.add({ kind: "duel", clientId: id, a, b, result, at: Date.now() });
    setSession((s) => [...s, { id, a, b, result }]);
  };
  const last = session.at(-1);
  const undo =
    last &&
    (() => {
      outbox.add({ kind: "undoDuel", clientId: newId(), target: last.id });
      setSession((s) => s.slice(0, -1));
    });
  return { session, answer, undo };
}

function Progress({ value, left, right }: { value: number; left: string; right: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.max(3, value * 100)}%` }}
        />
      </div>
    </div>
  );
}

const byNewest = (items: Item[]) => [...items].sort((a, b) => b.addedAt - a.addedAt);

function Sharpen({ pool, ranking }: { pool: Item[]; ranking: Ranked }) {
  const { t } = useTranslation();
  const { session, answer, undo } = useSession();
  const sorted = ranking.sort(byNewest(pool), (i) => i._id);
  const ids = sorted.map((i) => i._id);
  const byId = new Map(pool.map((i) => [i._id, i]));
  const pair = nextSharpening(ranking, ids);
  const confirmed = confirmedTop(ranking, ids);
  const total = Math.min(SHARPEN_TOP, ids.length);
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Progress
          value={confirmed / total}
          left={t("rank.confirmed", { n: confirmed, total })}
          right={t("count.answer", { count: session.length })}
        />
        {pair ? (
          <Duel
            a={byId.get(pair[0])!}
            b={byId.get(pair[1])!}
            onAnswer={(result) => answer(pair[0], pair[1], result)}
            onUndo={undo}
          />
        ) : (
          <>
            <p>{t("rank.allConfirmed")}</p>
            {undo && (
              <button className="btn btn-ghost text-xs" onClick={() => undo()}>
                <Undo2 size={14} /> {t("results.undoLast")}
              </button>
            )}
          </>
        )}
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold">{t("rank.currentTop")}</h2>
        <Places items={sorted.slice(0, total)} ranks={ranking.ranks(ids)} confirmed={confirmed} />
      </div>
    </div>
  );
}

function Place({ focus, pool, ranking }: { focus: Item; pool: Item[]; ranking: Ranked }) {
  const { t } = useTranslation();
  const { session, answer, undo } = useSession();

  // The list being searched, fixed while searching. Unranked items all share
  // one spot and say little about a place, so they only step in when there's
  // nothing better.
  const freeze = () => {
    const ranked = pool.filter((i) => ranking.isRanked(i._id));
    return ranking.sort(byNewest(ranked.length > 0 ? ranked : pool), (i) => i._id).map((i) => i._id);
  };
  // `freshFrom`: placing it again, trusting only answers from that point on.
  const [search, setSearch] = useState<{ order: ItemId[]; freshFrom: number | null }>(() => ({
    order: freeze(),
    freshFrom: null,
  }));

  const byId = useMemo(() => new Map(pool.map((i) => [i._id, i])), [pool]);
  const order = search.order.filter((id) => byId.has(id));
  const fresh =
    search.freshFrom === null
      ? null
      : buildRanking<ItemId>([focus._id, ...order], session.slice(search.freshFrom));
  const next = nextPlacement(order, (o) => (fresh ?? ranking).relation(focus._id, o));
  const asked = session.length - (search.freshFrom ?? 0);
  // Not past the start of placing it again: those answers are of no use here.
  const undoHere = asked > 0 ? undo : undefined;

  if (next.opponent !== null) {
    const opponent = next.opponent;
    return (
      <div className="space-y-4">
        <Progress
          value={asked / Math.max(1, asked + next.left)}
          left={t("count.answer", { count: asked })}
          right={t("rank.left", { count: next.left })}
        />
        <Duel
          a={focus}
          b={byId.get(opponent)!}
          onAnswer={(result) => answer(focus._id, opponent, result)}
          onUndo={undoHere}
        />
      </div>
    );
  }

  const sorted = ranking.sort(byNewest([...pool, focus]), (i) => i._id);
  const ranks = ranking.ranks(sorted.map((i) => i._id));
  const at = sorted.findIndex((i) => i._id === focus._id);
  // Scores move as answers come in: the final list may have new unknowns.
  const order2 = freeze();
  const canRefine = nextPlacement(order2, (o) => ranking.relation(focus._id, o)).opponent !== null;
  return (
    <div className="space-y-4">
      <p className="text-xl font-semibold">
        {t("rank.result", { rank: ranks.get(focus._id), total: sorted.length })}
      </p>
      <Places items={sorted.slice(Math.max(0, at - 2), at + 3)} ranks={ranks} highlight={focus._id} />
      <div className="flex flex-wrap gap-2">
        {undoHere && (
          <button className="btn btn-ghost" onClick={() => undoHere()}>
            <Undo2 size={14} /> {t("results.undoLast")}
          </button>
        )}
        {canRefine && (
          <button className="btn" onClick={() => setSearch({ order: order2, freshFrom: null })}>
            <Search size={14} /> {t("rank.refine")}
          </button>
        )}
        <button className="btn" onClick={() => setSearch({ order: order2, freshFrom: session.length })}>
          <RotateCcw size={14} /> {t("rank.again")}
        </button>
      </div>
    </div>
  );
}

function Places({
  items,
  ranks,
  confirmed = 0,
  highlight,
}: {
  items: Item[];
  ranks: Map<ItemId, number>;
  confirmed?: number;
  highlight?: ItemId;
}) {
  const { t } = useTranslation();
  return (
    <ol className="grid gap-1.5">
      {items.map((item, i) => (
        <li
          key={item._id}
          className={`card flex items-center gap-3 p-2 ${item._id === highlight ? "border-accent bg-accent-soft" : ""}`}
        >
          <span className="w-8 shrink-0 text-center text-sm font-bold">{ranks.get(item._id)}</span>
          <Cover item={item} className="h-12 w-8" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{item.title}</div>
            {item.creator && <div className="truncate text-sm text-muted">{item.creator}</div>}
          </div>
          {i < confirmed && <span className="text-xs text-muted">{t("rank.certain")}</span>}
        </li>
      ))}
    </ol>
  );
}
