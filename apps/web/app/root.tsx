import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource-variable/newsreader/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { RouteError } from "./components/RouteError";
import { ToastProvider } from "./components/ui/Toast";
import type { Route } from "./+types/root";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/png", href: "/tino-logo.png" },
  { rel: "apple-touch-icon", href: "/tino-logo.png" },
];

export const meta: Route.MetaFunction = () => [
  { title: "tino" },
  { name: "description", content: "tino — your team's assistant in Slack, with your mail, calendar and history." },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#141c27" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

/** Pre-rendered into index.html: what people see while the app boots. */
export function HydrateFallback() {
  return (
    <div className="boot" role="status" aria-label="loading tino">
      <img src="/tino-logo.png" alt="" width={56} height={56} className="boot__logo" />
      <span className="boot__word">tino</span>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <main className="solo">
      <RouteError error={error} />
    </main>
  );
}
