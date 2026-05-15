# Ch. 3 — Feedback

*Did it work? When? How do I know?*

Feedback is the answer to those questions. Without it, every action is a small act of faith.

The principle is simple: every action should produce visible, immediate, appropriate response. The user should never have to wonder whether the system noticed them.

The practice is layered. Different actions deserve different feedback at different speeds.

## The time horizons

Research consistently lands on three thresholds. The exact numbers vary; the shape is constant:

- **Under 100ms** — feels instant. The user perceives no delay. Reserve this zone for direct manipulation — typing, dragging, scrolling.
- **Under 1 second** — the user notices a delay but maintains flow. Tolerable for most clicks and transitions. Show *something* changing within 100ms; show the result by 1s.
- **Over 1 second** — the user starts wondering if it broke. Show **progress**, not a spinner. A spinner says "something is happening"; progress says "this far in, this much left."
- **Over 10 seconds** — the user mentally task-switches. Either send them away ("we'll email you when it's done") or fake immediacy with optimistic UI.

The single most underrated UX move: **optimistic UI**. Show the user the success state immediately; reconcile with the server quietly. If something fails, fall back gracefully. Slack, Linear, Notion all do this. It's why they feel fast on slow networks.

## What good looks like

- Buttons depress on press, animate on click, transition clearly to "done."
- Forms validate inline, not on submit.
- Save states are visible — *"saved 3 seconds ago"* beats nothing.
- Errors appear next to the field, not as a toast that flies past.
- Loading states are content-aware — skeleton screens that match the eventual layout, not generic spinners.

## What bad looks like

- A button that, when pressed, just sits there. You wait. You wonder. You click again.
- Spinners that spin forever with no indication of progress.
- "Something went wrong" with no detail and no path forward.
- Success states that look like nothing — the page just reloads.
- Toast notifications that disappear before the user finishes reading them.

## Diagnostic questions

- For every interactive element: what happens within 100ms of touching it?
- For every action: what changes by 1s? By 10s?
- Where does the user double-click?
- Where do they ask, out loud or in their head, *"did it save?"*

## The craft move

**Loud success, polite failure.** Make the wins celebratory. Make the failures small, specific, and actionable. The internet is full of products that whisper their successes and shout their errors. Invert it.
