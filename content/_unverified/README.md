# Quarantine: drafts written while the web was unreachable

**Nothing in this directory may be seeded into the Convex `knowledge` table,
served by Charge, or published, until a human has verified it against primary
sources.** The directory name is the guard. `content/apprenticeships/` is the
verified corpus; this is not part of it.

## What these documents are

Research agents produced them on 2 September 2026, during a period when this
environment's egress policy denied every research domain (see
`../_meta/RESEARCH_BLOCKED.md`). `WebSearch` still returned results, so the
agents wrote from search-engine extracts rather than from pages they opened.

To their credit, each document says so - in an `evidence_quality` field, a
`Verification status` section, or a `> [!GAP]` block. They were not passing
guesswork off as fact.

## Why they are quarantined anyway

The front matter still records `accessed: 2026-09-02` and, in places,
`type: primary` for domains that were provably blocked at that moment. Metadata
that claims first-hand verification contradicts a body that disclaims it, and
metadata is what a seeding script reads. Anything downstream would treat these
as verified.

The specific risk is that these documents are *good*. They are well-structured,
confidently written and correctly formatted. That is exactly what makes an
unverified document dangerous rather than merely useless: nothing about its
appearance signals that its numbers were never checked.

Several claims are plausible but unconfirmed - wage rates, vacancy counts,
application windows, competitor pricing. Some may well be correct. None has
been checked against the source it cites.

## One document was edited before quarantine

`50-competitive/apprentago.md` originally carried biographical detail about a
named individual, including health, disability and housing history, assembled
from unverified search extracts. That is special-category data under UK GDPR,
it was not needed to assess a competitor's product or pricing, and it had no
place in a knowledge base a chatbot answers teenagers from. It was removed and
must not be reinstated. The company-level analysis was kept.

## How to promote a document out of quarantine

1. Open every URL in its `sources` list and confirm the page actually supports
   the claim that cites it.
2. Correct anything the source contradicts. Expect wage rates, deadlines and
   pricing to have drifted.
3. Set `accessed` to the date you really opened it, and set `type` honestly.
4. Delete the verification-limitation `[!GAP]` blocks, since they will no
   longer be true.
5. Run `python3 tools/corpus/verify.py --net` and clear every error.
6. Move it to the matching path under `content/apprenticeships/`.

Until then, treat every number in this directory as a lead to check, not a fact
to repeat.
