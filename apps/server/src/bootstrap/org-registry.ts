/**
 * The live org runtimes, built on first use and cached. Also runs the one
 * knowledge-base scheduler: every few minutes it walks the orgs and runs each
 * one's indexer cycle in turn — sequential on purpose, so a hundred orgs cost a
 * steady trickle of API calls instead of a burst every five minutes.
 */
import type { Org } from "@tino/core/domain/org";
import type { Logger } from "@tino/core/ports/outbound";
import type { Persistence } from "../infrastructure/driven/persistence/postgres/index.js";
import { createOrgRuntime, type OrgRuntime, type PlatformServices } from "./org-runtime.js";

export interface OrgRegistry {
  get(orgId: string): Promise<OrgRuntime | null>;
  bySlug(slug: string): Promise<OrgRuntime | null>;
  /** Rebuild an org's runtime from its current settings (after Settings or an install changes). */
  refresh(orgId: string): Promise<void>;
  /** Build every active org's runtime now (at boot, so Slack events find their app). */
  warmAll(): Promise<void>;
  startScheduler(intervalMs?: number): void;
  stop(): Promise<void>;
}

export function createOrgRegistry(persistence: Persistence, services: PlatformServices, logger: Logger): OrgRegistry {
  const runtimes = new Map<string, Promise<OrgRuntime>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const load = (org: Org): Promise<OrgRuntime> => {
    let rt = runtimes.get(org.id);
    if (!rt) {
      rt = createOrgRuntime(org, persistence.forOrg(org.id), services);
      // A failed build must not be cached forever.
      rt.catch(() => runtimes.delete(org.id));
      runtimes.set(org.id, rt);
    }
    return rt;
  };

  const forOrg = async (org: Org | null): Promise<OrgRuntime | null> => {
    if (!org || org.status !== "active") return null;
    const rt = await load(org);
    rt.setOrg(org);
    return rt;
  };

  async function cycle(): Promise<void> {
    for (const org of await persistence.orgs.list()) {
      if (stopped) return;
      try {
        const rt = await forOrg(org);
        await rt?.kb()?.indexer.runCycleOnce();
      } catch (err) {
        logger.error({ org: org.slug, err: (err as Error).message }, "kb cycle failed for org");
      }
    }
  }

  return {
    get: async (orgId) => forOrg(await persistence.orgs.get(orgId)),
    bySlug: async (slug) => forOrg(await persistence.orgs.getBySlug(slug)),

    async refresh(orgId) {
      const org = await persistence.orgs.get(orgId);
      const existing = runtimes.get(orgId);
      if (!existing || !org) return;
      const rt = await existing;
      rt.setOrg(org);
      await rt.refresh();
    },

    async warmAll() {
      for (const org of await persistence.orgs.list()) {
        await forOrg(org).catch((err: Error) =>
          logger.error({ org: org.slug, err: err.message }, "org runtime failed to start"),
        );
      }
    },

    startScheduler(intervalMs = 5 * 60 * 1000) {
      const tick = async () => {
        await cycle();
        if (!stopped) timer = setTimeout(tick, intervalMs);
        timer?.unref?.();
      };
      timer = setTimeout(tick, 15_000);
      timer.unref?.();
      logger.info({ intervalMs }, "kb scheduler started");
    },

    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const rt of runtimes.values()) await (await rt.catch(() => null))?.close();
    },
  };
}
