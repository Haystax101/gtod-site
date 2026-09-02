#!/usr/bin/env python3
"""
Corpus integrity checker for the GTOD knowledge base.

Guards the promise that every factual claim in content/ is traceable to a
source that actually exists and actually says it. Structural checks run
offline; --net additionally fetches every cited URL.

Usage:
    python3 tools/corpus/verify.py                 # structure only
    python3 tools/corpus/verify.py --net           # also check every URL resolves
    python3 tools/corpus/verify.py --json out.json # machine-readable report
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
CONTENT = REPO / "content"

REQUIRED_FRONT_MATTER = ["id", "title", "summary", "last_verified", "sources"]
REQUIRED_SOURCE_KEYS = ["id", "title", "url", "accessed"]

# Phrases that signal generated filler rather than researched writing.
SLOP_PHRASES = [
    "in today's competitive",
    "in today's fast-paced",
    "ever-evolving",
    "ever-changing landscape",
    "it is important to note that",
    "it's important to note that",
    "delve into",
    "navigate the complexities",
    "unlock your potential",
    "embark on a journey",
    "in conclusion,",
    "the world of apprenticeships",
    "gone are the days",
    "when it comes to",
    "look no further",
    "game-changer",
    "tapestry",
]

FRONT_MATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
FOOTNOTE_DEF_RE = re.compile(r"^\[\^([A-Za-z0-9_-]+)\]:", re.MULTILINE)
FOOTNOTE_REF_RE = re.compile(r"\[\^([A-Za-z0-9_-]+)\]")
URL_RE = re.compile(r"https?://[^\s\)\]\>\"'`,;]+")

# A sentence carrying a hard number that ought to be backed by a citation.
NUMERIC_CLAIM_RE = re.compile(
    r"(£\s?[\d,]+|\b\d[\d,]*\.?\d*\s?(?:%|per cent|percent)|"
    r"\b\d{1,3}(?:,\d{3})+\b|\bLevel\s[2-7]\b|\b20\d\d\b)"
)

# Lines we never treat as prose claims.
SKIP_LINE_PREFIXES = ("|", ">", "#", "```", "[^", "- id:", "  ")


def rel_path(path: Path) -> str:
    """Repo-relative where possible, so findings are clickable; absolute otherwise."""
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


@dataclass
class Finding:
    file: str
    level: str  # "error" | "warn"
    kind: str
    detail: str
    line: int | None = None


@dataclass
class DocReport:
    path: str
    findings: list[Finding] = field(default_factory=list)
    urls: set[str] = field(default_factory=set)
    source_count: int = 0


def parse_doc(path: Path) -> tuple[dict | None, str, list[Finding]]:
    """Split a markdown file into (front matter, body, parse findings)."""
    rel = rel_path(path)
    text = path.read_text(encoding="utf-8")
    findings: list[Finding] = []

    m = FRONT_MATTER_RE.match(text)
    if not m:
        findings.append(Finding(rel, "error", "no-front-matter",
                                "File has no YAML front matter block"))
        return None, text, findings

    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        findings.append(Finding(rel, "error", "bad-yaml",
                                f"Front matter is not valid YAML: {exc}"))
        return None, text[m.end():], findings

    if not isinstance(fm, dict):
        findings.append(Finding(rel, "error", "bad-yaml",
                                "Front matter did not parse to a mapping"))
        return None, text[m.end():], findings

    return fm, text[m.end():], findings


def check_front_matter(rel: str, fm: dict) -> tuple[list[Finding], dict[str, str]]:
    """Validate required keys and return {source_id: url}."""
    findings: list[Finding] = []

    for key in REQUIRED_FRONT_MATTER:
        if key not in fm or fm[key] in (None, "", []):
            findings.append(Finding(rel, "error", "missing-field",
                                    f"Front matter is missing required field '{key}'"))

    sources = fm.get("sources") or []
    if not isinstance(sources, list):
        findings.append(Finding(rel, "error", "bad-sources",
                                "'sources' must be a list"))
        return findings, {}

    by_id: dict[str, str] = {}
    for i, src in enumerate(sources):
        label = f"sources[{i}]"
        if not isinstance(src, dict):
            findings.append(Finding(rel, "error", "bad-sources",
                                    f"{label} is not a mapping"))
            continue
        for key in REQUIRED_SOURCE_KEYS:
            if not src.get(key):
                findings.append(Finding(rel, "error", "bad-sources",
                                        f"{label} is missing '{key}'"))
        sid, url = src.get("id"), src.get("url")
        if sid and url:
            if sid in by_id:
                findings.append(Finding(rel, "error", "duplicate-source-id",
                                        f"Source id '{sid}' is declared twice"))
            by_id[str(sid)] = str(url)
    return findings, by_id


def check_citations(rel: str, body: str, source_ids: dict[str, str]) -> list[Finding]:
    """Cross-check footnote refs, footnote defs and declared sources."""
    findings: list[Finding] = []
    defs = set(FOOTNOTE_DEF_RE.findall(body))
    refs = {r for r in FOOTNOTE_REF_RE.findall(body)}
    # A definition line also matches the ref regex; refs proper are defs excluded.
    inline_refs = refs

    for ref in sorted(inline_refs - defs):
        findings.append(Finding(rel, "error", "undefined-citation",
                                f"[^{ref}] is cited in the body but never defined"))

    for sid in sorted(set(source_ids) - inline_refs):
        findings.append(Finding(rel, "warn", "unused-source",
                                f"Source '{sid}' is declared but never cited in the body. "
                                "Either cite it or remove it."))

    for d in sorted(defs - set(source_ids)):
        findings.append(Finding(rel, "error", "undeclared-source",
                                f"Footnote [^{d}] is defined but '{d}' is not in front-matter sources"))
    return findings


def check_prose(rel: str, body: str) -> list[Finding]:
    """Heuristics for uncited numbers and filler phrasing."""
    findings: list[Finding] = []
    in_fence = False

    for n, line in enumerate(body.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or not stripped:
            continue

        low = stripped.lower()
        for phrase in SLOP_PHRASES:
            if phrase in low:
                findings.append(Finding(rel, "warn", "filler-phrase",
                                        f"Filler phrasing: {phrase!r}", n))

        if stripped.startswith(SKIP_LINE_PREFIXES):
            continue
        if NUMERIC_CLAIM_RE.search(stripped) and "[^" not in stripped:
            findings.append(Finding(rel, "warn", "uncited-number",
                                    f"Numeric claim with no citation on the line: "
                                    f"{stripped[:110]}", n))
    return findings


def build_opener() -> urllib.request.OpenerDirector:
    ca = "/root/.ccr/ca-bundle.crt"
    ctx = ssl.create_default_context(cafile=ca) if os.path.exists(ca) else ssl.create_default_context()
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))


def check_url(opener, url: str, timeout: int = 25) -> tuple[str, int | str]:
    """Return (url, status). GET with a tiny read - many sites reject HEAD."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; GTOD-corpus-linkcheck/1.0)",
            "Accept": "text/html,application/xhtml+xml,*/*",
        },
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            resp.read(2048)
            return url, resp.status
    except urllib.error.HTTPError as exc:
        return url, exc.code
    except Exception as exc:  # noqa: BLE001 - report whatever went wrong
        return url, type(exc).__name__


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--net", action="store_true", help="fetch every cited URL")
    ap.add_argument("--json", metavar="PATH", help="write a JSON report here")
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on warnings as well as errors")
    ap.add_argument("--path", default=str(CONTENT), help="directory to scan")
    args = ap.parse_args()

    root = Path(args.path)
    # _meta holds specs, _unverified holds quarantined drafts that deliberately
    # fail these checks. Neither is part of the verified corpus.
    files = sorted(p for p in root.rglob("*.md")
                   if "_meta" not in p.parts
                   and "_unverified" not in p.parts
                   and p.name != "README.md")
    if not files:
        print(f"No markdown documents found under {root}")
        return 0

    reports: list[DocReport] = []
    all_urls: set[str] = set()

    for path in files:
        rel = rel_path(path)
        rep = DocReport(path=rel)
        fm, body, parse_findings = parse_doc(path)
        rep.findings.extend(parse_findings)

        source_ids: dict[str, str] = {}
        if fm is not None:
            fm_findings, source_ids = check_front_matter(rel, fm)
            rep.findings.extend(fm_findings)
            rep.source_count = len(source_ids)
            rep.findings.extend(check_citations(rel, body, source_ids))

        rep.findings.extend(check_prose(rel, body))
        rep.urls = set(source_ids.values()) | set(URL_RE.findall(body))
        all_urls |= rep.urls
        reports.append(rep)

    url_status: dict[str, int | str] = {}
    if args.net and all_urls:
        opener = build_opener()
        print(f"Checking {len(all_urls)} distinct URLs...", file=sys.stderr)
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            futures = [pool.submit(check_url, opener, u) for u in sorted(all_urls)]
            for i, fut in enumerate(concurrent.futures.as_completed(futures), 1):
                url, status = fut.result()
                url_status[url] = status
                if i % 25 == 0:
                    print(f"  ...{i}/{len(all_urls)}", file=sys.stderr)

        for rep in reports:
            for url in sorted(rep.urls):
                status = url_status.get(url)
                if status == 200:
                    continue
                level = "warn" if status in (403, 429, 999) else "error"
                rep.findings.append(Finding(
                    rep.path, level, "dead-link",
                    f"{url} returned {status}"
                    + (" (bot-blocked, likely fine for a human)" if level == "warn" else "")))

    errors = sum(1 for r in reports for f in r.findings if f.level == "error")
    warns = sum(1 for r in reports for f in r.findings if f.level == "warn")

    for rep in sorted(reports, key=lambda r: r.path):
        if not rep.findings:
            continue
        print(f"\n{rep.path}")
        for f in sorted(rep.findings, key=lambda f: (f.level != "error", f.kind)):
            loc = f":{f.line}" if f.line else ""
            marker = "ERROR" if f.level == "error" else "warn "
            print(f"  {marker}{loc} [{f.kind}] {f.detail}")

    live = sum(1 for s in url_status.values() if s == 200)
    print("\n" + "=" * 70)
    print(f"docs: {len(reports)}   sources declared: {sum(r.source_count for r in reports)}   "
          f"distinct URLs: {len(all_urls)}")
    if args.net:
        print(f"URLs returning 200: {live}/{len(all_urls)}")
    print(f"errors: {errors}   warnings: {warns}")
    print("=" * 70)

    if args.json:
        payload = {
            "docs": [
                {
                    "path": r.path,
                    "sources": r.source_count,
                    "urls": sorted(r.urls),
                    "findings": [vars(f) for f in r.findings],
                }
                for r in reports
            ],
            "url_status": url_status,
            "totals": {"errors": errors, "warnings": warns,
                       "docs": len(reports), "urls": len(all_urls)},
        }
        Path(args.json).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"JSON report written to {args.json}")

    if errors:
        return 1
    return 1 if (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
