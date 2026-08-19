export interface ReleaseNote {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
}

// Newest first. Version bumps the minor number for a normal shipped change; a major bump (2.0)
// is reserved for a genuinely foundational shift, not a rule enforced by code. See the
// feedback-release-notes memory for the standing instruction to add an entry here (and bump the
// version) as part of shipping any user-visible change — this file is the source of truth for
// both the in-app "release notes" page and that version number.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.16",
    date: "2026-08-19",
    title: "Privacy Compliance — a score that actually ranks anything",
    notes: [
      "**Every site was scoring 0.** The old score subtracted a flat penalty from 100 with a blocker costing 35, so three blockers floored a site at zero — and most storefronts have three. A site passing nineteen tests and one passing two were indistinguishable. Across a 23-site fleet, 21 scored exactly 0.",
      "The score is now a **weighted proportion of the tests that applied and were confirmed**. A site showing no banner has fourteen inapplicable tests, and judging it out of a fixed 100 marked it down for questions that were never asked.",
      "**Unknown is not half-good.** Flaky and blocked results are excluded from both sides of the ratio instead of earning partial credit. Modelling this against the real fleet caught the alternative red-handed: crediting them put the one site we had entirely failed to load at the *top* of the ranking.",
      "**A confirmed blocker always shows.** Any blocker-severity failure scales the result into the bottom half, so \"leaks data after opt-out\" can never present as a passing grade — while still separating one blocker from four.",
      "**Sites with too little confirmed are marked `n/s`, not 0.** A number there rates the site when it should rate the coverage. Those sites are also skipped in the overall report score rather than counted as a zero.",
      "On the same fleet the range is now 1–40 with sensible ordering: Waterloo 34, Wamsutta 11, Pavise 1, and the two sites nobody could test marked not-scored.",
    ],
  },
  {
    version: "1.15",
    date: "2026-08-19",
    title: "Privacy Compliance — separating \"the script loaded\" from \"data was sent\"",
    notes: [
      "**A blocker now means data actually left the browser.** Downloading `connect.facebook.net/en_US/fbevents.js` is fetching a library; sending `facebook.com/tr?id=…&ev=PageView` is telling Meta about the visitor. The scan reported both as \"the pixel fired\" — which hands a client\'s developer a blocker they can correctly dismiss, and once one blocker is dismissed the genuine ones go with it. Every blocker-severity test now reads transmissions only.",
      "**Script loads are still reported, at warning severity** (new B5 and C5), stating the weaker claim honestly: the vendor learns an IP address and a referring URL, which some readings of GDPR treat as a transfer in itself. Anthony\'s Goods is the shape of it — Meta, Google and Klaviyo genuinely transmitted pre-consent, while TikTok had only fetched its script.",
      "**Findings now quote the identifying parameters**, so a claim proves itself: `px.ads.linkedin.com/db_sync (pid=12608, gdpr=0)` rather than a bare URL buried in a hundred query parameters.",
      "**A request that never arrived no longer counts as a fire.** Responses are tracked, not just requests, so a tag the CMP aborted stops reading as a tag that leaked. A 4xx still counts — the vendor received it and answered.",
      "**Passing opt-out results are now confirmed by a second pass.** \"Nothing was transmitted after the visitor opted out\" is a negative claim, and one observation is thin evidence for a negative. A tag firing on nine loads in ten produced a clean pass on the tenth. Found immediately: one site\'s Klaviyo transmits after rejection intermittently, and is now reported flaky rather than confidently passed.",
      "Two classifier bugs fixed in the process — `analytics.tiktok.com/i18n/pixel/events.js` was read as an event because its path contains \"pixel\", and Klaviyo\'s web fonts and geo-IP lookup were counted as tracking.",
    ],
  },
  {
    version: "1.14",
    date: "2026-08-19",
    title: "Privacy Compliance — bulk scanning and a report you can hand to a client",
    notes: [
      "**New: a comprehensive per-site report** at `/consent/<site>`, reachable from any row in the fleet table. It leads with a tag × consent-state matrix that answers the question clients actually ask — *I opted out, did Meta stop?* — as an explicit **OK / FAIL / Silent** verdict for every tag under every choice, rather than a colour you have to decode.",
      "**Silent is its own verdict.** A tag that stays down when the visitor permitted it isn\'t a compliance problem, it\'s a destroyed-attribution problem — and a report that only looks for over-firing never finds it.",
      "Below the matrix: every test with its status, detail, fix and evidence; then each state\'s cookies, Consent Mode signals, Shopify Customer Privacy state and banner screenshot. **Print → Save as PDF** is styled for it, so the PDF keeps selectable text and live links instead of being a screenshot.",
      "**New: bulk scanning** at `/consent/run`. Paste any number of URLs or slugs — one per line or comma-separated, bare domains fine — and scan them independently of the per-store audit, with the CLI\'s output streaming live. `consent-scan` now takes as many targets as you pass on the command line too, and collapses duplicates. A bare domain like `blueair.com` is understood as a site rather than rejected as a missing registry slug — which is how a pasted column of domains actually arrives.",
      "Scanning drives a real browser, so it runs from a local checkout. On the deployed site that page becomes a **command builder** rather than a dead button — paste the list, copy the exact invocation, run it locally. Results publish to Blob either way, so the deployed dashboard shows them the moment the scan finishes.",
      "Per-site detail is stored as its own blob rather than folded into the fleet payload, so the table everyone opens doesn\'t pay to load the cookie lists and evidence almost nobody scrolls to.",
    ],
  },
  {
    version: "1.13",
    date: "2026-08-19",
    title: "Privacy Compliance — renamed, and taught the difference between broken and by-design",
    notes: [
      "**Consent QA is now Privacy Compliance**, in the report section, the dashboard page and the nav. Same tests, a name that means something to a client. The `/consent` URL is unchanged, so existing links still work.",
      "**The fleet view is now a table.** One row per site, sorted worst-first, with status, score, blocker count and the failing test IDs as chips you can hover for the detail — built to stay readable at fifty sites rather than four.",
      "**New: fixes that span more than one site.** Any failure appearing on two or more sites is rolled up with the list of sites and the remediation, because six sites failing the same test is one piece of work, not six.",
      "**Fixed a false positive that flagged correct implementations.** A Google tag that has been denied consent still calls home — cookieless, carrying `gcs=G100` — precisely to report the denial. The scanner counted that as \"marketing fired after reject\" and raised a blocker on sites doing exactly the right thing. It now reads the Consent Mode state on each request, so a denial is scored as a denial.",
      "**Fixed Osano banner detection.** Osano keeps a fully-rendered banner hidden in the page under an implied-consent configuration, so the old check reported a banner on sites that prompt nobody — passing the banner test and then failing to explain why nothing could be clicked.",
      "**\"We could not test this\" no longer looks like \"this failed.\"** Where a CMP reports an implied-consent model, the choice-driven suites are marked not-applicable with the vendor's own jurisdiction quoted, instead of 14 blocked results. Inferred only from the CMP's own configuration — a banner that is merely broken still reads as a coverage gap.",
      "**Hardened for large fleets.** Every browser state now runs under a hard deadline so one hung page cannot stall a scan, and a failed browser connection can no longer leak a Chrome process per site.",
    ],
  },
  {
    version: "1.12",
    date: "2026-08-19",
    title: "Consent QA — testing whether consent actually works",
    notes: [
      "New `consent-scan` command and a **Consent QA** section in every report. It drives the cookie banner for real — reject, accept, analytics-only, returning visitor — each in its own fresh incognito browser, and checks that trackers genuinely stop and start. 25 tests across 7 suites.",
      "This replaces the only consent check we had, which was a regex looking for the word \"cookiebot\" in the page source. A banner that renders but blocks nothing passed that check; it fails almost everything here.",
      "The new **Consent QA** page lists every client site, worst first, with the failing test IDs and the actual request URLs behind them. Run `pnpm barrel-audit consent-scan` to populate it.",
      "It tests that accepting works too, not just that rejecting does. A banner that blocks everything forever looks perfectly compliant and is quietly destroying the client's attribution — that's test D1.",
      "Findings distinguish \"failed\" from \"blocked\". A site that was down or never showed its banner is reported as untested, never as non-compliant — you can trust a clean result to mean something.",
      "Blocker-severity failures are automatically re-run once to confirm before being reported, and anything that disagrees between the two runs is marked flaky rather than stated as fact.",
      "Speaks Cookiebot, OneTrust, Osano, CookieYes and Shopify's Customer Privacy API, preferring each vendor's own JS API over clicking buttons. An unrecognised banner falls back to matching \"Reject\"-style button text, so a newly swapped CMP still gets tested instead of silently dropping out of coverage.",
      "Which sites get scanned lives in `sites.yml` at the repo root — `consent-scan --seed` drafts it from your existing stores. See docs/consent-qa.md for the full test plan.",
      "It reports technical behaviour, not legal compliance. \"Meta Pixel fired before consent\" is a fact; what it means under a given law is counsel's call, and the report says so.",
    ],
  },
  {
    version: "1.11",
    date: "2026-08-18",
    title: "Stop audit, and no more silently code-less reports",
    notes: [
      "\"Stop audit\" on the run progress screen now genuinely stops the run — it asks to confirm first, then kills the CLI and every headless browser it opened on your machine, and the screen says the run was stopped by you rather than pretending it finished.",
      "Two bugs behind that: stopping a run started through the local agent never actually stopped anything, and a stopped run left the \"an audit is already running\" lock stuck, refusing every later run until the process was restarted. Both fixed.",
      "New \"Theme code location\" box on the Run Audit form: point it at a local theme checkout (the folder with layout/theme.liquid) and the audit reviews that code. Saved per store, so you enter it once. Previously the only way to do this from the dashboard was to have already pulled the theme into the tool's own folder — the CLI's \"audit the theme I'm standing in\" shortcut can't work from the dashboard, which is why runs came back with no code findings.",
      "If \"Theme code & structure\" is checked and there is no code to review, the run now stops in the first second and says exactly how to fix it, instead of running for minutes and returning a report whose theme sections are simply missing — which read as \"nothing to flag\".",
      "Same check catches pointing at the wrong folder: if the path has no layout/theme.liquid, it says so, and suggests the subfolder if your repo keeps the theme one level down.",
      "When a run fails, the reason is now shown on the failure screen instead of only inside the collapsed CLI output.",
      "Fixed the globally-installed CLI mistaking a client repo for the tool's own: any repo with a `pnpm-workspace.yaml` (plenty of Shopify themes have one) was treated as the barrel-site-audit checkout, so it looked for `.env` and `stores/` inside the client repo and stopped with \"BLOB_READ_WRITE_TOKEN is not set\" even though `~/.barrel-audit/.env` had it. It now checks the repo is actually barrel-site-audit.",
    ],
  },
  {
    version: "1.10",
    date: "2026-08-18",
    title: "Run progress takes over the screen",
    notes: [
      "Starting an audit now opens progress as a full-screen modal instead of a panel below the form — the elapsed timer, current stage and rotating fact, with the page behind it dimmed and locked so there's nothing to accidentally edit mid-run.",
      "While the run is going there's no close button, just \"Cancel run\", which actually stops it — an X there would have hidden a run that was still going. Once it finishes, the modal turns into the outcome (complete or failed, with \"View report →\") and an X appears; Escape and a click outside work too.",
      "Closing it leaves the CLI output and report link on the page, so nothing is lost by dismissing it.",
      "Long theme-preview URLs no longer fill the heading with query-string tokens — it now reads \"Auditing client-store.com (preview link)…\".",
    ],
  },
  {
    version: "1.9",
    date: "2026-08-18",
    title: "ADA Scope Checker",
    notes: [
      "Paste a client's scoped accessibility requirements into the new \"ADA scope\" field on the Run Audit form (or pass `--ada-scope-file`), and the report checks off each line against what the audit actually measured — axe-core, Google Lighthouse's accessibility audit, and a live pass that presses real TAB keys through every journey page.",
      "The ADA tab leads with that checklist: a ticked box means an automated check verified the line; anything else carries a developer-ready action naming the failing elements, on which page, and what to change. Outstanding items also flow into the prioritized roadmap and Dev To-Do list.",
      "The live pass catches what a rule engine can't: controls TAB never reaches, focus outlines that never appear, and whether the skip-navigation link exists, points somewhere real, and actually shows itself when focused. Consent-dialog focus traps are called out as the trap they are, rather than as a page full of unreachable controls.",
      "Two copy buttons on the section: \"Copy client update\" for a plain-English summary a PM or AM can paste straight into a client email (with the Lighthouse accessibility score), and \"Copy dev actions\" for the developer version with selectors and fixes.",
      "Scope wording varies client to client, so nothing is hardcoded: common phrasings are keyword-matched, Claude maps anything unfamiliar, and requirements no automated test can settle — captions, a screen-reader pass, zoom/reflow, PDFs — are labelled as manual checks with instructions for how to verify them, plus a checkbox you can tick yourself. The scope is saved to the store, so re-running an audit re-checks the same list.",
    ],
  },
  {
    version: "1.8",
    date: "2026-08-17",
    title: "Run the local agent from any folder",
    notes: [
      "`barrel-audit serve` — the local agent that lets the hosted dashboard trigger audits on your machine — now works from any directory, not just a barrel-site-audit checkout. Sit in a client theme repo and start it there; stores and reports fall back to `~/.barrel-audit/` as `run` already did.",
      "Reminder on the command itself: with the CLI installed globally it's `barrel-audit serve`, with no `pnpm` in front. `pnpm barrel-audit serve` only resolves inside this repo, and in a Shopify theme folder (no package.json) it fails with ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND.",
      "Running an audit from inside a Shopify theme checkout now audits that code automatically — no `--local-repo .` needed. It looks for `layout/theme.liquid`, searching up from the current directory, and only applies when the store has no theme code of its own, so managed stores are never overridden.",
      "`run` now checks for the credentials it needs before starting, so a missing BLOB_READ_WRITE_TOKEN fails in a second instead of after several minutes of Lighthouse and browser passes. A missing ANTHROPIC_API_KEY is called out up front too.",
      "Every \"run this command next\" hint the CLI prints now matches how you actually installed it, instead of always saying `pnpm barrel-audit ...` even on a global install.",
      "Starting the agent on a port that's already busy now prints a one-line explanation and a suggested `--port`, instead of a raw Node EADDRINUSE stack trace.",
    ],
  },
  {
    version: "1.7",
    date: "2026-08-14",
    title: "Audit a repo you already have cloned, and a simpler CLI command",
    notes: [
      "`run --local-repo <path>` reads theme code straight from an existing local git checkout instead of copying it into stores/<slug>/theme/ — the fit for a dev auditing their own working copy rather than a client store managed via `link-repo`/`pull-theme`.",
      "For those stores, \"Suggest fix\" gets a fourth, simpler delivery option: write the change directly into that checkout, unstaged — no clone, no branch, no PR. Review and commit it yourself.",
      "The CLI can now be installed globally from GitHub Packages (`npm install -g @barrel/site-audit-cli`) and run from any directory, with config/report state falling back to `~/.barrel-audit/` when there's no barrel-site-audit checkout on disk.",
      "`pnpm run audit <url>` is now a shorter alias for `pnpm barrel-audit run <url>`.",
    ],
  },
  {
    version: "1.6",
    date: "2026-08-13",
    title: "Three ways to deliver a suggested fix",
    notes: [
      "\"Suggest fix\" now offers three independent choices instead of one: open the change in VS Code on a local branch, test it live with `shopify theme dev`, or push a branch and open a GitHub PR — pick any, none commit or push until you choose to.",
      "The VS Code and live-preview options share one prepared local branch, so edits made in the editor carry through if you then push.",
    ],
  },
  {
    version: "1.5",
    date: "2026-08-13",
    title: "About badge & release notes",
    notes: [
      "A small ⓘ badge in the header (landing page, report pages, and shared report links) explains how a report is generated, in plain terms — for anyone checking that the numbers are real.",
      "This page: a running, versioned changelog of what's shipped.",
    ],
  },
  {
    version: "1.4",
    date: "2026-08-13",
    title: "Broader structured-data scanning",
    notes: [
      "Site Health's structured-data check now reports the actual schema.org types found (e.g. \"Organization, WebSite, BreadcrumbList\") instead of just counting JSON-LD blocks.",
      "GEO now separately checks for Organization, WebSite, and BreadcrumbList structured data — not just Product/Offer — each with a concrete snippet to add if missing.",
    ],
  },
  {
    version: "1.3",
    date: "2026-08-13",
    title: "AI-suggested code fixes, report archiving, and a friendlier run screen",
    notes: [
      "Dev To-Do items that point at a real theme file get a \"Suggest fix\" button: Claude drafts a fix grounded in the real file and Shopify's Theme Check engine, you review the diff, and only on approval does it open a GitHub pull request — never merges anything itself.",
      "Reports can be archived/unarchived from the landing page or the report itself, without affecting Baseline & Reporting history.",
      "\"Progress\" renamed to \"Baseline & Reporting\" for clarity.",
      "The Run Audit wait now shows an elapsed timer, the current stage, and a rotating fact instead of a raw log.",
      "Fixed full-page screenshots coming out with gray placeholder boxes on pages with lazy-loaded sections.",
    ],
  },
  {
    version: "1.2",
    date: "2026-08-13",
    title: "Run audits from the dashboard",
    notes: [
      "A \"+ Run Audit\" form lets you kick off an audit by checking boxes instead of typing CLI flags, with the CLI's own output streamed live into the page.",
      "`pnpm barrel-audit serve` starts a local agent so this also works from the deployed dashboard, not just a locally-running copy of the site — the browser talks to it directly, gated by a one-time token.",
    ],
  },
  {
    version: "1.1",
    date: "2026-08-13",
    title: "Sitespeed.io, agent readiness, theme architecture, sharing, and progress tracking",
    notes: [
      "Added sitespeed.io as a second, independent performance signal (opt-in), an Agent Readiness section (per-SKU schema/hydration checks for AI shopping agents), and an AI-written Theme Architecture assessment.",
      "Reports can be shared via a private, expiring link — no login required for the recipient.",
      "Every report section now shows its own health-rating badge.",
      "Added Lighthouse's new Agentic Browsing category.",
    ],
  },
  {
    version: "1.0",
    date: "2026-08-11",
    title: "Initial release",
    notes: [
      "The barrel-audit CLI: Lighthouse performance/accessibility/SEO, axe-core accessibility, live site health checks, marketing-pixel & consent auditing, Shopify Theme Check code quality, an AI-written executive summary, and GA4 traffic/revenue and competitor benchmarking.",
      "A password-gated Next.js dashboard, deployed to Vercel, reading straight from Vercel Blob storage so a new report appears the instant a CLI run finishes.",
    ],
  },
];

export const CURRENT_VERSION = RELEASE_NOTES[0].version;
