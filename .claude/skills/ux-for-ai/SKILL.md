---
name: ux-for-ai
description: Use when designing or auditing a user experience — a flow, screen, interaction, or product. Use when diagnosing why a UI feels off, generic, or wrong. Use when trying to take something competent and make it joyful. Symptoms include: "users will navigate to the dashboard"-style UX descriptions, flows missing edge states, polish without substance, the default AI aesthetic (beige palettes, Inter, four cards in a grid), or "improve the UX" requests without specifics.
---

# ux-for-ai

Eight chapters on what makes user experiences feel right, then what makes them feel joyful. Synthesized from Donald Norman's *The Design of Everyday Things* and *Emotional Design*.

## When to use

- Designing a new flow, screen, form, navigation, or interaction
- Auditing an existing UX and articulating *what* is wrong (or right)
- Reviewing a Figma file, a deployed product, a competitor
- Making something competent into something that feels considered
- Resisting the default AI aesthetic when generating frontend code

## Modes

Pick one before starting. The chapters are the same in both; the workflow over them differs.

**AUDIT** — when something already exists (a screen, flow, prototype, deployed app, competitor). Walk each chapter's diagnostic questions against the artifact. Produce a structured report with severity tiers:

- *Critical* — foundation failures (Ch. 1–5) that block the user from succeeding
- *Major* — joy gaps (Ch. 6–8) or partial foundation issues that degrade the experience
- *Minor* — polish or edge cases worth noting but not urgent

Each finding cites the chapter it violates. No vibes. Output shape: scored review with concrete next steps.

**BUILD** — when designing something new. Walk the chapters as gated phases. Foundation first: complete each chapter's thinking before moving to the next. Don't start Ch. 6 (visceral) before finishing Ch. 1–5 — polished aesthetics on a confused interaction is more frustrating than a plain interaction that works. Within the joy layer, all three matter, but visceral comes first because it's the cheapest to lose to defaults. Output shape: design decisions in order, each tied to a principle.

If neither mode fits — "redesign this section," "make this better" — ask the user: *is something already there to audit, or are we building from scratch?* The two workflows produce different deliverables, and naming the mode prevents blurring them.

## The chapters

**Foundation — does the thing work?**

- **Ch. 1 — Why design fails** · `chapters/01-why-design-fails.md` — the two gulfs
- **Ch. 2 — Discoverability** · `chapters/02-discoverability.md` — affordances and signifiers
- **Ch. 3 — Feedback** · `chapters/03-feedback.md` — did it work, how do I know
- **Ch. 4 — Mental models** · `chapters/04-mental-models.md` — conceptual model and mapping
- **Ch. 5 — Constraints & forgiveness** · `chapters/05-constraints-and-forgiveness.md` — preventing and recovering from error

**Joy — does the thing feel right?**

- **Ch. 6 — Visceral** · `chapters/06-visceral.md` — the first impression
- **Ch. 7 — Behavioral** · `chapters/07-behavioral.md` — the pleasure in use
- **Ch. 8 — Reflective** · `chapters/08-reflective.md` — meaning, memory, mastery

## Source

Synthesized from:

- Donald Norman, *The Design of Everyday Things* (revised 2013 edition) — the foundation chapters
- Donald Norman, *Emotional Design* (2004) — the joy chapters

The chapters are this skill author's working synthesis, in our own words, with attribution. For the canonical text, read the books — they remain better than any summary.

## Output discipline

In both modes, every finding or decision should cite the chapter that justifies it. Uncited findings are vibes; uncited decisions are defaults. The eight diagnostics are the answer to both *why is this off* and *why is this right*.
