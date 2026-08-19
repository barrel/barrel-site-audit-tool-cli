import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { gradeForScore, parseAdaScope, type StoreConfig } from "@barrel/site-audit-shared";
import { cliInvocation, dataRoot, storeConfigPath, storeThemeDir } from "../paths.js";
import {
  findThemeRoot,
  looksLikeShopifyTheme,
  resolveStore,
  resolveThemeDir,
  saveStoreConfig,
  themeDirHasContent,
} from "../store.js";
import { ensureLocalStoreConfig } from "../store-sync.js";
import { runAudit, type RunOptions } from "../report/generate.js";
import { installBrowserCleanup } from "../shutdown.js";
import { linkRepoInteractive } from "./link-repo.js";

export interface RunCommandArgs extends RunOptions {
  slug: string;
  /** Skip the inline "connect a GitHub repo?" prompt on a store with no theme code yet. */
  skipGithub?: boolean;
  /** Read theme code straight from an existing local git checkout instead of the managed
   * stores/<slug>/theme/ copy — for a dev auditing (and later fixing) a repo they already have
   * cloned. Saved to the store's config.json so later runs/fixes for this store keep using it
   * without passing the flag again. */
  localRepo?: string;
  /** Path to a file containing the client's ADA scope — the practical way to pass a multi-line
   * scope on the command line. Takes precedence over --ada-scope. */
  adaScopeFile?: string;
}

/** Everything a run needs from the environment, checked up front. A full audit is several
 * minutes of Lighthouse, sitespeed and live-browser passes, so discovering a missing token at
 * the closing upload step throws all of that away — the most expensive possible moment to find
 * out. Anything knowable at second zero gets reported at second zero. */
function preflightEnv(args: RunCommandArgs): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      `BLOB_READ_WRITE_TOKEN is not set, so the finished report could not be uploaded.\n` +
        `Add it to ${dataRoot()}/.env before running an audit (see README).\n\n` +
        `Stopping now rather than after several minutes of Lighthouse and browser passes.`,
    );
  }

  // Optional, unlike the Blob token: the audit is still useful without AI, but say so before the
  // wait rather than at the end, when it's too late to decide differently.
  const wantsAi = !args.skipSummary || !args.skipAiSuggestions || !args.skipThemeArchitecture;
  if (wantsAi && !process.env.ANTHROPIC_API_KEY) {
    console.log(
      chalk.yellow(`ANTHROPIC_API_KEY is not set — the executive summary, AI suggestions and`) +
        chalk.yellow(` theme architecture assessment will be skipped.`) +
        chalk.gray(`\n  Add it to ${dataRoot()}/.env to include them. Continuing without.\n`),
    );
  }
}

/** How to name a path in a command the user is meant to copy: relative when that's actually
 * shorter to read, absolute when the relative form would be a chain of "../"s. */
function displayPath(dir: string): string {
  const rel = relative(process.cwd(), dir);
  return rel && !rel.startsWith("..") ? rel : dir;
}

/** The immediate subdirectories of `dir` that are themselves Shopify theme roots. A repo that
 * keeps its theme one level down (theme/, src/, dist/) is the usual reason a perfectly valid
 * checkout doesn't look like a theme at its root, so the error below can point straight at it
 * instead of leaving the user to guess. Shallow on purpose — one readdir, no recursive walk. */
function nestedThemeRoots(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(dir, entry.name))
      .filter(looksLikeShopifyTheme);
  } catch {
    return [];
  }
}

/** Shared by the --local-repo validation and the preflight below, which reach the same conclusion
 * from different directions: linting a directory with no layout/theme.liquid reports on the wrong
 * tree, and the usual cause is a repo that keeps its theme one level down. */
function notAThemeError(dir: string, subject: string, fallbackHelp: string, slug: string): Error {
  const nested = nestedThemeRoots(dir);
  return new Error(
    `${subject} — it has files in it, but no layout/theme.liquid, the one file every Shopify theme` +
      ` is required to have. Linting it would report on the wrong tree.` +
      (nested.length > 0
        ? `\n\nThe theme looks like it lives one level down. Try:` +
          nested.map((d) => `\n  ${cliInvocation()} run ${slug} --local-repo ${displayPath(d)}`).join("")
        : fallbackHelp),
  );
}

/** The three ways to give a store some code to review, plus the two ways to run without it. */
function themeCodeHelp(store: StoreConfig): string {
  return (
    `\n\nEither point the audit at some code:` +
    `\n  ${cliInvocation()} run ${store.slug} --local-repo <path to your theme checkout>` +
    `\n  ${cliInvocation()} link-repo ${store.slug}      (clone from GitHub into ${storeThemeDir(store.slug)})` +
    `\n  ${cliInvocation()} pull-theme ${store.slug}     (pull the live theme from Shopify)` +
    `\n\nOr run without it:` +
    `\n  ${cliInvocation()} run ${store.slug} --skip-code` +
    `\n  In the dashboard, untick "Theme code & structure" under "What to run".`
  );
}

/** Checked up front for the same reason as preflightEnv: a run that was asked for code review with
 * nowhere to read code from produces a report whose Theme Code, Theme Structure and Theme
 * Architecture sections are simply absent — which reads as "nothing to flag" rather than "never
 * looked", and is indistinguishable from a clean bill of health to whoever opens the report. Stop
 * before the several-minute Lighthouse/browser passes and say exactly how to resolve it. */
function preflightThemeCode(store: StoreConfig): void {
  const themeDir = resolveThemeDir(store);
  const help = themeCodeHelp(store);

  if (!themeDirHasContent(themeDir)) {
    throw new Error(
      `Theme code review was requested for ${store.name}, but there is no theme code to review.` +
        `\n  Looked in: ${themeDir}${existsSync(themeDir) ? " (empty)" : " (does not exist)"}` +
        help,
    );
  }

  if (!looksLikeShopifyTheme(themeDir)) {
    throw notAThemeError(
      themeDir,
      `Theme code review was requested for ${store.name}, but ${themeDir} doesn't look like a Shopify theme`,
      help,
      store.slug,
    );
  }
}

/** Works out which ADA scope this run should verify, in precedence order: --ada-scope-file,
 * --ada-scope, the BARREL_ADA_SCOPE env var (how the dashboard and the local agent hand a pasted,
 * multi-line scope to this process — argv would mangle a value starting with "-"), and finally
 * whatever was saved for this store last time. A newly-supplied scope is written to the store's
 * config.json, so re-running an audit for the same client doesn't mean re-pasting it. */
function resolveAdaScope(args: RunCommandArgs, store: StoreConfig): string | undefined {
  let incoming: string | undefined;
  let origin: string | undefined;

  if (args.adaScopeFile) {
    const absPath = resolve(process.cwd(), args.adaScopeFile);
    if (!existsSync(absPath)) {
      throw new Error(`--ada-scope-file "${args.adaScopeFile}" does not exist (resolved to ${absPath}).`);
    }
    incoming = readFileSync(absPath, "utf-8");
    origin = `--ada-scope-file ${args.adaScopeFile}`;
  } else if (args.adaScope?.trim()) {
    incoming = args.adaScope;
    origin = "--ada-scope";
  } else if (process.env.BARREL_ADA_SCOPE?.trim()) {
    incoming = process.env.BARREL_ADA_SCOPE;
    origin = "the dashboard's ADA scope field";
  }

  const trimmed = incoming?.trim();
  if (!trimmed) {
    const saved = store.adaScope?.trim();
    if (saved) {
      console.log(
        chalk.gray(
          `Verifying the ADA scope saved for ${store.name} (${parseAdaScope(saved).length} items).` +
            `\n  Pass --ada-scope-file <path> to replace it.`,
        ),
      );
    }
    return saved || undefined;
  }

  if (store.adaScope?.trim() !== trimmed) {
    store.adaScope = trimmed;
    saveStoreConfig(store);
  }
  console.log(
    chalk.cyan(`ADA scope: ${parseAdaScope(trimmed).length} items to verify (from ${origin}).`) +
      chalk.gray(`\n  Saved to config.json — later runs for this store reuse it automatically.\n`),
  );
  return trimmed;
}

export async function runCommand(args: RunCommandArgs): Promise<void> {
  // Before anything launches a browser: this is the only command that does, and a stop request
  // arriving mid-Lighthouse is exactly when leaving one behind matters.
  installBrowserCleanup();

  preflightEnv(args);

  // A store created in the dashboard (or by a teammate) has no config.json on this machine yet —
  // pull the shared copy down before resolving, so `run <slug>` works the first time instead of
  // erroring with "No store found" for a store that plainly exists.
  await ensureLocalStoreConfig(args.slug);

  const store = resolveStore(args.slug);

  if (args.localRepo) {
    const absPath = resolve(process.cwd(), args.localRepo);
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
      throw new Error(`--local-repo "${args.localRepo}" is not a directory (resolved to ${absPath}).`);
    }
    // Before the write below, not after: pointing a store's config.json at a directory that turns
    // out not to be a theme would leave every later run and "Suggest fix" for that store reading
    // from the wrong tree, long after the typo that caused it.
    if (!looksLikeShopifyTheme(absPath)) {
      throw notAThemeError(absPath, `--local-repo "${args.localRepo}" isn't a Shopify theme`, themeCodeHelp(store), store.slug);
    }
    if (store.localThemeDir !== absPath) {
      store.localThemeDir = absPath;
      saveStoreConfig(store);
      console.log(chalk.gray(`Reading theme code for ${store.name} from ${absPath} (saved to config.json).`));
    }
  } else if (!store.localThemeDir && !themeDirHasContent(storeThemeDir(store.slug))) {
    // Running from inside a theme checkout is the normal case for a globally-installed CLI, and
    // "audit the code I'm standing in" is what that plainly implies — so detect it instead of
    // making `--local-repo .` mandatory and silently skipping code review when it's omitted.
    // Gated on the store having no theme code of its own, so a managed store (pull-theme /
    // link-repo) is never quietly overridden by whatever directory you happened to run from.
    const detected = findThemeRoot();
    if (detected) {
      store.localThemeDir = detected;
      saveStoreConfig(store);
      console.log(
        chalk.cyan(`Auditing the theme code in ${detected}`) +
          chalk.gray(
            `\n  Detected from the current directory, since this store had no theme code of its own.` +
              `\n  Saved to config.json — pass --local-repo <path> to point somewhere else.\n`,
          ),
      );
    }
  }

  const hasTheme = themeDirHasContent(resolveThemeDir(store));
  if (!hasTheme && !store.localThemeDir && !args.skipGithub && process.stdin.isTTY) {
    const wantsLink = await confirm({
      message: `No theme code found for ${store.name} yet. Connect a GitHub repo now to clone into stores/${store.slug}/theme/?`,
      default: Boolean(process.env.GITHUB_OAUTH_CLIENT_ID),
    });
    if (wantsLink) {
      try {
        await linkRepoInteractive(store, { force: true });
      } catch (err: any) {
        console.log(chalk.yellow(`  Skipping GitHub connect: ${err?.message ?? err}\n`));
      }
    }
  }

  // After the GitHub-link prompt above, so accepting that offer is what resolves this rather than
  // erroring out on a store that was one confirmation away from having code to review.
  if (!args.skipCode) preflightThemeCode(store);

  const adaScope = resolveAdaScope(args, store);

  console.log(chalk.bold(`\nRunning audit for ${store.name} (${store.url})\n`));

  const spinner = ora().start();
  const report = await runAudit(
    store,
    { ...args, adaScope },
    {
      onStage: (stage) => {
        spinner.text = stage;
        // ora only ever renders spinner.text when stdout is a TTY — piped/non-interactive
        // callers (the web dashboard's /api/run and `barrel-audit serve`) would otherwise see
        // total silence between "Running audit for..." and the final summary. Print an explicit
        // line in that case so those consumers get live per-stage progress too.
        if (!process.stdout.isTTY) console.log(`→ ${stage}`);
      },
    },
  ).catch((err) => {
    spinner.fail(String(err?.message ?? err));
    throw err;
  });
  spinner.succeed("Audit complete");

  console.log();
  console.log(chalk.bold(`Overall score: ${report.overallScore} (${gradeForScore(report.overallScore)})`));
  if (report.sections.code) {
    console.log(`  Code:        ${report.sections.code.score}  (${report.sections.code.errorCount} errors, ${report.sections.code.warningCount} warnings)`);
  }
  if (report.sections.performance) {
    const p = report.sections.performance;
    console.log(`  Performance: ${p.performance.score}`);
    console.log(`  Accessibility: ${p.accessibility.score}`);
    console.log(`  Best Practices: ${p.bestPractices.score}`);
    console.log(`  SEO: ${p.seo.score}`);
  }
  if (report.sections.accessibility) {
    const a = report.sections.accessibility;
    const violations = a.pages.reduce((sum, p) => sum + p.violations.length, 0);
    console.log(`  Accessibility (axe-core): ${a.score}  (${violations} violation type(s) across ${a.pages.length} page(s))`);
  }
  if (report.sections.adaScope) {
    const s = report.sections.adaScope;
    console.log(
      `  ADA Scope: ${s.completeCount}/${s.items.length} scoped items verified complete` +
        ` (${s.coverage}% of the automatically-verifiable ones)`,
    );
    const breakdown = [
      s.incompleteCount > 0 ? `${s.incompleteCount} incomplete` : null,
      s.partialCount > 0 ? `${s.partialCount} partial` : null,
      s.manualCount > 0 ? `${s.manualCount} manual` : null,
      s.unverifiedCount > 0 ? `${s.unverifiedCount} unverified` : null,
    ].filter(Boolean);
    if (breakdown.length > 0) console.log(chalk.gray(`    ${breakdown.join(", ")}`));
    if (s.lighthouseAccessibilityScore !== undefined) {
      console.log(chalk.gray(`    Lighthouse accessibility score: ${s.lighthouseAccessibilityScore}/100`));
    }
  }
  if (report.sections.sitespeed) {
    const s = report.sections.sitespeed;
    console.log(`  Sitespeed.io: ${s.score}  (${s.advice.length} advice item(s), ${s.runs} run(s))`);
  }
  if (report.sections.themeStructure) {
    console.log(`  Theme Structure: ${report.sections.themeStructure.score}  (${report.sections.themeStructure.redFlags.length} flags)`);
  }
  if (report.sections.themeArchitecture) {
    console.log(`  Theme Architecture: ${report.sections.themeArchitecture.concerns.length} other concern(s) flagged`);
  }
  if (report.sections.health) {
    console.log(`  Site Health: ${report.sections.health.score}`);
  }
  if (report.sections.pixels) {
    console.log(`  Pixels & Consent: ${report.sections.pixels.score}`);
  }
  if (report.sections.geoSeo) {
    const gs = report.sections.geoSeo;
    console.log(
      `  SEO & GEO Health: ${gs.healthRating}  (SEO ${gs.seo.score}, ${gs.seo.opportunities.length} opportunities · GEO ${gs.geo.score})`,
    );
  }
  if (report.sections.agentReadiness) {
    const ar = report.sections.agentReadiness;
    console.log(`  Agent Readiness: ${ar.score}  (${ar.skusSampled} SKUs sampled, ${ar.issues.length} issue(s))`);
  }
  if (report.sections.ux) {
    const ux = report.sections.ux;
    console.log(`  UX & Conversion: ${ux.score}  (${ux.opportunities.length} AI-flagged opportunities)`);
  }
  if (report.sections.aiSuggestions) {
    console.log(`  AI Suggestions: ${report.sections.aiSuggestions.suggestions.length} performance/accessibility tips`);
  }
  if (report.sections.analytics) {
    const a = report.sections.analytics;
    console.log(
      `  Traffic & Revenue: ${a.sessions.toLocaleString()} sessions, ${a.conversionRate}% CVR, $${a.averageOrderValue.toFixed(2)} AOV (${a.dateRangeLabel})`,
    );
  } else if (store.ga4PropertyId && !args.skipAnalytics) {
    console.log(chalk.gray(`  Traffic & Revenue: skipped (check GOOGLE_SERVICE_ACCOUNT_KEY / property access — see docs/ga4-setup.md)`));
  }
  if (report.sections.competitors) {
    console.log(`  Competitor Benchmark:`);
    for (const c of report.sections.competitors.competitors) {
      console.log(
        `    ${c.name}: Performance ${c.performance}, Accessibility ${c.accessibility}, Best Practices ${c.bestPractices}, SEO ${c.seo}, Health ${c.healthScore}`,
      );
    }
  }
  if (report.sections.summary) {
    console.log();
    console.log(chalk.bold("Summary:"));
    console.log(`  ${report.sections.summary.overview}`);
  }
  if (report.aiUsage) {
    const u = report.aiUsage;
    console.log(
      chalk.gray(
        `  AI usage: ${u.model} — ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out (${u.totalTokens.toLocaleString()} total, ~$${u.estimatedCostUsd.toFixed(4)})`,
      ),
    );
  }
  console.log();
  console.log(chalk.gray(`Report uploaded to Vercel Blob (reports/${store.slug}/${report.id}.json).`));
  console.log(chalk.gray(`It's already live on the report site — no deploy needed.`));
}
