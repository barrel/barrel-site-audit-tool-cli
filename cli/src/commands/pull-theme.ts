import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import chalk from "chalk";
import type { StoreConfig } from "@barrel/site-audit-shared";
import { cliInvocation, storeConfigPath, storeThemeDir } from "../paths.js";

export interface PullThemeArgs {
  slug: string;
  store?: string;
  live?: boolean;
  theme?: string;
}

function normalizeDomain(input: string): string {
  return input.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function pullThemeCommand({ slug, store, live, theme }: PullThemeArgs): Promise<void> {
  const configPath = storeConfigPath(slug);
  if (!existsSync(configPath)) {
    throw new Error(
      `No store found for "${slug}". Run "${cliInvocation()} init-store ${slug} --url <https://...>" first.`,
    );
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig;

  const domain = store ? normalizeDomain(store) : config.shopifyDomain;
  if (!domain) {
    throw new Error(
      `No Shopify domain known for "${slug}". Pass --store <your-store>.myshopify.com, ` +
        `or add "shopifyDomain" to stores/${slug}/config.json.`,
    );
  }

  if (store && config.shopifyDomain !== domain) {
    writeFileSync(configPath, JSON.stringify({ ...config, shopifyDomain: domain }, null, 2));
  }

  const themeDir = storeThemeDir(slug);
  mkdirSync(themeDir, { recursive: true });

  const args = ["theme", "pull", `--store=${domain}`, `--path=${themeDir}`];
  if (live) args.push("--live");
  if (theme) args.push(`--theme=${theme}`);

  console.log(chalk.bold(`Pulling theme from ${domain} into stores/${slug}/theme/ ...`));
  console.log(chalk.gray("This opens a browser to authenticate with Shopify if you aren't already logged in.\n"));

  await new Promise<void>((resolve, reject) => {
    const child = spawn("shopify", args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`shopify theme pull exited with code ${code}`));
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            'Shopify CLI not found. Install it first: npm install -g @shopify/cli, then re-run this command.',
          ),
        );
      } else {
        reject(err);
      }
    });
  });

  console.log(chalk.green(`\nTheme pulled into stores/${slug}/theme/`));
  console.log(chalk.gray(`Run: ${cliInvocation()} run ${slug}`));
}
