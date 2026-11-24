import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { BarChart3, Bot, List, LogOut, Shield, Swords, Upload } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SignIn } from "./SignIn";
import { useRoute } from "./lib/router";
import { ItemsPage } from "./pages/ItemsPage";
import { TournamentsPage } from "./pages/TournamentsPage";
import { TournamentPage } from "./pages/TournamentPage";
import { ImportPage } from "./pages/ImportPage";
import { StatsPage } from "./pages/StatsPage";
import { AdminPage } from "./pages/AdminPage";
import { AgentsPage } from "./pages/AgentsPage";
import { LocalePicker } from "./i18n/LocalePicker";
import { currentLocale } from "./i18n";

export function App() {
  const { t } = useTranslation();
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-screen items-center justify-center text-muted">{t("common.loading")}</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Main />
      </Authenticated>
    </>
  );
}

function Main() {
  const route = useRoute();
  const me = useQuery(api.admin.me);
  const items = useQuery(api.items.list);
  const tags = useQuery(api.tags.list);
  const { signOut } = useAuthActions();
  const { t } = useTranslation();
  const setLocale = useMutation(api.admin.setLocale);
  // Keep the account's language (used for AI answers) in step with the UI.
  useEffect(() => {
    if (me && me.locale !== currentLocale()) void setLocale({ locale: currentLocale() });
  }, [me, setLocale]);
  // Stats compare against "now"; fixed per visit so the page is stable.
  const [now] = useState(() => Date.now());

  const nav = [
    { path: "", label: t("nav.list"), icon: List },
    { path: "tournaments", label: t("nav.tournaments"), icon: Swords },
    { path: "import", label: t("nav.import"), icon: Upload },
    { path: "stats", label: t("nav.stats"), icon: BarChart3 },
    ...(me?.isAdmin ? [{ path: "admin", label: t("nav.admin"), icon: Shield }] : []),
  ];
  const section = route[0] ?? "";
  const loaded = me !== undefined && items !== undefined && tags !== undefined;
  const aiEnabled = me?.aiEnabled ?? false;

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
        <a href="#/" className="text-xl font-black tracking-tight">
          FOMO
        </a>
        <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {nav.map((n) => (
            <a
              key={n.path}
              href={`#/${n.path}`}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                section === n.path ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
              }`}
            >
              <n.icon size={15} /> {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted">
          <span className="hidden truncate md:inline">{me?.email}</span>
          <a
            href="#/agents"
            className={`btn btn-ghost p-1.5 ${section === "agents" ? "text-ink" : ""}`}
            title={t("nav.agents")}
            aria-label={t("nav.agents")}
          >
            <Bot size={16} />
          </a>
          <LocalePicker signedIn />
          <button
            className="btn btn-ghost p-1.5"
            onClick={() => void signOut()}
            title={t("nav.signOut")}
            aria-label={t("nav.signOut")}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main>
        {!loaded ? (
          <p className="text-muted">{t("common.loading")}</p>
        ) : section === "tournaments" && route[1] ? (
          <TournamentPage key={route[1]} tournamentId={route[1] as Id<"tournaments">} />
        ) : section === "tournaments" ? (
          <TournamentsPage tags={tags} items={items} />
        ) : section === "import" ? (
          <ImportPage items={items} tags={tags} aiEnabled={aiEnabled} />
        ) : section === "stats" ? (
          <StatsPage items={items} tags={tags} now={now} />
        ) : section === "agents" ? (
          <AgentsPage />
        ) : section === "admin" && me?.isAdmin ? (
          <AdminPage />
        ) : (
          <ItemsPage items={items} tags={tags} aiEnabled={aiEnabled} />
        )}
      </main>
    </div>
  );
}
