# Tino — Multi-User Privacy Problem Statement

Audience: anyone making a strategy decision about tino's privacy architecture. Reads standalone. The wave-level plans in this same directory operate downstream of the choice this document is asking for.

## Background

Tino is a personal AI assistant deployed at kayn that talks to one user (Austin) over Slack DM. It has tools for Gmail, Google Calendar, GitHub, Linear, CloudWatch, and Slack. Today it is single-user by hard gate: `packages/core/src/slack/app.ts:47` rejects DMs from anyone other than `ALLOWED_SLACK_USER_ID`.

Tino is ALSO an OSS project. The intent is that other developers can install it for their teams. A future direction is a hosted multi-tenant offering. Both intents require multi-user support.

The console (Hono + React) already authenticates multiple users via Google Workspace SSO. The tool layer does not. There is no concept of "this credential belongs to user X." All capability credentials live in a single global config blob keyed by `capability.<id>` in DynamoDB. If the Slack-DM gate were widened today, a teammate's question would execute under the bot owner's tokens, exposing the owner's data through the teammate's session.

The architectural design for multi-user tino already exists in `docs/plans/product.md` (1315 lines). The currently-shipped v2.x plans deliberately deferred it. The waves in this directory (`wave_0.md` through `wave_5.md`) convert that design into shippable work.

## The privacy problem in one sentence

**When a teammate uses tino for emails, calendar, or private DMs, tino reads their data on their behalf and stores enough of it that someone with infrastructure access can read it later.**

That "someone" is a real person — most concretely, Austin (the kayn AWS account admin). Austin can open the AWS Console, query DynamoDB, and read every user's stored data. The naïve fix ("encrypt it") doesn't help because Austin also has KMS access. This is the threat that motivates this document.

## Threat model — be precise

Three distinct threats are usually conflated. Pulling them apart matters because they have different defenses.

**Threat A — Privileged operator with infrastructure access.** Austin (or whoever is the AWS account admin) opens DynamoDB in the AWS Console and reads another user's stored data. Has IAM, KMS, and CloudTrail-write access. Cannot be locked out cryptographically without sacrificing operator capabilities they need for legitimate work.

**Threat B — Lower-privileged IAM principal.** An on-call engineer, an auditor, or a ReadOnlyAccess role can list/read DynamoDB but lacks `kms:Decrypt`. Cryptographically defendable.

**Threat C — Data-at-rest exfiltration.** Snapshot theft, accidental S3 export, leaked backup. The attacker has bytes but no AWS principal. Pure encryption-at-rest defends; the storage engine is irrelevant.

The current Wave 2 design (per-user envelope encryption with `EncryptionContext={userId, capabilityId, fieldName}`) defends well against B and C. It does NOT defend against A — Austin can call `Decrypt` with the right encryption context.

The strategic question this document poses is: **how far should tino go to defend Threat A, and at what product cost?**

## Why this is harder than it looks

Tino is an LLM-driven agent, not a vault. Plaintext must materialize somewhere on every turn:

- **Bedrock (Claude) needs plaintext** at inference time. The full conversation history goes to Bedrock as `messages`. Tool results go in mid-turn.
- **Server needs plaintext credentials** to call Gmail / Slack / etc. OAuth bearer tokens cannot be sent encrypted.
- **`findWork` pollers run unattended** every 15 minutes. They need credentials when the user is offline.

Any "user-key-based" defense that requires the user to be present invalidates one of those three. Any "store nothing" defense that eliminates persistence breaks proactive features and across-turn memory.

This is the load-bearing constraint. Most of the conventional client-side-encryption / zero-knowledge / vault patterns from password managers do not directly apply to tino without re-shaping the product.

## What tino currently stores (per-user data only)

Brief, because it bounds the conversation:

| Store | Holds | Sensitivity | Threat A exposure today |
|---|---|---|---|
| `HISTORY#<userId>` | Full conversation history including all prior tool result bodies | High — Gmail snippets, private Slack DMs, etc. | Plaintext readable in DDB |
| `PREF#<userId>` | Timezone, formatting prefs | Low | Plaintext readable |
| `TASK#<taskId>` (`userId` indexed) | Scheduled task descriptions and results | Moderate | Plaintext readable |
| `CONFIG` (global, not per-user) | Capability credentials including OAuth refresh tokens, Slack `xoxp-`, GitHub PAT, Linear token | Critical — long-lived credentials | Plaintext readable |
| `AUDIT#<ts>` | Tool-call metadata, parameter keys only (no values) | Low by design | Schema-safe |

After Wave 2's per-user CMK + envelope encryption ships, Threats B and C are well-defended on all rows. Threat A is still readable because Austin has Decrypt.

## A relevant external benchmark

**What can a Slack admin already read in a customer's workspace?**

- Free / Pro / Business+ plans: workspace admins **cannot** read DMs or private channels they aren't members of. The data sits at Slack but customer admins have no path to it.
- Enterprise Grid plans: Org Owners with the Compliance Officer role and Compliance Exports enabled CAN read all messages including DMs. This is heavily gated, audit-logged, and typically requires separate approval.

For most kayn-style teams (likely Pro / Business+), **Slack itself protects DMs from the workspace admin**. If tino stores teammate DMs in plaintext under the AWS admin's reach, **tino has weakened privacy below the Slack baseline**. This is the security-tool-creating-a-security-hole failure mode.

Setting the floor explicitly: **tino's privacy posture should be at least as strong as the underlying Slack plan's privacy posture.** Otherwise tino is a downgrade and shouldn't be deployed for a team.

## Options considered

Each option below states the mechanism, what threat it addresses, what it costs, and the verdict. Compatible options can be layered.

### Option 1 — Wave 2 baseline (per-user CMK + EncryptionContext + audit trail)

**Mechanism.** One CMK per tino user. Each personal credential / sensitive field is encrypted with the user's CMK using `EncryptionContext={userId, capabilityId, fieldName}`. CMK key policy denies `Decrypt` to roles other than the ECS task role and the user-self role. CloudTrail data events on DynamoDB and KMS. SNS alarm on cross-user reads (any `GetItem` or `Decrypt` whose principal doesn't match the row's user-id).

**Defends.** Threat B (cryptographic), Threat C (cryptographic), Threat A (deterrence-plus-audit, NOT cryptographic — Austin can call `kms:PutKeyPolicy` to bypass, but that itself fires the alarm).

**Costs.** ~50 LOC per-user CMK provisioning, ~30 LOC CloudTrail data events. ~$1/CMK/month. CloudTrail data events have small per-event cost. Operationally inexpensive. No product changes.

**Verdict.** This is the floor. Already in the plan. Ships regardless of any further choice.

### Option 2 — Separate AWS account for tino

**Mechanism.** Tino's DynamoDB, KMS keys, ECS service live in an AWS member account separate from the kayn org-admin's account. SCPs prevent root account from assuming the tino-account admin role. Cross-account access is auditable.

**Defends.** Threat A, structurally. The kayn AWS admin doesn't have IAM principals in the tino account by default. To read user data they would need to assume a role that doesn't exist or be granted one through an audit-logged path.

**Costs.** Another AWS account in the org. Cross-account deploy pipeline. Separate billing aggregation. One-time migration effort. Operationally moderate.

**Verdict.** This is the structurally correct defense for Threat A and is engine-agnostic. Recommended if "even Austin can't read it without changing infrastructure" is a hard requirement. No product impact.

### Option 3 — Personal vault for cold-path data (passphrase-derived key)

**Mechanism.** User sets a vault passphrase in the console. Browser derives a key with Argon2id, generates a random data-encryption-key, wraps the DEK with the passphrase-derived key, stores `wrapped_dek + salt + params` in DDB. Plaintext key only ever in the user's browser. Cold-path data (archived history, audit beyond retention, user-authored notes) is encrypted with the DEK before persisting; decryption happens client-side in the console.

**Defends.** Threat A *for cold-path data only* — operator gets ciphertext, decryption requires the user. Threats B and C trivially.

**Does NOT defend.** Hot-path data (active conversation history within the agent's working window, active OAuth tokens, in-flight tool results). The agent loop requires plaintext for these and the user can't be present for every turn.

**Costs.** Console-side passphrase setup with recovery code. Browser-side decrypt UI for the vaulted views. Forgotten passphrase = lost data (recovery code is the only escape hatch). Modest implementation cost. Real product UX work.

**Verdict.** Useful as an **opt-in** layer for users who want stronger guarantees on their cold data. NOT a replacement for Option 1 — different data class. Marketing claim "zero-knowledge tino" would be a lie because hot-path data is still operator-readable.

### Option 4 — Stateless private capabilities (the "store nothing" answer)

**Mechanism.** Capabilities are split shared vs. private (already in plan). For PRIVATE capabilities (Gmail, Calendar, personal Slack DMs):
- Credentials never persist. User signs into the console, OAuth flow runs, access token lives in process memory only, refresh token never written to disk.
- Tool results from private capabilities are NOT written to `HISTORY#`. The history row stores a placeholder (`[private gmail content omitted]`). The agent does not have memory of what it read.
- No scheduled tasks for private-capability work. No findWork pollers for private capabilities.

For SHARED capabilities (GitHub, Linear, public Slack channels, CloudWatch): unchanged. Persistent history, persistent credentials, proactive features all work.

**Defends.** Threat A *categorically* for private data — the data isn't stored, so there's nothing to read. Threats B and C trivially.

**Costs to capability.**
- Loss of cross-session memory for personal data. "What did Cody DM me last week?" requires tino to re-search, not recall.
- Loss of proactive features for personal data. No "DM me 30 minutes before my next meeting" because the scheduler can't decrypt or hold the credential.
- Re-authentication friction. User must sign into the console at the start of every working session for private capabilities to function. Sessions die when the ECS task restarts.
- Compound tasks ("prep for my 3pm using calendar + emails + GitHub") are constrained — calendar and email parts work in real-time but don't accumulate context.

**Costs to architecture.** Significant. The history-filtering, in-memory-only credential handling, and per-session OAuth are all new code paths.

**Verdict.** This is the **cleanest answer to the literal question "be helpful without storing anything personal."** It's also a meaningfully different product from today's tino: tino remembers what the team did, forgets what you did. The privacy contract is strong and easy to communicate.

### Option 5 — Approval-gated mutations (defense against prompt-injection exfil)

**Mechanism.** Read tool calls run as today. Write tool calls (`linear_create_issue`, `linear_add_comment`, `linear_update_issue`, future `gmail_send`, future `gmail_trash_messages`) require interactive approval via Slack interactive buttons. Tino posts: "I want to do [X]. [Approve] [Deny]" — does not execute until clicked.

**Defends.** Prompt-injection-via-tool-result that tries to use mutations as exfil channels (already in `docs/security.md` threat model). NOT a defense against Threat A.

**Costs.** Slack interactive message implementation. Already on roadmap (`docs/plans/v2.md` Phase 12).

**Verdict.** Independent of the privacy decision but should ship alongside any of these. Concrete, useful, low cost.

### Options NOT recommended (briefly, to close the door)

- **Switching DBs (Postgres / DocumentDB / Mongo Atlas).** No privacy improvement. Threat lives at IAM/KMS layer, not the storage layer. Only changes the threat model if it changes *who holds the credentials* (separate vendor account ≈ Option 2).
- **Postgres row-level security.** Defends application-layer bugs, not operators. Master credential bypasses RLS.
- **Approval-gated reads at the per-tool-call level.** Approval fatigue + latency + proactive features die. Pattern fails contact with tino's interaction shape. (Approval at the *session* level — Option 4's per-session OAuth — does work, and is what "stores nothing for credentials" reduces to.)
- **CloudHSM / External Key Store / Nitro Enclaves.** Right answer for a future hosted-multi-tenant offering with regulated customers. Overkill for current scope.

## Composability — these layer

| Layer | Adds |
|---|---|
| Option 1 (Wave 2 baseline) | Cryptographic defense for B and C. Audit-trail defense for A. **Ships regardless.** |
| Option 5 (approval-gated mutations) | Defense against prompt-injection exfil. **Ships regardless.** |
| Option 2 (separate AWS account) | Structural defense against A. Optional. Operationally moderate. |
| Option 3 (cold-path vault) | Cryptographic defense against A *for cold data*. Opt-in per user. |
| Option 4 (stateless private capabilities) | Categorical defense against A *for private data*. Affects product shape. |

Compatible combinations:
- **Minimal: 1 + 5.** Today's plan. Threats B and C handled cryptographically. Threat A is deterrence-only.
- **Recommended for OSS adopters / small teams: 1 + 5 + 3.** Adds opt-in cold-path vault. Lets users with stronger requirements opt in without forcing it on everyone.
- **Recommended for kayn / "operator can't read" hard requirement: 1 + 5 + 2.** Separate AWS account. Most defensible posture without sacrificing product features.
- **Strongest privacy promise: 1 + 5 + 4 (+ optionally 2 or 3).** Stateless private capabilities. The "tino remembers the team, forgets you" model. Different product shape, strongest claim.

## The strategic question

**What promise does tino make to a teammate about their personal data?**

Three coherent answers, in increasing strength:

**Answer 1 — "We encrypt your data and audit access."** Layers 1 + 5. Threat A is handled by audit trail, not cryptography. The honest pitch is "Austin probably won't read your DMs and we'd notice if he did." Acceptable for a small team that trusts each other and primarily wants to defend against external threats and casual misuse.

**Answer 2 — "We encrypt your data, audit access, and isolate it in a separate AWS account / let you vault cold data."** Layers 1 + 5 + 2 or 3. Threat A is structurally or cryptographically harder. The pitch is "even Austin would have to actively change infrastructure (and trip alarms) to read your data." Stronger, costs more in operational complexity (Option 2) or product complexity (Option 3).

**Answer 3 — "We don't store your personal data at all."** Layer 4. Tino is stateless on private capabilities. The pitch is "we read your email when you ask, return the answer, and forget. The team workspace data is remembered; your personal data isn't." Strongest, costs proactive and conversational features for private data.

These map roughly to:
- **OSS-adopter default:** Answer 1 or 2.
- **Privacy-sensitive deployment:** Answer 2 or 3.
- **Hosted-multi-tenant future:** Answer 2 plus vault, plus eventually CloudHSM / enclaves.

## What this document is asking

The waves currently in this plan implement **Answer 1**. They are correct for the OSS baseline.

This document asks: **do we want to also commit to Answer 2 or Answer 3 as the kayn-deployed posture, and which?** That decision changes Waves 2 and 3 substantively:

- Answer 1 (current plan): no change.
- Answer 2 via separate-AWS-account: add a Wave 6 for AWS-account isolation. Defer until kn-eng is ready for cross-account work.
- Answer 2 via cold-path vault: add Wave 5.5 (or revise Wave 5) to add the opt-in vault module.
- Answer 3: substantially re-shape Waves 2 and 3. Private capabilities ship stateless from day one. Different acceptance criteria, different test surface, weaker proactive feature set.

## What this document is NOT

- A specification. The waves are the specification.
- An advocacy piece. Each option above has real defenders for real reasons.
- A claim that Threat A is the only threat. Threats B and C are real and Wave 2 already handles them well.

## Recommendation

Pick Answer 2 with cold-path vault (1 + 5 + 3) as the kayn deployed posture, and Answer 1 (1 + 5) as the OSS default.

**Rationale.**
- Answer 1 is below the Slack baseline for Pro/Business+ workspaces. Tino-deployed-for-a-team should not weaken privacy below the Slack the team is already using.
- Answer 3 is the most principled but the product cost is real. "Forgets your personal data" eliminates the proactive features that tino's whole product story is built on.
- Answer 2 with cold-path vault gets the cryptographic Threat-A defense for the data classes where it matters most (audit history beyond retention, user-authored notes), while keeping the agent loop intact for hot-path data.
- Operationally, the per-user CMK + CloudTrail combo from Wave 2 is already plausibly within budget; adding cold-path vault is incremental.
- Separate AWS account (Option 2-via-isolation) is good but is heavier work and can be added later as Wave 6 without re-shaping anything earlier.

The OSS default stays at Answer 1 because (a) OSS adopters' threat models vary widely and forcing Answer 2/3 makes deployment harder, (b) the wave-based design already supports adding the vault as opt-in.

Decision needed from: whoever owns the kayn-side privacy commitment and the OSS-product positioning.

---

## Appendix — what tino sends outward (egress)

For completeness, since storage is half the privacy story:

- **Bedrock (Anthropic via AWS).** Every turn: full conversation history + new message + tool definitions. BAA-covered. No prompt retention by Anthropic.
- **Slack Web API.** Outbound replies (post-validation). Read tools use the user's `xoxp-` token to access their full Slack scope.
- **Google APIs (Gmail, Calendar).** OAuth refresh-token flow. Search queries, message IDs, time ranges. BAA via Google Workspace if signed.
- **GitHub / Linear / CloudWatch.** Tool inputs (queries, IDs, paths) over their respective APIs. Linear and GitHub do not BAA.
- **AWS services** (DynamoDB, KMS, CloudWatch Logs, SNS): all internal-account, BAA-covered.
- **No general-purpose outbound HTTP.** Tino does not `fetch()` arbitrary URLs.

The egress surface is consistent regardless of which option above is chosen. Privacy choices about storage do not affect what tino transmits to third parties at the moment of a tool call.
