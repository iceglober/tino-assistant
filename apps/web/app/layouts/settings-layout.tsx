import type { OrgSetupStatus } from "@tino/contracts";
import { NavLink, Outlet, useRouteLoaderData } from "react-router";
import { PageHeader } from "../components/PageHeader";
import { RouteError } from "../components/RouteError";
import { orgApi } from "../lib/api";
import { loadPlatform, requireAdmin } from "../lib/session";
import type { Route } from "./+types/settings-layout";
import { useOrg } from "./app-shell";

export const meta: Route.MetaFunction = () => [{ title: "settings · tino" }];

/** Admins only. Loads the saved settings (secrets as set/not-set) for every page below. */
export async function clientLoader({ params, context }: Route.ClientLoaderArgs) {
  requireAdmin(context);
  const [settings, platform] = await Promise.all([orgApi(params.slug).settings(), loadPlatform()]);
  return { settings, platform };
}

export function useSettings() {
  const data = useRouteLoaderData<typeof clientLoader>("settings");
  if (!data) throw new Error("useSettings outside the settings layout");
  return data;
}

export const SETTINGS_PAGES = [
  { to: "model", label: "model", done: (s: OrgSetupStatus) => s.model },
  { to: "slack", label: "Slack app", done: (s: OrgSetupStatus) => s.slack.installed },
  { to: "google", label: "Google client", done: (s: OrgSetupStatus) => s.google.available },
  { to: "knowledge", label: "knowledge base", done: (s: OrgSetupStatus) => s.kb.enabled },
  { to: "assistant", label: "assistant", done: null },
] as const;

export default function SettingsLayout() {
  const { org, slug } = useOrg();
  return (
    <div className="stack-lg">
      <PageHeader title="settings" lede={`how tino runs for ${org.org.name}. changes apply as soon as you save.`} />
      <div className="settings">
        <nav className="settings__nav" aria-label="settings sections">
          <ul>
            {SETTINGS_PAGES.map((p) => {
              const done = p.done ? p.done(org.status) : null;
              return (
                <li key={p.to}>
                  <NavLink to={`/${slug}/settings/${p.to}`} className="settings__link">
                    <span>{p.label}</span>
                    {done === null ? null : done ? (
                      <span className="settings__state ok-text" title="set up">
                        ✓<span className="visually-hidden"> set up</span>
                      </span>
                    ) : (
                      <span className="settings__state muted" title="not set up">
                        ○<span className="visually-hidden"> not set up</span>
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="settings__body">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
