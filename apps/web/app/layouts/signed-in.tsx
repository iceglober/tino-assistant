import { Outlet, redirect, useRouteLoaderData } from "react-router";
import { RouteError } from "../components/RouteError";
import { AccountFrame } from "../components/shell/AccountFrame";
import { signinUrl } from "../lib/api";
import { loadMe, loadPlatform, meContext } from "../lib/session";
import type { Route } from "./+types/signed-in";

/** Everything below needs a session: put `Me` in context, or go sign in. */
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  async ({ request, context }) => {
    const me = await loadMe();
    if (!me) {
      const url = new URL(request.url);
      throw redirect(signinUrl(url.pathname + url.search));
    }
    context.set(meContext, me);
  },
];

export async function clientLoader({ context }: Route.ClientLoaderArgs) {
  const [platform] = await Promise.all([loadPlatform()]);
  return { me: context.get(meContext), platform };
}

/** The signed-in account and platform info, for any page below this layout. */
export function useSession() {
  const data = useRouteLoaderData<typeof clientLoader>("signed-in");
  if (!data) throw new Error("useSession outside the signed-in layout");
  return data;
}

export default function SignedIn() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <AccountFrame me={null}>
      <RouteError error={error} />
    </AccountFrame>
  );
}
