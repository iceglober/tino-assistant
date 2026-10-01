import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigation,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";
import { RouteError } from "../components/RouteError";
import { AccountFrame } from "../components/shell/AccountFrame";
import { OrgSwitcher } from "../components/shell/OrgSwitcher";
import { UserMenu } from "../components/shell/UserMenu";
import { VerifyBanner } from "../components/shell/VerifyBanner";
import { invalidateOverview, loadOverview, meContext, orgContext } from "../lib/session";
import type { Route } from "./+types/app-shell";

/** Every page in an org needs the overview: fetch it (briefly cached) into context. */
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  async ({ params, context }) => {
    context.set(orgContext, await loadOverview(params.slug));
  },
];

export async function clientLoader({ context }: Route.ClientLoaderArgs) {
  return { me: context.get(meContext), org: context.get(orgContext) };
}

/** Re-read the overview only when the org changes or something asked for a refresh. */
export function shouldRevalidate({
  currentParams,
  nextParams,
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (currentParams.slug !== nextParams.slug) return true;
  if (formMethod) return defaultShouldRevalidate;
  if (currentUrl.href === nextUrl.href) return defaultShouldRevalidate;
  return false;
}

/** The org overview and account, for any page inside the org. */
export function useOrg() {
  const data = useRouteLoaderData<typeof clientLoader>("org");
  if (!data) throw new Error("useOrg outside the org layout");
  return { ...data, slug: data.org.org.slug, isAdmin: data.org.me.role === "admin" };
}

/** After changing setup or connections: drop the cached overview and reload route data. */
export function useRefreshOrg() {
  const revalidator = useRevalidator();
  const { slug } = useOrg();
  return () => {
    invalidateOverview(slug);
    return revalidator.revalidate();
  };
}

const NAV = [
  { to: "", label: "overview", end: true },
  { to: "chat", label: "chat" },
  { to: "knowledge", label: "knowledge" },
  { to: "connections", label: "connections" },
  { to: "tools", label: "tools" },
] as const;

const ADMIN_NAV = [
  { to: "team", label: "team" },
  { to: "settings", label: "settings" },
] as const;

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { me, org } = loaderData;
  const slug = org.org.slug;
  const isAdmin = org.me.role === "admin";
  const navigation = useNavigation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const pending = navigation.state === "loading" && !navigation.formMethod;

  // Close the drawer on navigation (phone widths).
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the path changes
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const link = (to: string) => (to ? `/${slug}/${to}` : `/${slug}`);

  return (
    <div className={open ? "shell shell--open" : "shell"}>
      <a href="#main" className="skip-link">
        skip to content
      </a>
      <div className={pending ? "progress progress--on" : "progress"} aria-hidden="true" />

      <header className="topbar">
        <button
          type="button"
          className="topbar__menu"
          aria-label={open ? "close navigation" : "open navigation"}
          aria-expanded={open}
          aria-controls="rail"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">{open ? "×" : "≡"}</span>
        </button>
        <Link to={`/${slug}`} className="brand">
          <img src="/tino-logo.png" alt="" width={26} height={26} />
          <span>{org.org.name}</span>
        </Link>
      </header>

      <aside className="rail" id="rail" aria-label="org navigation">
        <Link to={`/${slug}`} className="brand brand--light rail__brand">
          <img src="/tino-logo.png" alt="" width={30} height={30} />
          <span>tino</span>
        </Link>

        <OrgSwitcher me={me} current={org.org} role={org.me.role} />

        <nav className="rail__nav" aria-label="pages">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={link(n.to)} end={"end" in n ? n.end : false} className="rail__link" prefetch="intent">
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <>
              <p className="rail__label">admin</p>
              <ul>
                {ADMIN_NAV.map((n) => (
                  <li key={n.to}>
                    <NavLink to={link(n.to)} className="rail__link" prefetch="intent">
                      {n.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </nav>

        <div className="rail__foot">
          <UserMenu me={me} placement="above" tone="rail" />
        </div>
      </aside>
      {open ? (
        <button type="button" className="scrim" aria-label="close navigation" onClick={() => setOpen(false)} />
      ) : null}

      <div className="shell__main">
        <VerifyBanner me={me} />
        <main id="main" className="page" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <AccountFrame me={null}>
      <RouteError error={error} />
    </AccountFrame>
  );
}
