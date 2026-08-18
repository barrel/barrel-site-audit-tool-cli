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
