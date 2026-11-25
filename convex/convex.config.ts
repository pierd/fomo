import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    // https://steamcommunity.com/dev/apikey. Without it, Steam imports say so.
    STEAM_API_KEY: v.optional(v.string()),
  },
});
