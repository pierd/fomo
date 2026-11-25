// Background work after an import is saved in batches: every write to an item
// makes each open client reload the whole list (items.list).

export const BATCH_SIZE = 25;
// Between two items of a batch, so source sites aren't hammered.
export const ITEM_INTERVAL_MS = 1500;
// Actions are killed after 10 minutes; stop well before and reschedule the rest.
const TIME_BUDGET_MS = 4 * 60 * 1000;

export function chunk<T>(list: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Runs `work` on one item after another, at most one per ITEM_INTERVAL_MS.
// Returns the items that were left when time ran out.
export async function runPaced<T>(list: T[], work: (item: T) => Promise<void>): Promise<T[]> {
  const start = Date.now();
  for (let i = 0; i < list.length; i++) {
    if (Date.now() - start > TIME_BUDGET_MS) return list.slice(i);
    const began = Date.now();
    await work(list[i]);
    const wait = ITEM_INTERVAL_MS - (Date.now() - began);
    if (wait > 0 && i < list.length - 1) await new Promise((r) => setTimeout(r, wait));
  }
  return [];
}
