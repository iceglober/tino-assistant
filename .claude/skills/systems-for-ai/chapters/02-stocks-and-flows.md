# Ch. 2 — Stocks and flows

A **stock** is what accumulates. A **flow** is what changes it.

Users are a stock; signups and churn are flows. Cash is a stock; revenue and expenses are flows. Technical debt is a stock; new debt added and debt paid down are flows. Trust is a stock; trust-building and trust-violating events are flows.

The reason this distinction matters: people confuse the two constantly, and the confusion has expensive consequences.

*"Conversion is down 5%"* is a flow statement. *"We have 100,000 active users"* is a stock statement. Strategies that move flows take time to show in stocks. Stocks change slowly; they have inertia.

A stock heading the wrong way doesn't reverse instantly when you change the flow. If churn is high and you fix the product on Monday, you won't see the user-base recover for months — even though the *flow* (churn rate) reverses on day one. The stock has inertia. Leaders who don't understand this fire the team that fixed the problem because the visible metric hadn't moved yet.

Likewise: a stock heading the right way can mask underlying flow problems. Active users can keep climbing for years while the *rate* of new signups is collapsing. By the time the stock falls, you're months too late to act.

This is also where **buffer stocks** matter. Cash reserves, runway, slack capacity, goodwill, attention budget. Buffer stocks let a system absorb delays and shocks. Run lean on buffers and any delay (Ch. 5) becomes a crisis.

## What good looks like

- Reports distinguish stocks (cumulative levels) from flows (rates of change)
- Forecasts use flow analysis, not stock trends
- Leading indicators are flow-based; lagging indicators are stock-based
- Buffer stocks consciously sized, not accidentally drained

## What bad looks like

- Cumulative growth mistaken for current rate (*"a million users!"* while signups crash)
- Setting flow-targets without considering stock-inertia (*"reduce churn 50% this quarter"* — even if the flow reverses, the stock catches up slowly)
- Buffer stocks ignored until the first delay turns into a crisis
- Stock trends extrapolated as if the underlying flows are stable

## Diagnostic questions

- For each metric on the dashboard: is this a stock or a flow?
- What stocks does this system contain? What flows in, what flows out?
- Which stocks have dangerous inertia (slow to reverse direction)?
- What buffer stocks (cash, time, attention, goodwill) does this system rely on, and how full are they?

## Craft move

Name the stocks before the flows. Most product decisions are framed in flow terms (*"how do we boost activation?"*) when the real question is about stocks (*"what's the addressable engagement pool, and how long until it runs dry?"*). Stock-thinking changes the answer.
