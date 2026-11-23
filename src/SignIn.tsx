import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <form
        className="card w-full max-w-sm p-8"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setBusy(true);
          const formData = new FormData(event.currentTarget);
          signIn("password", formData)
            .catch(() =>
              setError(
                step === "signIn"
                  ? "Wrong email or password."
                  : "Couldn't create the account. The password needs at least 8 characters, or the email is taken.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <h1 className="text-center text-3xl font-black tracking-tight">FOMO</h1>
        <p className="mt-1 mb-6 text-center text-sm text-muted">
          Everything you want to read, watch and play — and a tournament to pick what's next.
        </p>
        <div className="space-y-3">
          <input name="email" placeholder="Email" type="email" autoComplete="email" required className="input" />
          <input
            name="password"
            placeholder="Password"
            type="password"
            autoComplete={step === "signIn" ? "current-password" : "new-password"}
            required
            className="input"
          />
          <input name="flow" type="hidden" value={step} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full py-2.5">
            {step === "signIn" ? "Sign in" : "Create account"}
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
            {step === "signIn" ? "No account yet? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
