import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import type { StoreConfig } from "@barrel/site-audit-shared";
import { storeConfigPath, storesDir, storeThemeDir } from "./paths.js";

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function slugFromUrl(url: string): string {
  return new URL(url).hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Find an existing store whose config.json points at the same hostname, regardless of
 * what slug it was created under — so resolving by URL reuses a store made via `init-store`
 * (or an earlier URL run with e.g. a different www./path or query string) instead of creating
 * a second, disconnected store for the same site. */
function findStoreByHostname(url: string): StoreConfig | null {
  const targetHost = hostnameOf(url);
  if (!targetHost) return null;

  const dir = storesDir();
  if (!existsSync(dir)) return null;

  for (const slug of readdirSync(dir)) {
    const configPath = storeConfigPath(slug);
    if (!existsSync(configPath)) continue;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig;
      if (hostnameOf(config.url) === targetHost) return config;
    } catch {
      // corrupt/unreadable config.json — skip it
    }
  }
  return null;
}

/** Resolves a store by slug, or by a live URL (auto-creating the store from its hostname if
 * none exists yet). Shared by `run` and `link-repo` so both accept either form the same way —
 * a preview/query-string-heavy Shopify URL works here exactly like a plain storefront URL. */
export function resolveStore(slugOrUrl: string): StoreConfig {
  if (isUrl(slugOrUrl)) {
    const existing = findStoreByHostname(slugOrUrl);
    if (existing) return existing;

    const slug = slugFromUrl(slugOrUrl);
    const configPath = storeConfigPath(slug);
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig;
    }

    const store: StoreConfig = { slug, name: new URL(slugOrUrl).hostname, url: slugOrUrl };
    mkdirSync(storeThemeDir(slug), { recursive: true });
    writeFileSync(configPath, JSON.stringify(store, null, 2));
    console.log(chalk.gray(`No store found — created stores/${slug}/ automatically.`));
    console.log(chalk.gray(`Drop theme code into stores/${slug}/theme/ to include code review in future audits.`));
    return store;
  }

  const configPath = storeConfigPath(slugOrUrl);
  if (!existsSync(configPath)) {
    throw new Error(
      `No store found for "${slugOrUrl}". Run "pnpm barrel-audit init-store ${slugOrUrl} --url <https://...>" first, or pass a URL directly.`,
    );
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig;
}

export function themeDirHasContent(themeDir: string): boolean {
  return existsSync(themeDir) && readdirSync(themeDir).length > 0;
}
