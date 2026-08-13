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
