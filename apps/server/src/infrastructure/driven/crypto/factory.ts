import type { CryptoAdapter } from "@tino/core/ports/outbound";
import type { Env } from "../../../env.js";
import { LocalAdapter } from "./local-adapter.js";

/**
 * AES-256-GCM with a scrypt-derived master key from ENCRYPTION_KEY (required
 * in production; a fixed dev key otherwise, fine for throwaway databases).
 * WARNING: changing the key makes every stored credential and org secret unreadable.
 */
export function createCryptoAdapter(env: Env): CryptoAdapter {
  return new LocalAdapter({ LOCAL_DEV_CRYPTO_KEY: env.ENCRYPTION_KEY });
}
