/**
 * A fresh in-memory Postgres (PGlite + pgvector) per call, schema applied, with
 * orgs created on demand. Tests run against the same SQL as production.
 */
import type { Org } from "@tino/core/domain/org";
import { LocalAdapter } from "../src/infrastructure/driven/crypto/local-adapter.js";
import { createPglitePool } from "../src/infrastructure/driven/persistence/db.js";
import { createPersistence, type Persistence } from "../src/infrastructure/driven/persistence/postgres/index.js";

export const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export async function testDb(): Promise<Persistence & { makeOrg: (slug?: string) => Promise<Org> }> {
  const pool = await createPglitePool();
  const crypto = new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: "test-key" });
  const persistence = await createPersistence(pool, noopLogger, crypto);
  let n = 0;
  return {
    ...persistence,
    async makeOrg(slug?: string) {
      n += 1;
      const now = Date.now();
      return persistence.orgs.create({
        id: globalThis.crypto.randomUUID(),
        slug: slug ?? `org-${n}`,
        name: `Org ${n}`,
        status: "active",
        slackTeamId: null,
        createdAt: now,
        updatedAt: now,
      });
    },
  };
}
