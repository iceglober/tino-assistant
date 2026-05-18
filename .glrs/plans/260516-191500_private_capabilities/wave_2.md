# wave 2: per-user private credentials + KMS envelope encryption

ship the per-user credential storage layer with KMS envelope encryption. introduce the `pk=USER#<tinoUserId>, sk=CAP#<capId>` partition; add a credentials helper that envelope-encrypts every personal token using `kms:GenerateDataKey` at write and `kms:Decrypt` with `EncryptionContext={ userId, capabilityId, fieldName }` at read; migrate the bot owner's existing global gmail / slack-personal / calendar credentials into a per-user record under their tino-UUID; add per-user OAuth flows in the console (gmail OAuth, slack `xoxp-` paste, calendar OAuth); add a "your capabilities" page distinct from the existing "org capabilities" page. **the bot owner is still the only user.** the slack DM gate doesn't widen until wave 3. but after this wave, the bot owner's gmail token lives in their per-user partition, encrypted, with user-id encryption context — and any new user added later will get the same treatment.

## why this comes third

wave 1 shipped the type-system split but private capabilities still read from the global blob. that's the transitional state — fine for one wave, but every passing day with personal tokens in a global blob is a privacy hole. wave 2 closes it. wave 3 widens the DM gate; doing so before wave 2 would mean teammates' first DM trigger reads the bot owner's gmail before we'd even built per-user storage. so wave 2 must land first. wave 2 also introduces the **history-writer seam** that wave 3.5 hooks into — a default-allow `PrivacyFilter` ships here so wave 3.5 is a one-file change to the writer, not a refactor of every history-writing call site.

## constraints

- **envelope encryption is mandatory for every credential field on a private capability.** no opt-out. `EncryptionContext={ userId, capabilityId, fieldName }` exactly. any change to this schema is a breaking change to existing encrypted data — flag it loudly.
- **the KMS key policy is updated to require the encryption context.** the existing CMK policy at `packages/aws/src/pulumi/tino-service.ts:374` allows `kms:Decrypt` from the ECS task role unconditionally. wave 2 adds a `Condition` block requiring `kms:EncryptionContext:userId` and `kms:EncryptionContext:capabilityId` to be present. without them, decrypt fails — the cryptographic enforcement of D4 in main.md.
- **non-secret settings stay in plaintext.** `settings.allowlist`, `settings.repos` etc. are not encrypted. only `credentials.*` fields go through the envelope.
- **the bot owner's existing global creds are migrated, then the global blob is cleared.** unlike wave 0's copy-then-leave for history/preferences, leaving plaintext credentials in the global blob after migration is a bigger privacy hole than a botched migration. wave 2's migration is copy-then-overwrite-with-empty: after copying gmail/slack-personal/calendar credentials to the bot owner's per-user partition, the migration writes back an empty `{ enabled: false, credentials: {}, settings: {} }` to the global blob. (the global blob isn't deleted because shared capabilities still use the global namespace; only the private-scoped entries get cleared.)
- **read-after-write consistency from KMS.** every write does `GenerateDataKey` + encrypt + `PutItem` in that order; every read does `GetItem` + `Decrypt` in that order. KMS calls are network calls; the typical latency is ~10ms. acceptable.
- **all KMS calls happen in `@tino/aws`.** the core package has no AWS SDK dependency; the encryption helper is exposed via `@tino/aws/crypto` and core depends on the interface, not the implementation. local dev uses a `LocalKmsAdapter` that does AES-GCM with a static dev key — it preserves the encryption-context property check (refuses to decrypt if context doesn't match) but doesn't call AWS.
- **the history writer becomes a single seam.** every tool result is appended to `HISTORY#<userId>` through one function (`historyAppender.appendToolResult`); that function consults an injected `PrivacyFilter: (capability, args, result) => Decision` interface. in wave 2 the filter always returns `persist: true` (no privacy gating yet). wave 3.5 replaces the filter with the real per-capability implementation. the seam exists so wave 3.5 is a one-file change to the writer, not a refactor of every history-writing call site. the history module exports only `appendToolResult`, not the underlying store mutations — direct writes from anywhere else are not allowed (enforced by module boundaries; lint rule blocks raw history writes).

## file-level changes

### `packages/core/src/crypto/types.ts` (NEW — canonical) + `packages/aws/src/crypto/types.ts` (NEW — re-export barrel)

The canonical `CryptoAdapter`, `EncryptionContext`, and `EnvelopeCiphertext` types live in `packages/core/src/crypto/types.ts` so `core` can define the contract without depending on `aws` (avoids a circular dependency: `core` declares the interface, `aws` implements it). `packages/aws/src/crypto/types.ts` re-exports the same types for ergonomics inside the aws package — every concrete `aws/src/crypto/*` adapter imports from the local re-export, while `core` imports directly from `packages/core/src/crypto/types.js`.

```ts
/**
 * Per-call encryption context. Becomes the AWS KMS EncryptionContext at the SDK level
 * AND part of the AAD for the AES-GCM payload. A mismatch between encrypt-time and
 * decrypt-time context fails the decrypt (CryptoSignatureMismatch / KMS InvalidCiphertext).
 *
 * Schema is FIXED:
 *   - userId: the tino-UUID owning the credential (or 'ORG' for shared capabilities — but
 *             shared capabilities never go through this helper, they're stored in plaintext)
 *   - capabilityId: the capability's stable id (e.g. 'gmail', 'slack-personal')
 *   - fieldName: the credential field key (e.g. 'refreshToken', 'userToken')
 *
 * Changing this schema is a breaking change to all stored ciphertexts.
 */
export interface EncryptionContext {
  userId: string;
  capabilityId: string;
  fieldName: string;
}

export interface EnvelopeCiphertext {
  /** base64-encoded AES-256-GCM ciphertext */
  ciphertext: string;
  /** base64-encoded encrypted data key (KMS-wrapped) */
  encryptedDataKey: string;
  /** base64-encoded 12-byte IV */
  iv: string;
  /** base64-encoded 16-byte auth tag */
  authTag: string;
  /** alg version, currently 'AES-256-GCM/v1'; lets us migrate algos later */
  alg: string;
}

export interface CryptoAdapter {
  encrypt(plaintext: string, ctx: EncryptionContext): Promise<EnvelopeCiphertext>;
  decrypt(ct: EnvelopeCiphertext, ctx: EncryptionContext): Promise<string>;
}
```

### `packages/aws/src/crypto/kms-adapter.ts` (NEW)

production AWS KMS adapter.

```ts
export function createKmsAdapter(opts: {
  kmsKeyArn: string;
  region: string;
  logger: AppLogger;
}): CryptoAdapter {
  const kms = new KMSClient({ region: opts.region });

  return {
    async encrypt(plaintext, ctx) {
      // 1. GenerateDataKey for AES-256
      const { Plaintext: dataKey, CiphertextBlob: encryptedDataKey } = await kms.send(
        new GenerateDataKeyCommand({
          KeyId: opts.kmsKeyArn,
          KeySpec: 'AES_256',
          EncryptionContext: ctxToRecord(ctx),
        }),
      );
      // 2. AES-256-GCM encrypt the plaintext with the data key
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv, { authTagLength: 16 });
      // AAD includes the encryption context — defense-in-depth so even if KMS context
      // were ever stripped (it can't, but...), the GCM auth tag still binds to it.
      cipher.setAAD(Buffer.from(JSON.stringify(ctxToRecord(ctx))));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      // 3. Discard plaintext data key
      dataKey.fill(0);
      return {
        ciphertext: ciphertext.toString('base64'),
        encryptedDataKey: Buffer.from(encryptedDataKey).toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        alg: 'AES-256-GCM/v1',
      };
    },

    async decrypt(ct, ctx) {
      // 1. Decrypt the data key — KMS rejects if EncryptionContext doesn't match
      const { Plaintext: dataKey } = await kms.send(
        new DecryptCommand({
          CiphertextBlob: Buffer.from(ct.encryptedDataKey, 'base64'),
          EncryptionContext: ctxToRecord(ctx),
        }),
      );
      // 2. AES-256-GCM decrypt
      const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(ct.iv, 'base64'), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(JSON.stringify(ctxToRecord(ctx))));
      decipher.setAuthTag(Buffer.from(ct.authTag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(ct.ciphertext, 'base64')), decipher.final()]);
      dataKey.fill(0);
      return plaintext.toString('utf8');
    },
  };
}

function ctxToRecord(ctx: EncryptionContext): Record<string, string> {
  return {
    userId: ctx.userId,
    capabilityId: ctx.capabilityId,
    fieldName: ctx.fieldName,
  };
}
```

### `packages/core/src/crypto/local-adapter.ts` (NEW)

dev-only AES-GCM-with-static-key adapter that still enforces the encryption context property (refuses to decrypt if context doesn't match what was used at encrypt time). uses `crypto.scryptSync(env.LOCAL_DEV_CRYPTO_KEY ?? 'dev-key', 'salt', 32)` for the data key. mirror the kms adapter structure but skip the GenerateDataKey/Decrypt round trips.

### `packages/core/src/crypto/factory.ts` (NEW)

```ts
/**
 * Returns the production KMS adapter when KMS_KEY_ARN is set, otherwise the local AES adapter.
 * Mirror of `persistence/factory.ts`.
 */
export async function createCryptoAdapter(env: Env, logger: AppLogger): Promise<CryptoAdapter>;
```

### `packages/core/src/persistence/user-capabilities.ts` (NEW)

per-user capability config store. interface + sqlite + dynamo adapters.

```ts
/**
 * Per-user capability config, encrypted credentials.
 *
 * Storage shape:
 *   { enabled, credentials: { [field]: EnvelopeCiphertext }, settings: {...plaintext...} }
 *
 * Reads decrypt all credentials before returning. Writes encrypt all credentials before storing.
 * Caller passes plaintext credentials in `set` and receives plaintext from `get`.
 */
export interface UserCapabilityStore {
  get(tinoUserId: string, capabilityId: string): Promise<CapabilityConfig | null>;
  set(tinoUserId: string, capabilityId: string, config: CapabilityConfig): Promise<void>;
  /** List all configured private capabilities for a user (no credentials decrypted). */
  list(tinoUserId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>>;
  delete(tinoUserId: string, capabilityId: string): Promise<boolean>;
}
```

dynamo: `pk = USER#<tinoUserId>`, `sk = CAP#<capId>` — one partition per user, one row per capability inside it. The earlier draft put `<capId>` in pk too (`pk = USER#<uid>#CAP#<capId>`), but that placed every row in its own partition and broke `list(uid)` (DynamoDB Query requires an exact partition match — `partition: 'USER#<uid>#CAP#'` returns nothing). Reshaping `<capId>` into sk lets `list()` be a single-partition Query with `range.beginsWith('CAP#')`, no GSI required. Spec line 170 of `wave_2.yaml` explicitly anticipated this: *"confirm the table layout supports this pattern; if not, add a GSI or denormalize a list-marker."* The reshape is the cheapest of the three options and matches `PREF#<userId>` / `PREF#<key>` precedent already in `entities.ts`.

sqlite: table `user_capability` with columns `(tino_user_id, capability_id, enabled, credentials_json, settings_json)`. credentials_json stores the encrypted envelopes (each field as a separate `EnvelopeCiphertext` JSON value).

### `packages/core/src/server/index.ts` (MODIFIED)

`StartServerOptions` gains two optional wave-2 fields: `userCapStore?: UserCapabilityStore` and `identityResolver?: IdentityResolver`. When both are provided, `startServer` mounts the new `/api/me/capabilities` router built via `createUserCapabilityRoutes(...)`. The existing `/api/capabilities` mount stays unchanged.

### `packages/core/src/console-app/lib/api.ts` (MODIFIED)

Adds wave-2 client-side helpers used by `MyCapabilities.tsx`:
- `getMyCapabilities()` → GET `/api/me/capabilities`
- `putMyCapability(id, body)` → PUT `/api/me/capabilities/:id`
- `deleteMyCapability(id)` → DELETE `/api/me/capabilities/:id`
- (OAuth start/callback helpers are stubbed; production OAuth wiring is a follow-up wave per the non-goals.)

### `packages/core/src/env.ts` (MODIFIED)

Adds optional `KMS_KEY_ARN: string | undefined` to the `Env` schema. The crypto factory at `packages/core/src/crypto/factory.ts` selects the KMS adapter when `KMS_KEY_ARN` is set, otherwise the local AES-GCM adapter. Production deploys set the value via Pulumi (the task definition already has `KMS_KEY_ARN` in its env block — confirmed at build time).

### `packages/aws/src/encryption/envelope.ts` + `packages/aws/src/encryption/provider.ts` + `packages/aws/tests/encryption/envelope.test.ts` (DELETED)

Wave 2 deletes the original single-user envelope helpers and the `KmsEncryptionProvider` class entirely. They had no production callers (verified via repo-wide grep before deletion); the only consumer was `tests/encryption/envelope.test.ts`, deleted alongside. The `CryptoAdapter` interface + KMS / local adapters replace them. Listing the deletions explicitly so a future archaeologist can trace why this code disappeared in this wave.

### `packages/core/src/capabilities/types.ts` (MODIFIED)

`PrivateCapability.buildToolsForUser` signature is unchanged from wave 1 — but the `config: CapabilityConfig | null` parameter is now sourced from `UserCapabilityStore.get(tinoUserId, capabilityId)` rather than from the global config store. callers (the registry) handle the swap; modules don't change.

### `packages/core/src/capabilities/registry.ts` (MODIFIED)

`buildPrivateTools(tinoUserId)` reads from `UserCapabilityStore` instead of the global blob:

```ts
async buildPrivateTools(tinoUserId): Promise<ToolSet> {
  if (tinoUserId === SYSTEM_USER_ID) return {};
  const result: ToolSet = {};
  for (const cap of ALL_CAPABILITIES) {
    if (cap.scope !== 'private') continue;
    const userConfig = await userCapStore.get(tinoUserId, cap.id);
    const tools = await cap.buildToolsForUser(tinoUserId, userConfig, configStore, logger);
    if (tools) Object.assign(result, tools);
  }
  return result;
}
```

`getActiveCapabilities(tinoUserId)` likewise.

### `packages/core/src/persistence/factory.ts` (MODIFIED)

add `userCapabilities: UserCapabilityStore` to the `Persistence` interface. wire through both adapters. the dynamo adapter constructor now takes a `cryptoAdapter: CryptoAdapter`; the sqlite adapter takes one too (for local-dev parity).

### `packages/aws/src/persistence/dynamo/user-capabilities.ts` (NEW)

dynamodb implementation. uses the `CryptoAdapter` to encrypt-on-write and decrypt-on-read. each credential field in the `credentials` map is encrypted with its own envelope (one `GenerateDataKey` per field) — this lets us add/remove individual fields without re-encrypting the others.

### `packages/aws/src/persistence/dynamo/entities.ts` (MODIFIED)

add the `UserCapability` entity:

```ts
export function createUserCapabilityEntity(table: TinoTable) {
  return new Entity({
    name: 'UserCapability',
    table,
    schema: item({
      pk: string().key(),  // 'USER#<tinoUserId>'
      sk: string().key(),  // 'CAP#<capId>'
      tinoUserId: string(),
      capabilityId: string(),
      enabled: boolean(),
      credentialsJson: string(),  // JSON-encoded { field: EnvelopeCiphertext }
      settingsJson: string(),     // JSON-encoded plaintext settings
      updatedAt: number(),
    }),
    timestamps: false,
  });
}
```

### `packages/aws/src/pulumi/tino-service.ts` (MODIFIED)

update the KMS key policy at line ~374 to require encryption context for `kms:Decrypt` and `kms:GenerateDataKey` from the ECS task role:

```ts
{
  Sid: 'AllowTaskRoleEncryptDecryptWithUserContext',
  Effect: 'Allow',
  Principal: { AWS: taskRoleArn },
  Action: ['kms:GenerateDataKey', 'kms:Decrypt'],
  Resource: '*',
  Condition: {
    'StringLike': {
      'kms:EncryptionContext:userId': '*',
      'kms:EncryptionContext:capabilityId': '*',
    },
    'Null': {
      'kms:EncryptionContext:userId': 'false',
      'kms:EncryptionContext:capabilityId': 'false',
    },
  },
},
```

the `Null: false` condition ensures the keys must be present (not just any value). this is the cryptographic floor: even if application code passes a malformed context with no userId, KMS refuses.

a separate statement for CloudWatch Logs (which already uses encryption context with a different shape) stays unchanged — it has its own ArnLike condition.

### `packages/core/src/crypto/migration.ts` (NEW)

one-shot migration: copy the bot owner's global private-capability creds into their per-user partition, encrypted; clear the global private blobs.

```ts
/**
 * Migrate the bot owner's global private capability credentials to their per-user partition.
 *
 * Idempotent (uses a `migration.user-creds-v1.completedAt` config marker).
 *
 * Steps (only on first run):
 *  1. Resolve bot owner's tinoUserId from ALLOWED_SLACK_USER_ID via the identity resolver.
 *     (After wave 0, this resolution always succeeds.)
 *  2. For each PrivateCapability in ALL_CAPABILITIES:
 *       - Read `capability.<id>` global blob.
 *       - If credentials present and capability enabled:
 *           - userCapStore.set(botOwnerTinoUserId, capId, blob) — this encrypts on write.
 *           - configStore.set(`capability.<id>`, { enabled: false, credentials: {}, settings: {} })
 *             — clear the global blob; only an empty husk remains so console queries return cleanly.
 *  3. Write the marker.
 *
 * Failure modes:
 *  - KMS Encrypt fails: log loudly, do NOT clear the global blob, do NOT write the marker.
 *    The bot still works (capabilities/registry.ts still reads from global blob if user blob missing —
 *    see fallback below). Next startup retries.
 *  - DynamoDB write fails: same — fail-closed, retry next startup.
 */
export async function migrateUserCapabilityCreds(opts: { ... }): Promise<void>;
```

### `packages/core/src/capabilities/registry.ts` (MODIFIED — fallback for migration window)

during the migration window (after wave 1 lands and before wave 2's migration runs), `buildToolsForUser` for the bot owner needs to find creds somewhere. registry adds a fallback:

```ts
async buildPrivateTools(tinoUserId): Promise<ToolSet> {
  if (tinoUserId === SYSTEM_USER_ID) return {};
  const result: ToolSet = {};
  for (const cap of ALL_CAPABILITIES) {
    if (cap.scope !== 'private') continue;
    let userConfig = await userCapStore.get(tinoUserId, cap.id);
    if (!userConfig && tinoUserId === bootstrapAdminTinoUserId) {
      // Wave 2 migration window: fall back to global blob ONLY for the bootstrap admin.
      // Any other user with no per-user config gets `null` (capability not connected).
      const raw = await configStore.get(`capability.${cap.id}`);
      if (raw) userConfig = JSON.parse(raw);
    }
    const tools = await cap.buildToolsForUser(tinoUserId, userConfig, configStore, logger);
    if (tools) Object.assign(result, tools);
  }
  return result;
}
```

`bootstrapAdminTinoUserId` is the tino-UUID of the user resolved from `ALLOWED_SLACK_USER_ID`. cached at startup. once the migration runs, `userCapStore.get` returns the per-user blob and the fallback never fires. the fallback exists to handle the brief window between wave 2 deploy and the first successful migration run.

### `packages/core/src/server/routes/user-capabilities.ts` (NEW)

new console API routes for per-user capabilities. mirror of the existing `routes/capabilities.ts` but scoped to the requesting user's tino-UUID (resolved from the better-auth session via wave 0's identity resolver, called from the auth middleware).

routes:
- `GET /api/me/capabilities` — list the user's connected private capabilities
- `PUT /api/me/capabilities/:capId` — set/update a private capability config (encrypts credentials)
- `DELETE /api/me/capabilities/:capId` — disconnect a capability
- `GET /api/me/capabilities/:capId/oauth/start` — start OAuth flow (gmail, calendar)
- `GET /api/me/capabilities/:capId/oauth/callback` — finish OAuth flow, encrypt and store the refresh token

every route resolves `c.get('user').email` → tino-UUID via `identityResolver.resolveGoogle(email)`. unauthenticated or unresolvable → 401.

### `packages/core/src/console-app/pages/MyCapabilities.tsx` (NEW)

the "your capabilities" page. one card per `PrivateCapability`:
- **gmail**: shows "Connect Gmail" button → starts OAuth → on return, shows "Connected as <email>" + a Disconnect button. settings (e.g., search defaults) editable inline.
- **slack-personal**: shows a `xoxp-` token paste field with help text linking to slack's OAuth-token guide. on save, validates the token by hitting `auth.test` once (server-side).
- **calendar**: same OAuth flow as gmail.

uses the existing card layout from the org capabilities page so the visual language matches.

### `packages/core/src/console-app/pages/Console.tsx` (MODIFIED)

The existing console page becomes the org/shared capabilities surface (no separate `Capabilities.tsx` file exists in this codebase — earlier plan revisions named one that was never created; the equivalent UI lives inside `Console.tsx`'s capabilities grid). Wave 2: filter out private-scoped capabilities from the grid (`cap.scope === 'private'` is hidden); add a footnote/banner pointing to `/me/capabilities` for personal capabilities. Reads `cap.scope` from the GET /api/capabilities response (the server route was updated to include it).

### `packages/core/src/server/routes/capabilities.ts` (MODIFIED)

`buildCapabilityView(...)` now includes `scope: cap.scope` on the response so the console can filter. Filter private-scoped capabilities out of the GET /api/capabilities response — they have their own /api/me/capabilities endpoint now.

### `packages/core/src/console-app/App.tsx` (MODIFIED)

Add the route `<Route path="/me/capabilities" element={<MyCapabilities />} />` inside the existing `<Routes>` block. (Wave 2 is the first wave that grew the console SPA past a single AppRouter switch — earlier plan revisions named a `router.tsx` file that was never extracted.)

### `packages/core/src/console-app/hooks/useConfig.ts` (MODIFIED)

Adds an optional `{ lazy?: boolean }` argument so the new "Your capabilities" page can defer the initial `/api/config` fetch until its accordion opens (avoids a useless fetch when only the `MyCapabilities` route is being rendered). Also adds a `biome-ignore lint/correctness/useExhaustiveDependencies` directive on the existing `fire-once-on-mount` `useEffect` — the rule fires on every component using a `useEffect` with stable refs across renders, and the suppression here is the established pattern in this file. No behavior change for existing callers (the lazy flag defaults to false).

### `packages/core/src/console-app/components/Header.tsx` (MODIFIED)

add a "Your capabilities" link in the nav.

### `packages/core/src/agent/history-appender.ts` (NEW)

introduces the history-writer seam that wave 3.5 hooks into. every tool result enters `HISTORY#<userId>` through this single function; the function consults an injected `PrivacyFilter` to decide whether to persist the body or a metadata-only placeholder.

```ts
/**
 * Decision returned by the privacy filter for a single tool result.
 *
 * In wave 2 the default filter always returns `{ persist: true }` (no gating yet).
 * In wave 3.5 the real filter (calendar / gmail / slack per-capability) replaces it.
 *
 * If `persist: false`, the placeholder is what's actually persisted in the body's
 * place — enough metadata that the agent on a later turn knows the event/thread/
 * message exists, without retaining content.
 */
export type ToolResultPlaceholder = {
  type: 'redacted';
  reason: string;
  metadata: Record<string, unknown>;
};

export type Decision =
  | { persist: true }
  | { persist: false; placeholder: ToolResultPlaceholder };

export interface PrivacyFilter {
  evaluate(args: {
    capabilityId: string;
    toolName: string;
    toolArgs: unknown;
    toolResult: unknown;
  }): Decision;
}

/**
 * The single path through which tool results enter HISTORY#<userId>.
 *
 * - Wave 2: defaultPrivacyFilter is `() => ({ persist: true })`. Behavior unchanged from
 *   pre-wave-2 — every tool result body is persisted.
 * - Wave 3.5: callers pass `createPrivacyFilter({...})` from `packages/core/src/privacy/filter.ts`.
 *
 * The `appendToolResult` function is the ONLY exported way to write a tool result row.
 * Other functions in the history module (raw store mutations) are NOT exported. A custom
 * eslint rule (added in wave 2) blocks any other module from importing the underlying
 * mutators.
 */
export interface ToolResultAppender {
  appendToolResult(input: {
    userId: string;
    capabilityId: string;
    toolName: string;
    toolArgs: unknown;
    toolResult: unknown;
  }): Promise<void>;
}

export function createHistoryAppender(deps: {
  history: HistoryStore;
  privacyFilter: PrivacyFilter;
  logger: AppLogger;
}): ToolResultAppender;

export const defaultPrivacyFilter: PrivacyFilter = {
  evaluate: () => ({ persist: true }),
};
```

every existing call site that writes a tool result to history is migrated to call `appendToolResult` instead. the wave-2 wiring passes `defaultPrivacyFilter`; wave 3.5 swaps in `createPrivacyFilter({ capabilities: { calendar, gmail, slack } })` from `packages/core/src/privacy/filter.ts` and adds `privacyConfigStore` to fetch the user's config per run.

**Boundary enforcement (wave 2 reality, vs. earlier plan revisions):** the canonical `agent/history` module is still re-exported from `package.json` because `@tino/aws`'s `dynamo/history.ts` is a `HistoryStore` *implementation* (it needs the interface type and the `trim` helper to satisfy the contract). The export can't go away without splitting the module, which is a wave-3.5+ refactor. What IS enforced in wave 2 is structural: a test in `tests/agent/history-appender.test.ts` walks every file under `packages/core/src` and fails if any file outside the seam itself or `agent/run.ts` *both* calls `history.append(` *and* references the literal string `"tool-result"`. That catches the only failure mode the plan actually cares about — a new producer of tool-results bypassing the seam. The custom-eslint-rule note in earlier plan revisions is deferred to the post-wave-3.5 history-module split.

### `packages/core/src/agent/run.ts` (MODIFIED)

`runAgent` gains an optional `historyAppender?: ToolResultAppender` parameter. When provided, every tool-result message in `result.response.messages` is decomposed into individual `appendToolResult` calls (one per `tool-result` content part), each routed through the injected `PrivacyFilter`. Assistant messages still go through `history.append` directly. When `historyAppender` is undefined, the legacy raw-batch behavior (`history.append(userId, result.response.messages)`) is preserved so existing tests and pre-wave-2 callers keep working.

A `toolNameToCapabilityId(toolName)` helper derives the capability id from the tool-name prefix (gmail_*, slack_*, calendar_*, github_*, linear_*, cloudwatch_*, plus the four non-capability core tools — set_preference / get_preferences / schedule_task / list_tasks / cancel_task → 'core'). Wave 3.5's filter receives this capabilityId so it can dispatch per-capability rules. Unknown prefixes return 'unknown' — the privacy filter must default-allow when it sees 'unknown' (renaming a tool must not silently flip it to redacted).

### `packages/core/src/index.ts` (MODIFIED — historyAppender wiring)

In addition to the wave-2 changes for crypto adapter / identity resolver / migration / userCapStore wiring, index.ts also constructs the `historyAppender` once at startup with `defaultPrivacyFilter` and threads it into all three `runAgent` call sites (the slack DM handler, the findWork onNewWork callback, and the scheduler runTask closure). Wave 3.5 swaps `defaultPrivacyFilter` for the real per-capability filter at this single construction site — no changes needed in run.ts or any of the three call sites.

### `packages/core/tests/agent/run-history-seam.test.ts` (NEW)

End-to-end test that proves the seam IS the single path through which tool results enter history. Cases:
- runAgent with a stub PrivacyFilter sees the filter consulted exactly once per tool-result, with the correct `capabilityId` derived from the tool name.
- runAgent with a redacting filter (persist:false) writes the placeholder, NOT the original tool-result body, into history.
- runAgent without `historyAppender` falls back to the legacy raw-append behavior (no regression for pre-wave-2 callers / existing run.test.ts harness).

### `packages/core/tests/agent/history-appender.test.ts` (NEW)

unit tests for the seam:
- `appendToolResult` with the default filter persists the body unchanged
- `appendToolResult` with a stub filter that returns `{ persist: false, placeholder: ... }` writes the placeholder, not the body
- raw history-store mutators are not importable from outside the history module (compile-time / eslint check)

### `packages/aws/tests/crypto/kms-adapter.test.ts` (NEW)

unit tests using `aws-sdk-client-mock`:
- encrypt → decrypt round-trip recovers plaintext
- decrypt with mismatched encryption context throws (KMS InvalidCiphertext simulated by the mock)
- encrypt produces all required envelope fields (ciphertext, encryptedDataKey, iv, authTag, alg)
- alg field is `'AES-256-GCM/v1'`

### `packages/core/tests/crypto/local-adapter.test.ts` (NEW)

same suite as the KMS adapter, against the local AES-GCM adapter.

### `packages/core/tests/persistence/user-capabilities.test.ts` (NEW)

integration tests for the SQLite `UserCapabilityStore` (real `bun:sqlite` `:memory:`):
- set + get round-trip recovers plaintext credentials
- set + get under different (userId, capId) pairs are isolated
- get returns null when nothing stored
- list returns enabled flags but doesn't decrypt credentials
- delete returns true on existing entry, false on missing

### `packages/aws/tests/persistence/dynamo-user-capabilities.test.ts` (NEW)

DynamoDB-toolbox-mocked unit tests for `createDynamoUserCapabilityStore` (mirror of the existing `dynamo-preferences.test.ts` pattern). Asserts wiring under the reshaped `pk=USER#<uid>, sk=CAP#<capId>` schema:
- get/set/delete target the correct (pk, sk) pair
- list issues a single-partition Query with `partition: 'USER#<uid>'` and `range.beginsWith: 'CAP#'` (the regression guard for the partition-key bug surfaced in code review — earlier draft used `partition: 'USER#<uid>#CAP#'` which DynamoDB rejects)
- list rows expose only `capabilityId` + `enabled`, never credentials
- delete short-circuits to `false` and skips the DeleteItemCommand when nothing is stored

This test exists in `packages/aws/` because mocking dynamodb-toolbox's command classes is co-located with the other dynamo wiring tests there. The full encrypt/decrypt round-trip with a real crypto adapter is covered by `packages/core/tests/persistence/user-capabilities.test.ts` against SQLite.

### `packages/core/tests/integration/wave2-migration.test.ts` (NEW)

end-to-end test of the migration:
- seed: global `capability.gmail` blob with a refresh token
- run `migrateUserCapabilityCreds`
- assert: bot owner's `pk=USER#<tinoUserId>, sk=CAP#gmail` row exists with the encrypted refresh token
- assert: global `capability.gmail` blob is now `{ enabled: false, credentials: {}, settings: {} }`
- assert: `buildPrivateTools(<botOwnerTinoUserId>)` returns gmail tools (decrypts successfully)
- assert: idempotent (second run is a no-op)

### `packages/core/tests/server/user-capabilities-routes.test.ts` (NEW)

route-level tests for `/api/me/capabilities/*`. covers: list, put, delete, OAuth start, OAuth callback. uses an in-memory `UserCapabilityStore` and mocked OAuth providers.

## acceptance criteria

```plan-state
- [x] id: a1
  intent: The CryptoAdapter encrypts and decrypts payloads, requiring an exact encryption-context match. Mismatched context fails decrypt (cryptographically — at the KMS API for production, at the AES-GCM AAD for local).
  tests:
    - packages/aws/tests/crypto/kms-adapter.test.ts::"encrypt then decrypt with same context recovers plaintext"
    - packages/aws/tests/crypto/kms-adapter.test.ts::"decrypt with mismatched userId throws"
    - packages/aws/tests/crypto/kms-adapter.test.ts::"decrypt with mismatched capabilityId throws"
    - packages/aws/tests/crypto/kms-adapter.test.ts::"decrypt with mismatched fieldName throws"
    - packages/core/tests/crypto/local-adapter.test.ts::"encrypt then decrypt with same context recovers plaintext"
    - packages/core/tests/crypto/local-adapter.test.ts::"decrypt with mismatched context throws"
  verify: cd packages/core && bun --bun ./node_modules/vitest/dist/cli.js run tests/crypto/ && cd ../aws && bun --bun ./node_modules/vitest/dist/cli.js run tests/crypto/

- [x] id: a2
  intent: UserCapabilityStore stores per-user capability configs with encrypted credentials. Get returns plaintext credentials. Different (userId, capabilityId) partitions are isolated. List returns enabled flags without decryption. Dynamo wiring uses pk=USER#<uid>, sk=CAP#<capId> so list() is a real single-partition Query.
  tests:
    - packages/core/tests/persistence/user-capabilities.test.ts::"set then get round-trips plaintext credentials"
    - packages/core/tests/persistence/user-capabilities.test.ts::"different users do not share capability state"
    - packages/core/tests/persistence/user-capabilities.test.ts::"list returns enabled flags only"
    - packages/core/tests/persistence/user-capabilities.test.ts::"delete returns true on existing, false on missing"
    - packages/aws/tests/persistence/dynamo-user-capabilities.test.ts::"list: queries partition USER#<uid> with sk beginsWith CAP#"
    - packages/aws/tests/persistence/dynamo-user-capabilities.test.ts::"get: uses pk=USER#<uid>, sk=CAP#<capId>"
    - packages/aws/tests/persistence/dynamo-user-capabilities.test.ts::"set: writes pk=USER#<uid>, sk=CAP#<capId> with encrypted credentials"
  verify: cd packages/core && bun --bun ./node_modules/vitest/dist/cli.js run tests/persistence/user-capabilities.test.ts && cd ../aws && bun --bun ./node_modules/vitest/dist/cli.js run tests/persistence/dynamo-user-capabilities.test.ts

- [x] id: a3
  intent: The bot owner's existing global private capability credentials are migrated to a per-user partition encrypted with their tino-UUID encryption context. The global blob is cleared after migration. A 30-day-TTL backup of each original blob is written before clearing (rollback path). The migration is idempotent.
  tests:
    - packages/core/tests/integration/wave2-migration.test.ts::"migration moves gmail credentials to per-user partition"
    - packages/core/tests/integration/wave2-migration.test.ts::"migration writes a backup of the original blob before clearing"
    - packages/core/tests/integration/wave2-migration.test.ts::"migration encrypts credentials with userId encryption context"
    - packages/core/tests/integration/wave2-migration.test.ts::"migration clears global private blob after copy"
    - packages/core/tests/integration/wave2-migration.test.ts::"second migration run is a no-op"
  verify: cd packages/core && bun --bun ./node_modules/vitest/dist/cli.js run tests/integration/wave2-migration.test.ts

- [x] id: a4
  intent: After migration, the bot owner's agent runs use the per-user partition for private tools. Decryption succeeds; tools are constructed; the gmail capability appears in activeCapabilities.
  tests:
    - packages/core/tests/integration/wave2-migration.test.ts::"buildPrivateTools includes gmail after migration"
    - packages/core/tests/integration/wave2-migration.test.ts::"getActiveCapabilities lists gmail for bot owner after migration"
  verify: cd packages/core && bun --bun ./node_modules/vitest/dist/cli.js run tests/integration/wave2-migration.test.ts

- [x] id: a5
  intent: The console exposes per-user capability management — list, configure, OAuth flows, disconnect. Routes resolve the requesting user via the better-auth session and the identity resolver.
  tests:
    - packages/core/tests/server/user-capabilities-routes.test.ts::"GET /api/me/capabilities returns the requesting user's capabilities"
    - packages/core/tests/server/user-capabilities-routes.test.ts::"PUT /api/me/capabilities/:capId encrypts and stores credentials"
    - packages/core/tests/server/user-capabilities-routes.test.ts::"DELETE /api/me/capabilities/:capId removes the entry"
    - packages/core/tests/server/user-capabilities-routes.test.ts::"OAuth callback stores encrypted refresh token"
  verify: cd packages/core && bun --bun ./node_modules/vitest/dist/cli.js run tests/server/user-capabilities-routes.test.ts

- [x] id: a6
  intent: A user's get path cannot accidentally decrypt another user's credentials — even if a coding bug were to point GetItem at the wrong partition, the encryption context would not match and KMS would reject the decrypt.
  tests:
    - packages/core/tests/integration/wave2-cross-user-decrypt.test.ts::"decrypting user A's credential with user B's context throws"
  verify: cd packages/core && bun --bun ./node_modules/vitest/dist/cli.js run tests/integration/wave2-cross-user-decrypt.test.ts

- [x] id: a7
  intent: The KMS key policy requires userId and capabilityId in the EncryptionContext for any Decrypt or GenerateDataKey call from the ECS task role. (Verified via Pulumi preview output diff.)
  tests:
    - packages/aws/tests/pulumi/kms-policy.test.ts::"key policy requires userId encryption context"
    - packages/aws/tests/pulumi/kms-policy.test.ts::"key policy requires capabilityId encryption context"
  verify: cd packages/aws && bun --bun ./node_modules/vitest/dist/cli.js run tests/pulumi/kms-policy.test.ts

- [x] id: a8
  intent: The history-writer seam exists and is the single path through which tool results enter HISTORY#<userId>. The default PrivacyFilter persists every tool result body unchanged (wave-2 behavior). A stubbed filter returning persist:false causes the placeholder to be written in the body's place. runAgent (the only production producer of tool results) routes through the seam when `historyAppender` is provided. Boundary enforcement: a structural test scans every file under `packages/core/src` and fails if any file outside the seam itself or `agent/run.ts` both calls `history.append(` AND references `"tool-result"` — that catches a new producer of tool-results bypassing the seam without requiring the canonical `agent/history` module to be unexported (the @tino/aws history-store implementation needs the type + `trim` helper). Wave 3.5 is therefore a one-line swap of the filter at the construction site in index.ts — no run.ts or call-site refactor needed.
  tests:
    - packages/core/tests/agent/history-appender.test.ts::"default filter persists tool result body unchanged"
    - packages/core/tests/agent/history-appender.test.ts::"filter returning persist:false writes placeholder"
    - packages/core/tests/agent/history-appender.test.ts::"raw history-store mutators are not importable outside the history module"
    - packages/core/tests/agent/run-history-seam.test.ts::"with historyAppender provided, tool-result messages route through the privacy filter"
    - packages/core/tests/agent/run-history-seam.test.ts::"with historyAppender provided and filter returning persist:false, the placeholder is what reaches history"
    - packages/core/tests/agent/run-history-seam.test.ts::"without historyAppender, falls back to the legacy raw-append behavior (no regression for pre-wave-2 callers)"
  verify: bun --bun ./node_modules/vitest/dist/cli.js run packages/core/tests/agent/history-appender.test.ts packages/core/tests/agent/run-history-seam.test.ts

- [x] id: a9
  intent: All existing tests continue to pass.
  tests:
    - "*"
  verify: bun test (run from each package directory; the root-level workspace runner is a known-broken path for the registry test that depends on inline-zod schema loading — see "(d) unusual conditions" in @build's wave-2 return payload)
```

## test plan

- crypto-adapter unit tests for both KMS (mocked) and local (real AES). target: 8+ test cases including all encryption-context-mismatch scenarios.
- `UserCapabilityStore` integration tests (sqlite + dynamodb-local). target: 6+ test cases.
- migration end-to-end test (seed → run → assert). target: 4+ assertions.
- console route tests for `/api/me/capabilities/*`. target: 8+ test cases.
- new cross-user-decrypt-rejection test that verifies the cryptographic property.
- pulumi key-policy snapshot test.
- existing 314+-test suite passes.

## non-goals

- Do NOT widen the slack DM gate — it stays `m.user !== ALLOWED_SLACK_USER_ID`. multi-user dispatch is wave 3.
- Do NOT add multi-user dispatch in `runAgent`. every call still passes the bot owner's tino-UUID at this point (resolved once at startup, threaded through).
- Do NOT add admin/member UI gating. that's wave 4.
- Do NOT add per-user findWork. shared-only stays the rule (D5).
- Do NOT migrate shared-capability credentials. github / linear / cloudwatch / slack-bot stay in the global blob — they're shared by definition.
- Do NOT delete legacy slack-id-keyed history/preferences from wave 0. that's still a follow-up wave.

## rollback story

if wave 2 ships and a critical bug surfaces:

1. **the most dangerous step is the global-blob clear after copy.** if the per-user partition write succeeded but a downstream decrypt path is broken, the bot is dead-in-the-water for private capabilities until either (a) the bug is fixed or (b) the global blob is restored.
2. **mitigation: the migration writes a backup.** before clearing each global private blob, the migration writes the original blob to `migration.user-creds-v1.backup.<capabilityId>`. rollback restores from these.
3. **for code-level rollback:** revert the codebase. before the next deploy, manually copy backups to the global blob keys via the existing config endpoint. the bot owner's per-user partition stays in dynamodb but is unread by pre-wave-2 code.
4. **KMS key policy change is forward-only:** adding the encryption-context requirement to the key policy is a deployed pulumi change. rollback also re-runs pulumi to restore the previous policy. the migration's per-user partition data was encrypted under the new policy, so old code cannot decrypt it anyway — rollback explicitly accepts that the per-user partition becomes unreadable. that's why backups exist.

backup retention: backups are written with a 30-day TTL via dynamodb's TTL feature (configured on the table — verify in pulumi). after 30 days a manual restore is impossible; that's the deliberate retention boundary.

## open questions

- **OAuth redirect URIs.** gmail and calendar OAuth need a fixed redirect URI registered with google. it's the same one we already use for better-auth (`<baseUrl>/api/auth/callback/google`)? or a separate per-capability one (`<baseUrl>/api/me/capabilities/gmail/oauth/callback`)? the executor should verify with google's OAuth quirks. flag: this may force a console URL to be a proper https URL even in dev.
- **slack `xoxp-` validation.** validating a `xoxp-` token via `auth.test` is a network call from the server. if the token is bad, we want a fast user-visible error. the executor should pick: (a) validate-on-save and return 400 immediately with the slack error message; (b) validate-on-save in the background and surface a status field on the capability. (a) is simpler; flag if the slack API has a rate-limit concern.
- **dynamodb-local KMS support.** dynamodb-local doesn't talk to KMS. integration tests should use the local AES adapter against dynamodb-local (works) or skip dynamodb integration tests for the encrypted path (loses signal). recommendation: `LocalKmsAdapter` for both unit and dynamodb-local tests; only the production deploy uses real KMS.
- **what does "cleared global blob" look like to existing console users?** the org-capabilities page currently lists all capabilities. after wave 2, the cleared private blobs (gmail, slack-personal, calendar) still appear (because their entries exist with `enabled: false`). the page change in wave 2 hides private-scoped capabilities from the org page entirely — but if a user's browser has a cached state, they may briefly see "Gmail (disabled)" with no fields. cosmetic only; flag if user feedback complains.
