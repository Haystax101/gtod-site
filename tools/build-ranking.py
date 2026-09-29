#!/usr/bin/env python3
"""
Turn a standalone consensus-ranking HTML file into a page for the site.

    python3 tools/build-ranking.py <source.html> <slug> "<Subject>"

Takes the self-contained page (Literata/Figtree, own light+dark theme) and
rewrites it to match the site: site header and footer, the shared
/rankings/rankings.css, an eyebrow and back link, page metadata. The table
markup and all of the page's JavaScript are carried over untouched, so the
sliders, sorting, filters and detail rows behave exactly as they did.

The light/dark toggle is removed: the rest of the site is dark only.

Writes public/rankings/<slug>/index.html.
"""
import re, sys, pathlib

def build(src_path: str, slug: str, subject: str) -> str:
    src = pathlib.Path(src_path).read_text()

    after_style = src.split('</style>', 1)[1]
    body = after_style.split('</head>', 1)[1]
    markup, js = body.split('<script>', 1)
    js = js.rsplit('</script>', 1)[0]
    markup = markup.replace('<body>', '').strip()

    # Drop the theme toggle button and the two lines of script behind it.
    # Remove the button's own line only; eating the preceding newline would
    # break the '<header>\n  <h1>' anchor used for the back link below.
    markup = re.sub(r'[ \t]*<button class="theme"[^>]*>.*?</button>\n', '', markup)
    js = re.sub(r'document\.getElementById\("theme"\)\.addEventListener.*?\n', '', js)
    js = re.sub(r'\(\(\)=>\{const t=store\.get\("[a-z]+-theme"\).*?\n', '', js)
    if 'theme' in markup or '-theme' in js:
        raise SystemExit('theme toggle not fully removed — check the source markup')

    # Back link + eyebrow above the headline, and highlight the last phrase.
    markup = markup.replace(
        '<header>\n  <h1>',
        f'<header>\n  <a class="backlink" href="/rankings/">&larr; All rankings</a>\n'
        f'  <p class="eyebrow">Rankings &middot; <b>{subject}</b></p>\n  <h1>', 1)
    markup = re.sub(r'(<h1>.*?)one ranking</h1>', r'\1<span class="hl">one ranking</span></h1>', markup, count=1)

    url = f'https://getthereoneday.com/rankings/{slug}/'
    head = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>UK {subject} Rankings: a consensus ranking | Get There One Day</title>
<meta name="description" content="Four UK league tables for {subject.lower()}, blended into one ranking you can re-weight yourself. Complete University Guide, Guardian, QS and THE, side by side.">
<meta name="theme-color" content="#121010">
<link rel="canonical" href="{url}">
<meta property="og:title" content="UK {subject.lower()}: a consensus ranking">
<meta property="og:description" content="Four league tables, one ranking. Drag the weights to change what counts.">
<meta property="og:type" content="article">
<meta property="og:url" content="{url}">
<meta property="og:site_name" content="Get There One Day">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/rankings/rankings.css">
</head>
<body>

<header class="sitehead">
  <div class="nav">
    <div class="nav-logo"><img src="/assets/logo.png" alt="Get There One Day logo"></div>
    <a class="nav-name" href="/">Get There <span>One Day</span></a>
    <nav>
      <a href="/rankings/" aria-current="page">Rankings</a>
      <a href="/#podcast">Podcast</a>
      <a href="/#follow">Follow</a>
      <a class="hl" href="/#ask">Ask a question &rarr;</a>
    </nav>
  </div>
</header>

'''
    foot = '''
<footer class="sitefoot">
  <a href="/rankings/">All rankings</a> &nbsp;&middot;&nbsp; <a href="/">Get There One Day</a> &nbsp;&middot;&nbsp; &copy; 2026 &nbsp;&middot;&nbsp; One day at a time
</footer>

<script>
''' + js + '''</script>
</body>
</html>
'''
    return head + markup + foot


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    source, slug, subject = sys.argv[1:4]
    out = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'rankings' / slug / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    html = build(source, slug, subject)
    out.write_text(html)
    print(f'wrote {out} ({len(html):,} chars)')
