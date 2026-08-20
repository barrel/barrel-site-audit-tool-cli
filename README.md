# barrel-site-audit

A reusable tool for auditing client Shopify storefronts: theme code quality and structure,
Lighthouse performance/accessibility/SEO, storefront health, live marketing-pixel detection,
behavioural cookie-consent QA across the whole client fleet, a best-practices verdict table,
and an AI-written executive summary.
Reports are generated from the CLI and published to a password-protected web app on Vercel.

**Live report site:** https://barrel-site-audit.vercel.app (password-protected — ask in
`#barrel` or check the Vercel project's `SITE_PASSWORD` env var)

## Quick start: running a report

**0. One-time setup** (skip if you've already done this once on your machine):

```
pnpm install
pnpm --filter @barrel/site-audit-shared build
pnpm --filter @barrel/site-audit-cli build
cp .env.example .env
```

Open `.env` and paste in a Blob read/write token — Vercel dashboard → your project →
Storage → the Blob store → `.env.local` tab → copy `BLOB_READ_WRITE_TOKEN`. That's the
only credential the CLI needs. (`ANTHROPIC_API_KEY` in the same file is optional — it
turns on the AI-written executive summary and the AI performance/accessibility
suggestions list. `GITHUB_OAUTH_CLIENT_ID` is also optional — it turns on `link-repo` for
pulling theme code straight from a GitHub repo instead of the Shopify CLI. It's a GitHub
OAuth App Client ID, not a secret — see [Adding a store](#adding-a-store) below for the
one-time setup.)

**1. Run the audit** — just point it at the storefront's URL:

```
pnpm barrel-audit run https://client-store.com
# — or the shorter alias, which is exactly the same command —
pnpm run audit https://client-store.com
```

That's it. This single command scaffolds a `stores/<slug>/` folder for you (from the
hostname), runs every analyzer (Lighthouse performance/accessibility/SEO, site health,
live pixel/consent audit, and — if theme code is present — theme code + structure
checks), and uploads the finished report straight to Vercel Blob storage.

If it's a brand-new store with no theme code yet and `GITHUB_OAUTH_CLIENT_ID` is set, the
CLI pauses first to ask whether you want to connect a GitHub repo — say yes and, the first
time, it'll show a one-time code and a github.com link to approve in your browser (no
token to paste); after that it fetches your repos, lets you pick one (type to search), and
clones it straight into `stores/<slug>/theme/` before the audit runs. See
[`link-repo`](#adding-a-store) below to do this on its own, any time.

**2. View it** — open https://barrel-site-audit.vercel.app, enter the site password, and
the report is already there, at the top of the list. No deploy step, no waiting — it's
live the moment step 1 finishes. The CLI also prints the exact report ID/URL when it's
done.

**3. (Optional) add the theme's code for deeper analysis.** Step 1 alone gives you
performance, SEO, accessibility, site health, and pixel/consent findings — no theme code
needed. To also get Theme Code Quality and Theme Structure findings, get the theme's
Liquid source into `stores/<slug>/theme/` — pull it via the Shopify CLI, clone it from
GitHub, or just copy/paste the files in yourself (unzip a theme export, drag files in
Finder, whatever's fastest) — then (re-)run the audit:

```
pnpm barrel-audit pull-theme <slug> --store <slug>.myshopify.com   # first time only, if pulling via Shopify CLI
# — or, if the theme lives in a GitHub repo instead —
pnpm barrel-audit link-repo <slug>                                 # prompts you to pick the repo
pnpm barrel-audit run <slug>
```

(`<slug>` is whatever `run` printed/created in step 1 — usually the store's hostname
with dots replaced by dashes, e.g. `client-store-com`.) Re-run `pnpm barrel-audit run
<slug>` any time to refresh the report — every run is saved as new history, nothing gets
overwritten.

That covers the common case end-to-end. The rest of this README is reference detail on
each piece.

## How it fits together

```
barrel-site-audit/
  cli/      the barrel-audit CLI — runs analyzers, writes report JSON
  shared/   report types + scoring helpers shared by the CLI (source of truth)
  web/      Next.js report site, deployed to Vercel, password-gated
  stores/   one folder per client store: config.json + theme/ (theme code you drop in)
```

Reports live in **Vercel Blob storage**, not in this repo — the CLI uploads each report to
`reports/<store>/<report-id>.json` and updates a `reports/manifest.json` index blob after
every run. Screenshots go to `screenshots/<store>/<report-id>/*.jpg` in the same private
Blob store; the web app proxies them through `/api/screenshot/...` (behind the same login)
so the Blob read/write token never reaches the browser. The web app reads straight from
Blob storage on every request (the manifest read always bypasses the CDN cache), so a new
report is live on the site **the moment the CLI finishes** — no redeploy, no commit.
Redeploying `web/` is only needed when the app's own code changes.

## One-time setup

Requires **Node 22+** (`sitespeed.io`, used by the optional `--sitespeed` flag, hard-requires it).

```
pnpm install
pnpm --filter @barrel/site-audit-shared build   # CLI depends on this
pnpm --filter @barrel/site-audit-cli build
```

Copy `.env.example` to `.env` at the **repo root** and fill in a Blob read/write token
(Vercel dashboard → Storage → your Blob store → `.env.local` tab). The CLI loads this file
automatically. `BLOB_READ_WRITE_TOKEN` is required for `pnpm barrel-audit run` and `pnpm barrel-audit list`
to reach Blob storage; `ANTHROPIC_API_KEY` is optional and enables the AI-written executive
summary (skipped cleanly if unset).

The `web/` app needs three env vars (see `web/.env.example`):

- `SITE_PASSWORD` — shared password to view the report site
- `SESSION_SECRET` — long random string used to sign the login session cookie
- `BLOB_READ_WRITE_TOKEN` — same Blob store as the CLI, so the site can read reports

These are already set on the Vercel project (`barrel-8677f380/barrel-site-audit`) for
Production and Preview. For local dev, copy `web/.env.example` to `web/.env.local` and
fill in your own values.

## Adding a store

```
pnpm barrel-audit init-store <slug> --url https://client-store.com --name "Client Name" [--shopify-domain <slug>.myshopify.com]
```

This scaffolds `stores/<slug>/config.json` and `stores/<slug>/theme/`. You can also just
run `pnpm barrel-audit run <url>` directly against a live URL — it auto-creates the store from
the hostname.

`stores/<slug>/theme/` is a plain folder — get theme code into it any of three ways:

- **Pull it via the Shopify CLI:**

  ```
  pnpm barrel-audit pull-theme <slug> --store <slug>.myshopify.com
  ```

  (`--store` is only needed the first time — it's saved to `config.json`.) This opens a
  browser to authenticate with Shopify if needed.

- **Clone it from a GitHub repo:**

  ```
  pnpm barrel-audit link-repo <slug-or-url>
  ```

  Like `run`, this accepts an existing store slug or a live URL directly (auto-creating
  the store from its hostname if needed) — so you can point it straight at a storefront
  or preview URL without an `init-store`/`run` step first.

  Requires a one-time team setup: create a GitHub OAuth App (Settings → Developer
  settings → OAuth Apps → New OAuth App, at https://github.com/settings/developers),
  enable **Device Flow** on it, and put its Client ID in `.env` as
  `GITHUB_OAUTH_CLIENT_ID` (see `.env.example`) — no client secret needed, and the Client
  ID isn't sensitive, so this is shared once across the team, not per-person.

  The first time anyone runs `link-repo`, it prints a one-time code and a github.com link
  — open the link, enter the code, approve access, and you're done; the login is cached
  at `~/.config/barrel-audit/github-token.json` so it won't ask again on that machine
  (pass `--relogin` to force a fresh login, e.g. after switching GitHub accounts). From
  there it prompts you to search/select from your GitHub repos (type to filter) and
  clones the pick straight into `stores/<slug>/theme/` — pass `--repo <owner/name>` to
  skip the picker, and `--branch <branch>` to override the repo's default branch. If
  `theme/` already has files in it, you'll be asked to confirm before it's cleared. `run`
  on a brand-new store offers this same prompt inline, so you often won't need to call it
  directly.

- **Or just copy/paste the files in yourself** — unzip a theme export, drag files in
  Finder, `cp -r` from a local checkout, whatever's fastest. No CLI step required; the
  next `pnpm barrel-audit run <slug>` picks up whatever's in the folder.

- **Or point straight at a repo you already have cloned**, instead of copying anything
  into `theme/` at all:

  ```
  pnpm barrel-audit run <slug-or-url> --local-repo /path/to/your/theme-checkout
  ```

  This is the option for a dev auditing (and fixing) their own working copy — see
  [Auditing a repo you already have cloned](#auditing-a-repo-you-already-have-cloned)
  below.

Either way, `theme/` is gitignored — it's per-machine working state, not versioned here.

## Auditing a repo you already have cloned

`run --local-repo <path>` reads theme code straight from an existing git checkout instead
of copying it into `stores/<slug>/theme/`:

```
pnpm barrel-audit run https://client-store.com --local-repo .
```

The path is saved to that store's `config.json` (as `localThemeDir`), so later runs and
fixes for the same store keep using it without repeating the flag.

**You usually don't need the flag at all.** If you run an audit from inside a Shopify theme
checkout (detected by `layout/theme.liquid`, searching up from the current directory so a
subfolder works too), that checkout is used automatically and saved the same way — it prints
which directory it picked. This only kicks in when the store has no theme code of its own, so a
managed store set up via `link-repo`/`pull-theme` is never silently overridden by whatever
directory you happened to be standing in. Pass `--local-repo <path>` explicitly to override the
detection.

**Auto-detection can't work from the dashboard.** It reads the process's working directory, and a
dashboard-triggered run is spawned in the data root, never in the theme repo you're working on —
so from `/run` the path has to be given explicitly, in the **Theme code location** field (see
[Running an audit from the dashboard](#running-an-audit-from-the-dashboard)). It's the same
`--local-repo` value, saved to `config.json` the same way.

**A run that was asked for code review with no code to review now fails immediately** rather than
returning a report whose theme sections are simply absent — indistinguishable, to whoever opens
the report, from a clean bill of health. The error names the directory it looked in and lists both
ways out (point it at some code, or `--skip-code`). The same preflight rejects a path that has no
`layout/theme.liquid`, and suggests the subfolder if your repo keeps the theme one level down —
checked *before* the path is written to `config.json`, so a typo can't leave a store permanently
pointed at the wrong tree. This is the natural
fit for a dev who already has the theme repo checked out locally — one dev per repo, one
audit at a time — as opposed to `link-repo`/`pull-theme`, which clone a fresh managed copy
and suit auditing many stores you don't otherwise have on disk.

It changes how "Suggest fix" on the report page delivers a fix, too: instead of cloning
the GitHub repo into a disposable branch and opening a pull request, the fix is written
**directly into `--local-repo`'s path, left unstaged** — exactly like any other local edit.
Nothing is committed or pushed automatically; review the diff with your own git tooling
(`git diff`) and commit it yourself once you're happy with it. This is deliberately the
most conservative delivery option available — no branch, no PR, no chance of an
AI-generated change reaching GitHub without a human in the loop first.

## Installing the CLI outside this repo

Day to day, `pnpm barrel-audit ...`/`pnpm run audit ...` from inside this checkout (as
above) is the easiest way to run it. If you'd rather not clone `barrel-site-audit` at all
— e.g. you just want `barrel-audit` available globally to run against your own theme
repo — install the published package instead:

```
# one-time: point the @barrel scope at GitHub Packages and authenticate
echo "@barrel:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc   # needs a token with read:packages

npm install -g @barrel/site-audit-cli
```

From anywhere, that gives you the same `barrel-audit` command:

```
cd ~/code/some-client-theme-repo
barrel-audit run https://client-store.com --local-repo .
barrel-audit serve                                        # or drive it from the dashboard
```

Note there's no `pnpm` in front of these. `pnpm barrel-audit ...` resolves the `barrel-audit`
script from this repo's root `package.json`, so in any other directory it fails with
`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` — call the global `barrel-audit` binary directly instead.
(There's also no `barrel-audit install` command; installing is the `npm install -g` step above.)

With no `barrel-site-audit` checkout on disk, config/store data lives in `~/.barrel-audit/`
instead of `stores/` (created automatically), and env vars (`BLOB_READ_WRITE_TOKEN`,
`ANTHROPIC_API_KEY`) load from `~/.barrel-audit/.env` if present, else the shell
environment — create that file the same way you would `.env` at the repo root (see
[One-time setup](#one-time-setup)).

**Publishing a new version** (maintainers): `shared` publishes first since `cli` depends
on it.

```
pnpm --filter @barrel/site-audit-shared build && pnpm --filter @barrel/site-audit-shared publish --no-git-checks
pnpm --filter @barrel/site-audit-cli build && pnpm --filter @barrel/site-audit-cli publish --no-git-checks
```

Requires the same `~/.npmrc` auth line as above, but with a token that has
**`write:packages`** instead of (or in addition to) `read:packages`.

## Running an audit

```
pnpm barrel-audit run <slug-or-url>
```

Pass an existing store slug, or a live URL to auto-create a store from its hostname. This
runs every analyzer below and writes one report:

**Realistic data, by design:** every headless-Chrome analyzer (Lighthouse, axe-core, the
pixel/UX/agent-readiness audits, screenshots) launches its own Chrome instance with `--incognito`
and a brand-new temp profile (`chrome-launcher`'s default — created fresh per launch, deleted on
exit), and Lighthouse explicitly resets storage before every run — no signed-in session, cached
asset, extension, or prior run's cookies can leak into the numbers. If you're auditing a Shopify
**theme preview** link (a `?...&preview_theme_id=...&key=...` URL, not the published site), two
extra things happen automatically: (1) the floating preview bar — which injects DOM/script that
skews layout-shift and load timing — is disabled by appending `pb=0`; (2) the preview token is
carried onto every discovered journey page (Collection/Product/Cart), not just Home, since losing
it would otherwise silently audit the *live* published theme on every page but the first. Preview
links still carry one unavoidable cost the live site doesn't: an extra token-check redirect on
first load, so expect a slightly worse TTFB/load time than the same theme once actually published.

- **Code** — [Shopify Theme Check](https://shopify.dev/docs/storefronts/themes/tools/theme-check)
  against `stores/<slug>/theme/`. Skips automatically if no theme code has been added yet.
- **Theme Structure** — static analysis of the theme folder: orphaned sections/snippets
  (unreferenced and, for sections, without customizer presets), leftover test/backup
  files, hash-named auto-generated files, and competing page-builder apps (Shogun,
  PageFly, EComposer, GemPages, Zipify, Replo).
- **Theme Architecture** *(AI, shown inside the Theme Code Quality section)* — a Claude-written
  assessment of how the theme is actually built, grounded in the Theme Check/Theme Structure
  signals above plus a real sample of the theme's source (same sampler `ai-suggestions.ts`
  uses): a short narrative (custom-built vs. stock-based, page-builder reliance, Online Store
  2.0 vs. legacy Liquid-template architecture), a verdict table for specific platform-feature
  adoption (JSON templates, section groups, theme blocks/app-block support, metafields,
  settings-schema quality), and any other architectural concerns beyond raw lint errors — all
  of which feed the Roadmap/Dev To-Do list like any other finding. Requires
  `ANTHROPIC_API_KEY`; skip with `--skip-theme-architecture`.
- **Performance** — Lighthouse across the shopping journey: the CLI auto-discovers a
  Home, Collection (`/collections/all`), Product (via the store's public
  `/products.json`), and Cart page, then runs full Lighthouse passes on each for both
  mobile and desktop (Performance, Accessibility, Best Practices, SEO). Any page/device
  combo that fails to load is skipped rather than failing the whole audit. Detailed
  Core Web Vitals and the top failing audits come from the homepage/mobile run. This is
  the slowest analyzer — expect several minutes per audit. Also captures the real browser
  console errors logged during that homepage/mobile run (Lighthouse's own `errors-in-console`
  audit detail rows — network failures, CSP/MIME violations, uncaught JS exceptions), shown
  as their own "Console Errors" area in the **Trust & Privacy** section with the affected
  file/line where available, each feeding the Roadmap/Dev To-Do list. Also captures Lighthouse's
  **Agentic Browsing** category (ships by default from `lighthouse@13.3+`, requires a recent
  enough local Chrome) — how well an AI browsing agent (not a search crawler) can navigate and
  act on the homepage: agent-facing accessibility-tree quality, WebMCP integration, layout
  stability, and an `llms.txt`. Scored as a pass/total fraction rather than 0-100 (Google's own
  wording: "still under development and subject to change"), shown in Site Vitals as its own
  checklist and deliberately excluded from `overallScore`. Absent entirely on older/incompatible
  Chrome, or on reports run before this field existed.
- **Accessibility (axe-core)** — a second, independent accessibility signal: an automated
  [axe-core](https://github.com/dequelabs/axe-core) scan of every discovered journey page
  (Home, Collection, Product, Cart), catching issues Lighthouse's fixed audit set doesn't
  (keyboard traps, ARIA misuse on widgets that render after first paint, etc.). Reported
  alongside the Lighthouse accessibility score, plus a WCAG-category readiness checklist
  (axe's own `cat.*` taxonomy — one row per category) and every violation as an actionable
  finding (rule, affected elements, WCAG guidance link) feeding the Roadmap/Dev To-Do list.
  Throttled the same way as the UX audit below (single browser session, sequential loads,
  randomized pause, normal desktop UA). Skip with `--skip-axe`.
- **ADA Scope Checker** *(opt-in, needs a scope to check)* — verifies a client's own scoped
  accessibility requirements, line by line, against what the run actually measured. Paste the
  scope from the SOW (bullets, numbered lists, a "such as:" preamble and one-long-paragraph
  formats all parse) into the dashboard's **ADA scope** field, or pass
  `--ada-scope-file <path>` / `--ada-scope "<text>"`; it's saved to the store's `config.json`,
  so later runs re-check the same list without re-pasting. Each line is keyword-matched against
  a catalog of automated checks (`shared/src/ada-scope.ts`) — keyboard/TAB reach, visible focus
  indicators, skip-nav link, alt text, contrast, form labels, headings, landmarks, link/button
  names, ARIA, page language/title, tables, and WCAG A/AA as a whole — with Claude mapping any
  wording the keyword catalog doesn't recognize, and anything genuinely unautomatable (captions,
  screen-reader passes, zoom/reflow, PDFs) labelled as a manual check rather than quietly passed.
  Verdicts come from three sources: axe-core rules, Google Lighthouse's accessibility audits
  (whose score is shown on the section), and a live browser probe that presses real TAB keys
  through every journey page — comparing what the keyboard reaches against every visible
  interactive element, diffing each element's computed styles (outline, box-shadow, border,
  background, `::before`/`::after`) between its unfocused and keyboard-focused states, and
  checking the skip link's target and its reveal-on-focus. Focus traps (consent dialogs, drawers)
  are detected and reported as the finding rather than as a page full of unreachable controls,
  and a pass that runs out of key presses is reported as unfinished rather than as failures.
  Every item that isn't complete carries a developer-ready action naming the failing selectors,
  and those items also flow into the Roadmap/Dev To-Do list. The section's grade is scope
  completion, not site quality, so it's deliberately excluded from `overallScore`.
- **Sitespeed.io** *(opt-in, `--sitespeed`)* — a second, independent **performance** signal
  alongside Lighthouse: [sitespeed.io](https://www.sitespeed.io/) (Browsertime + its Coach
  plugin) runs 3 real-browser iterations against the homepage and reports a median-based
  score (0-100, plus Performance/Best Practice/Privacy sub-scores from Coach's own rule set —
  different from Lighthouse's), key timing metrics (TTFB, FCP, LCP, Total Blocking Time, CLS,
  full page load time, request count, page weight), and every sub-100 Coach rule as an
  actionable finding feeding the Roadmap/Dev To-Do list. This is a separate CLI subprocess with
  its own browser automation — noticeably heavier/slower than the rest of the suite (expect it
  to roughly double a run's total time), which is why it's opt-in rather than on by default.
  Shown in the Site Vitals page alongside the Lighthouse-based sections above.
- **Site Health** — custom checks against the live URL: HTTPS, meta tags, canonical,
  structured data (parses the homepage's JSON-LD and reports the actual schema.org `@type`s
  found, e.g. "Found: Organization, WebSite, BreadcrumbList" — not just a block count), image
  alt-text coverage, third-party script count, password-page detection, robots.txt, sitemap.xml.
- **Pixel & Tracking Audit** — a live headless-browser pass over the homepage: whether
  Meta, Google Ads/GA4, Microsoft Clarity, TikTok, and Pinterest pixels actually fire on
  the network (vs. just being referenced in code), whether a cookie-consent mechanism is
  present, and a flag if pixels fire unconditionally with no consent mechanism detected.
- **Security & Compliance** — its own report section, built entirely from HTTP responses, the
  delivered HTML and one TLS handshake (no browser, ~2s): the security headers
  (`Content-Security-Policy` — present *and* whether its `script-src` is meaningfully
  restrictive, `Strict-Transport-Security` and its `max-age`, `X-Content-Type-Options`,
  clickjacking protection via CSP `frame-ancestors` or `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`); transport (HTTP→HTTPS redirect and whether it's permanent, mixed
  content in the delivered markup, TLS certificate validity and days to expiry); cookie flags
  (`Secure` and `SameSite` on everything the homepage sets, `HttpOnly` on session/auth cookies
  only — analytics cookies are read by the front-end scripts that own them, so demanding it of
  them would break the tag); exposed surface (`/.env`, `/.git/config`, `/.git/HEAD`,
  `/config.json` — each only reported when the response body actually matches that file's
  format, since plenty of hosts answer every unknown path with the storefront's own HTML;
  published source maps; `Server`/`X-Powered-By` version disclosure); and the script supply
  chain (cross-origin `<script src>` without SRI, the count of distinct third-party script
  origins, and the jQuery version read from the library file itself). Every check carries the
  header value, cookie name or URL it was read from, so a reader can re-check it with `curl`.
  A control that could not be observed is reported as **not tested** — never rounded into a
  pass or a fail — and excluded from the score entirely. Skip with `--skip-security`.
- **Best Practices** — a verdict table (Good / Needs Improvement / Poor) synthesized from
  the sections above: deprecated Liquid patterns, performance, accessibility, theme
  structure, page-builder usage, and lint/CI enforcement.
- **SEO Opportunities** — its own report section: title/meta-description length, heading
  structure, Open Graph tags, and canonical URL, each flagged with an impact level and a
  concrete recommendation, with its own health-rating badge.
- **GEO — Generative Engine Optimization** — a separate report section covering AI/LLM
  answer-engine and agentic-commerce readiness: whether major AI/LLM crawlers (GPTBot,
  ClaudeBot, PerplexityBot, Google-Extended, etc.) are allowed by `robots.txt`, whether
  `llms.txt` is present, whether a sample product page carries real Product/Offer schema.org
  data, and dedicated checks for **Organization**, **WebSite**, and **BreadcrumbList**
  structured data (checked across the homepage and the sample product page, each with its own
  pass/warn and a concrete Liquid snippet to add if missing) — an *Agentic Commerce & AI
  Discoverability* verdict table (structured product data, a machine-readable product feed, AI
  crawler access, FAQ/Q&A schema, brand-entity clarity via Organization `sameAs` links), and a
  synthesized "Areas to Improve" list. Skip with `--skip-geo-seo`.
- **Agent Readiness** — a deeper, catalog-wide follow-on to GEO focused specifically on whether
  an AI shopping agent can actually *transact* against this store, not just discover it. Samples
  up to 8 products (plain `fetch()` calls to `/products.json` + each PDP — no browser) and checks,
  per-SKU rather than sampled once: (1) AI crawler access via `robots.txt` (same crawler list as
  GEO); (2) whether price/availability are present in the raw, pre-JS HTML (via Product/Offer
  JSON-LD or a price meta tag) — an agent that has to execute heavy JavaScript to see current
  price or stock will often abandon the crawl; (3) per-SKU Product/Offer schema completeness
  (`sku`, `price`, `priceCurrency`, `availability`) walked across every variant in a
  `ProductGroup.hasVariant`, not just checked once for the whole product; (4) whether returns/
  shipping/warranty are exposed as structured data (`hasMerchantReturnPolicy`/`shippingDetails`
  on the Offer) rather than only a prose policy page; (5) size-attribute consistency across the
  sampled catalog (e.g. "XL" vs "X-Large" vs "extra large" all used for the same size breaks
  agent-side SKU comparison); (6) price agreement between `/products.json` (the "feed") and each
  sampled product's own live Offer schema (the "site") — a mismatch here causes shopping-feed
  disapprovals and agent mistrust. Every SKU/catalog issue found feeds the Roadmap/Dev To-Do
  list like any other finding. On by default; skip with `--skip-agent-readiness`.
- **UX & Conversion** — a focused review of one collection page and one product page (not a
  full-site crawl): deterministic checks (add-to-cart visibility, reviews/social proof, trust
  badges, image count, breadcrumbs, collection filters/quick-add) plus an AI vision critique
  (Claude, screenshots + the deterministic signals) that returns specific, screenshot-grounded
  conversion opportunities. **Throttled** to avoid tripping a target site's bot protection: a
  single browser session, sequential page loads with a randomized 2–4s pause between them, a
  normal desktop Chrome user agent (not the default headless-Chrome signature), and no
  retries. Skip with `--skip-ux`.
- **Traffic & Revenue** — real sessions, conversion rate, average order value, revenue,
  and channel/device breakdown, pulled from the client's own GA4 property. Requires a
  one-time Google Cloud service-account setup plus a per-store `ga4PropertyId` — see
  [`docs/ga4-setup.md`](docs/ga4-setup.md). Skipped otherwise.
- **AI Suggestions** — a prioritized, actionable list of performance and accessibility
  (ADA/WCAG) fixes generated by Claude from the Lighthouse performance/accessibility
  signals and — when theme code is present — a sample of the actual Liquid/JSON source,
  so suggestions can cite specific files. Advisory only, not part of any score. Requires
  `ANTHROPIC_API_KEY`; skip with `--skip-ai-suggestions`.
- **Summary** — a short AI-written executive overview + key findings, generated with
  Claude (`claude-opus-5`) from the full report. Requires `ANTHROPIC_API_KEY`; skipped
  otherwise. Token usage (input/output/total tokens, model, estimated cost) is stored on the
  report itself and shown in the report footer, next to Methodology.
- **Competitor Benchmark** *(optional)* — a lightweight single-page (homepage, mobile)
  Lighthouse pass plus a site-health check on each `--competitor <url>` you pass, shown
  side by side with this site's own scores in the report. Great for sales-cycle "here's
  how you stack up" conversations. Pass it multiple times to compare against several
  competitors at once (capped at 5 — each one runs a full local Chrome/Lighthouse/screenshot
  pass, so this bounds resource usage per run, not a third-party quota):
  ```
  pnpm barrel-audit run <slug-or-url> --competitor https://competitor-a.com --competitor https://competitor-b.com
  ```
- **Screenshots** — a full-page mobile screenshot of the homepage (and of each
  `--competitor` URL, when passed) is captured and stored in Vercel Blob, then shown
  inline in the Lighthouse Vitals and Competitor Benchmark sections. Skip with
  `--skip-screenshots`.

Flags: `--skip-code`, `--skip-performance`, `--skip-axe`, `--skip-theme-architecture`, `--skip-health`, `--skip-pixels`, `--skip-geo-seo`, `--skip-agent-readiness`, `--skip-ux`, `--skip-analytics`, `--skip-screenshots`, `--skip-ai-suggestions`, `--skip-summary`, `--skip-github`, `--competitor <url>` (repeatable), `--ada-scope <text>` / `--ada-scope-file <path>`, `--sitespeed` (opt-in, off by default), `--local-repo <path>`.

Without `--skip-code`, the run refuses to start unless it can find theme code to review — see
[Auditing a repo you already have cloned](#auditing-a-repo-you-already-have-cloned).

### Rate limits & quotas

Per `run`, the tool's external-API footprint is small and fixed, independent of how often the
team runs audits:

- **Claude (Anthropic API)** — up to 5 calls per run: the executive summary, the UX audit's
  screenshot critique (skipped if `--skip-ux` or `--skip-summary`, or if no UX pages could be
  loaded), the AI performance/accessibility suggestions list (skipped with
  `--skip-ai-suggestions`, or if there's neither Lighthouse data nor theme code to ground it
  in), the Theme Architecture assessment (skipped with `--skip-theme-architecture`, or if
  there's no theme code), and the ADA Scope Checker's mapping call (only when an ADA scope was
  supplied *and* some line in it didn't match the keyword catalog). Combined token usage across all calls is recorded on the report and
  shown in its footer, so real spend is always visible per audit.
- **Google Analytics Data API (GA4)** — exactly 3 `runReport` calls per run, only when a store
  has `ga4PropertyId` configured. Well inside Google's default per-property quota (25,000
  requests/day).
- **Competitor benchmarking** — capped at 5 `--competitor` URLs per run (excess ones are
  dropped with a logged warning, not silently truncated). This isn't a third-party quota — it
  bounds local Chrome/Lighthouse/Puppeteer resource usage, since each competitor runs a full
  headless-browser pass.
- **UX audit & Accessibility (axe-core) — target-site bot protection** — these are the two
  analyzers that specifically guard against tripping a client site's own WAF/bot detection
  (Cloudflare, etc.), not just an API quota: each uses a single browser session that loads its
  pages sequentially, with a randomized 2–4s pause between them and a normal desktop Chrome
  user agent, then stops — no retries, no parallel tabs, no repeated hits on the same URL.
- **Sitespeed.io** *(opt-in, `--sitespeed`)* — not an API quota either, but the heaviest single
  step in the tool: a separate CLI subprocess (Browsertime driving its own Chrome via
  chromedriver) runs 3 full real-browser iterations against the homepage. Expect it to roughly
  double a run's total time — this is exactly why it's opt-in rather than on by default.
- **Everything else** (Lighthouse, site health, GEO/SEO checks, pixel audit, screenshot
  capture, theme-code linting) either runs entirely locally (headless Chrome, Shopify Theme
  Check) or hits the client's *own* storefront directly (a handful of plain `fetch()` calls to
  its homepage, robots.txt, llms.txt, and products.json) — no third-party API or quota involved.

All of the above run sequentially within a single `run` (no concurrent bursts), and every
external call (Claude, GA4, target-site fetches) is wrapped to fail soft — a rate-limit or
network error drops just that section from the report rather than crashing the audit. Worth
noting: the *overall* `run` already touches the Collection and Product pages several times via
Lighthouse's own multi-page x multi-device sweep before the UX audit even starts — across a
full default run that's roughly a dozen total page loads spread across analyzers, which is
still a very light, human-plausible volume, nowhere near the request rates that typically
trigger bot-scoring.

Other commands:

```
pnpm barrel-audit list          # list stores and their past reports
pnpm barrel-audit deploy        # deploy web/ to Vercel (preview)
pnpm barrel-audit deploy --prod # deploy to production (no "--" before --prod — pnpm forwards
                                 # a literal "--" into the CLI's argv here and Commander then
                                 # drops --prod as a stray positional, silently deploying preview)
```

## The landing page

A searchable, paginated (20/page) list of every report ever run, newest first, across
all stores. Search matches store name, slug, or URL. Each report's detail page also
links to other reports for the same store. `pnpm barrel-audit deploy` is only for
shipping changes to the web app's own code (new sections, styling, etc.) — it's never
needed just to publish a report.

An **Archive** button on each row (also on the report page itself, next to Share) hides a
report from this default list without deleting anything — the report blob, its direct link,
and its place in Baseline & Reporting history all keep working exactly as before. Archived
reports live under the **Archived** tab next to the search box, with an **Unarchive** button
to bring one back. The flag (`archived` on the manifest entry, toggled via `POST /api/archive`)
lives in the same `reports/manifest.json` blob as `isBaseline` — set/cleared only from the web
app, never touched by the CLI.

## Running an audit from the dashboard

`/run` (a "+ Run Audit" button on the landing page) is a form-based alternative to typing CLI
flags: enter a store slug or URL, check the boxes for which analyzers to include (inverted from
the CLI's `--skip-*` flags — checked means "run it"), optionally add up to 5 competitor URLs,
and click **Run audit**. With **Theme code & structure** checked, the **Theme code location** field
is where you put the absolute path to a local theme checkout (the folder containing
`layout/theme.liquid`) — it becomes `--local-repo` and is saved to the store, so it's entered once
per store. Leave it blank to use whatever the store already has; leave it blank with nothing there
and the run stops in its first second rather than producing a report with no code findings in it. It POSTs to `/api/run`, which spawns `pnpm barrel-audit run ...` as a
real local child process (args passed as an array, never through a shell, so nothing you type
can inject extra flags) and streams the CLI's own stdout/stderr straight into the page as it
runs; once it finishes, a "View report" link appears automatically.

While it's running, the page shows a friendlier progress screen instead of a raw log: an elapsed
timer, the current stage in plain language (parsed from `→ <stage>` lines — the CLI only prints
those when its stdout isn't a TTY, i.e. exactly when it's being driven this way, see
`cli/src/commands/run.ts`), and a rotating "did you know?" barrel-history fact
(`web/lib/barrel-facts.ts`) to make a multi-minute Lighthouse pass less of a staring contest. The
raw log is still one click away ("Show raw CLI output"), and the plain terminal-style view comes
back once the run finishes or fails. If it fails, the reason is shown on the failure screen itself,
not just buried in that log — the CLI fences a failed run's message in `__BARREL_AUDIT_ERROR__`
markers when its stderr isn't a TTY, alongside the `__BARREL_AUDIT_DONE__<code>__` trailer the page
already parsed. This only updates live as long as both the browser tab and whatever's actually
running the CLI (the terminal, or the `serve` agent below) stay open — closing either one stops the
run.

**Stop audit** (on the progress screen, behind a confirmation, since nothing partial is saved) ends
the run for real. It works by aborting the request, which both backends treat as "stop", and the
kill has to reach three things:

- **The process group, not just the child.** `/api/run` spawns `pnpm`, which execs the CLI, so
  killing the direct child wouldn't even stop the audit. Both backends spawn `detached` and signal
  the negative pid — SIGTERM, then SIGKILL five seconds later (`killRunTree`, duplicated in
  `web/app/api/run/route.ts` and `cli/src/commands/serve.ts` because `web/` deploys standalone).
- **Headless Chrome, which the group kill misses.** chrome-launcher spawns each browser `detached`
  too, in its own group, reparented to init — verified by watching a Chrome keep running, and keep
  spawning renderers, a minute after its parent audit was killed. So the CLI installs signal
  handlers (`cli/src/shutdown.ts`) that call chrome-launcher's `killAll()` — which closes only the
  browsers that process opened, never yours — before exiting. This is why SIGTERM gets five seconds
  before SIGKILL: SIGKILL can't run a cleanup handler.
- **The single-flight lock.** Clearing it has to happen before anything touches the response
  stream: enqueueing to a controller whose consumer has disconnected throws, which previously threw
  out of the exit handler before the lock was released — leaving "an audit is already running"
  stuck for the life of the process.

By itself this only works when the report site is running locally (`pnpm dev` in `web/`) — it
spawns the CLI on whatever machine is running the Next.js server, and the deployed Vercel site
has no local Chrome, no `stores/*/theme`, and no pnpm to reach. `/api/run` checks for
`process.env.VERCEL` and refuses with a clear message rather than failing confusingly if hit
there. Only one run at a time is allowed (a second attempt gets a 409) since two concurrent
Lighthouse/Chrome passes on one machine would fight over the same resources.

### Running it from the deployed dashboard

```
pnpm barrel-audit serve [--port 5757]     # from inside this checkout
barrel-audit serve [--port 5757]          # or anywhere, with the CLI installed globally
```

Starts a small local HTTP agent bound to `127.0.0.1` only (never your network) and prints a
one-time token. The `/run` page's "Local agent" panel detects it and, once you paste in the
token, submits runs straight to `http://127.0.0.1:<port>/run` **from the browser** instead of
through `/api/run` — this works even when the dashboard itself is the deployed Vercel site,
because the browser is still running on your own machine regardless of which origin loaded the
page; that request never touches Vercel. (Browsers treat `127.0.0.1`/`localhost` as a
"potentially trustworthy" target even from an `https://` page, so this isn't blocked as mixed
content.)

CORS alone doesn't gate access here — any page can send a "simple" cross-origin request whether
or not the response is readable — so every `/run` request must present the token as
`Authorization: Bearer <token>`; a wrong or missing one gets a 401 and the dashboard prompts you
to re-paste it. The token is generated fresh each time you run `serve` and only lives in that
terminal session's output plus your browser's `localStorage` — nothing is written to disk or
Blob. Same single-flight rule as above: one run at a time per agent.

`serve` works from any directory, including a client theme repo with no `package.json` of its
own — it stores stores/reports under whichever root [`dataRoot()`](cli/src/paths.ts) resolves to
(this checkout if you're inside one — matched on the root `package.json` name, so a client repo
that happens to be a pnpm workspace isn't mistaken for it — otherwise `~/.barrel-audit/`, created
on first run) and
re-invokes its own binary for each audit rather than shelling out to `pnpm`. Note that `pnpm
barrel-audit serve` only works *inside* this checkout: `pnpm <script>` needs a `package.json` in
the current directory, so from anywhere else drop the `pnpm` and call `barrel-audit serve`
directly (see [Installing the CLI outside this repo](#installing-the-cli-outside-this-repo)).

## Privacy Compliance

Behavioural cookie-consent testing across every client site at once. It drives each banner for
real — reject, accept, analytics-only, returning visitor — and asserts that trackers actually stop
and start, rather than only checking that a banner exists.

```bash
pnpm barrel-audit consent-scan                      # every active site in sites.yml
pnpm barrel-audit consent-scan waterloo             # one registry entry, by slug
pnpm barrel-audit consent-scan https://example.com  # ad hoc, not in the registry
pnpm barrel-audit consent-scan --inventory          # which CMP is where — fast, presence only
pnpm barrel-audit consent-scan --seed               # draft sites.yml from stores/
```

32 tests across 8 suites, run in five fresh incognito browser states plus a Global Privacy Control
probe. Results land on **/consent** in the dashboard (worst sites first) and, for a single site,
as a **Privacy Compliance** section in its normal report. The command exits non-zero on any
blocker-severity failure, so it can gate CI unchanged.

The list of sites to scan lives in `sites.yml` at the repo root — a reviewed file, seeded from
`stores/` and hand-completed once. A theme repo almost never contains its own production domain,
so that one pass is unavoidable; `--seed --from-repos` at least lists the repos it couldn't place.

Supported CMPs: Cookiebot, OneTrust, Osano, CookieYes, Shopify Customer Privacy, plus a heuristic
adapter so an unrecognised banner still gets driven rather than silently dropping out of coverage.

**This reports technical behaviour, not legal compliance.** "Meta Pixel fired before consent" is a
fact; what it means under a given statute is counsel's call.

Full test plan, result-state semantics, and how to add a CMP adapter or tracker:
[`docs/consent-qa.md`](docs/consent-qa.md).

## Baseline & Reporting

For stores audited more than once over the course of an engagement (running audits at
different points in the SDLC — pre-build, mid-build, pre-launch), the **Baseline & Reporting**
link (header of the landing page and every report page) shows change over time instead of one
report in isolation:

- `/progress` — every store with its full audit history, a sparkline of `overallScore`
  across runs, and its current score vs. baseline delta, sorted by most recently audited.
- `/progress/<slug>` — that store's full run history, newest first, each row's score
  compared against the baseline with a colored ±delta badge.

Any run can be marked the **baseline** via the "Set baseline" button on its row in
`/progress/<slug>` — at most one per store; marking a different run moves it, clicking the
current baseline's button again clears it. With no baseline explicitly set, the earliest
report for that store stands in automatically, so every store shows a trend from the first
run without extra setup. The flag (`isBaseline` on the manifest entry) is stored in the same
`reports/manifest.json` blob the CLI already writes — set/cleared only from the web app via
`POST /api/baseline`, never touched by the CLI.

## AI-suggested code fixes, gated behind review

Dev To-Do items that point at a real theme file (Theme Check errors, file-grounded AI
suggestions — anything with a `file` field, `web/lib/findings.ts`) get a **Suggest fix** button.
This is a three-gate flow, never automatic and never bulk:

1. **Pick one item.** Clicking "Suggest fix" is the only way anything happens — there's no
   multi-select or "do this for everything" action anywhere in the Dev To-Do list.
2. **Review the diff.** This calls the local agent's `POST /suggest-fix` (needs
   `barrel-audit serve` running and connected, same as Run Audit — there's no server-side
   fallback here, since it needs real access to the theme checkout). It reads the actual current
   file, asks Claude for a complete corrected version (with the `web_search` tool available for
   confirming current Shopify/Liquid syntax against shopify.dev), and validates the result
   against Shopify's real Theme Check engine on a scratch copy before showing you anything.
   Nothing is written yet. Cancel at this point and nothing happens — no branch, no commit,
   nothing sent to GitHub.
3. **Choose how to proceed.** For a store audited with `run --local-repo <path>` (see
   [Auditing a repo you already have cloned](#auditing-a-repo-you-already-have-cloned)),
   there's exactly one option — **Apply to local repo**, which writes the change directly
   into that checkout via `POST /apply-fix`, unstaged, and stops. No clone, no branch, no
   PR — review and commit it yourself. Every other store gets the three GitHub-backed
   options below, any or all of them, in any order, and nothing happens until you pick one:
   - **Open in VS Code** — `POST /fix/prepare` clones the store's linked GitHub repo into a
     persistent working directory (`stores/<slug>/fixes/<branch>/`, never
     `stores/<slug>/theme/`, which has no git history on purpose — see `link-repo`), creates the
     fix's branch, and writes the suggested change — uncommitted. `POST /fix/open-editor` then
     runs `code --goto` on that file. Edit however you like; nothing is pushed yet.
   - **Test live (Shopify CLI)** — reuses the same prepared branch and runs
     `shopify theme dev --path <dir>` against it (`POST /fix/preview`, polled via
     `GET /fix/preview-status`), surfacing whatever preview URL(s) it prints. Requires
     `shopify auth login` to have been run previously (or a Theme Access password configured) —
     if not, the CLI's own prompt shows up in the log instead of a URL. `POST /fix/stop-preview`
     kills it; closing the panel does this automatically.
   - **Push branch & open PR** — `POST /apply-fix` commits whatever is currently in the prepared
     branch (including any manual edits made via VS Code) and pushes it, or — if nothing was
     prepared first — clones, branches, commits, and pushes in one shot. Either way it opens a PR
     and stops. Merging is 100% normal GitHub review; this tool is structurally incapable of
     merging anything (`cli/src/git-pr.ts` only ever calls `pulls.list`/`pulls.create`, enforced
     by a build-time grep check, `cli/scripts/verify-git-pr-safety.mjs`). Client repos should have
     branch protection on their base branch requiring review before merge — that's the guarantee
     that holds even if this code ever had a bug.

Retrying a push is always safe: the branch name is derived deterministically from the finding
(not random), so a retry after a partial failure resumes the same branch instead of creating a
duplicate, and re-pushing a fix whose PR was already merged is rejected with a clear error rather
than opening a redundant one. If the file changed on GitHub between "Suggest fix" and preparing
the branch, that step detects the drift (a content hash captured at suggestion time) and refuses
to overwrite it — re-run "Suggest fix" to regenerate against the latest version.

Shopify's own MCP server was considered and skipped: it's stdio-only (no hosted endpoint), and
the one thing it would have provided — Shopify's Theme Check engine — is already a direct
dependency this CLI uses elsewhere (`cli/src/analyzers/code.ts`).

## Report pages

Each report is split across multiple pages instead of one long scroll, with a sticky
tab bar (Overview / Site Vitals / Theme Check / UX / SEO/GEO / ADA / All / Dev To-Do) at
`/reports/<slug>/<id>[/<page>]`:

- **Overview** (the default — `/reports/<slug>/<id>`) — Executive Summary, stat tiles,
  Traffic & Revenue, Competitor Benchmark, and the Prioritized Roadmap (synthesized
  across every section in the report, regardless of which page it's shown on).
- **Site Vitals** (`/vitals`) — Lighthouse Vitals, Performance findings, Sitespeed.io (if run
  with `--sitespeed`), AI performance suggestions.
- **Theme Check** (`/theme`) — Theme Code Quality (incl. the Theme Architecture assessment —
  how the theme is built, Shopify platform-feature fit, other concerns), Theme Structure, Best
  Practices Verdict, Trust & Privacy.
- **UX** (`/ux`) — UX & Conversion.
- **SEO/GEO** (`/seo-geo`) — Technical Health & SEO (with the full site-health
  checklist tucked in a collapsible), SEO Opportunities, GEO, Agent Readiness.
- **ADA** (`/ada`) — the ADA Scope Checker first when a scope was supplied (the client's own
  scoped requirements as a verified checklist, with "Copy client update" / "Copy dev actions"
  buttons), then Accessibility: Lighthouse + axe-core scores, a WCAG readiness checklist,
  Lighthouse findings, axe violations (actionable items), and AI accessibility suggestions.
- **All** (`/all`) — every section above on one page, for anyone who wants the whole
  report at a glance or wants to Cmd+F/print it in one shot.
- **Dev To-Do** (`/dev-todo`) — the complete, uncapped prioritized findings list (the
  Overview Roadmap only shows the top 10) meant to be handed directly to a developer:
  every actionable finding, priority-ordered, with severity, **where it applies**
  (Homepage, Collection page, Product page, a specific theme file, or Site-wide for
  config/behavior that isn't tied to one page), category, an effort estimate, and a
  **How to fix** step distinct from the rationale — a concrete instruction (what to
  change, and where), not just a restatement of the problem. An "Export CSV (Jira)"
  button downloads the whole list as a CSV with columns matching Jira's CSV importer
  (`Summary`, `Priority`, `Labels`, `Issue Type`, `Description`) — drag it straight into
  Jira's "Import issues from CSV" flow instead of pasting items one at a time. A "Copy
  to clipboard" button is also still there for a quick Slack/email paste: it copies the
  whole list as plain-text/Markdown, one self-contained ticket block per item
  (`Summary:` / `Description:` / `How to fix:`, separated by `---`). Theme Check's
  `MatchingTranslations` rule is filtered out of this list (and the Overview Roadmap) as
  low-signal noise — it still shows in the raw Theme Code section, just not as a
  developer to-do.

All of these are generated from a single source of truth
(`web/lib/build-report-sections.tsx`), so a section only ever needs to be written
once — it's tagged with the category page it belongs on, and the All page just renders
everything regardless of tag. `collectAllFindings()` in that same file is the shared
finding-gathering step behind both the Overview Roadmap and the full Dev To-Do list, so
the two can never drift out of sync with each other.

## Sharing a report

The "Share" button in the report header (visible on every report page) generates a
private link at `/share/<token>` that opens the full report — every section, on one
scrollable page — with **no login required**, so it's safe to send to a client or
prospect who doesn't have the site password. Clicking it copies the link to your
clipboard immediately.

The link is a signed, stateless token (HMAC'd with `SESSION_SECRET`, no database row to
manage or clean up) scoped to exactly that one report and valid for **30 days**, after
which it 404s. There's no revocation list — a link can't be un-shared early, only left
to expire. Screenshots embedded in a shared report (homepage/competitor/UX captures)
load via a short-lived cookie scoped to that same report's screenshot paths, set when
the share link is first opened, so they display for the recipient without exposing the
Blob store or any other report's images.

## Scoring

Overall score is the average of every section's score. Grades: A ≥90, B ≥80, C ≥70,
D ≥50, F below that — same bands used for the color coding (green/amber/red) throughout
the report UI.

Privacy Compliance and Security & Compliance score the same way as each other, and differently
from the rest: a **weighted proportion of what was actually confirmed**, rather than a penalty
subtracted from 100. Checks that could not be run (`blocked`/`flaky` for consent, `not tested`
for security) are excluded from both sides of the ratio instead of earning partial credit, and
either section reports **no score at all** — rather than 0 — when too little was confirmed to
rank the site rather than the coverage. In that case it is also left out of the overall average.
Any confirmed top-severity failure (a consent blocker, a security `critical`) scales the section
into the bottom half, so "leaks data after opt-out" or "serves a readable `.env`" can never
present as a passing grade.
