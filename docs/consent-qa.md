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
barrel-audit consent-scan                      # every active site in sites.yml
barrel-audit consent-scan waterloo             # one registry entry, by slug
barrel-audit consent-scan https://example.com  # ad hoc, not in the registry
barrel-audit consent-scan --inventory          # which CMP is where, no behavioural tests
barrel-audit consent-scan --seed               # draft sites.yml from stores/
```

Two flags here sound alike and do unrelated things. `--inventory` is a presence-only CMP census
that skips the behavioural suites entirely. `--no-tag-inventory` runs the full scan and skips only
the per-vendor cookie & script table. The second is deliberately *not* called `--no-inventory`:
two flags one negation apart, meaning different things, is how someone turns off the wrong half of
a scan and doesn't notice.

Targets are variadic — pass as many slugs and URLs as you like, mixed freely, and duplicates
(including bare trailing-slash and `www.` variants of the same URL) are collapsed:

```bash
barrel-audit consent-scan https://a.com https://b.com waterloo
```

Useful flags: `--concurrency <n>` (default 4), `--json <path>`, `--junit <path>` for CI,
`--no-upload` to skip Blob and evidence screenshots, `--no-retry` to skip blocker confirmation.

A single site takes about 90 seconds — five browser states plus a GPC probe, each in its own
fresh incognito context. The scan exits non-zero when any blocker-severity test fails, so it can
gate CI unchanged.

Skip it in a per-store run with `--skip-consent`.

In Claude Code, `/consent-scan` runs the scan and explains the failures in plain English.

---

## The three views

**`/consent`** — the fleet table. One row per site, worst first, with status, score, blocker count
and the failing test IDs. Below it, a roll-up of any failure appearing on more than one site,
because the same fix on six sites is one piece of work rather than six.

**`/consent/<slug>`** — the comprehensive per-site report, and the thing to send a client. Leads
with a tag × consent-state matrix answering the question clients actually ask — *I opted out, did
Meta stop?* — as an explicit verdict per tag per state rather than a colour:

| Verdict | Meaning |
|---------|---------|
| `OK` | Behaved as the visitor's choice requires — fired when permitted, stayed down when not |
| `FAIL` | Fired when the visitor's choice should have blocked it |
| `Silent` | Stayed down when it was permitted — an attribution problem, not a compliance one |
| `n/a` | Essential, not gated by consent |
| `—` | That state could not be tested |

Then **What's working** — the pass list, which is the section a client asks for first. Every
confirmed pass, grouped by what it means for a visitor ("Before the visitor chooses", "When the
visitor rejects") rather than by suite letter, with each check's own confirmation sentence and its
ID for traceability. Each group line names the topic rather than asserting the site clears it — a
group can hold one pass beside three failures listed above it, and an affirmative line there would
claim more than its own passes support. It closes with the tags proven to obey the choice: fired after Accept, silent
after Reject. Then every test with its status, detail, fix and evidence; then each state's cookies,
Consent Mode signals, Shopify Customer Privacy state and banner screenshot. Print-styled, so the
browser's own Print → Save as PDF produces the PDF with selectable text and live links.

The pass list is derived at render time from the stored scan, not written into it, so an archived
report shows it without being re-scanned. Its ratio is counted against checks that reached a
verdict, never against all 32: a site whose states were mostly unreachable must not present as a
clean sweep. Nothing in it is a new assertion — it regroups verdicts the scanner already reached,
which is why a `blocked` check can never surface here as a pass.

Then the **cookie & script inventory** — see its own section below.

**`/consent/run`** — paste any number of URLs or slugs and scan them, independently of the
per-store audit. Streams the CLI's output live.

Scanning runs from a local checkout, because it drives a real browser. On the deployed site the
same page becomes a command builder: paste the list, copy the exact `consent-scan` invocation, run
it locally. Results publish to Blob either way, so the deployed dashboard shows them the moment the
scan finishes — only the *running* is local.

Privacy Compliance also runs inside every normal `barrel-audit run`, so a per-store audit carries
its own section without anyone asking for it — pass list and inventory included.

Scanning a **single** site at the terminal prints the same pass list after the result line, then the
inventory's headline: the rows needing attention, any Shopify pixel gated on nothing, and the fix
plan's steps. Not the whole table — a wide grid can't be rendered honestly in a terminal, and a
truncated one looks complete. Across a fleet both are suppressed, because the table is the point of
a fleet run.

---

## The cookie & script inventory

The other half of the deliverable. The suites answer "is consent working?"; this answers "what is
running on my site, and is each thing classified and firing correctly?" — the question a client
actually opens with, and one a list of test IDs cannot answer.

One row per vendor, because that is the unit someone acts on: a CMP rule is written against a
domain, a theme edit removes one script tag, a Shopify pixel is configured once. Klaviyo's five
hosts are one decision, not five.

| Column | Source |
|---|---|
| Vendor, purpose | Catalogue. A model writes the purpose for anything not in it, and the row is labelled `inferred` |
| How it loads | Theme `<head>`, a named GTM container, a Shopify web pixel, or another vendor's script — from the CDP initiator chain plus the document's own script tags |
| Cookies & storage | Cookies, plus the localStorage/sessionStorage keys no cookie banner governs |
| *CMP* classification | The declared category, read off the script tags the CMP gates |
| Classified correctly? | That declaration compared against observed behaviour |
| Fires before / despite consent? | Which of the five states the vendor transmitted in, named explicitly |
| Severity | Graded from disclosure, not from category alone |
| Recommended fix | A model, writing against the load mechanism above |

### Discovery is open-ended, unlike the suites

The suites assert against `TRACKERS`, which is right for a pass/fail claim — a review widget is
not a tracker and should not make C1 fail. But an inventory limited to that list would silently
omit every uncatalogued third party, and on a real storefront those are the majority. They are
also, precisely, the ones the client has not accounted for. So vendors are discovered from traffic
and grouped by registrable domain, with two catalogues in front of the model: `TRACKERS` for the
tags the suites already know, and `VENDOR_CATALOGUE` in `vendors.ts` for the storefront apps that
are not trackers but do appear in the network log.

Identification is by **host plus path, never the query string.** Cookie-sync endpoints name their
partner in a parameter — `odr.mookie1.com/sync?partner=amazon-adsystem.com` — and matching the
whole URL attributed ten unrelated ad-tech hosts to Amazon Ads, merging their rows. A vendor is
identified by where a request went, not by whom it mentions.

Catalogued trackers key by **tracker id, not by domain**: Meta is `connect.facebook.net` *and*
`facebook.com/tr`, and keying by domain split one vendor into two rows whose verdicts then read as
though each half behaved differently.

### Reading the CMP's own classification

"Is it classified correctly?" is only a meaningful question if we can see what the CMP thinks. That
is read from the script tags the CMP gates, because to hold a tag back a CMP must neutralise its
`type` and record which category would release it — so both halves are always present on a gated
tag, and the marker is documented vendor behaviour rather than internal state:

| CMP | Marker |
|---|---|
| Cookiebot | `data-cookieconsent="marketing"` (and `="ignore"`, a vendor opting its own tag out) |
| OneTrust | `class="optanon-category-C0004"`, or `data-ot-ignore` |
| Osano | `type="osano/blocked"` — gated, but the marker doesn't name the category |
| CookieYes | `data-cookieyes="cookieyes-advertisement"` |

Reaching into the vendor's rule store was tried first and abandoned. Osano exposes `Osano.cm` and a
command queue and nothing resembling its ruleset; a column built by pattern-matching a minified
bundle would empty itself silently at the vendor's next release, and an empty column reads exactly
like a site with nothing to report.

Osano's `cm.jurisdiction` *is* readable and names the live ruleset variant, so the column header
can say whose classification it audited — "Osano (live us-fl ruleset)" rather than a bare "Osano".

### The verdicts, and why each is separate

| Verdict | Meaning |
|---|---|
| `correct` | The CMP's own label agrees with what the vendor demonstrably is |
| `incorrect` | It contradicts it — a marketing tag declared ESSENTIAL, or a vendor's own bypass marker |
| `partly` | The tag is gated, but the marker doesn't name a category, so gating on the *right* one can't be read |
| `unclassified` | The ruleset is readable and nothing in it covers this vendor |
| `unknown` | No classification could be read at all |

`unknown` and `unclassified` are deliberately different. Both leave the client without an answer,
but only the second is a finding about their configuration; the first is our gap and must never
present as theirs. When nothing was readable the report says so once, at the top of the table —
forty identical "not readable" cells read as forty findings instead of one missing input.

`unclassified` is also not `incorrect`. An absent gating marker has an innocent explanation: a tag
injected by JavaScript was never a script tag for the CMP to rewrite. Calling that misclassification
is an accusation the evidence doesn't support, so the note says which two things it's consistent
with and where to confirm.

The behavioural claim is kept out of the classification verdict entirely. A vendor can be classified
correctly and still fire when it shouldn't — that is a broken *gate*, not a broken classification,
and merging them loses the distinction the fix depends on.

### Shopify web pixels

Read from the storefront's own `webPixelsConfigList`, which is inlined in the page as an argument
to the web-pixels-manager bootstrap. Parsed by brace-matching rather than regex: a pixel's
`configuration` is a JSON *string* containing brackets of its own, and a non-greedy match truncates
the list at the first one.

`privacyPurposes` is the only place the platform records whether a pixel is gated on consent, and
it is not observable in a request at all. **An empty list means Shopify runs that pixel whatever
the visitor chose, and no CMP configuration can change it** — a materially different finding from a
tag the CMP failed to block, with a different owner and a different fix, so it gets its own table
and its own note on the vendor's row. `runtimeContext: OPEN` is flagged too: that pixel runs in the
page with full DOM access rather than in Shopify's sandbox.

Pixels are attributed to vendors from the initiator chain first, which names the pixel's id
outright (`/web-pixels@…/app/web-pixel-<id>@…/pixel.modern.js`), falling back to matching the
config text. An unattributed pixel is listed on its own rather than attached to a plausible-looking
vendor: a wrong attribution would put a `privacyPurposes: []` finding on an innocent row.

### What the model is and isn't allowed to do

It writes purposes for uncatalogued vendors, the `recommendedFix` wording, the ordered fix plan and
the opportunities. It is given the verdicts as settled context and there is nothing in its schema
it could use to overturn one.

`classifiedCorrectly`, `firesBeforeConsent`, `firesDespiteRejection` and `severity` are computed
from the capture. Those are the claims a client forwards to a vendor, so they have to be traceable
to an observation rather than to a model's reading of one.

The one exception is the category of an *uncatalogued* vendor, which the model may propose and which
then re-grades that row's severity. Without it, a dozen uncatalogued ad-tech hosts all firing under
full opt-out would grade as `preferences` and sort to the bottom of the table — the opposite of the
truth. The row stays labelled `inferred` so a reader can see which is which.

A catalogued vendor's purpose is never overwritten: what Criteo does doesn't depend on which
storefront it turned up on, and a per-run inference would make the same vendor read differently in
two clients' reports for no reason.

The AI pass is streamed with a high token ceiling. A 45-vendor table overran 8192 tokens, the
response was cut mid-string, and the whole enrichment was lost to a JSON parse error that read like
a malformed schema. Truncation is now named explicitly, and a missing API key degrades the table to
catalogue purposes rather than withholding it — the deterministic columns are the substance.

### Opportunities are not fixes

The "compliant ways to collect more" section is structurally separate from the fix plan and says so
in its own subtitle. Letting "recover modelled conversions" sit beside "stop transmitting after
opt-out" invites a reader to treat them as equivalent work, and only one of them has to happen.
Where an opportunity depends on a fix landing first, it names the step in `requires`.

### Export

The per-site report offers the whole thing as an **Inventory CSV** —
`/api/consent-inventory?scan=<id>&slug=<slug>` — which is what actually gets it into the Google
Sheet a client asks for. Every field is quoted unconditionally: a fix is a sentence and a host list
is comma-separated, and one unquoted comma shifts every later column on that row silently.

### Known gaps

- **A tracker CNAMEd onto the site's own domain is invisible.** `data.shop.example.com` resolving
  to a vendor is first-party by hostname and matches no pattern, so nothing distinguishes it from
  the shop's own endpoints. Keeping every first-party host instead would fill the table with the
  site's asset and API routes. A vendor-owned domain used as a first-party CNAME *is* caught;
  catching a genuinely cloaked subdomain needs a DNS lookup the scanner doesn't do.
- **A vendor with no gating marker can't be told apart** from one the CMP blocks by network
  interception rather than tag rewriting. Hence `unclassified` rather than `incorrect`.
- **Storage is observed, not gated.** localStorage keys are reported because no cookie banner
  governs them, but the scan can't say whether a CMP intended to.

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
| B2 | No marketing **data transmitted** before any interaction | blocker |
| B5 | No marketing vendor's **script fetched** before any interaction | warning |
| B3 | No analytics cookies or calls before any interaction | error |
| B4 | Google Consent Mode v2 default is `denied` | error |

### Suite C · Reject (S1)
| ID | Test | Severity |
|----|------|----------|
| C1 | No marketing **data transmitted** after reject | blocker |
| C5 | No marketing vendor's **script fetched** after reject | warning |
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

**Transmission vs script load.** The single most important distinction in the report, and the one
that decides whether a finding survives contact with the client's developer.

Downloading `connect.facebook.net/en_US/fbevents.js` is the browser fetching a library. Sending
`facebook.com/tr?id=…&ev=PageView` is telling Meta about this visitor. Reporting both as "the pixel
fired" hands the developer a blocker they can correctly dismiss — and once one blocker is
dismissed, the genuine ones go with it.

Every blocker-severity assertion therefore reads *transmissions only*. Script loads are reported
separately at warning severity (B5, C5), stating the weaker claim honestly: the vendor learns an IP
address and a referring URL, which some readings of GDPR treat as a transfer in its own right.

Classification is by request path, extension first — `analytics.tiktok.com/i18n/pixel/events.js`
contains "pixel" and is still a script. Vendors may declare an `infrastructure` pattern for their
own plumbing (Klaviyo's web fonts, form definitions and geo-IP lookup). That list is an allowlist
of the known-innocuous, never of the known-tracking: an uncatalogued endpoint still counts as a
transmission, so the failure mode is a finding that can be checked against its evidence rather than
one that is never raised.

**Delivered requests only.** A request that was aborted or never answered told the vendor nothing,
and counting it as a fire reports a CMP that worked as one that failed. A 4xx or 5xx still counts:
the vendor received it and replied, which is exactly the disclosure at issue.

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

**Retry.** The whole site is scanned a second time, and any result the two passes disagree on is
downgraded to `flaky`, when either:

- a blocker-severity test **failed** — those are the findings that start a client conversation, so
  they are worth a second full run before being stated as fact; or
- C1 or F2 **passed** — "nothing was transmitted after the visitor opted out" is a negative claim,
  and one observation is thin evidence for a negative. A tag that fires on nine loads in ten yields
  a clean pass on the tenth, and a report asserting that consent works when it intermittently does
  not is the most damaging error this scan can make: every other mistake is visible in the
  evidence, and this one looks exactly like success.

Sites that show no banner — the majority — never reach C1 or F2 and so never pay for the second
pass.

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
