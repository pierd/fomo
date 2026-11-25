import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useConvexAuth, useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import type { QueryCache } from "./cache";
import type { Outbox } from "./outbox";

export type Offline = {
  userId: string;
  cache: QueryCache;
  outbox: Outbox;
  offline: boolean;
  // Changes the server turned down since the app was opened.
  skipped: number;
  dismissSkipped: () => void;
  syncFailed: boolean;
  // Resolves once everything is sent, or can't be for now.
  flush: () => Promise<void>;
};

export const OfflineContext = createContext<Offline | null>(null);

export function useOffline(): Offline {
  const value = useContext(OfflineContext);
  if (value === null) throw new Error("No OfflineProvider");
  return value;
}

export function useOutbox() {
  const { outbox } = useOffline();
  return useSyncExternalStore(outbox.subscribe, outbox.get);
}

// A short drop (switching networks, waking up) isn't worth mentioning.
const GRACE_MS = 3000;

export function useIsOffline() {
  const { isWebSocketConnected } = useConvexConnectionState();
  const [lost, setLost] = useState(false);
  const online = useSyncExternalStore(
    (f) => {
      window.addEventListener("online", f);
      window.addEventListener("offline", f);
      return () => {
        window.removeEventListener("online", f);
        window.removeEventListener("offline", f);
      };
    },
    () => navigator.onLine,
  );
  useEffect(() => {
    if (isWebSocketConnected) return;
    const timer = setTimeout(() => setLost(true), GRACE_MS);
    return () => {
      clearTimeout(timer);
      setLost(false);
    };
  }, [isWebSocketConnected]);
  return !online || (lost && !isWebSocketConnected);
}

export const cacheKey = <Q extends FunctionReference<"query">>(query: Q, args: FunctionArgs<Q>) =>
  `${getFunctionName(query)}|${JSON.stringify(args)}`;

// useQuery that starts from the last known result, and keeps it offline.
export function useCachedQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: FunctionArgs<Q> | "skip",
): FunctionReturnType<Q> | undefined {
  const { cache } = useOffline();
  const { isAuthenticated } = useConvexAuth();
  const live = useQuery(query as FunctionReference<"query">, isAuthenticated ? args : "skip") as
    | FunctionReturnType<Q>
    | undefined;
  const key = args === "skip" ? null : cacheKey(query, args);
  useEffect(() => {
    if (key !== null && live !== undefined) cache.set(key, live);
  }, [cache, key, live]);
  const cached = useSyncExternalStore(cache.subscribe, () => (key === null ? undefined : cache.get(key)));
  return live ?? (cached as FunctionReturnType<Q> | undefined);
}

// For what can't be done offline: says so at once, rather than hanging.
export function useOnlineMutation<M extends FunctionReference<"mutation">>(mutation: M) {
  const { offline } = useOffline();
  const run = useMutation(mutation as FunctionReference<"mutation">);
  return useCallback(
    async (args: FunctionArgs<M>): Promise<FunctionReturnType<M>> => {
      if (offline) throw new ConvexError({ code: "offline" });
      return (await run(args)) as FunctionReturnType<M>;
    },
    [run, offline],
  );
}
