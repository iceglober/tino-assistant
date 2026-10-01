import type { ReactNode } from "react";
import { Link, Outlet, useRouteLoaderData } from "react-router";
import { RouteError } from "../components/RouteError";
import { loadPlatform } from "../lib/session";
import type { Route } from "./+types/auth-layout";

export async function clientLoader() {
  return { platform: await loadPlatform() };
}

/** The platform info, for any page under the auth layout. */
export function usePlatform() {
  const data = useRouteLoaderData<typeof clientLoader>("auth");
  if (!data) throw new Error("usePlatform outside the auth layout");
  return data.platform;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__story" aria-hidden="true">
        <Link to="/" className="brand brand--light" tabIndex={-1}>
          <img src="/tino-logo.png" alt="" width={36} height={36} />
          <span>tino</span>
        </Link>
        <div className="auth__quote">
          <p>the assistant that already read the thread.</p>
          <ul>
            <li>answers in Slack, from your Slack, mail and calendar</li>
            <li>each person connects their own accounts — tino only sees what they can</li>
            <li>keeps a knowledge base of what your team decided, and why</li>
          </ul>
        </div>
        <p className="auth__foot">a managed service. your data stays in your org.</p>
      </aside>
      <main className="auth__main" id="main">
        <Link to="/" className="brand auth__brand-mobile">
          <img src="/tino-logo.png" alt="" width={32} height={32} />
          <span>tino</span>
        </Link>
        <div className="auth__card">{children}</div>
      </main>
    </div>
  );
}

export default function AuthLayout() {
  return (
    <Frame>
      <Outlet />
    </Frame>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <Frame>
      <RouteError error={error} compact />
    </Frame>
  );
}
