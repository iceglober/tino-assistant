# Synthesis: AI Assistant Adoption Failures (2025-2026)

**Status:** COMPLETE
**Last updated:** May 2026
**Source files:** [01-self-hosted-stuck-points.md](./01-self-hosted-stuck-points.md), [02-integration-friction.md](./02-integration-friction.md), [03-abandonment-trust-nowwhat.md](./03-abandonment-trust-nowwhat.md)

---

## Executive Summary

The user asked for evidence — not opinions — about why people abandon AI assistants after initial setup, what trips up self-hosted AI agent tools, what makes integrations painful, what security concerns block adoption, and the "now what?" problem.

After mining GitHub issues across the five most-deployed self-hosted AI assistants (LibreChat 37k★, LobeChat 77k★, Open WebUI 137k★, Onyx/Danswer 29k★, AnythingLLM 60k★), the MCP servers reference repo (85k★), HN discussion threads, and named enterprise post-mortems, **eight failure patterns recur across every tool and every adoption surface**. They are ranked below by evidence weight (number of independent sources + size of impact).

The single sharpest finding: **the structural absence of "I don't know what to do with this" issues in the GitHub trackers is the loudest signal in the data.** Users who don't know what to do don't file issues — they walk away silently. The trackers contain bugs and feature requests; the abandonment cohort is invisible there but visible in HN comments and operator-shutdown stories.

---

## The Eight Dominant Failure Patterns (Ranked by Evidence Weight)

### 1. Setup-to-first-useful-task gap is too long — "stuck after install"

The dominant failure mode across every self-hosted assistant. Users get install completed, then hit a wall before doing useful work.

Documented cases:
- AnythingLLM "Document Processor Unavailable on launch" ([#866](https://github.com/Mintplex-Labs/anything-llm/issues/866)), "Engine instance could not be reached" ([#3103](https://github.com/Mintplex-Labs/anything-llm/issues/3103)), "Illegal instruction Container exit" on AVX-less CPUs ([#1331](https://github.com/Mintplex-Labs/anything-llm/issues/1331)).
- OpenWebUI "save embedding to vector DB freezes the whole application" ([#19421](https://github.com/open-webui/open-webui/issues/19421)).
- LibreChat "File upload context processing not happening for non-agents" ([#10493](https://github.com/danny-avila/LibreChat/issues/10493)).
- Onyx "Postgres sql installation is failing" ([#7378](https://github.com/onyx-dot-app/onyx/issues/7378)), "Connectors Remain Stuck in 'Deleting' State" ([#1378](https://github.com/onyx-dot-app/onyx/issues/1378), closed Stale).
- LobeChat Logto SSO authentication mega-thread ([#3852](https://github.com/lobehub/lobe-chat/issues/3852)), Docker NextAuth regressions ([#5804](https://github.com/lobehub/lobe-chat/issues/5804)).

**Operative quote** (from a self-hoster who spent months and walked away):
> _"I spent way too much time repeating myself, talking in all caps, and generally fighting with the SOTA models to try to get them to understand my data... I scrapped the project to try and accomplish both the above goals due to too many mistakes."_ — joshstrange on HN, Nov 2025 ([source](https://news.ycombinator.com/item?id=45881367))

### 2. Google OAuth verification is a hard adoption blocker for any Google integration

The cleanest single-cause-of-abandonment evidence in the entire research. Google's OAuth verification process for restricted scopes (Gmail, Drive, Calendar) requires:
- 36+ days of waiting in "Verification in progress" with no Google contact ([source](https://www.adminium.ai/post/36-days-and-counting-the-never-ending-odyssey-of-google-oauth-verification))
- $15k–$75k annual CASA pentest fee from a monopoly of two certifiers ([HN](https://news.ycombinator.com/item?id=19873251), 54 points)
- 100-user cap on unverified apps
- Public landing page with privacy/terms even for internal-only apps

**Smoking gun:** A 2025 AI email organizer (Skyler) shut down explicitly because of CASA compliance — *not* because users didn't want it. The developer wrote: _"It was live at skylerinbox.com for a few months before I shut it down due to Google's CASA compliance requirements... The compliance overhead (CASA certification, legal costs, ongoing OAuth verification) didn't make sense for a solo MVP."_ ([source](https://news.ycombinator.com/item?id=46354497))

For self-hosted assistants connecting Gmail/Drive/Calendar across teams, the operator either accepts red `unverified app` warnings forever or pays five figures annually. Most pick option C: don't ship the integration.

### 3. MCP runtime fragility — "GUI launches don't inherit shell environment"

The Model Context Protocol shipped late 2024 as the way to plug AI into tools. The reference servers repo (85k stars) has 269 open issues. The dominant failure class is **runtime/transport fragility**, not protocol design:

- "MCP servers fail to connect with `npx` on Windows" ([#40](https://github.com/modelcontextprotocol/servers/issues/40))
- "MCP Servers Don't Work with NVM" ([#64](https://github.com/modelcontextprotocol/servers/issues/64), closed *almost a year* after open)
- "Connection failures with npm-based MCP servers while uvx-based servers work correctly" ([#76](https://github.com/modelcontextprotocol/servers/issues/76)) — the title literally directs users to find the workaround in the comments
- "Claude Desktop: 'Could not attach to MCP server'" ([#2729](https://github.com/modelcontextprotocol/servers/issues/2729))
- "filesystem MCP server doesn't support legal Windows pathnames" ([#447](https://github.com/modelcontextprotocol/servers/issues/447), open since Dec 2024)
- AnythingLLM mirror: "Have to launch from command-line for MCP server connections to not fail" ([#4017](https://github.com/Mintplex-Labs/anything-llm/issues/4017))

The root cause across most of these: GUI-launched apps don't inherit the developer's shell PATH/env, so they can't find Node from nvm, can't find npx, can't spawn the MCP subprocess. The fix is "launch the app from a terminal" — which works for the developer but breaks for end users.

### 4. Silent failure modes destroy trust without a clear error

The most dangerous category — when integrations "succeed" but produce wrong results.

- LibreChat "File upload context processing not happening for non-agents" ([#10493](https://github.com/danny-avila/LibreChat/issues/10493)) — upload appeared to succeed, model couldn't actually use the document, user only discovered it from wrong answers downstream.
- LibreChat "Upload Documents as input Context vs RAG Workflow" ([#2755](https://github.com/danny-avila/LibreChat/issues/2755)) — the title itself is the user's confusion: same UI affordance, mode-dependent behavior.
- OpenWebUI "Tool call results not decoded from HTML entities before sending to LLM" ([#20600](https://github.com/open-webui/open-webui/issues/20600)) — confirmed bug, tool results corrupted with `&amp;` style entities.
- Onyx "Connectors Remain Stuck in 'Deleting' State" ([#1378](https://github.com/onyx-dot-app/onyx/issues/1378)) — once a connector breaks, user can't even clean it up. Closed Stale.
- Onyx "No ETA for indexing, too slow, can't parallel index" ([#1546](https://github.com/onyx-dot-app/onyx/issues/1546)) — connector "works" but isn't useful for hours.
- Onyx "Danswer asks for an OpenAI API Key even with Ollama configuration" ([#1414](https://github.com/onyx-dot-app/onyx/issues/1414)) — direct violation of self-hosted contract.

The trust dynamic: a loud crash is recoverable. A silent wrong answer trains the user to *not trust* the system, and that doesn't recover.

### 5. The "now what?" problem manifests as feature-request volume, not bug volume

The loudest LibreChat threads, by comment count, are nearly all feature requests for capabilities that would make the running tool *useful*: admin panel ([#3137](https://github.com/danny-avila/LibreChat/issues/3137), open since Jun 2024), folders/projects ([#4848](https://github.com/danny-avila/LibreChat/issues/4848), open since Dec 2024), cost-of-conversation display ([#1215](https://github.com/danny-avila/LibreChat/issues/1215), open since Nov 2023 — *2.5+ years*).

These are not bugs. They are users with the tool running, asking for the next thing to make it actually useful.

The "now what?" problem at enterprise scale: Klarna deployed AI to handle 2/3 of customer-support chats (Feb 2024), then walked it back ("Klarna's AI replaced 700 workers. Now the CEO wants humans back after $40B fall," May 2025 ([source](https://news.ycombinator.com/item?id=44034641))). The AI worked technically but the customer-experience metric moved the wrong way.

### 6. Security/trust concerns block real data input

Three independent vectors converge:

**Legal precedent.** Air Canada was held liable for its chatbot's bad advice (Feb 2024, [Guardian](https://www.theguardian.com/world/2024/feb/16/air-canada-chatbot-lawsuit), 303 points on HN). Tribunal rejected Air Canada's "the chatbot is a separate legal entity" defense. Chatbot output is now legally binding on the operator.

**Prompt injection + no human-in-loop gate.** LibreChat #5580 — "Ability to ask user before making Tool Call" — open since Jan 2025. For 16+ months users have asked for a per-call confirmation gate before the AI calls Slack/Gmail/etc., and don't have one. ([source](https://github.com/danny-avila/LibreChat/issues/5580))

**MCP servers run unsigned subprocesses.** No signing, no sandboxing, no permission model in the protocol. Users running MCP servers from random GitHub authors are running arbitrary code with the AI app's privileges. Issue #522 — "Clarify possible Brave Search TOS violation" — closed *Not Planned* by maintainers, leaving users to do legal review themselves. ([source](https://github.com/modelcontextprotocol/servers/issues/522))

### 7. Acquisition/license-change anxiety drives anticipatory abandonment

When ClickHouse acquired LibreChat in Nov 2025, the HN thread (118 points, 40 comments) showed the immediate user response was *anticipatory abandonment*:

- _"Yeah that's really bad news. I too have LibreChat deployed for my personal use and now the only question is how long until it will inevitably be enshittified/monetized."_ ([elaus](https://news.ycombinator.com/item?id=45879313))
- _"I've seen open source projects get acquired like that, and very soon they start to have some kind of paid features, telemetry, etc. Might have to start looking for alternatives soon."_ ([zerof1l](https://news.ycombinator.com/item?id=45880034))
- _"Embrace, extend, extinguish... Hashicorp and Elasticsearch for the same old story."_ ([saberience](https://news.ycombinator.com/item?id=45880228))
- _"My biggest question and concern is whether or not LibreChat will end up introducing the SSO tax or other 'enterprise tier' features."_ ([tedivm](https://news.ycombinator.com/item?id=45880150))

Self-hosters are 1-2 acquisitions away from rebuilding. That uncertainty itself disincentivizes deep integration with any one tool.

### 8. Compliance-side abandonment — operators give up on shipping integrations

Beyond user → tool abandonment, **tool builders abandon platforms** because of compliance friction. Skyler shut down its AI email organizer because Google CASA compliance was unaffordable for solo developers. The QPost developer described OAuth verification across YouTube/TikTok/Instagram as _"brutal"_ requiring _"several rounds of revisions... each round took several weeks for feedback"_ ([source](https://news.ycombinator.com/item?id=46523758)).

This drains the supply of useful third-party integrations self-hosters can wire up. Abandonment runs both directions.

---

## Cross-Cutting Insights

### Insight A: The "issues closed as Stale" pattern is itself a measurable abandonment signal

In the Onyx repo specifically, multiple critical bug reports went stale and were closed unresolved:
- Connectors stuck deleting ([#1378](https://github.com/onyx-dot-app/onyx/issues/1378))
- Fail to index ([#1204](https://github.com/onyx-dot-app/onyx/issues/1204))
- High memory consumption ([#3427](https://github.com/onyx-dot-app/onyx/issues/3427))
- Cloud-key requirement violating self-hosted promise ([#1414](https://github.com/onyx-dot-app/onyx/issues/1414))
- Indexing speed/parallelism ([#1546](https://github.com/onyx-dot-app/onyx/issues/1546))
- Helm charts ([#971](https://github.com/onyx-dot-app/onyx/issues/971))

Each user filed a detailed report, didn't get a fix, didn't return to update — the bot closed the issue. Stale-rate is a proxy for the silent abandonment funnel.

### Insight B: MIT NANDA's "95% of GenAI pilots fail" is now the macro-anchor

Since Aug 2025 ([PDF](https://mlq.ai/media/quarterly_decks/v0.1_State_of_AI_in_Business_2025_Report.pdf), [Forbes summary](https://www.forbes.com/sites/jasonsnyder/2025/08/26/mit-finds-95-of-genai-pilots-fail-because-companies-avoid-friction/)), every conversation about AI ROI starts from this number. CISOs cite it. Boards cite it. Procurement cites it. The framing in the Forbes title — _"Companies Avoid Friction"_ — matters: the failure mode is not the tech, it's the integration / change-management / trust gates that pilots can't cross.

### Insight C: MCP rolled out in version-skew waves

LibreChat shipped MCP support in 6 distinct phases over 4 months (Apr 2025 → Jul 2025), each phase landing a previously-missing capability (remote OAuth → per-user OAuth → tool list refresh → human-in-loop → file return path). Onyx didn't add MCP until Sep 2025 — *almost a year* after the protocol launched. For users on the bleeding edge, "MCP supported" meant something different in April 2025 than November 2025. This created a moving target.

### Insight D: The connector long-tail outstrips maintainer capacity

Onyx put $500 cash bounties on individual connectors (Outline, Coda were paid; GitHub Pages went stale unclaimed). Even with cash on the table, certain integrations couldn't be built. The supported-connector list is always shorter than the user's needed list, and that gap is a hard wall for adoption.

### Insight E: The Klarna arc shows the textbook reversal pattern

Feb 2024 victory lap → Aug 2024 doubling down → May 2025 partial reversal → Nov 2025 reframe as workforce-restructuring success. The honest version: AI didn't replace humans well enough to keep humans away from customers, but the reorg stuck. Worth noting that this is the most-public arc — many private enterprise reversals follow the same shape without the press releases.

---

## Contradictions & Tensions in the Evidence

### Tension 1: Self-hosters say "I want privacy" then choose tools that need cloud LLM keys

Onyx #1414 captures the contradiction: user explicitly chose Ollama for local-only inference, app still demanded an OpenAI key. This isn't only an Onyx bug — it's a structural mismatch between the self-hosted-tools audience (wants privacy) and the cost-quality reality (local LLMs are still meaningfully behind frontier cloud models for many tasks). Tools that try to support both end up with friction surfaces in both modes.

### Tension 2: The same maintainers who deprioritize OAuth/SSO get acquired by enterprise vendors

OpenWebUI #483 — OAuth/OIDC was labeled `non-core`, `help wanted`, `low priority` for over a year before landing. LibreChat got acquired by ClickHouse and immediately the top user concern was "SSO tax" ([tedivm](https://news.ycombinator.com/item?id=45880150)). The community-deprioritized features become the commercial moat — which is exactly why community users fear acquisitions.

### Tension 3: Enterprise survivors *embed* AI into existing workflows; self-hosted assistants are *standalone* chat UIs

The OpenAI enterprise adoption guide (Apr 2025, [HN summary](https://news.ycombinator.com/item?id=43748225)) lists Morgan Stanley, Indeed, Lowe's, BBVA, Mercado Libre. Their pattern: embed AI in existing product workflows where there's already a human in the loop and a measurable outcome. Self-hosted assistants do the opposite — they're a chat box, and users are expected to figure out what to ask. The two patterns diverge structurally on the activation step.

---

## Confidence Assessment

**High confidence** (multiple independent sources, direct quotes, named-entity verification):
- Patterns 1, 2, 3, 4, 6, 7, 8 above.
- The four canonical enterprise cases (MIT NANDA, Klarna, McDonald's-IBM, Air Canada).
- The MCP runtime-fragility issue cluster.
- The acquisition-anxiety user voice from the LibreChat-ClickHouse HN thread.

**Medium confidence** (evidence is strong but partly indirect):
- Pattern 5 (the "now what?" problem) — supported by feature-request volume in trackers and by the joshstrange voice on HN, but the strongest signal is *absence* (no "how do I use this?" issue volume), which is harder to measure.
- Insight A (stale-rate as abandonment proxy) — observed clearly in Onyx, less clearly elsewhere because of different stale-bot policies across projects.

**Lower confidence** (sources blocked):
- Reddit user voice. I attempted r/selfhosted, r/LocalLLaMA, r/ChatGPT directly and Reddit's bot-verification wall blocked all of them. The Reddit cohort's sentiment is missing from this research and is the largest known gap.
- Discord user voice. Onyx and LibreChat have active Discords where the most pre-issue-filing pain lives, but Discord isn't crawlable.

---

## Recommended Next Steps

1. **Sample Reddit directly via a real browser session** — particularly r/selfhosted, r/LocalLLaMA, r/ChatGPT search for "I gave up," "abandoned," "switched away," and per-tool names. Reddit voice is the largest gap in this research.
2. **Crawl 5-10 Onyx Discord channels** for the pre-issue-filing pain that doesn't make it to GitHub. Onyx has the cleanest *abandonment proxy* (stale-rate) but a noisy *frustration signal* (Discord).
3. **Pull two more named-enterprise reversals** beyond Klarna / McDonald's / Air Canada for 2025-2026 specifically. Likely candidates: any LLM-customer-support deployment in regulated industries (healthcare, finance, legal) that quietly walked back.
4. **Quantify the "feature-request vs bug" ratio across the top 5 self-hosted assistants.** If feature-request issues outnumber bug issues by N×, that's a measurable proxy for the "now what?" problem.
5. **Verify the Skyler shutdown** with the developer for a longer-form post-mortem — it's the cleanest single piece of evidence in the research and worth a deeper interview.

---

## Appendix: Quote Bank for Future Use

The verbatim quotes most likely to be useful in downstream artifacts:

> **"I scrapped the project."** — joshstrange, HN Nov 2025, on chat-with-your-data on real schemas. ([source](https://news.ycombinator.com/item?id=45881367))

> **"It was live at skylerinbox.com for a few months before I shut it down due to Google's CASA compliance requirements."** — sanjaykumar584, HN Dec 2025. ([source](https://news.ycombinator.com/item?id=46354497))

> **"how long until it will inevitably be enshittified/monetized."** — elaus, HN Nov 2025. ([source](https://news.ycombinator.com/item?id=45879313))

> **"Has Google made you pay $15,000 to $75,000 for a security review?"** — aspantel, Ask HN 2019, 54 points. ([source](https://news.ycombinator.com/item?id=19873251))

> **"OAuth verification was brutal: Google took several rounds of revisions... TikTok only needed 3 rounds but each round took several weeks."** — arslan2012, Show HN Jan 2026. ([source](https://news.ycombinator.com/item?id=46523758))

> **"95% of GenAI pilots fail because companies avoid friction."** — Forbes / MIT NANDA, Aug 2025. ([source](https://www.forbes.com/sites/jasonsnyder/2025/08/26/mit-finds-95-of-genai-pilots-fail-because-companies-avoid-friction/))

> **"Klarna's AI replaced 700 workers. Now the CEO wants humans back after $40B fall."** — Livemint headline, May 2025. ([source](https://news.ycombinator.com/item?id=44034641))

> **"Air Canada ordered to pay customer who was misled by airline's chatbot."** — Guardian, Feb 2024, 303 points HN. ([source](https://www.theguardian.com/world/2024/feb/16/air-canada-chatbot-lawsuit))

> **"McDonald's will stop testing AI to take drive-thru orders, for now."** — Verge, Jun 2024. ([source](https://www.theverge.com/2024/6/16/24179679/mcdonalds-ending-ai-chatbot-drive-thru-ordering-test-ibm))

The single most-quotable issue title that captures the whole pattern:
> **"Have to launch from command-line for MCP server connections to not fail."** — AnythingLLM #4017, closed Dec 2025. ([source](https://github.com/Mintplex-Labs/anything-llm/issues/4017))

That title is the one-line version of the entire MCP runtime-fragility pattern.
