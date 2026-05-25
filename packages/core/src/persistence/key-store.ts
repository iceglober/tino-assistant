/**
 * Per-user encryption key storage port.
 *
 * Abstracts the backend that holds each user's data-encryption key (DEK),
 * decoupling consumers (e.g. the encrypted-history adapter) from any specific
 * storage substrate — currently Google Drive's appDataFolder, potentially KMS
 * or another secrets backend in the future.
 *
 * Implementations are responsible for:
 *   - Returning a 32-byte (or backend-specific) key on getOrCreateKey, creating
 *     one on first call for a given user.
 *   - Caching keys in memory with a TTL appropriate to the backend; evict
 *     allows callers (sign-out, key rotation) to invalidate the cache entry.
 *   - Returning null from getOrCreateKey when the key cannot be resolved
 *     (e.g. the user is signed out of the upstream provider) — never throw.
 */
export interface UserKeyStorePort {
  getOrCreateKey(userId: string): Promise<Buffer | null>;
  evict(userId: string): void;
}
