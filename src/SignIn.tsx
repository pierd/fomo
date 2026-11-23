import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LocalePicker } from "./i18n/LocalePicker";
import { currentLocale } from "./i18n";

export function SignIn() {
  const { signIn } = useAuthActions();
  const { t } = useTranslation();
  const [step, setStep] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <form
        className="card w-full max-w-sm p-8"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setBusy(true);
          const formData = new FormData(event.currentTarget);
          signIn("password", formData)
            // Production redacts server errors, so the cause can't be told apart here.
            .catch((e) => {
              console.error(e);
              setError(step === "signIn" ? t("auth.signInFailed") : t("auth.signUpFailed"));
            })
            .finally(() => setBusy(false));
        }}
      >
        <h1 className="text-center text-3xl font-black tracking-tight">FOMO</h1>
        <p className="mt-1 mb-6 text-center text-sm text-muted">{t("app.tagline")}</p>
        <div className="space-y-3">
          <input
            name="email"
            placeholder={t("auth.email")}
            type="email"
            autoComplete="email"
            required
            className="input"
          />
          <input
            name="password"
            placeholder={t("auth.password")}
            type="password"
            autoComplete={step === "signIn" ? "current-password" : "new-password"}
            minLength={step === "signUp" ? 8 : undefined}
            title={step === "signUp" ? t("auth.passwordHint") : undefined}
            required
            className="input"
          />
          <input name="flow" type="hidden" value={step} />
          <input name="locale" type="hidden" value={currentLocale()} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full py-2.5">
            {step === "signIn" ? t("auth.signIn") : t("auth.signUp")}
          </button>
        </div>
        <div className="mt-5 text-center">
          <button
            type="button"
            className="text-sm text-muted underline underline-offset-4 hover:text-ink"
            onClick={() => {
              setError(null);
              setStep(step === "signIn" ? "signUp" : "signIn");
            }}
          >
            {step === "signIn" ? t("auth.signUpInstead") : t("auth.signInInstead")}
          </button>
        </div>
      </form>
      <LocalePicker />
    </div>
  );
}
