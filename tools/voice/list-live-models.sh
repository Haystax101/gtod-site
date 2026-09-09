#!/usr/bin/env bash
# Which Gemini models can actually run a Live (bidirectional audio) session?
#
# Do not take a model id from documentation, a blog post, or an assistant's
# recollection. The list changes, models get retired, and only a subset of any
# generation supports bidiGenerateContent. This asks your key directly, which is
# the only answer that is true for your project today.
#
#   GEMINI_API_KEY=... tools/voice/list-live-models.sh
#
# Whatever it prints is what belongs in VITE_VOICE_MODEL.
set -euo pipefail

: "${GEMINI_API_KEY:?Set GEMINI_API_KEY first (do not paste it into a chat)}"

echo "Models supporting bidiGenerateContent (Live):"
echo

curl -sS "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
| python3 -c '
import json, sys
data = json.load(sys.stdin)
if "error" in data:
    print("  API error:", data["error"].get("message", data["error"]))
    sys.exit(1)
models = data.get("models", [])
live = [m for m in models
        if "bidiGenerateContent" in (m.get("supportedGenerationMethods") or [])]
if not live:
    print("  none found - check the key has Gemini API access")
    print(f"  ({len(models)} models visible in total)")
    sys.exit(1)
for m in live:
    name = m.get("name", "").replace("models/", "")
    print(f"  {name}")
    if m.get("displayName"):
        print(f"      {m['displayName']}")
    ins, outs = m.get("inputTokenLimit"), m.get("outputTokenLimit")
    if ins or outs:
        print(f"      tokens in/out: {ins}/{outs}")
print()
print(f"  {len(live)} Live-capable of {len(models)} total")
'

cat <<'NOTE'

Next, before enabling voice:
  1. Put the chosen id in VITE_VOICE_MODEL and rebuild.
  2. Find that model's per-minute audio rate on the pricing page.
  3. python3 tools/cost/model.py --voice-rate-per-min <rate> --heavy-user
     If the margin is negative, lower VOICE_MINUTES_PRO until it is not.
NOTE
