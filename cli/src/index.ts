#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { Command } from "commander";
import chalk from "chalk";
import { initStore } from "./commands/init-store.js";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { deployCommand } from "./commands/deploy.js";
import { pullThemeCommand } from "./commands/pull-theme.js";
import { linkRepoCommand } from "./commands/link-repo.js";
import { serveCommand } from "./commands/serve.js";
import { dataRoot } from "./paths.js";

// dataRoot() is the repo root inside a barrel-site-audit checkout, or ~/.barrel-audit when the
// CLI is installed globally and run elsewhere — loadEnv() itself is a silent no-op if the file
// doesn't exist, so no try/catch is needed either way.
loadEnv({ path: `${dataRoot()}/.env` });

const program = new Command();

program
  .name("barrel-audit")
  .description("Reusable code / performance / site-health audit tool for Shopify storefronts");

program
  .command("init-store <slug>")
  .description("Scaffold a new store folder under stores/<slug>")
  .requiredOption("--url <url>", "Live storefront URL, e.g. https://mystore.com")
  .option("--name <name>", "Display name for the store (defaults to slug)")
  .option("--shopify-domain <domain>", "The store's *.myshopify.com domain, for pull-theme")
  .option("--ga4-property-id <id>", "GA4 numeric property ID, for the Traffic & Revenue section (see docs/ga4-setup.md)")
  .action((slug: string, opts: { url: string; name?: string; shopifyDomain?: string; ga4PropertyId?: string }) => {
    initStore({ slug, url: opts.url, name: opts.name, shopifyDomain: opts.shopifyDomain, ga4PropertyId: opts.ga4PropertyId });
  });

program
  .command("pull-theme <slug>")
  .description("Pull a store's live theme code from Shopify into stores/<slug>/theme via the Shopify CLI")
  .option("--store <domain>", "The store's *.myshopify.com domain (saved to config.json for next time)")
  .option("--live", "Pull the currently published (live) theme explicitly")
  .option("--theme <id>", "Pull a specific theme by ID instead of the live theme")
  .action(async (slug: string, opts: { store?: string; live?: boolean; theme?: string }) => {
    try {
      await pullThemeCommand({ slug, store: opts.store, live: opts.live, theme: opts.theme });
    } catch (err: any) {
      console.error(chalk.red(`\n${err?.message ?? err}`));
      process.exitCode = 1;
    }
  });

program
  .command("link-repo <slug-or-url>")
  .description(
    "Connect a GitHub repo and clone it into stores/<slug>/theme — an alternative to pull-theme for stores " +
      "whose theme code lives in GitHub rather than (or in addition to) a live Shopify theme. Pass an existing " +
      "store slug, or a live URL to auto-create a store from its hostname, same as `run`. Signs in via GitHub's " +
      "OAuth device flow (a one-time code + browser approval, no token to paste) the first time, then reuses " +
      "the cached login. Prompts you to pick a repo interactively unless --repo is given. Requires " +
      "GITHUB_OAUTH_CLIENT_ID in .env.",
  )
  .option("--repo <owner/name>", "Skip the interactive picker and clone this repo directly")
  .option("--branch <branch>", "Branch to clone (defaults to the repo's default branch)")
  .option("--relogin", "Discard the cached GitHub login and re-authenticate before continuing")
  .action(async (slug: string, opts: { repo?: string; branch?: string; relogin?: boolean }) => {
    try {
      await linkRepoCommand({ slug, repo: opts.repo, branch: opts.branch, relogin: opts.relogin });
    } catch (err: any) {
      console.error(chalk.red(`\n${err?.message ?? err}`));
      process.exitCode = 1;
    }
  });

program
  .command("run <slug-or-url>")
  .description(
    "Run a full audit (code, theme structure, performance, axe-core accessibility scan, site health, pixel/consent audit) and write a report, " +
      "with an AI-generated executive summary and AI performance/accessibility suggestions if ANTHROPIC_API_KEY " +
      "is set. Pass an existing store slug, or a live URL to auto-create a store from its hostname. On a store " +
      "with no theme code yet, interactively prompts to connect a GitHub repo via OAuth device flow (see " +
      "link-repo) before auditing. " +
      "Pass --competitor one or more times to add a side-by-side benchmark against competitor storefronts. " +
      "Pass --ada-scope-file to verify a client's pasted ADA scope item by item.",
  )
  .option("--skip-code", "Skip theme code linting and theme structure analysis")
  .option("--skip-performance", "Skip Lighthouse performance/accessibility/seo audit")
  .option("--skip-axe", "Skip the axe-core accessibility scan")
  .option("--skip-theme-architecture", "Skip the AI theme architecture & Shopify platform-fit assessment")
  .option("--sitespeed", "Also run sitespeed.io (Browsertime + Coach) as a second, independent performance signal — slow, off by default")
  .option("--skip-health", "Skip storefront health checks")
  .option("--skip-pixels", "Skip live marketing pixel / consent audit")
  .option("--skip-geo-seo", "Skip SEO opportunities & AI/agentic-commerce readiness (GEO) audit")
  .option("--skip-agent-readiness", "Skip the agent-readiness audit (per-SKU schema, hydration, policy data, feed drift)")
  .option("--skip-ux", "Skip the UX/conversion audit (one collection page + one product page)")
  .option("--skip-analytics", "Skip pulling Google Analytics traffic/revenue data")
  .option("--skip-screenshots", "Skip capturing homepage/competitor screenshots")
  .option("--skip-ai-suggestions", "Skip the AI-generated performance & accessibility suggestions list")
  .option("--skip-summary", "Skip the AI-generated executive summary")
  .option("--skip-github", "Don't prompt to connect a GitHub repo, even on a store with no theme code yet")
  .option(
    "--ada-scope <text>",
    "Verify a client's ADA scope against this run: paste the scoped accessibility requirements and " +
      "each one is checked against axe-core, Lighthouse and a live keyboard/focus probe, with a " +
      "developer-ready action item for anything not yet complete. Saved to config.json, so later " +
      "runs for this store reuse it. Use --ada-scope-file for a multi-line scope.",
  )
  .option(
    "--ada-scope-file <path>",
    "Read the ADA scope from a file instead of the command line — the practical way to pass a " +
      "multi-line, bulleted scope. Takes precedence over --ada-scope.",
  )
  .option(
    "--local-repo <path>",
    "Read theme code from an existing local git checkout instead of stores/<slug>/theme/ — for " +
      "auditing (and, via \"Suggest fix\", editing in place) a repo you already have cloned. Saved " +
      "to config.json, so later runs for this store keep using it without repeating the flag.",
  )
  .option(
    "--competitor <url>",
    "Benchmark against a competitor storefront URL (repeatable, max 5 — each one runs a full Lighthouse + screenshot pass)",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .action(
    async (
      slug: string,
      opts: {
        skipCode?: boolean;
        skipPerformance?: boolean;
        skipAxe?: boolean;
        skipThemeArchitecture?: boolean;
        sitespeed?: boolean;
        skipHealth?: boolean;
        skipPixels?: boolean;
        skipGeoSeo?: boolean;
        skipAgentReadiness?: boolean;
        skipUx?: boolean;
        skipAnalytics?: boolean;
        skipScreenshots?: boolean;
        skipAiSuggestions?: boolean;
        skipSummary?: boolean;
        skipGithub?: boolean;
        adaScope?: string;
        adaScopeFile?: string;
        localRepo?: string;
        competitor: string[];
      },
    ) => {
      try {
        await runCommand({
          slug,
          skipCode: opts.skipCode,
          skipPerformance: opts.skipPerformance,
          skipAxe: opts.skipAxe,
          skipThemeArchitecture: opts.skipThemeArchitecture,
          sitespeed: opts.sitespeed,
          skipHealth: opts.skipHealth,
          skipPixels: opts.skipPixels,
          skipGeoSeo: opts.skipGeoSeo,
          skipAgentReadiness: opts.skipAgentReadiness,
          skipUx: opts.skipUx,
          skipAnalytics: opts.skipAnalytics,
          skipScreenshots: opts.skipScreenshots,
          skipAiSuggestions: opts.skipAiSuggestions,
          skipSummary: opts.skipSummary,
          skipGithub: opts.skipGithub,
          adaScope: opts.adaScope,
          adaScopeFile: opts.adaScopeFile,
          localRepo: opts.localRepo,
          competitorUrls: opts.competitor,
        });
      } catch (err: any) {
        console.error(chalk.red(`\n${err?.message ?? err}`));
        process.exitCode = 1;
      }
    },
  );

program
  .command("serve")
  .description(
    "Start a local HTTP agent (127.0.0.1 only) so the report dashboard — including the deployed " +
      "Vercel site, since the browser talks to this port directly rather than through Vercel — can " +
      "trigger audits on this machine. Prints a one-time token to paste into the dashboard's " +
      "\"Run Audit\" page; every request must present it.",
  )
  .option("--port <port>", "Port to listen on", "5757")
  .action(async (opts: { port: string }) => {
    try {
      await serveCommand({ port: Number(opts.port) });
    } catch (err: any) {
      console.error(chalk.red(`\n${err?.message ?? err}`));
      process.exitCode = 1;
    }
  });

program
  .command("list")
  .description("List stores and their past reports")
  .action(async () => {
    try {
      await listCommand();
    } catch (err: any) {
      console.error(chalk.red(`\n${err?.message ?? err}`));
      process.exitCode = 1;
    }
  });

program
  .command("deploy")
  .description("Deploy the report web app to Vercel")
  .option("--prod", "Deploy to production instead of preview")
  .action(async (opts: { prod?: boolean }) => {
    try {
      await deployCommand({ prod: opts.prod });
    } catch (err: any) {
      console.error(chalk.red(`\n${err?.message ?? err}`));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
