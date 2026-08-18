import { existsSync, readdirSync, readFileSync } from "node:fs";
import chalk from "chalk";
import { gradeForScore, type StoreConfig } from "@barrel/site-audit-shared";
import { cliInvocation, storesDir, storeConfigPath } from "../paths.js";
import { readManifest } from "../report/manifest.js";

export async function listCommand(): Promise<void> {
  const dir = storesDir();
  const slugs = existsSync(dir) ? readdirSync(dir).filter((f) => existsSync(storeConfigPath(f))) : [];

  const manifest = await readManifest();

  if (slugs.length === 0 && manifest.reports.length === 0) {
    console.log(chalk.gray(`No stores yet. Create one with: ${cliInvocation()} init-store <slug> --url <https://...>`));
    return;
  }

  const seenSlugs = new Set(slugs);

  for (const slug of slugs) {
    const store = JSON.parse(readFileSync(storeConfigPath(slug), "utf-8")) as StoreConfig;
    const reports = manifest.reports.filter((r) => r.storeSlug === slug);
    console.log(chalk.bold(`\n${store.name}`) + chalk.gray(`  (${slug}) — ${store.url}`));
    if (reports.length === 0) {
      console.log(chalk.gray("  no reports yet"));
    } else {
      for (const r of reports.slice(0, 5)) {
        console.log(`  ${r.createdAt}  score ${r.overallScore} (${gradeForScore(r.overallScore)})  [${r.id}]`);
      }
    }
  }

  const remoteOnlySlugs = [...new Set(manifest.reports.map((r) => r.storeSlug))].filter((s) => !seenSlugs.has(s));
  for (const slug of remoteOnlySlugs) {
    const reports = manifest.reports.filter((r) => r.storeSlug === slug);
    console.log(
      chalk.bold(`\n${reports[0].storeName}`) +
        chalk.gray(`  (${slug}) — ${reports[0].storeUrl} [no local store folder]`),
    );
    for (const r of reports.slice(0, 5)) {
      console.log(`  ${r.createdAt}  score ${r.overallScore} (${gradeForScore(r.overallScore)})  [${r.id}]`);
    }
  }

  console.log();
}
