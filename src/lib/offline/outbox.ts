import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Comparison } from "../../../convex/lib/ranking";

type ServerOp = FunctionArgs<typeof api.sync.push>["ops"][number];
type Pushed = FunctionReturnType<typeof api.sync.push>;
// What a tournament made here starts with, to show it before it's synced.
export type CreateOp = Extract<ServerOp, { kind: "create" }> & {
  at: number;
  imported: Comparison<Id<"items">>[];
  conflicts: number;
};
export type Op = Exclude<ServerOp, { kind: "create" }> | CreateOp;

type Saved = {
  ops: Op[];
  // Tournaments made on this device: their id here -> on the server.
  aliases: Record<string, Id<"tournaments">>;
};

const EMPTY: Saved = { ops: [], aliases: {} };
const LOCAL_PREFIX = "local-";
export const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 20);
export const newLocalId = () => LOCAL_PREFIX + newId();
export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX);

export const toServer = (op: Op): ServerOp => {
  if (op.kind !== "create") return op;
  const { clientId, kind, name, tagIds, importFrom, participantIds } = op;
  return { clientId, kind, name, tagIds, importFrom, participantIds };
};

// Starting a tournament can be a lot of writes: it gets a batch of its own.
export function nextBatch(ops: Op[], max = 50): Op[] {
  if (ops[0]?.kind === "create") return [ops[0]];
  const create = ops.findIndex((op) => op.kind === "create");
  return ops.slice(0, create === -1 ? max : Math.min(create, max));
}

// Changes waiting to be sent, kept in localStorage: written synchronously, so
// nothing is lost if the app is closed right after an answer. Every change is
// appended, undo too, as the one it undoes may already be on its way.
export class Outbox {
  private saved: Saved = EMPTY;
  private raw: string | null = null;
  private listeners = new Set<() => void>();
  // Storage refused a write: what's in memory is all there is.
  private memoryOnly = false;
  private key: string;
  private storage: Storage;

  constructor(userId: string, storage: Storage = localStorage) {
    this.key = `fomo.outbox.${userId}`;
    this.storage = storage;
    this.refresh();
  }

  // Other tabs write too.
  refresh = () => {
    if (this.memoryOnly) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === this.raw) return;
      this.raw = raw;
      this.saved = raw === null ? EMPTY : (JSON.parse(raw) as Saved);
    } catch {
      // Keep what's in memory.
    }
  };

  private write(next: Saved) {
    this.saved = next;
    if (!this.memoryOnly) {
      try {
        const raw = JSON.stringify(next);
        this.storage.setItem(this.key, raw);
        this.raw = raw;
      } catch {
        this.memoryOnly = true;
      }
    }
    this.notify();
  }

  private notify() {
    for (const f of this.listeners) f();
  }

  get = () => this.saved;

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  };

  onStorage = (e: StorageEvent) => {
    if (e.key !== this.key) return;
    this.refresh();
    this.notify();
  };

  add(op: Op) {
    this.refresh();
    // The tournament may have got its real id since the page was drawn.
    const resolved =
      op.kind === "answer" || op.kind === "undo"
        ? { ...op, tournament: this.saved.aliases[op.tournament] ?? op.tournament }
        : op;
    this.write({ ...this.saved, ops: [...this.saved.ops, resolved] });
  }

  // The server has these now.
  done(sent: Op[], created: Pushed["created"]) {
    this.refresh();
    const gone = new Set(sent.map((op) => op.clientId));
    const aliases = { ...this.saved.aliases };
    for (const c of created) aliases[c.clientId] = c.tournamentId;
    const ops = this.saved.ops
      .filter((op) => !gone.has(op.clientId))
      .map((op) =>
        op.kind === "answer" || op.kind === "undo"
          ? { ...op, tournament: aliases[op.tournament] ?? op.tournament }
          : op.kind === "create"
            ? { ...op, importFrom: op.importFrom.map((id) => aliases[id] ?? id) }
            : op,
      );
    this.write({ ops, aliases });
  }

  clear() {
    this.write(EMPTY);
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Nothing to remove then.
    }
    this.raw = null;
  }
}
