# barrel-site-audit

A reusable tool for auditing client Shopify storefronts: theme code quality and structure,
Lighthouse performance/accessibility/SEO, storefront health, live marketing-pixel detection,
behavioural cookie-consent QA across the whole client fleet, a best-practices verdict table,
and an AI-written executive summary.
Reports are generated from the CLI and published to a web app on Vercel, behind Barrel Google
sign-in.

It also produces a second, separate report type: a **CRO audit**, which reviews a storefront by page
type against the store's own GA4 data and produces the slides of a client conversion deck rather
than a scored report. See [CRO audits](#cro-audits).

**Live report site:** https://barrel-site-audit.vercel.app — sign in with your Barrel Google
account via [Barrel Labs](https://barrel-labs.vercel.app/go/site-audit). No password to share
around; if it says access is denied, a Labs admin needs to grant you the `site-audit` app.

## Install it — once per machine

`barrel-audit` is a normal global command. **You do not need a copy of this repo to run audits**:
install the published package once and run it from whatever folder you happen to be in — a client
theme checkout, your home directory, anywhere.

**1. Install the CLI.** Needs **Node 22+**. The package is published to Barrel's private GitHub
Packages registry, so npm has to be told where to look and who you are. Four lines, one time:

```
gh auth refresh -h github.com -s read:packages         # only if your gh token lacks the scope
npm config set @barrel:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
npm install -g @barrel/site-audit-cli
```

No `gh` on your machine? `brew install gh && gh auth login` first — or create a classic GitHub
token with `read:packages` at https://github.com/settings/tokens and paste it in place of
`$(gh auth token)`.

**2. Give it its credentials.**

```
barrel-audit setup
```

It asks for one required thing: the **Vercel Blob read/write token**, which is what lets your runs
publish reports to the dashboard. Get it from the Vercel dashboard → the `barrel-site-audit`
project → Storage → the Blob store → `.env.local` tab, or ask in `#barrel`. Setup checks the token
against Blob storage *before* saving anything, so a typo fails here rather than several minutes
into an audit.

It then offers two optional keys, each of which just adds sections to the report:
`ANTHROPIC_API_KEY` (the AI-written executive summary, the client-ready recommendations, the fix
suggestions, the theme architecture read) and `GITHUB_OAUTH_CLIENT_ID` (`link-repo`, which clones a
store's theme straight from GitHub). Press Enter to skip either.

Everything lands in `~/.barrel-audit/.env`, mode 600 — and that directory is where store data and
config live too, so nothing is ever written into the repo you're standing in.

```
barrel-audit setup --check       # re-test what's configured, change nothing
barrel-audit setup               # re-run any time to replace a key
```

Re-running rewrites only the keys it manages and leaves the rest of the file (and your comments)
alone.

**That's the install.** `barrel-audit --version` confirms it; `npm install -g
@barrel/site-audit-cli@latest` upgrades it later.

## Run a report

Two ways in, same result: a report published to
[barrel-site-audit.vercel.app](https://barrel-site-audit.vercel.app) the moment the run finishes.
No deploy step, no commit, nothing to upload by hand.

### From the terminal

Point it at the storefront's URL:

```
barrel-audit run https://client-store.com
```

That's the whole command. It scaffolds a store folder for you (named from the hostname), runs
every analyzer — Lighthouse performance/accessibility/SEO, site health, the live pixel/consent
audit, the UX pass, and, if theme code is present, the theme code and structure checks — and
uploads the finished report. A full run takes several minutes; it prints the report ID and URL
when it's done.

If it's a brand-new store with no theme code and `GITHUB_OAUTH_CLIENT_ID` is set, it pauses to ask
whether to connect a GitHub repo first. Say yes and, the first time, it shows a one-time code and
a github.com link to approve in your browser (no token to paste); after that it fetches your repos,
lets you type to search, and clones the one you pick before the audit runs.

### From the portal

If you'd rather drive it from the browser — or hand it to someone who doesn't live in a terminal —
leave the local agent running instead:

```
barrel-audit serve
```

It prints a token. Open
[barrel-site-audit.vercel.app/run](https://barrel-site-audit.vercel.app/run), paste the token once,
fill in the store and options, and press Run. The browser talks to the agent on `127.0.0.1`
directly, so the audit runs on your machine (where Chrome and the theme code are) while the
deployed site drives it and streams the log. The agent is bound to localhost only and is not
reachable from your network.

### Then view it

Open [barrel-site-audit.vercel.app](https://barrel-site-audit.vercel.app) and sign in with your
Barrel Google account. The new report is already at the top of the list. To send it to a client,
press **Share** on any report page for a private 30-day link that needs no login.

### Optional: theme code, for the deeper sections

The steps above already cover performance, SEO, accessibility, site health, UX and pixel/consent
findings — no theme code needed. Theme Code Quality and Theme Structure need the Liquid source. If
you already have the repo cloned, that's a flag:

```
barrel-audit run https://client-store.com --local-repo .
```

(Run from inside the theme checkout and it's detected automatically — the flag is only for
pointing somewhere else.) Otherwise pull a managed copy:

```
barrel-audit pull-theme <slug> --store <slug>.myshopify.com   # via the Shopify CLI
barrel-audit link-repo <slug> --mode read                     # or read it from GitHub each run
barrel-audit link-repo <slug> --mode pull                     # or clone a copy from GitHub
barrel-audit run <slug>
```

`<slug>` is what `run` printed in the step above — usually the hostname with dots replaced by
dashes, e.g. `client-store-com`. Re-run `barrel-audit run <slug>` any time to refresh; every run
is saved as new history and nothing is overwritten.

That covers it end to end. The rest of this README is reference detail on each piece.

## How it fits together

```
barrel-site-audit/                 (this repo — only needed to work on the tool)
  cli/      the barrel-audit CLI — runs analyzers, writes report JSON
  shared/   report types + scoring helpers shared by the CLI (source of truth)
  web/      Next.js report site, deployed to Vercel, behind Barrel Labs SSO
  tools/    the test harness and build gate (`pnpm check`) — see docs/testing.md

~/.barrel-audit/                   (per-machine data, created by `barrel-audit setup`)
  .env                    your credentials, mode 600
  sites.yml               the Privacy Compliance registry, if you scan the fleet
  stores/<slug>/          one folder per store: config.json + theme/ + any in-progress fix
```

**Nothing a run produces is versioned anywhere.** Reports go to Blob storage; store folders,
pulled theme code and your `.env` stay on the machine that made them and are gitignored in the
checkout too, so a `stores/` full of client work can never be committed or deployed by accident.
The shared copy of a store's `config.json` lives in Blob, not git — which is how the dashboard and
your teammates see a store you created, and how `barrel-audit run <slug>` works on a machine that
has never seen that store.

Blob storage holds three separate namespaces, deliberately: `reports/` for site audits, `consent/`
for fleet privacy scans, and `cro/` for CRO audits. Each has its own index, and a report from one
never appears in the list of another.

Reports live in **Vercel Blob storage**, not in this repo — the CLI uploads each report to
`reports/<store>/<report-id>.json` and updates a `reports/manifest.json` index blob after
every run. Screenshots go to `screenshots/<store>/<report-id>/*.jpg` in the same private
Blob store; the web app proxies them through `/api/screenshot/...` (behind the same login)
so the Blob read/write token never reaches the browser. The web app reads straight from
Blob storage on every request (the manifest read always bypasses the CDN cache), so a new
report is live on the site **the moment the CLI finishes** — no redeploy, no commit.
Redeploying `web/` is only needed when the app's own code changes.

## Working on the tool itself

Only needed to change the CLI or the web app — running audits needs nothing but the global
install above. Requires **Node 22+** (`sitespeed.io`, used by the optional `--sitespeed` flag,
hard-requires it).

```
git clone https://github.com/barrel/barrel-site-audit-tool-cli.git
cd barrel-site-audit-tool-cli
pnpm install
pnpm --filter @barrel/site-audit-shared build   # CLI depends on this
pnpm --filter @barrel/site-audit-cli build
barrel-audit setup                              # writes .env at the repo root, not ~/.barrel-audit
```

Inside a checkout the CLI switches its data root to the repo root, so `.env` and `stores/` live
here instead of `~/.barrel-audit/` — deliberately, so working on the tool never disturbs the
install you use for real client work. Both are gitignored.

`pnpm barrel-audit <args>` runs **your local build** (`cli/dist`) rather than the globally
installed one; that's the only place the `pnpm` prefix is correct, and it works because this
repo's root `package.json` defines the script. Everywhere else, call `barrel-audit` directly —
see [Why there is no `pnpm` in front](#why-there-is-no-pnpm-in-front).

The `web/` app needs these env vars (see `web/.env.example`):

- `LABS_APP_SLUG` — `site-audit`, the slug this app is registered under in Barrel Labs. It is
  the audience of every token Labs signs for us, so a mismatch fails every sign-in.
- `LABS_SESSION_SECRET` — long random string (`openssl rand -base64 32`) that signs this app's
  own session cookie. Not shared with Labs and not shared with any other Barrel app.
- `LABS_URL` — optional, defaults to `https://barrel-labs.vercel.app`.
- `LABS_APP_ORIGIN` — optional. The origin Labs redirects back to; normally derived from
  `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL`, falling back to `localhost:3000`. Set it when
  running on a different local port.
- `SESSION_SECRET` — long random string, now used *only* to sign public `/share/<token>` links.
  Nothing to do with login.
- `BLOB_READ_WRITE_TOKEN` — same Blob store as the CLI, so the site can read reports.

These are already set on the Vercel project (`barrel-8677f380/barrel-site-audit`) for
Production and Preview. For local dev, copy `web/.env.example` to `web/.env.local` and
fill in your own values.

### Login and who can see what

Sign-in is delegated to **Barrel Labs**, so this app holds no Google OAuth client, no password
and no user table. A request with no session is bounced to Labs, which checks the Barrel Google
session and the access list for the `site-audit` app and hands back a 60-second RS256 token; the
app verifies it against Labs' public JWKS and swaps it for its own 8-hour cookie. The app has no
key capable of *minting* a token — only of verifying one — so a compromise here cannot forge
access to any other Barrel tool.

Signed-in pages carry the **Barrel Labs utility bar** at the top — `web/components/labs-nav.tsx`,
the same file every Labs app runs, deliberately unforked. It does three things and only three:
says who you are (avatar, address, `ADMIN · CLEARANCE L5`, read off the verified session), offers
the **◆ TOOLS** switcher to the other Barrel tools you are cleared for, and signs you out. This
app's own destinations live in a second row underneath (`web/components/TopNavBar.tsx`); app links
never go in the Labs bar. The switcher is driven by a `tools` claim that rides in the handoff token
and then in this app's own cookie — it is a *menu, not a grant*: every entry goes to Labs'
`/go/<slug>`, which re-checks access, so a stale list can show a tool that then refuses you and can
never open one. Nothing is ever gated on `session.tools`.

Two consequences worth knowing:

- **Revocation takes up to 8 hours.** When the cookie expires the app silently re-authorizes
  through Labs, which is invisible to anyone whose Labs sign-in is still live. Shorten
  `SESSION_TTL_SECONDS` in `web/lib/labs-auth.ts` if that window is too long.
- **Privacy Compliance is admins only.** `/consent`, `/consent/<site>`, `/consent/run`, `/consent/scan/<id>` and
  `/api/consent-run` require a Labs `admin` role — it is a live list of where client sites are
  setting tracking cookies before consent, which is a legal-exposure record about our clients
  rather than a to-do list. The nav link is omitted for members, middleware rewrites the routes
  to an explanation, and each page re-checks on its own. Everything else — every store's audit
  report — is open to anyone who can sign in.

Everything the app serves is behind sign-in, `/instructions` and `/release-notes` included. Two
routes are ungated, each for a reason:

- **`/share/<token>`** — client report links. Opening for someone with no Barrel account is the
  entire feature; they carry their own security model (HMAC-signed, scoped to one report, 30-day
  expiry) rather than relying on the session gate.
- **`/labs-error`** — where a failed handoff lands. It *cannot* be gated: the gate is what failed,
  so a gated error page redirects back into it and loops until the browser gives up.

Registering the app in Labs is a one-time job for a Labs admin, in **Control → Experiments**:
set the slug to `site-audit`, list every hostname allowed to receive a token under **SSO
redirect hosts** (exact hosts, no wildcards — `barrel-site-audit.vercel.app`,
`localhost:3000`, plus any preview alias you actually use), and set **Access**. An empty
redirect-host list means SSO is refused outright.

Share the app with `https://barrel-labs.vercel.app/go/site-audit` rather than the raw Vercel
URL: it signs the recipient in, checks their access, and someone without it sees a
request-access button instead of a wall.

## Adding a store

```
barrel-audit init-store <slug> --url https://client-store.com --name "Client Name" [--shopify-domain <slug>.myshopify.com]
```

This scaffolds `stores/<slug>/config.json` and `stores/<slug>/theme/`. You can also just
run `barrel-audit run <url>` directly against a live URL — it auto-creates the store from
the hostname.

`stores/<slug>/theme/` is a plain folder — get theme code into it any of three ways:

- **Pull it via the Shopify CLI:**

  ```
  barrel-audit pull-theme <slug> --store <slug>.myshopify.com
  ```

  (`--store` is only needed the first time — it's saved to `config.json`.) This opens a
  browser to authenticate with Shopify if needed.

- **Connect a GitHub repo** (read-only), either from the dashboard's **Theme Repos** page or
  from the CLI:

  ```
  barrel-audit link-repo <slug-or-url>              # asks which mode you want
  barrel-audit link-repo <slug-or-url> --mode read  # nothing kept on disk
  barrel-audit link-repo <slug-or-url> --mode pull  # clone once into stores/<slug>/theme/
  ```

  Like `run`, this accepts an existing store slug or a live URL directly (auto-creating
  the store from its hostname if needed) — so you can point it straight at a storefront
  or preview URL without an `init-store`/`run` step first.

  **Two modes, and the difference is where the code lives:**

  - `--mode read` records the connection and nothing else. Every audit downloads that branch
    as it is at that moment into a temp directory, reads it, and deletes it. So each report
    reflects the code as it is today, and no client code is left on your disk. This is the
    default the interactive picker offers.
  - `--mode pull` clones once into `stores/<slug>/theme/` (stripping the nested `.git`, so the
    copy can never be pushed from) and later audits read that snapshot until you pull again.
    Right when you want the code on disk to read yourself, or to audit offline. If `theme/`
    already has files in it you'll be asked to confirm before it's cleared — `--force` skips
    that.

  **Both modes are read-only.** Nothing in the connector commits, pushes, branches or opens
  anything on GitHub; a build-time check (`cli/scripts/verify-github-readonly.mjs`) fails
  `pnpm build` if a write call is ever added to one of its modules. The one sanctioned write
  path in this tool is the human-gated "Suggest fix" pull request described further down.

  **Finding the repo.** The picker searches GitHub's search API on each keystroke rather than
  filtering a downloaded list, so it works on an org with thousands of repositories; `--org
  <name>` narrows it, and `--repo <owner/name>` skips the picker entirely. To browse without
  connecting anything:

  ```
  barrel-audit repos <query> --org <name>    # search; --json to script it
  barrel-audit repos --orgs                  # which orgs your login can see
  ```

  **Where the theme sits inside the repo** is worked out at connect time from the repo's file
  tree (one request, no checkout): the connector looks for `layout/theme.liquid` and records
  the path to it as `themeSubdir`, so a repo that keeps its theme in `theme/` or `src/` works
  without any extra flag. A repo with no theme in it still connects, but with a warning — the
  alternative is a report whose Theme Code section is simply missing, which reads as "nothing
  to flag" rather than "never looked".

  **Signing in.** Requires a one-time team setup: create a GitHub OAuth App (Settings →
  Developer settings → OAuth Apps → New OAuth App, at https://github.com/settings/developers),
  enable **Device Flow** on it, and give its Client ID to `barrel-audit setup` (it's saved as
  `GITHUB_OAUTH_CLIENT_ID`) — no client secret needed, and the Client ID isn't sensitive, so
  this is one value shared across the team rather than per-person. For the dashboard's own
  picker, the same value has to be set as an environment variable on the Vercel project.

  The first time anyone runs `link-repo`, it prints a one-time code and a github.com link —
  open the link, enter the code, approve access, and you're done; the login is cached at
  `~/.config/barrel-audit/github-token.json` so it won't ask again on that machine (pass
  `--relogin` to force a fresh login, e.g. after switching GitHub accounts).
  `barrel-audit link-repo --login` signs in and stops without touching a store, which is
  what a machine needs before it can serve an audit nobody is watching: the device code has
  to be typed by a person, so a run started from the dashboard cannot do it mid-audit.

  `run` on a brand-new store offers this same connect prompt inline, so you often won't need
  to call `link-repo` directly.

- **Or just copy/paste the files in yourself** — unzip a theme export, drag files in
  Finder, `cp -r` from a local checkout, whatever's fastest. No CLI step required; the
  next `barrel-audit run <slug>` picks up whatever's in the folder.

- **Or point straight at a repo you already have cloned**, instead of copying anything
  into `theme/` at all:

  ```
  barrel-audit run <slug-or-url> --local-repo /path/to/your/theme-checkout
  ```

  This is the option for a dev auditing (and fixing) their own working copy — see
  [Auditing a repo you already have cloned](#auditing-a-repo-you-already-have-cloned)
  below.

Either way, `theme/` is gitignored — it's per-machine working state, not versioned here.

## Auditing a repo you already have cloned

`run --local-repo <path>` reads theme code straight from an existing git checkout instead
of copying it into `stores/<slug>/theme/`:

```
barrel-audit run https://client-store.com --local-repo .
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

## Why there is no `pnpm` in front

Every command in this README is the bare `barrel-audit`, and that matters more than it looks.
`pnpm barrel-audit ...` resolves the `barrel-audit` script from *this repo's* root
`package.json`, so anywhere else it fails — and *how* it fails depends on where you are standing,
which is what makes it confusing:

- **In a folder with no `package.json`** you get `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`, which at
  least points at the real problem.
- **In a client theme repo that *does* have a `package.json`** — the normal case, since most themes
  have a build — pnpm adopts *that repo* as the workspace and runs its verify-deps-before-run check
  first, meaning it runs `pnpm install` on the theme before it will run anything. If that install is
  healthy the command then works (pnpm falls through to the global binary on `PATH`). If the theme's
  install is broken for any reason of its own, you never reach the CLI at all: what you see is a
  `pnpm install` failure ending in `runDepsStatusCheck`, which reads as a bug in this tool and isn't
  one.

  A real example, worth recognising because pnpm causes it silently: pnpm 11 writes an unresolved
  `allowBuilds:` block into the theme's own `pnpm-workspace.yaml` (`esbuild: set this to true or
  false`) and then fails every install with `ERR_PNPM_IGNORED_BUILDS` until those become real
  booleans. Nothing about that involves this tool, but every `pnpm barrel-audit ...` in that repo
  dies on it.

So: call `barrel-audit` directly. The global binary doesn't touch the theme's dependencies at all,
so it's immune to whatever state that install is in. (There's also no `barrel-audit install`
command — installing is `npm install -g`, above.) The one exception is inside a
`barrel-site-audit` checkout, where `pnpm barrel-audit ...` deliberately means "run my local
build" — see [Working on the tool itself](#working-on-the-tool-itself).

## Publishing a new CLI version

Maintainers only, and the step people forget: **most of Barrel runs the globally installed
`barrel-audit`, so a CLI change that isn't published does not exist for them, however green
`main` is.** That includes any new report section, since its data comes from a `cli/` analyzer
even when it renders in `web/`. `shared` publishes first, because `cli` depends on it via
`workspace:*` and a mismatch fails at runtime rather than at install.

```
pnpm --filter @barrel/site-audit-shared build && pnpm --filter @barrel/site-audit-shared publish --no-git-checks
pnpm --filter @barrel/site-audit-cli build && pnpm --filter @barrel/site-audit-cli publish --no-git-checks
```

Bump the version in each `package.json` first, and add an entry to `web/lib/release-notes.ts`.
Publishing needs a token with **`write:packages`** (`gh auth refresh -h github.com -s
write:packages,read:packages`), and it can't be undone. This project has no Vercel git
integration, so pushing to `main` deploys nothing — a release is also a manual `pnpm web:deploy`.

## Running an audit

```
barrel-audit run <slug-or-url>
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
- **Theme & Codebase** — what theme the store actually runs and what its codebase is made of.
  Entirely deterministic (a file scan, no API key), so every claim cites the count or filename it
  came from. Three parts:
  - *Identity*, read from the theme's own `config/settings_schema.json` `theme_info` block: name,
    version, author, docs URL, and a classification — **stock** Shopify theme, a **fork** of one
    (the name still matches Dawn/Horizon but the author doesn't, so upstream releases can no longer
    be merged in), **third-party/agency**, **custom-built**, or honestly **unidentified**. Shopify's
    own parser tolerates trailing commas in that file and real themes contain them, so a strict
    `JSON.parse` failure falls back to a tolerant parse and then to scraping the four fields
    directly rather than losing the theme's identity.
  - *Codebase facts*: template architecture (JSON vs Liquid) and section groups, theme blocks and
    app-block support, Liquid line count, asset count/weight with the largest files named, JS/CSS
    totals, the build tooling actually committed, front-end libraries detectable in the code,
    localization (including per-market section-group variants), metafield/metaobject usage, and
    whether `.theme-check.yml`/CI/README are in the repo.
  - *Codebase opportunities*, each with an impact, an effort and its own evidence: deprecated
    `{% include %}` tags, oversized images and animated GIFs, legacy `.ttf`/`.otf` fonts, several
    generations of one content-hashed bundle left in `assets/`, page-builder-owned page templates,
    templates still Liquid-only in an Online Store 2.0 theme, missing header/footer section groups,
    theme blocks or app blocks never adopted, jQuery (named down to the file it's bundled inside),
    heavy metafield use with no metaobjects, a bloated `assets/`, and missing lint/CI. A theme whose
    hashed build *output* is committed without its build config is its own finding — that isn't "no
    build step", it's a build nobody else can reproduce. Deliberately conservative in the other
    direction too: `_backup_do_not_delete` templates are never recommended for migration, and files
    that merely share a filename prefix are not reported as abandoned build output.
- **Theme Architecture** *(AI, shown inside the Theme Code Quality section)* — a Claude-written
  assessment of how the theme is actually built, grounded in the Theme & Codebase profile and the
  Theme Check/Theme Structure signals above plus a real sample of the theme's source (same sampler
  `ai-suggestions.ts` uses): a short narrative that names the theme and version (custom-built vs.
  stock-based, page-builder reliance, Online Store 2.0 vs. legacy Liquid-template architecture), a
  verdict table for specific platform-feature adoption (JSON templates, section groups, theme
  blocks/app-block support, metafields, settings-schema quality), any other architectural concerns
  beyond raw lint errors, and the opportunities a file scan can't find (a pattern repeated across
  sections, render-blocking script loading, state that wants to be a metaobject) — it is told what
  the scan already found and asked not to restate it. All of which feed the Roadmap/Developer list
  like any other finding. Requires `ANTHROPIC_API_KEY`; skip with `--skip-theme-architecture`.
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
  file/line where available, each feeding the Roadmap/Developer list. Also captures Lighthouse's
  **Agentic Browsing** category (ships by default from `lighthouse@13.3+`, requires a recent
  enough local Chrome) — how well an AI browsing agent (not a search crawler) can navigate and
  act on the homepage: agent-facing accessibility-tree quality, WebMCP integration, layout
  stability, and an `llms.txt`. Scored as a pass/total fraction rather than 0-100 (Google's own
  wording: "still under development and subject to change"), shown in SEO/GEO/AEO as its own
  checklist and deliberately excluded from `overallScore`. Absent entirely on older/incompatible
  Chrome, or on reports run before this field existed.
- **Accessibility (axe-core)** — a second, independent accessibility signal: an automated
  [axe-core](https://github.com/dequelabs/axe-core) scan of every discovered journey page
  (Home, Collection, Product, Cart), catching issues Lighthouse's fixed audit set doesn't
  (keyboard traps, ARIA misuse on widgets that render after first paint, etc.). Reported
  alongside the Lighthouse accessibility score, plus a WCAG-category readiness checklist
  (axe's own `cat.*` taxonomy — one row per category) and every violation as an actionable
  finding (rule, affected elements, WCAG guidance link) feeding the Roadmap/Developer list.
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
  and those items also flow into the Roadmap/Developer list. The section's grade is scope
  completion, not site quality, so it's deliberately excluded from `overallScore`.
- **Sitespeed.io** *(opt-in, `--sitespeed`)* — a second, independent **performance** signal
  alongside Lighthouse: [sitespeed.io](https://www.sitespeed.io/) (Browsertime + its Coach
  plugin) runs 3 real-browser iterations against the homepage and reports a median-based
  score (0-100, plus Performance/Best Practice/Privacy sub-scores from Coach's own rule set —
  different from Lighthouse's), key timing metrics (TTFB, FCP, LCP, Total Blocking Time, CLS,
  full page load time, request count, page weight), and every sub-100 Coach rule as an
  actionable finding feeding the Roadmap/Developer list. This is a separate CLI subprocess with
  its own browser automation — noticeably heavier/slower than the rest of the suite (expect it
  to roughly double a run's total time), which is why it's opt-in rather than on by default.
  Shown in the Site Performance page alongside the Lighthouse-based sections above.
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
  clickjacking protection via CSP `frame-ancestors` or `X-Frame-Options` — the CSP half read
  from the response header only, since browsers ignore `frame-ancestors` in a `<meta>` tag —
  `Referrer-Policy`, `Permissions-Policy` including whether it wildcards camera/microphone/
  geolocation/payment rather than merely being present); transport (HTTP→HTTPS redirect on the
  hostname as given, before redirects, so an apex serving plaintext isn't excused by its
  canonical host; mixed content in the delivered markup, read against
  `upgrade-insecure-requests` so a page the browser silently upgrades isn't called broken; TLS
  certificate validity and days to expiry, with an incomplete chain reported as the
  integration problem it is rather than as an outage, because mainstream browsers fetch the
  missing intermediate themselves); cookie flags (`Secure` and `SameSite` on everything the
  homepage sets, `HttpOnly` on session/auth cookies only — with cookies the storefront cannot
  change, `_shopify_*` and vendor analytics, separated out in all three, since a fix
  instruction nobody can carry out is worse than no finding); exposed surface (`/.env`,
  `/.git/config`, `/.git/HEAD`, `/config.json` — each only reported when the response body
  actually matches that file's signature, and for `/config.json` that means secret-shaped
  content, not merely valid JSON, since plenty of hosts answer every unknown path with the
  storefront's own HTML or a JSON 200; published source maps; `Server`/`X-Powered-By` version
  disclosure); and the script supply chain (cross-origin `<script src>` without SRI, the count
  of distinct third-party script origins, and the **lowest** jQuery version on the page, read
  from each library file itself — a modern copy in the theme does not remove an old one an app
  drags in). Every check carries the header value, cookie name or URL it was read from, so a
  reader can re-check it with `curl`. A control that could not be observed is reported as
  **not tested** — never rounded into a pass or a fail — and excluded from the score entirely;
  if the homepage request is answered by a bot challenge, an error page or a Shopify password
  page, every header-, cookie- and markup-derived check becomes *not tested* rather than
  reading the edge's own security headers as the store's. Skip with `--skip-security`.
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
  disapprovals and agent mistrust. Every SKU/catalog issue found feeds the Roadmap/Developer
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
- **Data Analysis** *(web app only, generated on demand)* — a separate report tab, shown only
  for a store with a linked GA4 property, that crosses this report's findings with the store's
  own analytics to produce ranked conversion recommendations. It pulls the last 28 complete days
  from GA4 (totals plus splits by device, channel and landing page), computes the conversion gap
  between each weak segment and a credible benchmark, and asks Claude to rank what to do about
  it. Not produced by a CLI run: it is generated from a button on the tab, because it costs a
  model call. See [Data Analysis](#data-analysis-the-audit-crossed-with-real-ga4-data) below.
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
  barrel-audit run <slug-or-url> --competitor https://competitor-a.com --competitor https://competitor-b.com
  ```
- **Screenshots** — a full-page mobile screenshot of the homepage (and of each
  `--competitor` URL, when passed) is captured and stored in Vercel Blob, then shown
  inline in the Lighthouse Vitals and Competitor Benchmark sections. Skip with
  `--skip-screenshots`.

Flags: `--skip-code`, `--skip-performance`, `--skip-axe`, `--skip-theme-architecture`, `--skip-health`, `--skip-pixels`, `--skip-geo-seo`, `--skip-agent-readiness`, `--skip-ux`, `--skip-analytics`, `--skip-screenshots`, `--skip-ai-suggestions`, `--skip-summary`, `--skip-recommendations`, `--skip-github`, `--competitor <url>` (repeatable), `--ada-scope <text>` / `--ada-scope-file <path>`, `--sitespeed` (opt-in, off by default), `--local-repo <path>`.

Without `--skip-code`, the run refuses to start unless it can find theme code to review — see
[Auditing a repo you already have cloned](#auditing-a-repo-you-already-have-cloned).

### Rate limits & quotas

Per `run`, the tool's external-API footprint is small and fixed, independent of how often the
team runs audits:

- **Claude (Anthropic API)** — up to 6 calls per run: the executive summary, the UX audit's
  screenshot critique (skipped if `--skip-ux` or `--skip-summary`, or if no UX pages could be
  loaded), the AI performance/accessibility suggestions list (skipped with
  `--skip-ai-suggestions`, or if there's neither Lighthouse data nor theme code to ground it
  in), the Theme Architecture assessment (skipped with `--skip-theme-architecture`, or if
  there's no theme code), the client-ready Recommendations (skipped with
  `--skip-recommendations`; runs last, since it reads every other finished section), and the ADA
  Scope Checker's mapping call (only when an ADA scope was supplied *and* some line in it didn't
  match the keyword catalog). Combined token usage across all calls is recorded on the report and
  shown in its footer, so real spend is always visible per audit.
- **Google Analytics Data API (GA4)** — exactly 3 `runReport` calls per run, only when a store
  has `ga4PropertyId` configured, plus 5 more each time a Data Analysis is generated from the web
  app. Well inside Google's default per-property quota (25,000 requests/day).
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
barrel-audit setup         # write/repair this machine's credentials
barrel-audit setup --check # test them without changing anything
barrel-audit list          # list stores and their past reports
barrel-audit deploy        # deploy web/ to Vercel (preview)
barrel-audit deploy --prod # deploy to production
```

(If you run these as `pnpm barrel-audit deploy --prod` from a checkout, don't put `--` before
`--prod`: pnpm forwards a literal `--` into the CLI's argv and Commander then drops `--prod` as a
stray positional, silently deploying preview.)

## The landing page

A searchable, paginated (20/page) list of every report ever run, newest first, across
all stores. Search matches store name, slug, or URL. Each report's detail page also
links to other reports for the same store. `barrel-audit deploy` is only for
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
and the run stops in its first second rather than producing a report with no code findings in it.

**Browse…** next to that field opens a folder picker for the machine running `barrel-audit serve`,
so the path can be clicked rather than typed or dragged in from Finder. It has to work that way
round: a browser never tells a page the absolute path of a folder you pick — a directory `<input>`
hands back relative names only — and an absolute path is exactly what `--local-repo` needs. So the
agent walks the filesystem (`GET /fs/browse`, token-gated like every other agent route, directory
*names* only, nothing about the files inside) and the dashboard renders the listing. Folders that
contain `layout/theme.liquid` are flagged **THEME** with a **Use** button, so the right checkout is
recognisable without opening it, and the footer says plainly whether the folder you're standing in
is a theme. The button is disabled until the local agent is connected, since it is the only part of
this that can see your disk. It POSTs to `/api/run`, which spawns the checkout's own CLI build as a
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
barrel-audit serve [--port 5757]     # from any directory
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

## CRO audits

A **separate report type** from everything above, with its own command, its own pages and its own
storage. A site audit says what is technically wrong with a storefront and scores it; a CRO audit is
an argument about where conversion is being lost, and what comes out of it is a deck — one slide per
page type, three to five opportunities each, in the house `Short title: short description` format.

It runs in two passes, split by what each one physically needs.

```bash
# Pass 1 — needs a real browser, so it runs on your machine.
barrel-audit cro https://client-store.com
barrel-audit cro <slug> --competitor https://rival.com --competitor https://other.com
barrel-audit cro <slug> --groups home,pdp --devices mobile --skip-competitors
```

That walks the nav, home, collection, product and cart page types at a phone width and a laptop
width, screenshots each one, records what it measured, and writes the UX and competitive-benchmark
slides. It prints the report URL when it finishes.

**Pass 2 is a Generate button on that report**, and runs on the deployed site with no browser and no
terminal: the analytics step from the store's GA4 property, then the four key insights across
everything the audit found. A store with GA4 linked can get that half with no local setup at all.

Capture and interpretation are stored separately on purpose. The browser pass writes the evidence —
screenshots, the signals read out of each page, and the fold/scroll measurements — as its own blob,
and every slide is drafted from that rather than from the live site. That is what lets a section be
rewritten later without crawling a client's storefront again.

**What the measurements buy you.** "The add-to-cart control sits 867px down, 23px below the first
mobile screen" is a sentence a developer can act on and a client can check. Where each section of
the page starts, how many controls begin below the fold, how many tap targets are under 44px, and
the contrast of the primary button all come out of the page itself. They are a proxy for where
attention stops, not evidence of it, and every surface that shows them says so.

**The deck format is enforced in code, not asked for in a prompt.** A bullet whose title runs past a
slide, or that opens by naming a fault ("Missing trust signals") instead of an opportunity, is
discarded — as is any bullet carrying a figure that appears nowhere in the evidence it cited, the
same rule the Data Analysis tab runs on. Discarded bullets are listed with their reason rather than
dropped quietly.

**Every bullet is editable, and editing never rewrites the audit.** Corrections are saved as an
overlay beside the generated record, which may already have been sent to a client. Bullets can be
hidden from the deck rather than deleted. **Deck view** prints one 16:9 slide per page, and **Share
with client** mints the same kind of signed 30-day link the site audit uses, scoped so it authorises
that one audit's screenshots and nothing else.

`--checkout` is off by default: reaching checkout means adding a real item to a real cart on the
client's live store, which leaves an abandoned checkout in their admin.

Three parts of the CRO process are still done by hand, and the report says so on the page rather
than showing an empty section: heatmaps and session recordings, the voice-of-customer review
analysis, and the CX journey map.

Fill in a store's **CRO brief** before the first run (linked from any store on `/cro`): up to three
competitors, which analytics and heatmap tools the client actually has, business model, and their
own stated hypotheses. It lives on the store, so later audits reuse it.

Full step-by-step of what the tool does and does not do:
[`docs/cro-audit.md`](docs/cro-audit.md).

## Privacy Compliance

Behavioural cookie-consent testing across every client site at once. It drives each banner for
real — reject, accept, analytics-only, returning visitor — and asserts that trackers actually stop
and start, rather than only checking that a banner exists.

```bash
barrel-audit consent-scan                      # every active site in sites.yml
barrel-audit consent-scan waterloo             # one registry entry, by slug
barrel-audit consent-scan https://example.com  # ad hoc, not in the registry
barrel-audit consent-scan --inventory          # which CMP is where — fast, presence only
barrel-audit consent-scan --seed               # draft sites.yml from stores/
barrel-audit consent-scan cabot --no-tag-inventory   # skip the per-vendor table and its AI pass
```

32 tests across 8 suites, run in five fresh incognito browser states plus a Global Privacy Control
probe. Results land on **/consent** in the dashboard (worst sites first) and, for a single site,
as the **Privacy Compliance** section on its normal report's Privacy & Compliance page. The command exits non-zero on any
blocker-severity failure, so it can gate CI unchanged.

**One report for a whole scan.** *Shareable report* on the dashboard opens `/consent/scan/<id>`: every site worst-first, a key decoding each
failed test ID, a fix list grouped by failure, and a "How the score is calculated" section. *Print / Save
as PDF* and *Download CSV* (`/consent/scan/<id>/csv`, one row per site) are on the same page. It is
admin-gated like the rest of `/consent`.

**External sharing.** *Create protected link* on that page mints `/secure-report/<id>`, which is public in
middleware but opens only for an email on the creator's list **and** the password they chose (scrypt-hashed,
stored in Blob under `consent-shares/`; revocable, 7/30/90-day expiry, 5 failures lock it for 15 minutes,
`noindex`). Every request re-reads the record, so revoke and expiry apply instantly. Logic is in
`web/lib/consent-share.ts`. Limits: the lockout counter is a Blob read-modify-write, so it is best-effort
under concurrent guessing; and the email check is an allowlist, not proof the visitor owns the address — the
password is what actually gates, so share it over a different channel than the link. The weights and thresholds it prints are
`COMPLIANCE_*` constants in `shared/src/scoring.ts` (mirrored into `web/lib/shared.ts`); the scorer in
`cli/src/analyzers/consent/index.ts` keeps its own copy, and `cli/test/consent-score.test.ts` fails if the two
disagree — change both together.

Both report views carry a **What's working** pass list alongside the findings: every confirmed
pass, grouped by what it means for a visitor rather than by suite letter, plus the tags proven to
fire after Accept and stay silent after Reject. Scanning a single site prints the same list at the
terminal. It is derived from the stored scan, so archived reports show it without re-scanning, and
its ratio counts only checks that reached a verdict — a site whose states were unreachable cannot
present as a clean sweep.

### The cookie & script inventory

Alongside the pass/fail suites, each scan produces a **vendor inventory** — the "take stock of
everything that fires" deliverable, one row per vendor:

| Column | Where it comes from |
|---|---|
| Vendor and purpose | The catalogue; a model writes the purpose for vendors not in it, and the row is labelled `inferred` |
| How it loads | Hardcoded in the theme, injected by a named GTM container, or a Shopify web pixel — read from the CDP initiator chain and the document |
| Cookies & storage | Cookies plus the localStorage/sessionStorage keys a cookie banner doesn't govern |
| What the CMP says | The declared classification, read off the script tags the CMP gates (`osano/blocked`, `data-cookieconsent`, `optanon-category-*`, `data-cookieyes`) |
| Classified correctly? | That declaration compared against observed behaviour |
| Fires before / despite consent? | Which of the five states it transmitted in |
| Severity, recommended fix | Graded from the behaviour; the fix wording is written by a model |

Vendors are discovered from live traffic rather than matched against the tracker catalogue, so the
uncatalogued ones — usually the majority on a real storefront, and the ones nobody has accounted
for — appear too. It also reads Shopify's own **web pixel registry**, because `privacyPurposes` is
the only place the platform records whether a pixel is gated on consent and an empty list means
Shopify runs it whatever the visitor chose. No CMP setting can change that, so those get their own
table.

Every column except the purposes and the fix wording is a restatement of an observation. The model
is never allowed to set a verdict: `classifiedCorrectly`, `firesBeforeConsent` and `severity` are
computed from the capture, because those are the claims a client forwards to a vendor. When no
ruleset could be read the classification column says so once, at the top, and reports nothing about
the client's configuration — "we couldn't see it" and "they got it wrong" are different findings.

The section ends with an ordered **fix plan** and, kept structurally separate, **compliant ways to
collect more** — server-side tagging, Consent Mode v2 modelling, consented first-party identifiers.
Those are not compliance fixes and the report says so; where one depends on a fix landing first it
names the step.

The per-site report offers the whole thing as an **Inventory CSV**, which is what actually gets it
into the Google Sheet a client asks for.

The list of sites to scan lives in `sites.yml` in the data root (`~/.barrel-audit/sites.yml`, or
the repo root inside a checkout) — a reviewed file, seeded from
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

Developer-page items that point at a real theme file (Theme Check errors, file-grounded AI
suggestions — anything with a `file` field, `web/lib/findings.ts`) get a **Suggest fix** button.
This is a three-gate flow, never automatic and never bulk:

1. **Pick one item.** Clicking "Suggest fix" is the only way anything happens — there's no
   multi-select or "do this for everything" action anywhere in the Developer list.
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
tab bar (Overview / Site Performance / Theme Check / UX / SEO/GEO/AEO / ADA /
Privacy & Compliance / Data Analysis / All / Developer) at `/reports/<slug>/<id>[/<page>]`:

- **Overview** (the default — `/reports/<slug>/<id>`) — Priority Actions (the ranked
  recommendation list, linking to the full case for each), Executive Summary, what the run did
  and did not cover, stat tiles, Traffic & Revenue, Competitor Benchmark, and the Prioritized
  Roadmap (synthesized across every section in the report, regardless of which page it's shown
  on).
- **Recommendations** (`/recommendations`) — **the page you present**, reached from Overview's
  Priority Actions list rather than from the tab bar. The 5-10 highest-impact
  actions read across the whole report and ordered by how much each should move *conversion*,
  not by technical severity: related findings merged into one business-level action, anything
  only a developer cares about left to the Developer page. Each one gives the action, the area of the
  experience it moves, why it matters commercially, what we'd actually do, what to expect, and
  the specific audit figures behind it. Opens on what's already working, cited with real numbers.
  Written in an account manager's voice, and deliberately framed as building on the site rather
  than faulting it — we often built it. Expected impact stays directional; it never invents a
  percentage lift for the store. **Copy for deck** puts the whole set on the clipboard as
  markdown. Requires `ANTHROPIC_API_KEY`; skip with `--skip-recommendations`.
- **Site Performance** (`/vitals` — the slug is unchanged so pasted links keep working) —
  Lighthouse Vitals, Performance findings, Sitespeed.io (if run with `--sitespeed`), AI
  performance suggestions.
- **Theme Check** (`/theme`) — Theme & Codebase (what theme this is, what the codebase is made
  of, and its codebase opportunities), Theme Code Quality (incl. the Theme Architecture
  assessment — how the theme is built, Shopify platform-feature fit, other concerns), Theme
  Structure, Best Practices Verdict. Trust & Privacy, Privacy Compliance and Security &
  Compliance are not here: they are exposure rather than code quality, and they are scored
  on their own scale rather than the A-F one. They have their own page — see below.
- **UX** (`/ux`) — UX & Conversion.
- **SEO/GEO/AEO** (`/seo-geo`) — Technical Health & SEO (with the full site-health
  checklist tucked in a collapsible), SEO Opportunities, GEO, Agent Readiness, Agentic Browsing.
  The last two are the AEO half: answer- and agent-engine readiness, kept together rather than
  split between a Lighthouse category and an SEO page.
- **ADA** (`/ada`) — the ADA Scope Checker first when a scope was supplied (the client's own
  scoped requirements as a verified checklist, with "Copy client update" / "Copy dev actions"
  buttons), then Accessibility: Lighthouse + axe-core scores, a WCAG readiness checklist,
  Lighthouse findings, axe violations (actionable items), and AI accessibility suggestions.
- **Privacy & Compliance** (`/privacy`) — Privacy Compliance (the behavioural consent suite and
  the cookie & script inventory), Security & Compliance (headers, transport, cookie flags,
  exposed paths, script supply chain), and Trust & Privacy (Lighthouse best-practices findings,
  console errors, and the marketing-pixel detail). One subject — what the storefront exposes to a
  visitor and to the network — on one page, and the one page a client is most likely to forward
  on its own. The three were at the bottom of Overview until 1.42, where a reader had to scroll
  past the roadmap to find them. Note this is the *store's own* compliance section in its audit;
  the admin-only **Privacy Compliance** item in the top nav is the fleet-wide scan across every
  site in `sites.yml`.
- **Data Analysis** (`/data`) — *only present when the store has a GA4 property linked.* The
  audit crossed with the store's own analytics; generated on demand from a button. See below.
- **All** (`/all`) — every section above on one page, for anyone who wants the whole
  report at a glance or wants to Cmd+F/print it in one shot.
- **Developer** (`/dev-todo` — slug unchanged) — the complete, uncapped prioritized findings list (the
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

**Deck view** (`/deck`) sits beside those tabs rather than among them, reached from the button in
the report header. It turns the finished report into 16:9 slides — the same shape a CRO audit
produces, one point per page: the cover and overall score, where the storefront stands (the
recommendation headline, or the executive summary), the scorecard as gauges, what the site already
gets right, the key findings, the speed and GA4 numbers as grids, the consent/security exposure,
the recommendations with the commercial reason for each, the quick wins, how the work splits by
effort, and the top eight fixes for the build team. **Print / Save as PDF** gives one landscape
slide per page; **Copy key points** puts the whole deck on the clipboard as markdown, one heading
per slide, for pasting into Slides or Keynote.

It is *composed* from the report (`web/lib/report-deck.ts`), not generated — no model call, no API
key, and every report already in the dashboard has one, including runs archived long before the
deck existed. Nothing on a slide can say something the run didn't find, which is the failure mode
the CRO deck needs a whole validator to defend against. Slides whose section was skipped are
absent rather than padded, and both the bullet and prose pagination are budgeted against the real
16:9 page, because a deck slide is `overflow: hidden` and clips in silence. The scored areas come
from `reportScorecard()` in that file — the same list the Overview's stat tiles read, so the two
can't disagree about which sections count. Because the deck needs none of the report chrome (tab
strip, scroll-spy nav, methodology footnote), the tab pages live in a `(tabs)` route group and the
deck is its sibling; the group is a Next.js route group, so no URL changed.

All of these are generated from a single source of truth
(`web/lib/build-report-sections.tsx`), so a section only ever needs to be written
once — it's tagged with the category page it belongs on, and the All page just renders
everything regardless of tag. `collectAllFindings()` in that same file is the shared
finding-gathering step behind both the Overview Roadmap and the full Developer list, so
the two can never drift out of sync with each other. (It lives in `web/lib/findings.ts` and is
re-exported from `build-report-sections.tsx`, so the Data Analysis API route can reuse it
without pulling in that file's React component tree.)

The Data Analysis tab is the one page not produced by `buildReportSections` — its content comes
from GA4 at generate time rather than from the audit run, so it has its own page and its own
blob.

## Data Analysis: the audit crossed with real GA4 data

A report tab that answers the question the rest of the audit cannot: **of everything wrong with
this site, which of it is costing the client money?** It runs entirely in the deployed web app —
no CLI, no browser, no local checkout — and appears only for a store that has a GA4 property
linked (link one from the Run Audit page; see [`docs/ga4-setup.md`](docs/ga4-setup.md)).

**Generating is explicit.** A button, not a page load: it costs a Claude call and several seconds.
The result is written to `reports/<slug>/<id>-data-analysis.json` in Blob and read back on every
later visit, so the tab is instant after the first run. Re-running replaces it.

**What it pulls.** Five GA4 `runReport` calls over `28daysAgo`→`yesterday` (yesterday, not today:
a partial day drags every rate down by an amount nobody can see):

| # | Dimensions | Metrics | Why |
|---|---|---|---|
| 1 | — | `sessions`, `transactions`, `purchaseRevenue`, `totalUsers` | Totals. |
| 2 | `date` | `sessions` | Never displayed — it answers "how much history does this property actually have", which gates everything else. |
| 3 | `deviceCategory` | `sessions`, `transactions`, `purchaseRevenue` | Where conversion problems localise most often, and what the audit's mobile Lighthouse run can speak to. |
| 4 | `sessionDefaultChannelGroup` | `sessions`, `transactions`, `purchaseRevenue` | Context on who the traffic is. Not used for gap arithmetic — paid and organic converting differently is a media fact, not a site defect. |
| 5 | `landingPagePlusQueryString` | `sessions`, `transactions`, `purchaseRevenue` | Where a specific template's problem becomes a number. |

Conversion rate and average order value are computed here (`transactions ÷ sessions`,
`revenue ÷ transactions`) rather than read from GA4's own `sessionConversionRate` and
`averagePurchaseRevenue` — the latter is revenue per *user*, which is not what anyone means by
AOV, and two rates on one page produced by two definitions is a discrepancy nobody can explain.

**What it refuses to claim.** This is the part that matters, and it is enforced in code rather
than requested in a prompt:

- **Every figure on the page was computed by this tool.** Recommendations cite *evidence by id*
  from a catalogue built out of the GA4 response and the report; the page prints the catalogue's
  own wording. The model writes prose and chooses which facts to cite — it never supplies a
  number the page formats.
- **A recommendation containing a figure that appears nowhere in the evidence or findings it
  cited is discarded**, and listed as discarded with the offending figure named, so a filtered run
  cannot be mistaken for a quiet one. Restating a cited number at lower precision is allowed
  (rounding is not invention); producing a new one is not.
- **No forecasts.** Gap sizes are arithmetic on days that already happened — the weak segment's
  own sessions at the benchmark's conversion rate, valued at the observed AOV — and are labelled
  as the size of a difference already measured, not as what a fix would earn.
- **Correlation is not written up as cause.** A recommendation that joins an audit finding to a
  GA4 number is marked *Hypothesis* and carries a note on what else could produce the same
  numbers; only a restatement of what GA4 recorded is marked *Measured*.
- **Insufficient data is said, not filled.** Fewer than 21 days with recorded sessions, no
  sessions, no transactions, fewer than 25 transactions, or transactions with no revenue → a
  plain statement of which of those is true, no recommendations, and **no model call at all**.
  The figures are still shown so the refusal can be checked rather than taken on trust.

Failure states each get their own message naming what to change: no property linked, no
`GOOGLE_SERVICE_ACCOUNT_KEY`, no `ANTHROPIC_API_KEY`, a service account without Viewer access, a
property that does not exist, a GA4 API error. None of them writes a partial analysis to storage.

The pure half of all this — the sufficiency gates, the gap arithmetic, the number check — lives in
`web/lib/data-analysis.ts` and is covered by `shared/test/data-analysis.test.ts`.

## Sharing a report

The "Share" button in the report header (visible on every report page) generates a
private link at `/share/<token>` that opens the full report — every section, on one
scrollable page — with **no login required**, so it's safe to send to a client or
prospect who has no Barrel account at all. Clicking it copies the link to your
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

## Tests and the build gate

```bash
pnpm test      # the suite on its own (~0.5s, nothing touches the network)
pnpm check     # the whole gate: git-pr safety guard, format, lint, typecheck, tests (~8s)
```

`pnpm build` runs `pnpm check` first and refuses to build if it fails; `pnpm build:packages`
skips the gate when you need the artifacts and nothing else.

The suite is hermetic by design — **no test launches a browser or contacts a live site**, so
none of it costs the minutes a real `consent-scan` does. It covers the consent analyzer's pure
logic (which requests count as a transmission, when a Consent Mode ping is a denial rather than a
hit, the `blocked`-not-`fail` rule for states the scan never reached, and how a score is
computed), the dashboard→CLI argv builder, ADA-scope parsing, and the drift guards that catch
`web/lib/shared.ts` falling behind `shared/src/types.ts`.

The harness retries a failing test and reports anything that only passed on a retry as **flaky**
rather than as passing. It auto-fixes formatting and lint and re-runs those steps; it never
touches an assertion. Results land in `test-results/`.

**[docs/testing.md](docs/testing.md)** has the full account — what "self-healing" does and, more
importantly, what it deliberately does not do.
