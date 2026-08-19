# Privacy Compliance

Behavioural cookie-consent testing. The scanner drives each site's banner for real — reject,
accept, analytics-only, returning visitor — and asserts that trackers actually stop and start.

This is deliberately different from the Marketing Pixels check in the same report, which only
asks whether a CMP is *present*. A banner that renders but doesn't block anything passes that
check and fails almost every test here.

> **This tool reports technical behaviour, not legal compliance.** "Meta Pixel fired before
> consent" is a fact. Whether that violates a given statute in a given jurisdiction is a question
> for counsel, and no output here should be presented as a legal opinion.

---

## Running it

```bash
pnpm barrel-audit consent-scan                      # every active site in sites.yml
pnpm barrel-audit consent-scan waterloo             # one registry entry, by slug
pnpm barrel-audit consent-scan https://example.com  # ad hoc, not in the registry
pnpm barrel-audit consent-scan --inventory          # which CMP is where, no behavioural tests
pnpm barrel-audit consent-scan --seed               # draft sites.yml from stores/
```

Useful flags: `--concurrency <n>` (default 4), `--json <path>`, `--junit <path>` for CI,
`--no-upload` to skip Blob and evidence screenshots, `--no-retry` to skip blocker confirmation.

A single site takes about 90 seconds — five browser states plus a GPC probe, each in its own
fresh incognito context. The scan exits non-zero when any blocker-severity test fails, so it can
gate CI unchanged.

Privacy Compliance also runs as part of a normal `barrel-audit run`, appearing as its own report section.
Skip it with `--skip-consent`.

In Claude Code, `/consent-scan` runs the scan and explains the failures in plain English.

---

## The registry — `sites.yml`

The reviewable source of truth at the repo root. Only `status: active` entries are scanned.

```yaml
sites:
  - slug: drinkwaterloo-com
    client: Waterloo
    url: https://www.drinkwaterloo.com/
    repo: barrel/waterloo
    cmp: cookiebot         # pins the adapter; "unknown" auto-detects
    regions: [us]
    expect:
      banner: true
      preConsentMarketing: false
      consentModeV2: true
    owner: nick.meyer@barrelny.com
    status: active
```

`--seed` adds entries from `stores/*/config.json` and never modifies one that already exists —
hand-edits always win. It strips query strings, because a store's recorded URL is often a Shopify
theme-preview link pointing at an *unpublished* theme, and it pauses `*.myshopify.com` hosts,
which are staging domains rather than the storefront a shopper sees.

**The registry's known blind spot:** a theme repo almost never contains its own production
domain, so repos can't be resolved to URLs automatically. `--seed --from-repos` lists the repos it
couldn't place so they're visible rather than silently missing. Adding those by hand, once, is the
whole setup cost.

---

## The test plan

Severity drives the exit code: only a **blocker** fails the run.

### Suite A · Presence
| ID | Test | Severity |
|----|------|----------|
| A1 | CMP script loads successfully (not 404 / expired domain-group ID) | blocker |
| A2 | Banner is visible on a clean load | blocker |
| A3 | Reject offered at the same prominence as Accept | warning |
| A4 | No console errors from the CMP | warning |

### Suite B · Pre-consent (state S0)
| ID | Test | Severity |
|----|------|----------|
| B1 | No marketing cookies before any interaction | blocker |
| B2 | No marketing network calls before any interaction | blocker |
| B3 | No analytics cookies or calls before any interaction | error |
| B4 | Google Consent Mode v2 default is `denied` | error |

### Suite C · Reject (S1)
| ID | Test | Severity |
|----|------|----------|
| C1 | Marketing trackers do not fire after reject | blocker |
| C2 | Non-essential cookies set before the choice are cleared | error |
| C3 | Consent Mode update fires with denied signals | error |
| C4 | Shopify Customer Privacy API reflects the rejection | error |

### Suite D · Accept (S2)
| ID | Test | Severity |
|----|------|----------|
| D1 | Expected trackers **do** fire after accept | error |
| D2 | Consent Mode update grants all four v2 signals | error |
| D3 | Shopify Customer Privacy API reflects the acceptance | error |

D1 is the false-negative guard. A CMP that blocks everything permanently passes all of Suite C
and is still broken — it's silently destroying attribution.

### Suite E · Persistence
| ID | Test | Severity |
|----|------|----------|
| E1 | The choice survives a reload | error |
| E2 | The choice survives navigation | error |
| E3 | Banner does not re-prompt a consented visitor | warning |
| E4 | Banner returns after cookies are cleared | warning |

### Suite F · Granular (S3, analytics only)
| ID | Test | Severity |
|----|------|----------|
| F1 | Analytics is allowed through | error |
| F2 | Marketing stays blocked | error |

### Suite G · Compliance surface
| ID | Test | Severity |
|----|------|----------|
| G1 | Privacy policy link present and reachable | warning |
| G2 | Preference centre can be reopened after a choice | warning |
| G3 | "Do Not Sell or Share" link present (US) | warning |
| G4 | Global Privacy Control is honoured | warning |

### Result states

| State | Meaning |
|-------|---------|
| `pass` | Asserted and held |
| `fail` | Asserted and did not hold |
| `blocked` | **Not proven either way** — site down, bot-walled, or the banner never appeared |
| `skipped` | The CMP genuinely has no such capability, or `sites.yml` records an exception |
| `flaky` | The two runs disagreed; treat as unconfirmed |

`blocked` is never a compliance finding. Conflating "we couldn't test it" with "it failed" is the
fastest way for a report like this to lose its audience.

---

## How it works

**Five browser states**, each in a brand-new incognito context so no cookie or storage bleed can
make "did rejecting change anything?" unanswerable:

| State | Setup |
|-------|-------|
| `clean` | Load, touch nothing. The baseline. |
| `reject` | Reject-all via the CMP |
| `accept` | Accept-all via the CMP |
| `granular` | Analytics yes, marketing no |
| `returning` | Accept, then reload and navigate |

Plus a GPC probe that loads the page broadcasting `Sec-GPC: 1` and
`navigator.globalPrivacyControl` without making any choice at all.

Assertions compare states, not snapshots — that's what makes this a test.

**CMP adapters** (`cli/src/analyzers/consent/adapters/`) always prefer the vendor's JS API over
clicking, because a CMP redesign changes class names far more often than it changes the word
"Reject". The fallback chain is JS API → DOM click → accessible-name text match → `blocked`.

Supported: Cookiebot, OneTrust, Osano, CookieYes, Shopify Customer Privacy, and a heuristic
adapter for anything unrecognised. The heuristic exists so a newly swapped CMP degrades to
text-matched clicking rather than dropping out of coverage — a site silently going untested looks
exactly like a site that passed.

**Timing.** After a consent choice the scanner waits 5 seconds before reading anything. A great
many tags are injected by a tag manager reacting to the consent event, so they land well after the
click, and a shorter window produces false passes on precisely the sites that matter most.

**Consent Mode-aware matching.** A Google tag that has been denied consent still calls home:
cookieless, with `gcs=G100` and `npa=1`, precisely to report that consent was withheld. Counting that
as "marketing fired" flags the correct implementation and the broken one identically, which is worse
than not checking at all — it teaches the reader that a blocker means nothing. Every request is
matched individually and its `gcs` state read, so a denial scores as a denial. A request carrying no
`gcs`, or `gcs=G1--` (Consent Mode active but nothing declared), still counts as a fire: absence is
not consent.

**Implied-consent configurations.** Many US-configured CMPs prompt nobody and grant everything by
default. There is then no accept or reject flow to drive, and reporting fourteen `blocked` results
misrepresents a deliberate configuration as a coverage gap. When the CMP's own API reports an
implied-consent model, those suites are marked `skipped` with the vendor's jurisdiction quoted
verbatim. This is asserted from the CMP's configuration, never inferred from a missing banner —
a banner that is simply broken produces identical silence and must keep reading as `blocked`.

**Retry.** When a blocker-severity test fails, the whole site is scanned a second time and any
result that disagrees is downgraded to `flaky`. Scoped to blockers on purpose: those are the
findings that start a client conversation, and a clean site never pays the cost.

---

## Adding a CMP adapter

Implement `CmpAdapter` (`adapters/types.ts`) and add it to the `ADAPTERS` array in
`adapters/index.ts`. Order matters — vendor CMPs come before `shopify-native`, because a store can
have both, and driving Shopify's API directly would bypass the banner actually under test.
`heuristic` must stay last.

Return `false` rather than throwing from any method. A CMP that can't be driven should produce
`blocked`, and an adapter that threw would be indistinguishable from a genuinely broken site.

## Adding a tracker

Add a signature to `TRACKERS` in `cli/src/analyzers/consent/trackers.ts` with the right
`category`. The category is what makes the assertions meaningful: essential tags are supposed to
keep running, and under a granular choice analytics may legitimately continue while marketing must
not. Uncatalogued cookies fall to `preferences`, never `marketing` — guessing would manufacture
blocker-severity failures out of cookies we simply haven't catalogued.

---

## Known gaps

- **US only.** Every scan runs from your real location. GDPR opt-in behaviour for EU visitors is
  untested; the `regions` field records intent so a later proxied run is distinguishable rather
  than silently comparable.
- **CMP configuration lives in the vendor dashboard, not the repo.** Scanning theme code can never
  confirm it's correct — which is the whole reason this tool drives a live browser.
- **Registry drift.** A new client site nobody added is invisible. `--seed --from-repos` surfaces
  unplaced repos, but it can't invent domains.
