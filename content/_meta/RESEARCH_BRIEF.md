# Shared research brief

Read this together with `AUTHORING.md` before writing anything. Every research
agent working on this corpus follows both.

## Who this is for

Get There One Day (GTOD) is a UK community and podcast for ambitious young
people, especially degree apprentices. The reader is typically 16 to 19, in
year 12 or 13, deciding between an apprenticeship and university, or already
applying. Write for them: plain English, concrete, no hedging, no careers-
adviser waffle.

## What this corpus is for

It becomes the knowledge base behind "Charge", a chatbot in the GTOD React app
(Convex backend, `knowledge` table). Documents are seeded as `{slug, title,
content}`. That has two consequences:

1. `id` in front matter is the Convex `slug`. Keep it stable and unique.
2. Every enabled document currently goes straight into the model's system
   prompt, so padding is not free - it costs money on every single message.
   Write dense, factual prose. No filler.

## What already exists (do not duplicate)

`convex/content/playbook.ts` holds the Degree Apprenticeship Playbook written
by Charlie and George: first-person craft advice on CVs, cover letters,
assessment centres and interviews. That is GTOD's own voice and stays as it is.

This corpus is the **sourced factual base underneath it**: what the rules
actually are, what things actually pay, which employers actually run schemes,
and what the evidence actually shows. Where our advice and a source disagree,
say so plainly rather than papering over it.

## Write files incrementally

**Write each document to disk as soon as you have researched it. Do not hold
work in memory and write everything at the end.** A run that is interrupted
must leave finished documents behind. After each file, move on to the next.

## Research method

1. `WebSearch` to find candidate sources.
2. `WebFetch` every URL you intend to cite, and confirm the page actually
   contains the claim. A search snippet is not a source.
3. Record the URL and today's date in front matter.
4. If a fetch fails, do not cite the URL. Find another source or record a gap.

## Honesty rules

- Never invent a number, a deadline, an entry requirement or a URL.
- `Not stated` is a perfectly good answer. So is a `> [!GAP]` block.
- Distinguish "the source says X" from "we think X". The latter is
  `**GTOD take:**`.
- Prefer a short, fully-sourced document over a long, half-sourced one.
