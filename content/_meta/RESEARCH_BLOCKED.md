# Blocker: research domains are denied by the network egress policy

**Status as at 2 September 2026: the research corpus cannot be written.**
Not a tooling problem and not a model problem - the environment cannot reach
any of the sources the corpus is required to cite.

## Evidence

Three independent confirmations:

1. `WebFetch` on `https://www.gov.uk/national-minimum-wage-rates` returns
   `EGRESS_BLOCKED`.
2. `curl -sS "$HTTPS_PROXY/__agentproxy/status"` lists `connect_rejected`
   entries - "gateway answered 403 to CONNECT (policy denial or upstream
   failure)" - for `www.gov.uk`, `www.deloitte.com`, `www.pwc.co.uk`,
   `www.shl.com`, `www.jobtestprep.com` and others.
3. Two research agents independently probed dozens of hosts and found every
   source tier in `AUTHORING.md` blocked, while `github.com` and the package
   registries resolve normally.

The proxy's `noProxy` allowlist is scoped to developer infrastructure: the
Anthropic API, npm, PyPI, crates.io, the Go module proxy, and private ranges.
Public research domains are not on it.

A 403 from the gateway is an organisation policy denial. Per
`/root/.ccr/README.md` it is to be reported, not routed around. No workaround
was attempted and none should be.

## Why nothing was written instead of "something"

`WebSearch` still works, but it returns titles, URLs and a model-written
summary of snippets. That fails the corpus rules deliberately:

- `AUTHORING.md` #2 - the writer must have actually opened the URL cited.
- `RESEARCH_BRIEF.md` - "A search snippet is not a source."

The risk is concrete, not theoretical. A search for the current apprentice
minimum wage returned mostly SEO content-farm pages (training providers and
wage-calculator sites) asserting a specific rate change. That claim may well
be correct, but the primary sources that would settle it - GOV.UK and the
relevant statutory instrument on legislation.gov.uk - are exactly what is
blocked.

Writing from those snippets would produce documents that look identical to
verified ones: correct front matter, footnotes, confident prose. They would
then be seeded into the Convex `knowledge` table and served to 16-year-olds by
Charge as fact, with nothing downstream able to tell the difference. That is
the precise failure the corpus exists to prevent.

## What unblocks it

The environment's network policy is chosen when the environment is created.
See https://code.claude.com/docs/en/claude-code-on-the-web

Minimum useful allowlist, in priority order:

**Tier 1 - primary sources (essential)**
`*.gov.uk` (covers `www.gov.uk`, `findapprenticeship.service.gov.uk`,
`legislation.gov.uk`, `assets.publishing.service.gov.uk`,
`explore-education-statistics.service.gov.uk`, `nidirect.gov.uk`, `gov.wales`),
`skillsengland.education.gov.uk`, `ucas.com`, `apprenticeships.scot`,
`ons.gov.uk`, `ifs.org.uk`

`assets.publishing.service.gov.uk` matters disproportionately: the
apprenticeship funding rules and Skills England documents that settle the
current policy position are PDFs hosted there.

**Tier 2 - employer careers pages (essential for the employer directory)**
`deloitte.com`, `pwc.co.uk`, `ey.com`, `kpmgcareers.co.uk`,
`grantthornton.co.uk`, `bdo.co.uk`, `rsmuk.com`, `home.barclays`,
`lloydsbankinggroup.com`, `natwestgroup.com`, `hsbc.com`, `santander.co.uk`,
`goldmansachs.com`, `jpmorgan.com`, `bankofengland.co.uk`, `aviva.com`,
`axa.co.uk`, `baesystems.com`, `rolls-royce.com`, `airbus.com`, `ibm.com`,
`microsoft.com`, `bt.com`, `nationalgrid.com`, `nhs.uk`,
`civilservicejobs.service.gov.uk`, `bbc.co.uk`

**Tier 3 - professional bodies and assessment publishers**
`icaew.com`, `accaglobal.com`, `cimaglobal.com`, `cii.co.uk`, `sra.org.uk`,
`lawsociety.org.uk`, `shl.com`, `cappfinity.com`, `arcticshores.com`

**Tier 4 - aggregators and competitors (for the competitive analysis)**
`ratemyapprenticeship.co.uk`, `getmyfirstjob.co.uk`, `notgoingtouni.co.uk`,
`springpod.com`, `amazingapprenticeships.com`, `apprentago.com`

## What was still possible while blocked

- `content/_meta/AUTHORING.md` - the corpus authoring spec
- `content/_meta/RESEARCH_BRIEF.md` - the shared research brief
- `tools/corpus/verify.py` - the citation verifier, fixture-tested

All three are ready. The moment egress opens, research can start immediately
against a defined standard rather than being designed from scratch.
