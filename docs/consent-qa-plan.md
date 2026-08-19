# Consent QA Scanner — Plan

**Status:** Built and shipped 2026-08-19. Kept as the design record — for how the tool
works day to day, see [`consent-qa.md`](consent-qa.md).
**Implementation target:** this repo (extension, per decision below).
**Author:** nick.meyer@barrelny.com · **Date:** 2026-08-19

---

## 1. Why this exists

Consent is the one QA area where a silent failure is a legal exposure, not just a bug.
A banner that renders but doesn't actually block Meta's pixel looks *fine* to everyone
— client, PM, and the current audit tooling alike — right up until it doesn't.

Nothing we have today proves consent **works**. It only proves a banner **exists**.

### What's actually deployed (measured, not assumed)

| Finding | Evidence |
|---|---|
| ~230 repos in the `barrel` org, overwhelmingly Shopify Liquid themes | `gh repo list barrel` |
| No house-standard CMP — at least four vendors in play | Cookiebot (`waterloo`), OneTrust (`halo-aden-theme` + ~6 repos), Osano (`instanpot-osano`), CookieYes |
| Existing consent "check" is a regex over one page's HTML | `barrel-site-audit/cli/src/analyzers/pixels.ts:44-51` |
| It only asks *"is a CMP present?"* — never clicks Reject, never verifies anything stops | `pixels.ts:94-107` |
| Repo → live domain is **not** derivable from code | Tested 20 local repos; 1 exposed a domain |
| `_shopify_marketing` + `_shopify_analytics` set on first load, pre-interaction | `curl` on `drinkwaterloo.com`, no consent given |
| GitHub code search is capped at 10 req/min | Hit the limit during this survey |

That last cookie finding is exactly the class of issue this tool exists to catch — and
today nothing would have surfaced it.

---

## 2. Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Architecture | **Extend `barrel-site-audit`** | One tool, one report site, no duplicated publishing infra. Requires a new *batch* mode, since site-audit is one-store-per-run. |
| Check scope | **Behavioral consent QA** | Drive the banner for real. Presence detection is table stakes, not the product. |
| Geography | **US-only v1, geo-designed** | `region` is a first-class parameter from day one; adding an EU proxy later is config, not a rewrite. |
| Site list | **Committed `sites.yml`** | Reviewable source of truth, seeded semi-automatically, human-confirmed once. |

---

## 3. Two things get built

**A. `consent.ts` analyzer** — deep behavioral QA for a single site, wired into the
existing report as a new `consent` section. Follows the established
`analyzeX(url) → XSection` contract.

**B. `consent-scan` command** — fleet-wide runner over `sites.yml` producing one roll-up.
This is the thing that answers *"is consent working across all our clients right now?"*
and the thing that can run on a schedule.

The existing `pixels.ts` keeps its pixel-detection job and **hands the consent verdict
over** to the new section, so the report can't contradict itself.

---

## 4. The site registry

`sites.yml` at the repo root — the reviewable source of truth.

```yaml
sites:
  - slug: drinkwaterloo-com
    client: Waterloo
    url: https://www.drinkwaterloo.com/
    repo: barrel/waterloo
    cmp: cookiebot            # cookiebot | onetrust | osano | cookieyes | shopify-native | none | unknown
    regions: [us]             # us | eu | ca-us  — v1 runs us only
    expect:
      banner: true
      preConsentMarketing: false
      consentModeV2: true
    owner: nick.meyer@barrelny.com
    status: active            # active | paused | offboarded
```

**Seeding** (`consent-scan --seed`): union of the 6 existing `stores/*/config.json`,
active Harvest projects, and org repo names → emits a draft `sites.yml` with `cmp: unknown`
and blank URLs where undiscoverable. One human pass fills the gaps. After that it's a
normal reviewed file, and a new client site that never got added is itself a visible gap.

---

## 5. What "working correctly" means — the consent state machine

Each site is driven through five states, **each in a brand-new incognito context**:

| State | Setup |
|---|---|
| **S0 Clean** | No cookies, no interaction. Baseline. |
| **S1 Reject** | Reject-all via the CMP |
| **S2 Accept** | Accept-all via the CMP |
| **S3 Granular** | Analytics yes, marketing no (where supported) |
| **S4 Returning** | Consent persisted, then reload + navigate |

In every state we capture: cookies (name/domain/expiry), network requests to known tracker
hosts, `dataLayer` consent events, `gtag` consent state, `Shopify.customerPrivacy` state,
and local/sessionStorage keys.

Assertions are made on the **difference between states**, which is what makes this a real
test rather than a snapshot.

---

## 6. Test plan — the test cases

Severity: **B**locker · **E**rror · **W**arning · **I**nfo

### Suite A — Presence
| ID | Test | Sev |
|---|---|---|
| A1 | CMP script loads successfully (not 404 / expired domain-group ID) | B |
| A2 | Banner is visible on clean load | B |
| A3 | Reject is offered at the same level as Accept (dark-pattern check) | W |
| A4 | No console errors originating from the CMP | W |

### Suite B — Pre-consent (S0)
| ID | Test | Sev |
|---|---|---|
| B1 | No marketing cookies set before interaction | B |
| B2 | No marketing network calls before interaction | B |
| B3 | No analytics cookies/calls before interaction | E |
| B4 | Google Consent Mode v2 default is `denied` | E |

### Suite C — Reject (S1)
| ID | Test | Sev |
|---|---|---|
| C1 | Marketing trackers do **not** fire after reject | B |
| C2 | Non-essential cookies set pre-choice are cleared | E |
| C3 | Consent Mode `update` fires with correct denied signals | E |
| C4 | `Shopify.customerPrivacy` reflects the rejection | E |

### Suite D — Accept (S2)
| ID | Test | Sev |
|---|---|---|
| D1 | Expected trackers **do** fire after accept | E |
| D2 | Consent Mode `update` grants `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` | E |
| D3 | `Shopify.customerPrivacy` reflects the acceptance | E |

> D1 is the false-negative guard. A CMP that blocks everything forever passes Suite C
> perfectly and is still broken — it's quietly destroying the client's attribution.
> Half of consent QA is proving that *accepting works too*.

### Suite E — Persistence
| ID | Test | Sev |
|---|---|---|
| E1 | Choice survives a reload | E |
| E2 | Choice survives navigation (home → PDP → cart) | E |
| E3 | Banner does not re-prompt a consented returning visitor | W |
| E4 | Banner **does** return after cookies are cleared | W |

### Suite F — Granular
| ID | Test | Sev |
|---|---|---|
| F1 | Analytics-only: GA4 fires, Meta/TikTok do not | E |
| F2 | Category mapping is correct — no marketing tag filed under analytics | E |

### Suite G — Compliance surface
| ID | Test | Sev |
|---|---|---|
| G1 | Privacy policy link present and returns 200 | W |
| G2 | Preference center re-openable after a choice | W |
| G3 | "Do Not Sell or Share" link present (US/CA sites) | W |
| G4 | GPC (`Sec-GPC: 1`) treated as an opt-out | W |

**Result states:** `pass` · `fail` · `blocked` (site down / bot-walled) · `skipped`
(CMP doesn't support the capability) · `flaky` (retry disagreed).

A `blocked` site must never read as non-compliant. That distinction is load-bearing —
conflating "we couldn't test it" with "it failed" is how a report loses its audience.

---

## 7. CMP adapters — the hard part

Clicking "Reject" across four vendors is the real engineering problem. Common interface:

```ts
interface CmpAdapter {
  id: CmpVendor;
  detect(page): Promise<boolean>;
  waitForBanner(page, timeoutMs): Promise<boolean>;
  rejectAll(page): Promise<boolean>;
  acceptAll(page): Promise<boolean>;
  granular?(page, cats: TrackerCategory[]): Promise<boolean>;
  readState(page): Promise<ConsentState>;
  openPreferences?(page): Promise<boolean>;
}
```

**Always prefer the vendor JS API over a DOM click** — dramatically less flaky than
chasing selectors through a CMP redesign:

| Adapter | API used |
|---|---|
| `cookiebot` | `Cookiebot.consent`, `.withdraw()`, `.submitCustomConsent()` |
| `onetrust` | `OneTrust.RejectAll()`, `.AllowAll()`, `OptanonActiveGroups` |
| `osano` | `Osano.cm.denyAll()`, `.acceptAll()`, `.getConsent()` |
| `cookieyes` | `CookieYes` API + documented cookie |
| `shopify-native` | `Shopify.customerPrivacy.setTrackingConsent()` |
| `heuristic` | Accessible-name match on `/reject\|decline\|necessary only\|opt.?out/i` |

Fallback chain: **JS API → DOM click → heuristic → `blocked`**. The `heuristic` adapter is
what keeps an unknown or newly-swapped CMP from silently dropping out of coverage.

---

## 8. Tracker taxonomy

Extends the 5 platforms in `pixels.ts` and adds a **category** to each — because
"did tracking stop" is the wrong question. The right one is "did the *right categories*
stop."

`essential` · `analytics` · `marketing` · `preferences`

Covering: GA4, Google Ads, Meta, TikTok, Pinterest, Snapchat, Klaviyo, Attentive, Hotjar,
Clarity, Northbeam, Triple Whale, Elevar, Impact, Criteo, Bing UET, LinkedIn, Reddit,
Amazon, Rakuten, Shopify trekkie.

---

## 9. Output

| Surface | Content |
|---|---|
| **Terminal** | Colored per-suite summary, non-zero exit on any Blocker — usable in CI/cron unchanged |
| **Per-site report section** | New `ConsentAudit.tsx`: state × tracker matrix, test table with evidence |
| **Fleet page** `/consent` | One row per site — CMP badge, pass/fail/blocked counts, last scanned, trend. Red first. |
| **Machine-readable** | JSON + JUnit XML, so this can gate a PR later without rework |

### Evidence capture
Every failure carries: a screenshot of the banner state, the offending request URLs, the
cookie names/domains/expiries, and a HAR-lite trace — stored in Blob beside the report.
A compliance finding without evidence is an accusation, not a bug report; nobody can act
on "consent is broken."

---

## 10. Reliability

Flakiness is the failure mode that kills tools like this — a scanner people don't trust
gets ignored, and an ignored scanner is worse than none because it looks like coverage.

- Fresh incognito context **per state, per site** — zero cookie bleed
- Never reuse a page after a consent choice
- `networkidle` + settle delay + a **5s post-consent window** (many tags fire late)
- Retry any failure once; disagreement ⇒ `flaky`, never a silent pass
- Concurrency capped at 4–6 contexts
- Per-site timeout ⇒ `blocked`, not `fail`

---

## 11. Files to change in `barrel-site-audit`

```
sites.yml                                        NEW  registry
shared/src/types.ts                              EDIT ConsentSection, ConsentTestResult,
                                                      ConsentState, CmpVendor, TrackerCategory
cli/src/analyzers/consent/index.ts               NEW  orchestrator
cli/src/analyzers/consent/engine.ts              NEW  state-machine driver
cli/src/analyzers/consent/adapters/*.ts          NEW  6 adapters
cli/src/analyzers/consent/trackers.ts            NEW  taxonomy
cli/src/analyzers/consent/testcases.ts           NEW  one function per test ID
cli/src/analyzers/consent/registry.ts            NEW  sites.yml load + validate
cli/src/commands/consent-scan.ts                 NEW  batch runner
cli/src/index.ts                                 EDIT register cmd, --skip-consent
cli/src/report/generate.ts                       EDIT call analyzeConsent
cli/src/analyzers/pixels.ts                      EDIT delegate consent verdict
web/components/ConsentAudit.tsx                  NEW
web/lib/build-report-sections.tsx                EDIT register section
web/app/consent/page.tsx                         NEW  fleet page
.claude/commands/consent-scan.md                 NEW  slash command
docs/consent-qa.md                               NEW  runbook
```

---

## 12. How you run it

```bash
pnpm consent-scan                      # every active site in sites.yml
pnpm consent-scan --site waterloo      # one site
pnpm consent-scan https://example.com  # ad-hoc, not in the registry
pnpm consent-scan --inventory          # what CMP is where — no behavioral tests
pnpm consent-scan --seed               # draft sites.yml from stores + Harvest + repos
```

And inside Claude Code — `/consent-scan` runs the scan and explains the failures in plain
English, which is the difference between a report a developer reads and one an account
lead can act on.

---

## 13. Rollout

| Phase | Deliverable | Est. |
|---|---|---|
| **0** | `sites.yml` + seeder + `--inventory`. **Answers "what's installed to date" immediately.** | 1–2d |
| **1** | Engine + Cookiebot & Shopify-native adapters + Suites A–D on the 6 known stores | 3–4d |
| **2** | OneTrust, Osano, CookieYes, heuristic adapters + Suites E–F | 2–3d |
| **3** | Report UI: per-site section + `/consent` fleet page | 2–3d |
| **4** | Suite G, GPC, scheduling (cron / GitHub Action), Slack digest | 2d |

Phase 0 ships value on day one and is independently useful even if everything after it slips.

---

## 14. Explicitly out of scope

- Building our own CMP
- **Any claim of legal compliance.** This tool reports *technical behavior*. "Marketing
  pixel fired before consent" is a fact; whether that violates a given statute in a given
  jurisdiction is counsel's call. The report will say so on its face.
- Real-payment checkout testing
- Scanning all ~230 repos — registry-driven only; most are archived or inactive

---

## 15. Known risks

| Risk | Mitigation |
|---|---|
| Bot detection / WAF blocks headless Chrome | Realistic UA + stealth flags; `blocked` status rather than a false failure. Shopify storefronts are generally fine. |
| **CMP config lives in the vendor dashboard, not the repo** | Repo scanning can never confirm correct configuration. Live behavioral scanning is the authoritative signal — this is the core justification for the whole approach. |
| US-only v1 leaves GDPR opt-in behavior untested for EU-serving clients | Named as a known gap in every report until geo lands; `regions` field already carries it. |
| Consent Mode v2 detection needs to intercept `gtag` before it runs | Inject an init script pre-navigation to record the consent command queue. |
| Registry drift — a new client site never added | `--seed` diffs registry against Harvest/repos and flags unknowns. |
