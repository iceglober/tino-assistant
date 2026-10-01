/**
 * Who's signed in, and what the platform offers — fetched once and shared by
 * every route. Mutations that change either (sign in/out, creating or joining
 * an org) call `invalidateMe()`.
 */
import type { Me, OrgOverview, PlatformInfo } from "@tino/contracts";
import { createContext, data, type RouterContextProvider } from "react-router";
import { accountApi, isApiError, orgApi } from "./api";

/** Set by the signed-in layout's middleware; read by any loader below it. */
export const meContext = createContext<Me>();
/** Set by the org layout's middleware: the org overview for `:slug`. */
export const orgContext = createContext<OrgOverview>();

let mePromise: Promise<Me | null> | null = null;

/** The signed-in account, or null when signed out. */
export function loadMe(): Promise<Me | null> {
  if (!mePromise) {
    mePromise = accountApi.me().catch((err: unknown) => {
      mePromise = null;
      if (isApiError(err) && err.status === 401) return null;
      throw err;
    });
  }
  return mePromise;
}

export function invalidateMe(): void {
  mePromise = null;
  overviews.clear();
}

let platformPromise: Promise<PlatformInfo> | null = null;

export function loadPlatform(): Promise<PlatformInfo> {
  if (!platformPromise) {
    platformPromise = accountApi.platform().catch((err: unknown) => {
      platformPromise = null;
      throw err;
    });
  }
  return platformPromise;
}

/** Org overviews, cached briefly so moving between pages doesn't refetch. */
const overviews = new Map<string, { at: number; value: Promise<OrgOverview> }>();
const OVERVIEW_TTL_MS = 30_000;

export function loadOverview(slug: string): Promise<OrgOverview> {
  const hit = overviews.get(slug);
  if (hit && Date.now() - hit.at < OVERVIEW_TTL_MS) return hit.value;
  const value = orgApi(slug)
    .overview()
    .catch((err: unknown) => {
      overviews.delete(slug);
      throw err;
    });
  overviews.set(slug, { at: Date.now(), value });
  return value;
}

/** Call after anything that changes setup status or my connections. */
export function invalidateOverview(slug?: string): void {
  if (slug) overviews.delete(slug);
  else overviews.clear();
}

/** Where a signed-in person belongs when they land on `/`. */
export function homeFor(me: Me): string {
  const active = me.memberships.filter((m) => m.status !== "suspended");
  if (active.length === 1 && active[0]) return `/${active[0].org.slug}`;
  if (active.length > 1) return "/orgs";
  if (me.joinable.length > 0) return "/orgs";
  return "/new";
}

/** Only allow same-site relative paths as a post-sign-in destination. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/** Thrown (as a 403 route error) by admin pages; the error boundary explains it. */
export const ADMINS_ONLY = "admins_only";

/** In an org-scoped loader: the overview, or a 403 "admins only" for members. */
export function requireAdmin(context: Readonly<RouterContextProvider>) {
  const org = context.get(orgContext);
  if (org.me.role !== "admin") throw data(ADMINS_ONLY, { status: 403 });
  return org;
}
