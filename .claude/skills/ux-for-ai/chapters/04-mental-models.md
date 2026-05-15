# Ch. 4 — Mental models

*The user's idea of how it works. Your design has to meet that — or rewrite it gently.*

Every user, on every screen, brings a **mental model** of what's going on under the hood. They believe the trash can deletes things permanently. They believe the cloud icon means "uploaded somewhere." They believe Cmd+Z undoes the last thing — but only the last *visible* thing.

Sometimes the model is right. Sometimes it's wrong. The design's job is to either honor the model that's already there, or teach a better one — fast and without lecturing.

## Conceptual model vs. implementation

The **implementation** is what the system actually does. The **conceptual model** is what the user thinks it does. Good UX makes them match. Where they can't match — because the implementation is genuinely complex — good UX teaches a *useful fiction*: a model accurate enough for the user's purposes, even if it's a simplification.

The iPhone's swipe-to-unlock worked because it matched a physical mapping: things slide. The desktop trash can worked because it borrowed an office metaphor people already used. The save icon — a floppy disk no one's touched in 25 years — works *anyway* because the metaphor has calcified into convention.

When a product invents a new conceptual model (say, a chat app using "channels" instead of "rooms"), it has to teach that model with the structure of the interface itself. Empty states, first-run moments, and microcopy all carry the load.

## Mapping

Beyond the model, there's **mapping** — how spatial and semantic relationships in the UI match the user's expectations.

A stove with four burners in a square, controlled by four knobs in a row, has bad mapping. You have to think every time. The same stove with knobs in a matching square arrangement: no thought required.

In software: a "left" arrow that moves things right. A "high contrast" toggle that lowers contrast. A volume slider where down is louder. All mapping failures. All instantly disorienting.

## What good looks like

- Terminology matches what users actually say, not what's in the schema.
- Spatial layouts cluster related controls; operations on a thing happen near the thing.
- Metaphors hold up beyond first impression — they don't break when the user looks closer.
- Empty states and first-runs teach the model in passing, not in tutorials.

## What bad looks like

- Internal jargon leaking into the UI ("entity," "object," "node").
- Novel patterns where conventional ones would do — custom dropdowns that don't behave like dropdowns.
- Inconsistent verb mapping: "delete," "remove," "archive" used interchangeably for different actions.
- Onboarding tours that explain the model instead of letting the interface do the teaching.

## Diagnostic questions

- If a user described what this screen does, what words would they use? Do they match yours?
- What's the metaphor here, and does it survive a second click?
- Are related things close, unrelated things far?
- What jargon could a user learn from the UI itself, without docs?

## The craft move

Speak the user's language. If they say "subscription" and your code says "entitlement," the UI says *subscription*. Engineering vocabulary is rarely user vocabulary, and the user is the one you're designing for.
