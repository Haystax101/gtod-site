# Inbox: drop raw research here

Paste or save research documents into this folder exactly as they come out of
the research chat. Nothing here is part of the corpus yet, and nothing here is
served to anyone.

## Why this folder and not one of the others

| Folder | What it holds |
|---|---|
| `content/inbox/` | raw, unprocessed research. **Drop files here.** |
| `content/apprenticeships/` | the verified corpus. Only documents that pass `verify.py`. |
| `content/_unverified/` | quarantined drafts written without source access. Not served. |
| `convex/content/` | TypeScript modules seeded into Convex (the playbook, the scheme list). **Not for research markdown.** |

## The pipeline

```bash
# 1. Fix the mechanical differences between a research chat's output and the
#    corpus format: citation widgets, [s1] to [^s1], bullet sources to
#    footnotes, unquoted colons in YAML.
python3 tools/corpus/normalise.py content/inbox/*.md

# 2. Check it. --net fetches every cited URL, which is the check that matters.
python3 tools/corpus/verify.py --path content/inbox --net

# 3. Move what passes into the corpus, then re-chunk.
mv content/inbox/<file>.md content/apprenticeships/<section>/
npx convex run knowledge:reindex
```

Sections under `content/apprenticeships/`: `00-foundations`, `10-applying`,
`20-employers`, `30-sectors`, `40-support`, `50-competitive`.

## What "passes" means

Zero errors from `verify.py`. Warnings are usually fine - they flag numbers on a
line with no citation, which catches real omissions but also fires on summary
sentences and `**GTOD take:**` lines.

Do not move a document across while `--net` reports a dead link. A citation that
does not resolve is worse than no citation, because it looks verified.

Files left in this folder are ignored by the corpus tooling, so a
half-finished document can sit here safely.
