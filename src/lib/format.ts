export { formatMinutes } from "../../convex/lib/duration";

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function errorMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  // Convex wraps server errors: "[CONVEX M(items:create)] [Request ID: ...] Server Error\nUncaught Error: <msg>\n  at ..."
  const m = msg.match(/Uncaught Error: ([^\n]+)/);
  return m ? m[1] : msg;
}
