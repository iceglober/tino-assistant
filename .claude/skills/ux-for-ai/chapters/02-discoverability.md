# Ch. 2 — Discoverability

*What can the user do here, without being told?*

Discoverability is the answer to that question. A well-designed thing makes its possibilities obvious — you walk up to it, and the right action is the natural one.

Two concepts do most of the work: **affordances** and **signifiers**.

An **affordance** is what something *can do.* A chair affords sitting. A flat surface affords placing things. A button — if it's a real button — affords pressing. The affordance lives in the thing itself.

A **signifier** is how the thing *advertises* its affordance. The shadow under a button. The underline on a link. The color of a clickable card. The signifier is the message; the affordance is the truth behind it.

Most discoverability failures are signifier failures. The thing has the affordance — the click works, the swipe works — but it doesn't *tell* the user. So users don't try.

A common modern failure: aggressive flat design. A page where everything has equal visual weight, where the call to action is the same shape as the headline, where buttons aren't visibly different from labels. Affordances are present but signifiers are silent. Users have to *guess* what's clickable. They tap things. They mostly miss.

## What good looks like

- Buttons look pressable — subtle shadow, color shift on hover, focus ring on tab.
- Links are visually different from non-links (color, underline, or both).
- Disabled states look disabled (low contrast, no pointer cursor on hover).
- Drag handles, expand arrows, close buttons all read as their function.
- Hovering tells you something — what's clickable becomes visibly clickable.

## What bad looks like

- "Ghost buttons" indistinguishable from labels at rest.
- Cards that look clickable but aren't (or look like text but are).
- Icons-only navigation with no labels and no convention to fall back on.
- Multi-purpose tap targets where the same gesture does different things depending on context the user can't see.

## Diagnostic questions

- What in this screen is clickable, and how does the user know without trying?
- What looks clickable but isn't — and what is the user doing when they tap it?
- Are signifiers consistent? Does a button always look like a button, here?
- If a new user landed on this screen with no context, what would they try first?

## A craft note

Aesthetic minimalism is not the same as discoverability. Plenty of "clean" interfaces are functionally hostile because the designer removed signifiers in pursuit of cleanliness. Decide deliberately: when a signifier seems "extra," is it actually doing work? Usually, yes.
