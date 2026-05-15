# Ch. 5 — Delays and oscillation

Most systems aren't instantaneous. Cause and effect are separated by time, and that gap produces almost every dynamic that surprises product teams.

The dashboard you launch this week affects user engagement next month. The hire you make this quarter shows results two quarters out. The marketing campaign you start today produces signups in three weeks. Most product feedback is *delayed.*

Delays cause oscillation. The classic case: you take a hot shower, the temperature is uncomfortable, you turn the knob. Nothing happens — because there's a delay in the pipes. You turn it more. Still nothing. You turn it further. Now the water is scalding. You turn it back hard. Cold. You turn it forward. Hot again. You're stuck oscillating because *your response time is faster than the system's response time.*

Product orgs do this constantly. Metric is down → react fast → over-correct → metric overshoots → react fast → over-correct other direction → repeat. The team feels "agile." It's actually oscillating, and the average is the same as if they'd done nothing — except they've spent the org's attention on it.

The fix is counterintuitive: **when there's a delay, slow your response down.** Make smaller moves. Wait for the previous change to propagate before judging it. Resist the urge to make another change just because *this* change "isn't working yet."

Delays also turn balancing loops into overshoot machines. A thermostat with a long sensor delay heats well past setpoint before noticing. A growth team that sees signup data on a 30-day lag invests in the wrong channel for a full month after it stops working. Anywhere there's a delay, expect oscillation unless you actively damp the response.

Delays interact with buffer stocks (Ch. 2). Adequate buffers absorb delays gracefully. Inadequate buffers turn every delay into a crisis. *"Why do we keep having fire drills?"* often resolves to: insufficient buffer + normal delay.

## What good looks like

- Explicit naming of delays in any feedback loop
- Response cadence calibrated to system response time (slower for slow systems)
- Patience with interventions that "haven't worked yet" — within a stated horizon
- Buffer stocks sized for the delays you actually have

## What bad looks like

- *"Why isn't the metric moving?"* — asked three days after a change
- Multiple simultaneous changes that destroy cause/effect attribution
- Reactive over-correction (product strategy oscillating quarter to quarter)
- Treating delays as "execution problems" rather than system structure

## Diagnostic questions

- What's the delay between intervention and observable result here?
- Are we measuring at intervals shorter than the system's response time?
- Where are we likely to over-correct because we didn't wait?
- What previous interventions might still be propagating, and how do we attribute correctly?

## Craft move

Name the delay *before* you act. Estimate, in days or weeks, how long until you can fairly evaluate the result. Until that time elapses, no second move on the same lever. The discipline of waiting is one of the most underrated systems skills.
