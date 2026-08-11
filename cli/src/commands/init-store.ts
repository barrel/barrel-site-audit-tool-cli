import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import type { StoreConfig } from "@barrel/site-audit-shared";
import { storeConfigPath, storeDir, storeThemeDir } from "../paths.js";

export interface InitStoreArgs {
  slug: string;
  name?: string;
  url: string;
  shopifyDomain?: string;
  ga4PropertyId?: string;
}

export function initStore({ slug, name, url, shopifyDomain, ga4PropertyId }: InitStoreArgs): void {
  const dir = storeDir(slug);
  const configPath = storeConfigPath(slug);
  const themeDir = storeThemeDir(slug);

  if (existsSync(configPath)) {
    throw new Error(`Store "${slug}" already exists at ${dir}`);
  }

  mkdirSync(themeDir, { recursive: true });

  const config: StoreConfig = {
    slug,
    name: name ?? slug,
    url,
    ...(shopifyDomain ? { shopifyDomain } : {}),
    ...(ga4PropertyId ? { ga4PropertyId } : {}),
  };
  writeFileSync(storeConfigPath(slug), JSON.stringify(config, null, 2));

  writeFileSync(
    `${dir}/README.md`,
    `# ${config.name}\n\n` +
      `Storefront: ${url}\n\n` +
      `## Adding theme code\n\n` +
      `\`theme/\` is a plain folder — get the theme's Liquid source into it either way:\n\n` +
      `**Option A — pull it via the Shopify CLI:**\n\n` +
      "```\n" +
      `pnpm barrel-audit pull-theme ${slug}${shopifyDomain ? "" : ` --store <your-store>.myshopify.com`}\n` +
      "```\n\n" +
      `**Option B — copy/paste the files in yourself:** unzip a theme export, drag files ` +
      `in Finder, \`cp -r\` from a local checkout, whatever's fastest — just get the theme's ` +
      `files into \`theme/\`.\n\n` +
      `Once the code is in place, run:\n\n` +
      "```\n" +
      `pnpm barrel-audit run ${slug}\n` +
      "```\n",
  );

  console.log(chalk.green(`Created store "${slug}" at stores/${slug}/`));
  console.log(chalk.gray(`  - Get theme code into stores/${slug}/theme/ either way:`));
  console.log(
    chalk.gray(
      shopifyDomain
        ? `      pull it:  pnpm barrel-audit pull-theme ${slug}`
        : `      pull it:  pnpm barrel-audit pull-theme ${slug} --store <your-store>.myshopify.com`,
    ),
  );
  console.log(chalk.gray(`      or just copy/paste the theme's files directly into that folder`));
  console.log(chalk.gray(`  - Edit stores/${slug}/config.json to adjust the name, URL, or Shopify domain`));
  if (!ga4PropertyId) {
    console.log(
      chalk.gray(`  - (Optional) add a "ga4PropertyId" to config.json for real traffic/revenue data — see docs/ga4-setup.md`),
    );
  }
  console.log(chalk.gray(`  - Then: pnpm barrel-audit run ${slug}`));
}
