#!/usr/bin/env python3
"""
Unit economics for a Charge Pro subscriber.

Every rate below is a PLACEHOLDER. This environment cannot reach provider
pricing pages, so before trusting any output you must pass the real published
rates. The point of this script is that swapping them is one flag, and every
conclusion recomputes.

    python3 tools/cost/model.py --voice-rate-per-min 0.05
    python3 tools/cost/model.py --voice-rate-per-min 0.05 --pro-voice-minutes 90 --heavy-user
"""
import argparse

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--price-gbp", type=float, default=10.0, help="monthly subscription price")
    p.add_argument("--gbp-per-usd", type=float, default=0.79, help="UNVERIFIED placeholder FX rate")
    p.add_argument("--stripe-pct", type=float, default=0.029)
    p.add_argument("--stripe-fixed-gbp", type=float, default=0.20)
    p.add_argument("--voice-rate-per-min", type=float, default=0.05,
                   help="USD per minute of live audio. PLACEHOLDER - set the real rate.")
    p.add_argument("--pro-voice-minutes", type=int, default=60)
    p.add_argument("--text-msgs-per-month", type=int, default=300,
                   help="Pro daily cap is 150; 300/month is a realistic heavy user")
    p.add_argument("--input-tokens-per-msg", type=int, default=6000,
                   help="system prompt + retrieved extracts + history, with retrieval on")
    p.add_argument("--output-tokens-per-msg", type=int, default=400)
    p.add_argument("--input-usd-per-m", type=float, default=2.0, help="PLACEHOLDER")
    p.add_argument("--output-usd-per-m", type=float, default=6.0, help="PLACEHOLDER")
    p.add_argument("--heavy-user", action="store_true",
                   help="model a user who exhausts every cap")
    args = p.parse_args()

    net_gbp = args.price_gbp * (1 - args.stripe_pct) - args.stripe_fixed_gbp
    net_usd = net_gbp / args.gbp_per_usd

    voice_min = args.pro_voice_minutes if args.heavy_user else args.pro_voice_minutes * 0.35
    msgs = args.text_msgs_per_month if args.heavy_user else args.text_msgs_per_month * 0.4

    voice_usd = voice_min * args.voice_rate_per_min
    text_usd = msgs * (
        args.input_tokens_per_msg / 1_000_000 * args.input_usd_per_m
        + args.output_tokens_per_msg / 1_000_000 * args.output_usd_per_m
    )
    total = voice_usd + text_usd

    label = "HEAVY user (every cap exhausted)" if args.heavy_user else "TYPICAL user"
    print(f"\n{label}")
    print("-" * 52)
    print(f"  revenue after Stripe      £{net_gbp:6.2f}  (${net_usd:6.2f})")
    print(f"  voice  {voice_min:5.1f} min           ${voice_usd:6.2f}")
    print(f"  text   {msgs:5.0f} messages      ${text_usd:6.2f}")
    print(f"  total cost                ${total:6.2f}")
    margin = net_usd - total
    pct = (margin / net_usd * 100) if net_usd else 0
    print(f"  margin                    ${margin:6.2f}  ({pct:.0f}%)")
    if margin < 0:
        print("\n  LOSS-MAKING at these rates. Reduce --pro-voice-minutes until positive.")
        breakeven = (net_usd - text_usd) / args.voice_rate_per_min if args.voice_rate_per_min else 0
        print(f"  Break-even voice allowance: {breakeven:.0f} minutes/month")
    else:
        headroom = margin / args.voice_rate_per_min if args.voice_rate_per_min else 0
        print(f"\n  Headroom: {headroom:.0f} more voice minutes before break-even.")
    print("\n  Rates above are PLACEHOLDERS. Verify before trusting this.\n")


if __name__ == "__main__":
    main()
