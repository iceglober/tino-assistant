import type { Env } from "../../../env.js";
import type { CryptoAdapter } from "@tino/core/ports/outbound";
import { LocalAdapter } from "./local-adapter.js";

/**
 * Create the CryptoAdapter: AES-256-GCM with a scrypt-derived master key.
 * In production the key comes from Secret Manager via LOCAL_DEV_CRYPTO_KEY;
 * locally it falls back to a dev default (fine for throwaway dev DBs).
 * WARNING: changing the key invalidates all existing encrypted payloads.
 */
export async function createCryptoAdapter(env: Env): Promise<CryptoAdapter> {
  return new LocalAdapter({
    LOCAL_DEV_CRYPTO_KEY: env.LOCAL_DEV_CRYPTO_KEY,
  });
}
