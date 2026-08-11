# barrel-site-audit

A reusable tool for auditing client Shopify storefronts: theme code quality and structure,
Lighthouse performance/accessibility/SEO, storefront health, live marketing-pixel and
consent auditing, a best-practices verdict table, and an AI-written executive summary.
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

Either way, `theme/` is gitignored — it's per-machine working state, not versioned here.

## Running an audit

```
pnpm barrel-audit run <slug-or-url>
```

Pass an existing store slug, or a live URL to auto-create a store from its hostname. This
runs every analyzer below and writes one report:

- **Code** — [Shopify Theme Check](https://shopify.dev/docs/storefronts/themes/tools/theme-check)
  against `stores/<slug>/theme/`. Skips automatically if no theme code has been added yet.
- **Theme Structure** — static analysis of the theme folder: orphaned sections/snippets
  (unreferenced and, for sections, without customizer presets), leftover test/backup
  files, hash-named auto-generated files, and competing page-builder apps (Shogun,
  PageFly, EComposer, GemPages, Zipify, Replo).
- **Performance** — Lighthouse across the shopping journey: the CLI auto-discovers a
  Home, Collection (`/collections/all`), Product (via the store's public
  `/products.json`), and Cart page, then runs full Lighthouse passes on each for both
  mobile and desktop (Performance, Accessibility, Best Practices, SEO). Any page/device
  combo that fails to load is skipped rather than failing the whole audit. Detailed
  Core Web Vitals and the top failing audits come from the homepage/mobile run. This is
  the slowest analyzer — expect several minutes per audit.
- **Accessibility (axe-core)** — a second, independent accessibility signal: an automated
  [axe-core](https://github.com/dequelabs/axe-core) scan of every discovered journey page
  (Home, Collection, Product, Cart), catching issues Lighthouse's fixed audit set doesn't
  (keyboard traps, ARIA misuse on widgets that render after first paint, etc.). Reported
  alongside the Lighthouse accessibility score, plus a WCAG-category readiness checklist
  (axe's own `cat.*` taxonomy — one row per category) and every violation as an actionable
  finding (rule, affected elements, WCAG guidance link) feeding the Roadmap/Dev To-Do list.
  Throttled the same way as the UX audit below (single browser session, sequential loads,
  randomized pause, normal desktop UA). Skip with `--skip-axe`.
- **Site Health** — custom checks against the live URL: HTTPS, meta tags, canonical,
  structured data, image alt-text coverage, third-party script count, password-page
  detection, robots.txt, sitemap.xml.
- **Pixel & Tracking Audit** — a live headless-browser pass over the homepage: whether
  Meta, Google Ads/GA4, Microsoft Clarity, TikTok, and Pinterest pixels actually fire on
  the network (vs. just being referenced in code), whether a cookie-consent mechanism is
  present, and a flag if pixels fire unconditionally with no consent mechanism detected.
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
  data, an *Agentic Commerce & AI Discoverability* verdict table (structured product data, a
  machine-readable product feed, AI crawler access, FAQ/Q&A schema, brand-entity clarity via
  Organization `sameAs` links), and a synthesized "Areas to Improve" list. Skip with
  `--skip-geo-seo`.
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

Flags: `--skip-code`, `--skip-performance`, `--skip-axe`, `--skip-health`, `--skip-pixels`, `--skip-geo-seo`, `--skip-ux`, `--skip-analytics`, `--skip-screenshots`, `--skip-ai-suggestions`, `--skip-summary`, `--skip-github`, `--competitor <url>` (repeatable).

### Rate limits & quotas

Per `run`, the tool's external-API footprint is small and fixed, independent of how often the
team runs audits:

- **Claude (Anthropic API)** — up to 3 calls per run: the executive summary, the UX audit's
  screenshot critique (skipped if `--skip-ux` or `--skip-summary`, or if no UX pages could be
  loaded), and the AI performance/accessibility suggestions list (skipped with
  `--skip-ai-suggestions`, or if there's neither Lighthouse data nor theme code to ground it
  in). Combined token usage across all calls is recorded on the report and shown in its
  footer, so real spend is always visible per audit.
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

## Report pages

Each report is split across multiple pages instead of one long scroll, with a sticky
tab bar (Overview / Site Vitals / Theme Check / UX / SEO/GEO / ADA / All / Dev To-Do) at
`/reports/<slug>/<id>[/<page>]`:

- **Overview** (the default — `/reports/<slug>/<id>`) — Executive Summary, stat tiles,
  Traffic & Revenue, Competitor Benchmark, and the Prioritized Roadmap (synthesized
  across every section in the report, regardless of which page it's shown on).
- **Site Vitals** (`/vitals`) — Lighthouse Vitals, Performance findings, AI
  performance suggestions.
- **Theme Check** (`/theme`) — Theme Code Quality, Theme Structure, Best Practices
  Verdict, Trust & Privacy.
- **UX** (`/ux`) — UX & Conversion.
- **SEO/GEO** (`/seo-geo`) — Technical Health & SEO (with the full site-health
  checklist tucked in a collapsible), SEO Opportunities, GEO.
- **ADA** (`/ada`) — Accessibility: Lighthouse + axe-core scores, a WCAG readiness
  checklist, Lighthouse findings, axe violations (actionable items), and AI accessibility
  suggestions.
- **All** (`/all`) — every section above on one page, for anyone who wants the whole
  report at a glance or wants to Cmd+F/print it in one shot.
- **Dev To-Do** (`/dev-todo`) — the complete, uncapped prioritized findings list (the
  Overview Roadmap only shows the top 10) meant to be handed directly to a developer:
  every actionable finding, priority-ordered, with severity, **where it applies**
  (Homepage, Collection page, Product page, a specific theme file, or Site-wide for
  config/behavior that isn't tied to one page), category, an effort estimate, and a
  **How to fix** step distinct from the rationale — a concrete instruction (what to
  change, and where), not just a restatement of the problem. A "Copy to clipboard"
  button copies the whole list as plain-text/Markdown, one self-contained ticket block
  per item (`Summary:` / `Description:` / `How to fix:`, separated by `---`), so each
  block pastes directly into a Jira issue — Summary into the title field, Description
  into the description field — without depending on nested-list rendering. Theme
  Check's `MatchingTranslations` rule is filtered out of this list (and the Overview
  Roadmap) as low-signal noise — it still shows in the raw Theme Code section, just
  not as a developer to-do.

All of these are generated from a single source of truth
(`web/lib/build-report-sections.tsx`), so a section only ever needs to be written
once — it's tagged with the category page it belongs on, and the All page just renders
everything regardless of tag. `collectAllFindings()` in that same file is the shared
finding-gathering step behind both the Overview Roadmap and the full Dev To-Do list, so
the two can never drift out of sync with each other.

## Scoring

Overall score is the average of every section's score. Grades: A ≥90, B ≥80, C ≥70,
D ≥50, F below that — same bands used for the color coding (green/amber/red) throughout
the report UI.
