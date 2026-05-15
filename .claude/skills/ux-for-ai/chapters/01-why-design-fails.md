# Ch. 1 — Why design fails

Two gulfs. Every interaction is a bridge across two gaps, and almost every UX failure lives in one of them.

**The Gulf of Execution** — *I have a goal. Can the design show me what to do, and let me do it?*

**The Gulf of Evaluation** — *I did something. Can the design show me what happened, and whether I succeeded?*

When a product feels frustrating, hard, or stupid, you can almost always point at one of these two gulfs. Either the user couldn't figure out what to do, or they did something and couldn't tell whether it worked.

The classic illustration is the Norman door — a door with a vertical handle on the push side. The handle says *pull*. The user pulls. The door doesn't move. The user pushes. The door swings open. The user feels stupid. The door is the problem. The handle is a lie. The gulf of execution wasn't bridged.

Or this, in software: a "Save" button that does the save, but shows no indication. The user clicks again. And again. Three drafts get saved. The save worked — but the gulf of evaluation wasn't bridged.

## The frame

Every screen, every flow, every interaction — walk it twice:

Once asking *can the user tell what they can do here?* (execution)
Once asking *can the user tell what happened when they did it?* (evaluation)

If either answer is "no," you've found the work.

## What good looks like

- The button looks like a button. Affordance and signifier match.
- After clicking, something visibly happens — state change, animation, confirmation.
- If something will take time, the design says so immediately, not eventually.
- Errors say what went wrong, where, and what to try.

## What bad looks like

- "Click here" written on something that doesn't look clickable.
- Forms that wipe themselves when validation fails.
- Submissions that look indistinguishable from idle.
- Loading states that look like errors. Error states that look like loading.

## Diagnostic questions

For any screen or flow:

- What can the user do here that they don't yet know they can do?
- What just happened that the user can't tell happened?
- Where does the user pause, hover, second-guess?
- Where do they click something twice?

The "click it twice" test is brutal and useful. If a real user ever double-fires anything, you have a feedback problem — full stop.

## The orienting move

Before designing anything else, hold a draft against this single question: *am I helping the user across both gulfs?* The remaining chapters are tools for closing them.
