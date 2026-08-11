import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { gradeForScore } from "@barrel/site-audit-shared";
import { storeThemeDir } from "../paths.js";
import { resolveStore, themeDirHasContent } from "../store.js";
import { runAudit, type RunOptions } from "../report/generate.js";
import { linkRepoInteractive } from "./link-repo.js";

export interface RunCommandArgs extends RunOptions {
  slug: string;
  /** Skip the inline "connect a GitHub repo?" prompt on a store with no theme code yet. */
  skipGithub?: boolean;
}

export async function runCommand(args: RunCommandArgs): Promise<void> {
  const store = resolveStore(args.slug);

  const hasTheme = themeDirHasContent(storeThemeDir(store.slug));
  if (!hasTheme && !args.skipGithub && process.stdin.isTTY) {
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

  console.log(chalk.bold(`\nRunning audit for ${store.name} (${store.url})\n`));

  const spinner = ora().start();
  const report = await runAudit(
    store,
    args,
    {
      onStage: (stage) => {
        spinner.text = stage;
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
  if (report.sections.themeStructure) {
    console.log(`  Theme Structure: ${report.sections.themeStructure.score}  (${report.sections.themeStructure.redFlags.length} flags)`);
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
