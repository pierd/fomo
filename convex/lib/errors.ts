import { ConvexError } from "convex/values";

// User-facing errors carry a code (plus parameters) that the frontend
// translates: production hides plain error messages.
export type ErrorCode =
  | "notSignedIn"
  | "notFound"
  | "aiLocked"
  | "adminsOnly"
  | "emptyName"
  | "badDuration"
  | "needTwoItems"
  | "tooManyItems"
  | "notesTooLong"
  | "tagExists"
  | "tournamentOver"
  | "noSuchAccount"
  | "tooManyTokens";

export function fail(code: ErrorCode, params: Record<string, string | number> = {}): never {
  throw new ConvexError({ code, ...params });
}
