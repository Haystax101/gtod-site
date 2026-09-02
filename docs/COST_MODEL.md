# Cost model: making £10 a no-brainer without bleeding money

The rule is simple and absolute: **no user can cost more than they pay.** Voice
is where that rule gets tested, because realtime audio is the most expensive
thing we will ever serve.

## The problem with voice

Text chat costs are small and self-limiting: a user types, waits, reads. Voice
is different. A 15-minute call streams audio continuously in both directions.
Where a text message might cost a fraction of a penny, a call is metered by the
minute and a handful of long calls can eat a month's margin on their own.

So voice is budgeted in **minutes**, not tokens:

- Minutes are what a user understands ("you have 42 minutes left this month").
- Minutes can be hard-stopped mid-session. Tokens cannot, cleanly.
- Minutes convert to cost through one number we can update when rates change.

## What a Pro user can cost us

£10/month, minus Stripe fees, leaves roughly £9.20. The existing code already
caps total model spend per Pro user at `monthlyCostMicros` ($8). Voice draws
from that same envelope rather than a separate one, so the ceiling holds no
matter which features a user leans on.

Run the numbers yourself, with real rates, using:

```
python3 tools/cost/model.py --voice-rate-per-min 0.05 --pro-voice-minutes 60
```

> [!IMPORTANT]
> **The default rates in that script are placeholders, not verified prices.**
> This environment cannot reach any provider pricing page. Before launch,
> replace them with the real published rate for the exact model in use and
> re-run. Every conclusion below moves with that number.

## The safety mechanisms, in the order they fire

1. **Per-session hard cap.** A call cannot exceed `maxSessionMinutes`
   (default 15). The server mints a credential whose TTL enforces this even if
   the client misbehaves.
2. **Per-month minute budget.** Checked before a session is minted, and
   decremented as the session runs. Pro default 60 minutes; Flash gets a short
   trial so the feature can be experienced before paying.
3. **The existing monthly cost cap.** Voice spend is written into the same
   `usage.costMicros` ledger as chat. If a user somehow burns the envelope on
   text, voice stops too, and vice versa.
4. **Concurrency limit.** One live session per user. Prevents both accidental
   double-billing and the obvious abuse.

Because 1 and 2 are enforced **before** the provider is called, the worst case
for a single user is bounded by arithmetic rather than by trust.

## Why this is still a no-brainer at £10

The value story does not depend on unlimited voice. It depends on voice
existing at all, because nobody else in this market has it:

- **Interview prep as a phone call** is the single most-requested thing a
  nervous 17-year-old wants and the hardest to get. A mock interview with a
  human costs £50+ an hour if you can find one.
- **Check-in calls** turn a passive tool into something that chases you, which
  is the difference between a one-visit product and a habit.
- Everything else in Pro (unlimited coaching, the full timeline, the answer
  bank) is text-cheap and margin-safe.

60 minutes a month is roughly four 15-minute mock interviews. That is more
practice than most applicants get in a whole cycle.

## Free tier

Free must be genuinely useful or the funnel dies:

- Timeline and weekly tasks: free. This is the habit loop and it costs us
  almost nothing.
- Answer bank storage: free.
- Charge text coaching: the existing daily message cap.
- Voice: a short trial, then Pro.

The timeline being free is a deliberate choice. It is the thing that brings
someone back weekly, and a returning free user converts far better than a
one-visit stranger.
