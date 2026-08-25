import chalk from "chalk";
import ora from "ora";
import type { CroPageGroup, CroDevice, CroStep, CroStepKey, StoreConfig } from "@barrel/site-audit-shared";
import {
  CRO_STEP_LABELS,
  DEFAULT_CRO_GROUPS,
  MAX_CRO_COMPETITORS,
  validateDevices,
  validateGroups,
} from "@barrel/site-audit-shared";
import { dataRoot } from "../paths.js";
import { resolveStore, saveStoreConfig } from "../store.js";
import { ensureLocalStoreConfig } from "../store-sync.js";
import { runCroAudit } from "../report/cro-generate.js";
import { installBrowserCleanup } from "../shutdown.js";

export interface CroCommandArgs {
  slug: string;
  skipUx?: boolean;
  skipCompetitors?: boolean;
  captureOnly?: boolean;
  checkout?: boolean;
  groups?: string;
  devices?: string;
  competitor?: string[];
  upload?: boolean;
}

/** Checked at second zero for the same reason `run` does it: a capture sweep is several minutes of
 * browser work, and finding out afterwards that it cannot be stored throws all of it away. */
function preflight(args: CroCommandArgs): void {
  if (args.upload !== false && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      `BLOB_READ_WRITE_TOKEN is not set, so the finished CRO audit could not be uploaded.\n` +
        `Add it to ${dataRoot()}/.env before running (see README).\n\n` +
        `Stopping now rather than after several minutes of browser passes.`,
    );
  }

  if (!args.captureOnly && !process.env.ANTHROPIC_API_KEY) {
    // Not fatal: the capture is the expensive, un-repeatable half, and it is worth keeping even
    // with nothing to interpret it. Said before the wait rather than after it.
    console.log(
      chalk.yellow("ANTHROPIC_API_KEY is not set, so no slides will be written from this capture.") +
        chalk.gray(
          `\n  The pages will still be captured and stored, and the slides can be drafted later without` +
            `\n  re-crawling the site. Add the key to ${dataRoot()}/.env to draft them now.\n`,
        ),
    );
  }
}

function resolveGroups(args: CroCommandArgs): readonly CroPageGroup[] {
  const requested = args.groups ? validateGroups(args.groups.split(",")) : [...DEFAULT_CRO_GROUPS];
  if (args.checkout && !requested.includes("checkout")) return [...requested, "checkout"];
  // --groups checkout without --checkout is a contradiction worth naming rather than resolving
  // silently in either direction: one reading skips what was asked for, the other creates an
  // abandoned checkout on a client's store that nobody opted into.
  if (!args.checkout && requested.includes("checkout")) {
    throw new Error(
      "Capturing checkout adds a real item to a real cart on the client's live store, which leaves an " +
        "abandoned checkout in their admin. Pass --checkout to confirm that is intended.",
    );
  }
  return requested;
}

function resolveDevices(args: CroCommandArgs): readonly CroDevice[] {
  const requested = args.devices ? validateDevices(args.devices.split(",")) : (["mobile", "desktop"] as const);
  if (requested.length === 0) throw new Error("At least one device is needed.");
  return requested;
}

/** Competitors given on the command line are saved to the store's brief, so the next CRO audit for
 * this client benchmarks the same set without them being re-typed — and so the dashboard's brief
 * page shows what a terminal run used. */
function resolveCompetitors(store: StoreConfig, args: CroCommandArgs): string[] {
  const passed = (args.competitor ?? []).map((c) => c.trim()).filter(Boolean);
  if (passed.length === 0) return store.croBrief?.competitorUrls ?? [];
  if (passed.length > MAX_CRO_COMPETITORS) {
    throw new Error(
      `At most ${MAX_CRO_COMPETITORS} competitors are supported — each one is a full capture sweep of their storefront.`,
    );
  }
  saveStoreConfig({ ...store, croBrief: { ...(store.croBrief ?? {}), competitorUrls: passed } });
  return passed;
}

function printStep(step: CroStep): void {
  const label = CRO_STEP_LABELS[step.key];
  const bullets = step.slides.reduce((sum, s) => sum + s.bullets.length, 0);

  if (step.status === "generated") {
    console.log(
      `  ${chalk.green("✓")} ${label}: ${step.slides.length} slide(s), ${bullets} bullet(s)` +
        (step.rejected?.length ? chalk.gray(` — ${step.rejected.length} discarded by the format/evidence checks`) : ""),
    );
  } else if (step.status === "pending") {
    console.log(`  ${chalk.yellow("…")} ${label}: ${chalk.gray("not generated yet")}`);
  } else if (step.status === "insufficient") {
    console.log(`  ${chalk.yellow("!")} ${label}: ${chalk.gray("nothing could be concluded")}`);
  } else {
    console.log(`  ${chalk.gray("–")} ${chalk.gray(`${label}: not part of this run`)}`);
  }

  for (const limitation of step.limitations) {
    console.log(chalk.gray(`      ${limitation}`));
  }
}

export async function croCommand(args: CroCommandArgs): Promise<void> {
  installBrowserCleanup();
  preflight(args);

  // Before resolveStore: a store created on another machine (or by a cloud run) exists only in
  // Blob until this pulls its config down. Same ordering as `run`.
  await ensureLocalStoreConfig(args.slug);
  const store = resolveStore(args.slug);

  const groups = resolveGroups(args);
  const devices = resolveDevices(args);
  const competitorUrls = resolveCompetitors(store, args);

  console.log(chalk.bold(`\nCRO audit — ${store.name} (${store.url})\n`));
  console.log(chalk.gray(`  Page groups: ${groups.join(", ")}`));
  console.log(chalk.gray(`  Devices:     ${devices.join(", ")}`));
  console.log(
    chalk.gray(`  Competitors: ${competitorUrls.length > 0 ? competitorUrls.join(", ") : "none recorded for this store"}`),
  );
  if (groups.includes("checkout")) {
    console.log(
      chalk.yellow(
        `  Checkout capture is on — this will add an item to a real cart and leave an abandoned checkout in the client's admin.`,
      ),
    );
  }
  console.log();

  const spinner = ora().start();
  const report = await runCroAudit(
    store,
    {
      groups,
      devices,
      skipUx: args.skipUx,
      skipCompetitors: args.skipCompetitors,
      captureOnly: args.captureOnly,
      upload: args.upload,
      competitorUrls,
    },
    {
      onStage: (stage) => {
        spinner.text = stage;
        // ora only renders spinner.text on a TTY; piped callers (the dashboard's /api/cro-run and
        // `barrel-audit serve`) would otherwise see silence for the whole run. Same convention as
        // `run`, so the dashboard's stage parsing works unchanged.
        if (!process.stdout.isTTY) console.log(`→ ${stage}`);
      },
      onNote: (note) => {
        // Which page stands for each group is a decision the reader of the deck will ask about, so
        // it goes to the terminal rather than only into the stored capture.
        spinner.clear();
        console.log(chalk.gray(`  ${note}`));
      },
    },
  ).catch((err) => {
    spinner.fail(String(err?.message ?? err));
    throw err;
  });
  spinner.succeed("Capture complete");

  console.log();
  for (const key of Object.keys(report.steps) as CroStepKey[]) {
    const step = report.steps[key];
    if (step) printStep(step);
  }

  if (report.aiUsage) {
    const u = report.aiUsage;
    console.log(
      chalk.gray(
        `\n  AI usage: ${u.model} — ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out ` +
          `(${u.totalTokens.toLocaleString()} total, ~$${u.estimatedCostUsd.toFixed(4)})`,
      ),
    );
  }

  if (args.upload === false) {
    console.log(chalk.yellow(`\nNothing was uploaded (--no-upload).`));
    return;
  }

  console.log();
  console.log(chalk.gray(`Stored at cro/${store.slug}/${report.id}.json (capture alongside it).`));
  console.log(`Open it at ${chalk.cyan(`/cro/${store.slug}/${report.id}`)} on the report site.`);
  console.log(
    chalk.bold(`\nNext: press Generate on that page`) +
      chalk.gray(` to add the analytics step (from GA4) and the key-insights summary.` +
        `\nBoth run in the dashboard — no browser, no CLI.`),
  );
}
