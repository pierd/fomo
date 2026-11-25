import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useConvex, useConvexAuth, useConvexConnectionState, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Item } from "../types";
import { QueryCache } from "./cache";
import { cacheKey, OfflineContext, useIsOffline } from "./context";
import { nextBatch, Outbox, toServer, type Op } from "./outbox";
import { localTournament, playTournament, type TournamentData } from "./overlay";

// Answers are sent together: every batch makes the server read the whole
// tournament, and every open page reload its data.
const SEND_DELAY_MS = 2000;
const RETRY_MS = 30_000;
// Active tournaments are kept ready to play offline.
const PREPARE_DELAY_MS = 5000;
const PREPARE_MAX = 5;
const PREPARE_EVERY_MS = 24 * 60 * 60 * 1000;

export function OfflineProvider({
  userId,
  loading,
  children,
}: {
  userId: string;
  loading: ReactNode;
  children: ReactNode;
}) {
  const [stores, setStores] = useState<{ cache: QueryCache; outbox: Outbox } | null>(null);
  useEffect(() => {
    let current = true;
    const cache = new QueryCache(userId);
    void cache.load().then(() => {
      if (current) setStores({ cache, outbox: new Outbox(userId) });
    });
    return () => {
      current = false;
      cache.flush();
    };
  }, [userId]);
  return stores === null ? (
    loading
  ) : (
    <Ready userId={userId} {...stores}>
      {children}
    </Ready>
  );
}

// Keeps the cached tournaments in step with what has been sent, in case they
// aren't open and the app goes offline again.
function foldIntoCache(cache: QueryCache, sent: Op[], created: { clientId: string; tournamentId: Id<"tournaments"> }[]) {
  const keyOf = (id: string) => cacheKey(api.tournaments.get, { tournamentId: id as Id<"tournaments"> });
  const items = (cache.get(cacheKey(api.items.list, {})) ?? []) as Item[];
  for (const op of sent) {
    if (op.kind !== "create") continue;
    const id = created.find((c) => c.clientId === op.clientId)?.tournamentId;
    if (!id) continue;
    const local = localTournament(op, items);
    cache.set(keyOf(id), { ...local, tournament: { ...local.tournament, _id: id } });
  }
  const touched = new Set(sent.flatMap((op) => (op.kind === "answer" || op.kind === "undo" ? [op.tournament] : [])));
  for (const id of touched) {
    const data = cache.get(keyOf(id)) as TournamentData | undefined;
    if (data) cache.set(keyOf(id), playTournament(data, sent, id));
  }
}

function Ready({
  userId,
  cache,
  outbox,
  children,
}: {
  userId: string;
  cache: QueryCache;
  outbox: Outbox;
  children: ReactNode;
}) {
  const convex = useConvex();
  const push = useMutation(api.sync.push);
  const offline = useIsOffline();
  const { isAuthenticated } = useConvexAuth();
  const { isWebSocketConnected } = useConvexConnectionState();
  const [skipped, setSkipped] = useState(0);
  const [syncFailed, setSyncFailed] = useState(false);
  const running = useRef<Promise<void> | null>(null);
  const canSend = isAuthenticated && isWebSocketConnected;

  const sendAll = useCallback(async () => {
    while (convex.connectionState().isWebSocketConnected) {
      outbox.refresh();
      const batch = nextBatch(outbox.get().ops);
      if (batch.length === 0) return;
      const result = await push({ ops: batch.map(toServer) });
      foldIntoCache(cache, batch, result.created);
      outbox.done(batch, result.created);
      if (result.skipped) setSkipped((n) => n + result.skipped);
    }
  }, [convex, push, cache, outbox]);

  const flush = useCallback(() => {
    if (!canSend) return Promise.resolve();
    // One sender at a time, across tabs too: order matters.
    running.current ??= (
      "locks" in navigator ? navigator.locks.request(`fomo-sync-${userId}`, sendAll) : sendAll()
    )
      .then(() => setSyncFailed(false))
      .catch((e: unknown) => {
        console.error("Sync failed", e);
        setSyncFailed(true);
      })
      .finally(() => {
        running.current = null;
      });
    return running.current;
  }, [canSend, sendAll, userId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (outbox.get().ops.length === 0) return;
      timer ??= setTimeout(() => {
        timer = undefined;
        void flush();
      }, SEND_DELAY_MS);
    };
    schedule();
    const unsubscribe = outbox.subscribe(schedule);
    const retry = setInterval(schedule, RETRY_MS);
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      cache.flush();
      void flush();
    };
    window.addEventListener("storage", outbox.onStorage);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(timer);
      clearInterval(retry);
      unsubscribe();
      window.removeEventListener("storage", outbox.onStorage);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [outbox, cache, flush]);

  // Once per visit, get what's needed to play offline.
  const prepared = useRef(false);
  useEffect(() => {
    if (!canSend || prepared.current) return;
    const timer = setTimeout(() => {
      prepared.current = true;
      void (async () => {
        const list = await convex.query(api.tournaments.list, {});
        cache.set(cacheKey(api.tournaments.list, {}), list);
        for (const { _id } of list.filter((x) => x.status === "active").slice(0, PREPARE_MAX)) {
          const key = cacheKey(api.tournaments.get, { tournamentId: _id });
          if (Date.now() - cache.savedAt(key) < PREPARE_EVERY_MS) continue;
          cache.set(key, await convex.query(api.tournaments.get, { tournamentId: _id }));
        }
        // Ask the browser not to clear the data when space runs low.
        await navigator.storage?.persist?.();
      })().catch((e: unknown) => console.warn("Not ready for offline use", e));
    }, PREPARE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canSend, convex, cache]);

  const dismissSkipped = useCallback(() => setSkipped(0), []);
  return (
    <OfflineContext value={{ userId, cache, outbox, offline, skipped, dismissSkipped, syncFailed, flush }}>
      {children}
    </OfflineContext>
  );
}
