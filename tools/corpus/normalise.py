#!/usr/bin/env python3
"""
Normalise a research document pasted out of a Claude chat into corpus form.

Research is done in a chat with web access (see _meta/RESEARCH_BLOCKED.md) and
comes back with three cosmetic differences from what AUTHORING.md specifies:

  1. Citation-widget artifacts - [![](claude-citation:<base64>)](url) - which are
     pure UI noise. They are large, and every byte would be paid for on each
     query once the document is chunked and retrieved.
  2. Inline citations written [s1] rather than the footnote form [^s1].
  3. A Sources section written as a bullet list rather than footnote definitions.

None of that affects the research. This fixes the shape and leaves the substance
alone. Idempotent: running it twice changes nothing.

    python3 tools/corpus/normalise.py <file.md> [more.md ...]
"""
import re
import sys
from pathlib import Path

# [![](claude-citation:...)](https://...) - the whole widget, including a
# leading space so stripping does not leave double spaces before punctuation.
CITATION_WIDGET = re.compile(r"\s*\[!\[\]\(claude-citation:[^)]*\)\]\([^)]*\)")


def strip_widgets(text: str) -> tuple[str, int]:
    cleaned, n = CITATION_WIDGET.subn("", text)
    # Tidy the punctuation the widgets were wedged into.
    cleaned = re.sub(r" +([.,;:])", r"\1", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    return cleaned, n


def split_doc(text: str) -> tuple[str, str]:
    m = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return "", text
    return m.group(1), text[m.end():]


def normalise_front_matter(fm: str) -> str:
    # region: England -> england
    fm = re.sub(r"^region:\s*(.+)$",
                lambda m: f"region: {m.group(1).strip().strip(chr(34)).lower()}",
                fm, count=1, flags=re.MULTILINE)
    # A prose audience line becomes the list the spec asks for.
    if re.search(r"^audience:\s*[\"']?[A-Za-z]", fm, re.MULTILINE):
        fm = re.sub(r"^audience:.*$",
                    "audience: [school-leaver, sixth-former, parent, career-changer]",
                    fm, count=1, flags=re.MULTILINE)
    # topics as a block list -> inline list, so the shape matches other docs.
    def fold_topics(match: re.Match) -> str:
        items = re.findall(r"^\s+-\s+(.+)$", match.group(2), re.MULTILINE)
        slugs = [re.sub(r"[^a-z0-9]+", "-", i.strip().strip('"').lower()).strip("-") for i in items]
        return f"topics: [{', '.join(slugs)}]\n"
    fm = re.sub(r"^(topics:)\s*\n((?:\s+-\s+.+\n)+)", fold_topics, fm, count=1, flags=re.MULTILINE)
    # A colon-space inside an unquoted scalar breaks YAML, which happens often in
    # source titles ("... agreements: status"). Quote those values. A URL is safe
    # because "https://" has no space after its colon.
    def quote_if_needed(match: re.Match) -> str:
        indent, key, value = match.group(1), match.group(2), match.group(3).rstrip()
        if ": " not in value:
            return match.group(0)
        if value[:1] in {'"', "'", "|", ">", "[", "{", "&", "*"}:
            return match.group(0)
        return f'{indent}{key}: "{value.replace(chr(34), chr(39))}"'

    fm = re.sub(r"^(\s*)(?:- )?(\w+):[ \t]+(.+)$",
                lambda m: quote_if_needed(m) if not m.group(0).lstrip().startswith("- ")
                else m.group(0),
                fm, flags=re.MULTILINE)

    if "maintainer:" not in fm:
        fm = re.sub(r"^(last_verified:.*)$", r"\1\nmaintainer: gtod", fm, count=1, flags=re.MULTILINE)
    return fm


def normalise_body(body: str) -> tuple[str, int, int]:
    parts = re.split(r"^(## Sources\s*)$", body, maxsplit=1, flags=re.MULTILINE)
    main, sources_header, sources = (parts + ["", ""])[:3] if len(parts) == 3 else (body, "", "")

    # [s1] / [s1][s2] -> [^s1][^s2], leaving [^s1] alone if already converted.
    main, inline = re.subn(r"(?<!\^)\[(s\d+)\]", r"[^\1]", main)

    # "- s1 - Publisher, ..." or "- [s1] Publisher, ..." -> "[^s1]: Publisher, ..."
    def to_footnote(match: re.Match) -> str:
        return f"[^{match.group(1)}]: {match.group(2).strip()}"

    defs = 0
    if sources:
        sources, defs = re.subn(
            r"^-\s*\[?(s\d+)\]?\s*(?:[-—:]\s*)?(.+)$",
            to_footnote, sources, flags=re.MULTILINE)

    return (main + sources_header + sources), inline, defs


def main(paths: list[str]) -> int:
    for path in paths:
        p = Path(path)
        original = p.read_text(encoding="utf-8")
        text, widgets = strip_widgets(original)
        fm, body = split_doc(text)
        body, inline, defs = normalise_body(body)
        out = f"---\n{normalise_front_matter(fm)}\n---\n{body}" if fm else body
        p.write_text(out, encoding="utf-8")
        saved = len(original) - len(out)
        print(f"{p.name}: stripped {widgets} widgets ({saved:,} bytes), "
              f"{inline} inline citations, {defs} footnote definitions")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
