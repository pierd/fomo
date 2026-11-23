import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

export type Item = FunctionReturnType<typeof api.items.list>[number];
export type Tag = FunctionReturnType<typeof api.tags.list>[number];
export type Status = Item["status"];
