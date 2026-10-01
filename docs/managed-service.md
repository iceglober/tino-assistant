# tino as a managed service

How tino runs as one service for many companies, and the pattern that keeps
it cheap to run: **customers bring their own OAuth clients** until revenue pays
for tino's own to be approved.

- [the shape](#the-shape) — what a customer does, what runs where
- [whose OAuth client?](#whose-oauth-client) — the compliance pattern, with numbers
- [when to switch on managed clients](#when-to-switch-on-managed-clients) — the thresholds
- [what bring-your-own does *not* get you out of](#what-bring-your-own-does-not-get-you-out-of)
- [tenancy](#tenancy) — how orgs are kept apart
- [running it on Railway](#running-it-on-railway)
- [scaling past one box](#scaling-past-one-box)

---

## the shape

```
person ──signs up──▶ account ──creates/joins──▶ org ──admin connects──▶ model key
                                                  │                    Slack app (theirs)
                                                  │                    Google client (theirs)
                                                  └──members connect──▶ their Gmail/Calendar, their Slack
```

1. **Sign up** with email + password (verified by email) or "Sign in with Google".
   Signing in grants *no* data access — it only asks Google for
   `openid email profile`, which needs no Google review.
2. **Create an org** (or accept an invite, or join one that admits your email domain).
3. **The admin sets up the org**, guided by the Overview checklist:
   - **Model**: their own OpenAI, Anthropic or Azure key. Their LLM bill, their data-processing contract.
   - **Slack**: one click on a manifest link tino generates → Slack creates *their* app → paste
     Client ID, Client secret, Signing secret → *Install*. Events come to `/slack/events/<orgId>`.
   - **Google**: create an OAuth client in *their* Google Cloud project, consent screen type
     **Internal**, Gmail + Calendar APIs on, tino's redirect URI → paste ID + secret.
4. **Members connect** their own Google (mail + calendar, or calendar only) and Slack, from the
   Connections page or by DMing the bot `connect`.

Everything customer-specific — Slack app, Google client, model keys, policies — is stored
per org, encrypted. The platform's own environment holds only the operator's settings
(see [`.env.example`](../.env.example)).

---

## whose OAuth client?

When tino reads someone's mail through **tino's** Google app, tino is the app Google audits.
When it reads it through an app **the customer owns**, the customer is — and an app used only
inside its own Workspace needs no audit at all. That asymmetry is the whole pattern.

### Google

| access | scope class | to offer it on *tino's* client | on the *customer's* Internal client |
|---|---|---|---|
| Sign in (openid, email, profile) | non-sensitive | brand verification only (free, days) | — (tino's client is fine) |
| Calendar (`calendar.readonly`) | **sensitive** | OAuth verification: privacy policy, demo video, scope justification. Free; typically weeks. | nothing |
| Gmail (`gmail.readonly`) | **restricted** | verification **plus an annual CASA security assessment**. Tier 2 via a self-serve lab is roughly **$540–1,000/yr**; the older lab track ran **$15k–75k**. Plus engineering time to pass, every year. | nothing |

Without verification, a Google app that asks for sensitive or restricted scopes shows the
"Google hasn't verified this app" screen and is capped at **100 users** for its lifetime.
"Testing" publishing status is not a workaround either: its refresh tokens expire after 7 days.

**Internal** apps — a consent screen of type Internal in a Google Cloud project that belongs to
the customer's Workspace organization — are exempt from verification and the user cap,
because only that company's own accounts can use them. The catch: Internal only works for
Google Workspace customers, not `@gmail.com` users. For a B2B product that's acceptable.

### Slack

Slack doesn't audit distributed apps up front, but since **May 2025** it throttles them:
an app *commercially distributed outside the Slack Marketplace* gets `conversations.history`
and `conversations.replies` at **1 request per minute, 15 messages per request** (new installs
from 2025-05-29; existing installs from 2026-03-03). The knowledge base reads history; at that
rate it cannot keep up with a single busy channel.

**Internal customer-built apps are exempt** — an app the customer creates in its own workspace
keeps the normal tiers. That's why tino generates a manifest and the customer creates the app:
the app is theirs, so the limits are the normal ones. Getting tino's own app approved for the
Marketplace (a free review, but with real requirements and weeks of back-and-forth) is what
would lift the limits for a shared app.

> Slack's 2025 API terms update also changed what apps may do with message data (bulk export,
> using it to train models). tino only indexes for retrieval within the customer's own org and
> never trains on it, but read the current terms before you sell against them.

### how the code decides

`packages/core/src/domain/oauth-clients.ts` is the one rule, applied to every provider:

1. use the **org's own client** if it has one (unless the org prefers the managed one and it may serve them);
2. else **tino's client**, if its approval level covers what the capability needs
   (`google.signin`: none · `google.calendar`: verified · `google.gmail`: assessed ·
   `slack`: assessed, i.e. Marketplace), the org is allowed to use it, and any pilot cap isn't reached;
3. else nothing — with a reason the console shows ("add your own OAuth client in Settings").

Each stored credential records **which client minted it** (`settings.client = { owner, clientId }`),
because a refresh token only refreshes against that client. The secret is joined in at read
time, so an org can rotate its client secret without everyone reconnecting, and a credential
whose client is gone reads as *not connected* instead of failing mid-reply.

Turning on a managed client is configuration, not code:

```sh
PLATFORM_GOOGLE_CLIENT_ID=…  PLATFORM_GOOGLE_CLIENT_SECRET=…
PLATFORM_GOOGLE_APPROVAL=none|verified|assessed
PLATFORM_GOOGLE_PILOT_CAP=0          # >0: serve above the approval to this many people (see below)
PLATFORM_SLACK_CLIENT_ID=…  PLATFORM_SLACK_CLIENT_SECRET=…  PLATFORM_SLACK_SIGNING_SECRET=…
PLATFORM_SLACK_APPROVAL=none|assessed
PLATFORM_CLIENT_ORGS=<org ids>       # optional allowlist
```

Orgs choose per provider in Settings: *ours if set up, else tino's* (default), *always ours*,
or *prefer tino's*.

---

## when to switch on managed clients

Bring-your-own costs the customer about ten minutes of an admin's time per provider, and it
costs *you* deals with customers who don't have that admin. Switch each managed client on when
that friction costs more than the approval does.

| stage | Google | Slack | cost to you |
|---|---|---|---|
| **0 · now → first ~10 paying orgs** | tino's client for **sign-in only**; customers bring Internal clients for data | customers create their app from the manifest | $0 |
| **1 · onboarding friction shows in lost trials** (roughly $2–5k MRR) | verify tino's client for **Calendar** (`APPROVAL=verified`): calendar-only connects work with no customer setup; Gmail stays BYO | unchanged | free; ~2–6 weeks of Google review |
| **2 · Gmail without setup is worth ~$1k/yr + a week of prep** (roughly $5–10k MRR, or one deal that needs it) | CASA Tier 2 for `gmail.readonly` (`APPROVAL=assessed`) | apply to the Marketplace (`PLATFORM_SLACK_APPROVAL=assessed`) | ~$540–1k/yr + annual re-assessment |
| **anytime · design partners** | `PILOT_CAP` ≤ 100 lets a few orgs use tino's unverified client for Gmail | — | free, but see below |

The **pilot cap** uses Google's allowance for unverified apps: up to 100 people see the
"unverified app" screen and can still consent. It is meant for testing and early users, not
production at scale — Google can restrict an app that leans on it. Use it for a handful of
design partners who'd otherwise stall on setup, tell them what the warning screen means (the
console does), and verify before you widen it. The policy counts people connected through
tino's client across all orgs and stops offering it at the cap.

What to do in the meantime to make BYO painless (already built):

- Slack: a generated, per-org manifest and a one-click "create from manifest" link; three values to paste.
- Google: a checklist with the exact redirect URI and scopes, and a live status that says which
  client a new connection would use and why.
- Calendar-only connect (`?access=calendar`), so a managed Calendar client can ship before Gmail's.

---

## what bring-your-own does *not* get you out of

BYO OAuth avoids **Google's app verification and CASA**, and **Slack's distribution limits**.
It does not change what tino *is* to its customers: a service that stores their employees'
mail and messages. So, independent of whose OAuth client is used:

- **Data-protection law still applies.** Under GDPR/UK GDPR you're a *processor* for each
  customer: you need a DPA (data processing agreement) and a list of sub-processors (Railway,
  your email provider, any platform embedding provider). CCPA has the equivalent
  "service provider" terms.
- **Security questionnaires will come anyway.** Mid-size buyers ask for SOC 2 because of the
  data tino holds, not because of OAuth. Budget for it when deals need it — often the same
  moment as stage 2 above.
- **Model providers see the content.** Using each org's own model key keeps that processing
  under the customer's own contract with OpenAI/Anthropic/Microsoft, and off your
  sub-processor list. That's why "bring your own model key" is the default. If you turn on
  `PLATFORM_OPENAI_API_KEY` for embeddings, OpenAI becomes *your* sub-processor for those orgs.
- **Deletion has to work.** Members can wipe their own indexed data (`forget me`), and
  `wipeOrgKnowledge` clears an org's knowledge base. A full org-deletion flow (account,
  settings, history) is not built yet — needed before you sign a DPA that promises it.

None of this is legal advice; have a lawyer read your DPA and terms before the first paid contract.

---

## tenancy

One process and one Postgres serve every org. The isolation rule is structural:

- Every tenant table carries `org_id`, first in every unique key.
- `persistence.forOrg(orgId)` returns stores bound to that org — every statement they run has
  `org_id = <theirs>`. Nothing below the composition root takes an org id as an argument, so it
  can't be passed the wrong one.
- An **org runtime** (`apps/server/src/bootstrap/org-runtime.ts`) is the old single-tenant tino
  built from those stores: its model, tools, Slack app and knowledge base. The registry builds
  one per org lazily and rebuilds it when settings change.
- Org secrets are envelope-encrypted with the org bound as AAD; a ciphertext copied into another
  org's row doesn't decrypt.
- `apps/server/tests/persistence/stores.test.ts`, `tests/kb/pg-store.test.ts` and
  `tests/server/platform-flow.test.ts` assert isolation for every store and over HTTP.

Inside an org, nothing changed: the [who-may-see-what](architecture.md#who-may-see-what) rules
still decide what each reply can use.

*Why not one deployment per customer?* It would isolate harder, but every org would cost a
service and a database on Railway (a few dollars a month each, before any traffic), deploys
and migrations would fan out across the fleet, and trials would cost real money. Pooled
tenancy with org-bound stores costs nothing per org. If a customer ever needs dedicated
infrastructure, the same image runs alone with one org in it.

---

## running it on Railway

Infrastructure is code in [`.railway/railway.ts`](../.railway/railway.ts) (Railway's TypeScript
IaC, `railway/iac`): one service built from the `Dockerfile`, and Railway Postgres 18, which
ships pgvector.

```sh
railway link
bash scripts/railway-bootstrap.sh          # generates ENCRYPTION_KEY + AUTH_SECRET once
TINO_DOMAIN=tino.example railway config plan
TINO_DOMAIN=tino.example railway config apply
```

Then in the dashboard: `ORG_CREATORS` (production starts as a closed beta), `RESEND_API_KEY`
+ `EMAIL_FROM` for verification and invite emails, and the optional `PLATFORM_*` clients.
Point your domain's DNS at the custom domain Railway shows.

IaC never writes secrets: they're `preserve()`d, so `apply` keeps whatever the bootstrap script
or the dashboard set. **Back up `ENCRYPTION_KEY`** — losing it makes every stored credential and
org secret unreadable.

Cost, roughly: one small always-on service and one Postgres, i.e. Railway's Hobby or Pro
plan plus usage — single-digit to low-tens of dollars a month for the first dozens of orgs.
Check Railway's current pricing; the knowledge base's indexing CPU and the database volume
are what grow with customers.

---

## scaling past one box

The single replica is a choice, not a limit of the design:

- **Slack** arrives over HTTP and is stateless per request — any replica can take it.
- **The knowledge-base scheduler** runs in-process and walks orgs one at a time. To run more
  than one replica, move it to its own Railway service (same image, a `WORKER=1` mode) or take
  a Postgres advisory lock per org cycle so only one replica runs a given org.
- **Rate limits** are per org (each has its own Slack app and Google client), so orgs don't
  starve each other's API budgets.

Do that when one box's CPU is the bottleneck, not before.
