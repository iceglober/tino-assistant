# Ch. 5 — Constraints & forgiveness

Two complementary moves. **Constraints** prevent users from going wrong. **Forgiveness** helps them recover when they do.

You need both. A system that only constrains feels paternalistic. A system that only forgives feels reckless. Together, they make users feel safe — which is the prerequisite to feeling anything else.

## Constraints

A constraint shapes possibility. The right move can't fail because the wrong moves were never offered.

Norman names four kinds:

- **Physical** — the round peg won't fit the square hole. In software: a date picker that won't accept malformed dates.
- **Cultural** — green for go, red for stop. Conventions everyone already knows.
- **Semantic** — meaning constrains action. "Are you sure you want to delete?" relies on the user understanding "delete."
- **Logical** — the only remaining option must be the next step. The "Next" button enables only when the form validates.

Most user errors disappear when you take them off the menu. Don't let users pick the wrong file format — auto-detect. Don't let them mistype an email — validate inline. Don't let them delete the wrong thing — confirm the destructive action with the *name* of the thing being deleted.

## Forgiveness

But constraints can't catch everything. People still slip. They click "Delete" when they meant "Archive." They paste into the wrong field. They quit without saving.

Forgiving design assumes the slip and plans for it.

The single most user-loving feature in software is **undo**. Universal undo, easily reachable, with a long enough history to recover from the cascade that follows the first slip. Gmail's send-undo (a 30-second delay before actually sending) ships terabytes of regret reversal each year. Notion's revision history rescues whole documents.

Beneath undo, the supporting moves: **autosave** (no "did you save?"), **drafts** (no "did I lose it?"), confirmation only for the truly destructive (no "are you sure?" on every click).

## Slips vs. mistakes

Norman distinguishes:

- **Slips** — right intent, wrong action. *"I meant to click Save, I clicked Submit."*
- **Mistakes** — wrong intent. *"I deleted the file because I thought I had a copy. I didn't."*

Forgiving design handles both. Slips get undo and easy recovery. Mistakes get clarity and second chances — confirmation when the cost of being wrong is high, with enough context that the user can actually decide.

## What good looks like

- Destructive actions are slow and named: *"Delete 47 files"* with the count and a real confirm.
- Soft delete by default; hard delete is a separate operation.
- Forms preserve state on validation failure.
- Network failures retry quietly, then ask only when they can't.
- Cmd+Z works everywhere, on everything, including settings changes.

## What bad looks like

- "Are you sure?" on every action — trains users to dismiss reflexively.
- Destructive actions adjacent to common ones (Delete next to Edit, no confirmation).
- Forms that wipe themselves on validation error.
- Saves that depend on a "Save" button (a style from the 90s, mostly).

## Diagnostic questions

- What's the worst thing a user could accidentally do here, and what saves them?
- After a slip, how many clicks to recover?
- After a mistake, what's available to undo it?
- Where could a constraint replace a warning?

## The craft move

Prefer **prevention to correction**, and **recovery to interrogation**. The fewer "are you sure?"s you ship, the more weight the necessary ones carry.
