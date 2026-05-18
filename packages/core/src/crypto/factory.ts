import type { Env } from "../env.js";
import type { CryptoAdapter } from "./types.js";
import { LocalAdapter } from "./local-adapter.js";

/**
 * Factory function to create a CryptoAdapter based on environment configuration.
 * Returns KMS adapter if KMS_KEY_ARN is set, otherwise local AES-256-GCM adapter.
 *
 * KMS adapter is dynamically imported to keep @aws-sdk/client-kms out of core's
 * dependency tree for SQLite-only users (local dev, testing).
 *
 * @param env Environment configuration (see packages/core/src/env.ts)
 * @returns CryptoAdapter instance
 */
export async function createCryptoAdapter(env: Env): Promise<CryptoAdapter> {
  if (env.KMS_KEY_ARN) {
    // Production: KMS-backed envelope encryption
    // Dynamic imports keep AWS SDK optional for core consumers
    // @ts-expect-error — @tino/aws is an optional peer; not in core's dep tree
    const { KmsAdapter } = await import("@tino/aws/crypto/kms-adapter");
    // @ts-expect-error — @aws-sdk/client-kms is not in core's dep tree
    const { KMSClient } = await import("@aws-sdk/client-kms");

    const kmsClient = new KMSClient({ region: env.AWS_REGION });
    return new KmsAdapter(kmsClient, env.KMS_KEY_ARN);
  }

  // Development: Local AES-256-GCM with static derived key
  // Scrypt derivation ensures consistent encryption across restarts
  return new LocalAdapter({
    LOCAL_DEV_CRYPTO_KEY: env.LOCAL_DEV_CRYPTO_KEY,
  });
}
