import type { FunctionReturnType } from "convex/server";
import type { GlobalRanking } from "../../convex/lib/globalRanking";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

export type Item = FunctionReturnType<typeof api.items.list>[number];
export type Tag = FunctionReturnType<typeof api.tags.list>[number];
export type Status = Item["status"];
export type Ranked = GlobalRanking<Id<"items">>;
