import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { toLocale } from "./lib/locales";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // The sign-up form sends the UI language along.
      profile(params) {
        return { email: params.email as string, locale: toLocale(params.locale) };
      },
    }),
  ],
  callbacks: {
    // Every account starts with a few tags to pick from.
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (existingUserId !== null) return;
      await ctx.runMutation(internal.tags.seedDefaults, { userId });
    },
  },
});
