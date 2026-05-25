# Wave 0: Storage Simplification

## Goal

All user data goes to DynamoDB. The only thing stored externally is the per-user encryption key, accessed through a `UserKeyStorePort` port. Drive is one adapter for that port — not a hardcoded dependency.

## Current State

Four files stored in each user's Drive appDataFolder:

| File | Adapter | Used by |
|------|---------|---------|
| `encryption-key.json` | `createKeyManager()` | `createEncryptedHistoryStore` |
| `preferences.json` | `createAppDataPreferencesStore()` | User preferences (timezone, etc.) |
| `privacy-config.json` | `createAppDataPrivacyConfigStore()` | Privacy filter config |
| `discovery-result.json` | `createDiscoveryStore()` | Discovery results |

### Problems

**Data adapters (preferences, privacy, discovery):** All three write to Drive first and `return` on success, skipping DynamoDB entirely. Server-side readers that hit DynamoDB directly get stale or missing data. These get deleted.

**Key manager:** `createKeyManager()` returns an `AppDataKeyManager` whose `getOrCreateKey(userId, client)` takes a raw `AppDataClient`. This Drive-specific type leaks through `createEncryptedHistoryStore`, which has to resolve the Drive client itself and pass it in. The key storage concern and the Drive adapter concern are tangled together.

## Changes

### 0a. Define `UserKeyStorePort`

**New file:** `src/persistence/key-store.ts`

```typescript
export interface UserKeyStorePort {
  getOrCreateKey(userId: string): Promise<Buffer | null>;
  evict(userId: string): void;
}
```

That's the entire interface. The implementation decides where the key lives. Callers don't know or care.

### 0b. Drive adapter for `UserKeyStorePort`

**Edit:** `src/drive/key-manager.ts` → rename to `src/drive/key-store.ts` (or keep the file, rename the export)

Refactor `createKeyManager()` into `createDriveKeyStore()`:
- Takes `resolveClient: (userId: string) => Promise<AppDataClient | null>` as a dep (instead of receiving `client` per-call)
- Implements `UserKeyStorePort` — `getOrCreateKey(userId)` resolves the client internally
- Keeps the existing 1-hour TTL cache, sweep interval, and key generation logic
- No behavioral change — same code, cleaner interface

```typescript
export function createDriveKeyStore(deps: {
  resolveClient: (userId: string) => Promise<AppDataClient | null>;
}): UserKeyStorePort {
  // ... existing cache + sweep logic ...
  return {
    async getOrCreateKey(userId: string): Promise<Buffer | null> {
      // check cache ...
      const client = await deps.resolveClient(userId);
      if (!client) return null;
      // read/create key from Drive ...
    },
    evict(userId: string): void { cache.delete(userId); },
  };
}
```

### 0c. Simplify `createEncryptedHistoryStore`

**Edit:** `src/drive/adapters/encrypted-history-store.ts`

Replace the two deps (`keyManager: AppDataKeyManager`, `resolveClient`) with one:

```typescript
export function createEncryptedHistoryStore(deps: {
  inner: HistoryStore;
  keyStore: UserKeyStorePort;  // was: keyManager + resolveClient
  logger: AppLogger;
  cap?: number;
}): HistoryStore {
```

The internal `resolveKey(userId)` helper becomes `deps.keyStore.getOrCreateKey(userId)`. Delete the `resolveClient` call — the `UserKeyStorePort` handles it.

### 0d. Update wiring in `src/index.ts`

```typescript
// Before:
const appDataKeyManager = createKeyManager();
const wrappedHistory = createEncryptedHistoryStore({
  inner: history,
  keyManager: appDataKeyManager,
  resolveClient: appDataResolver,
  logger,
});

// After:
const keyStore = createDriveKeyStore({ resolveClient: appDataResolver });
const wrappedHistory = createEncryptedHistoryStore({
  inner: history,
  keyStore,
  logger,
});
```

`appDataResolver` stays — still needed by the Drive key store. But it's no longer passed to the history store or any other consumer. The Drive dependency stops at the `UserKeyStorePort` adapter boundary.

### 0e. Remove `createAppDataPreferencesStore`

**Delete:** `src/drive/adapters/preferences-store.ts`

**Edit:** `src/index.ts`
- Remove `createAppDataPreferencesStore` import and `wrappedPreferences` variable
- Pass `preferencesStore` directly wherever `wrappedPreferences` was used

### 0f. Remove `createAppDataPrivacyConfigStore`

**Delete:** `src/drive/adapters/privacy-config-store.ts`

**Edit:** `src/index.ts`
- Remove `createAppDataPrivacyConfigStore` import
- Remove the wrapping call
- Rename `serverPrivacyConfigStore` → `privacyConfigStore`

### 0g. Simplify `createDiscoveryStore`

**Edit:** `src/discovery/store.ts`
- Remove `resolveClient` from deps — no more Drive reads/writes
- `get()`: read from config store only
- `set()`: write to config store only

**Edit:** wherever `createDiscoveryStore` is wired (server routes)
- Remove `resolveAppDataClient` from deps

### 0h. Clean up dead code

After 0e–0g, verify what's still imported from `src/drive/`:
- `createDriveKeyStore` (was `createKeyManager`) — used by index.ts. **Keep.**
- `createAppDataClientResolver` — used by Drive key store. **Keep.**
- `createAppDataClient` / `createDriveAppDataClient` — used by resolver. **Keep.**
- `crypto.ts` (encrypt/decrypt) — used by encrypted history. **Keep.**
- `types.ts` — used by above. **Keep.**

**Delete:**
- `src/drive/adapters/preferences-store.ts`
- `src/drive/adapters/privacy-config-store.ts`

Check for tests covering deleted adapters and remove them.

### 0i. Data migration consideration

Users who have data in Drive but not DynamoDB will lose:
- **Preferences:** Re-set in the console. Low impact.
- **Privacy config:** Re-configure in the console. The DynamoDB fallback is always populated on fresh setups going forward.
- **Discovery results:** Re-run in 30 seconds.

No automated migration. Old Drive data stays harmlessly in users' Google accounts.

## Files Summary

| File | Action |
|------|--------|
| `src/persistence/key-store.ts` | **New** — `UserKeyStorePort` port interface |
| `src/drive/key-manager.ts` | **Refactor** → `createDriveKeyStore()` implementing `UserKeyStorePort` |
| `src/drive/adapters/encrypted-history-store.ts` | **Edit** — take `UserKeyStorePort` instead of `keyManager` + `resolveClient` |
| `src/drive/adapters/preferences-store.ts` | **Delete** |
| `src/drive/adapters/privacy-config-store.ts` | **Delete** |
| `src/discovery/store.ts` | **Simplify** — remove Drive path |
| `src/index.ts` | **Edit** — new wiring, remove wrapping layers |
| Server route wiring | **Edit** — remove `resolveAppDataClient` from discovery deps |

## Verification

- [ ] `bun --bun vitest run` passes
- [ ] Deploy → sign in → set a preference → read it back (DynamoDB only)
- [ ] Deploy → run discovery → results visible in Customize page (DynamoDB only)
- [ ] Conversation history still encrypts/decrypts via Drive-backed `UserKeyStorePort`
- [ ] No `AppDataClient` imports outside of `src/drive/`
- [ ] No references to deleted adapter files remain
