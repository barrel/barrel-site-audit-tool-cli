import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { ConsentRegistry, ConsentSiteEntry, StoreConfig } from "@barrel/site-audit-shared";
import { dataRoot, storeConfigPath, storesDir } from "../../paths.js";

export function registryPath(root = dataRoot()): string {
  return join(root, "sites.yml");
}

const HEADER = `# Privacy Compliance registry — the reviewable source of truth for \`barrel-audit consent-scan\`.
#
# One entry per production storefront. Only entries with status: active are scanned by default.
# Seed or refresh candidates with \`barrel-audit consent-scan --seed\`; it never overwrites an
# entry that already exists, so hand-edits here always win.
#
#   cmp:        cookiebot | onetrust | osano | cookieyes | shopify-native | none | unknown
#   regions:    us | eu | ca-us   (v1 scans from the US only; the field records intent)
#   expect:     per-site overrides — set preConsentMarketing: true only for a signed-off exception
#   status:     active | paused | offboarded
`;

export function loadRegistry(root = dataRoot()): ConsentRegistry {
  const path = registryPath(root);
  if (!existsSync(path)) return { sites: [] };
  const parsed = parse(readFileSync(path, "utf8")) as ConsentRegistry | null;
  if (!parsed || !Array.isArray(parsed.sites)) return { sites: [] };
  return { sites: parsed.sites.filter(isUsable) };
}

/** A row with no slug or no URL can't be scanned. Dropping it quietly would hide a half-finished
 * hand-edit, so callers surface the count instead. */
function isUsable(entry: ConsentSiteEntry): boolean {
  return Boolean(entry && typeof entry.slug === "string" && entry.slug && typeof entry.url === "string" && entry.url);
}

export function loadRegistryWithProblems(root = dataRoot()): { registry: ConsentRegistry; incomplete: string[] } {
  const path = registryPath(root);
  if (!existsSync(path)) return { registry: { sites: [] }, incomplete: [] };
  const parsed = (parse(readFileSync(path, "utf8")) as ConsentRegistry | null) ?? { sites: [] };
  const all = Array.isArray(parsed.sites) ? parsed.sites : [];
  return {
    registry: { sites: all.filter(isUsable) },
    incomplete: all.filter((e) => !isUsable(e)).map((e) => e?.slug ?? "(unnamed entry)"),
  };
}

export function saveRegistry(registry: ConsentRegistry, root = dataRoot()): void {
  const body = stringify(registry, { lineWidth: 0 });
  writeFileSync(registryPath(root), `${HEADER}\n${body}`);
}

export function activeSites(registry: ConsentRegistry): ConsentSiteEntry[] {
  return registry.sites.filter((s) => (s.status ?? "active") === "active");
}

export interface SeedResult {
  added: ConsentSiteEntry[];
  /** Seeded as paused because the URL is a *.myshopify.com host — a staging/admin domain, not the
   * storefront a shopper (or a regulator) sees. */
  paused: string[];
  /** Repos with no discoverable production URL — the registry's known blind spot, surfaced
   * rather than silently dropped. */
  unresolvedRepos: string[];
  total: number;
}

/** Builds candidate entries from what we can actually derive, and leaves the rest visible.
 *
 * Existing entries are never modified: this is a reviewed file, and a seeder that "corrects"
 * hand-entered domains would make it untrustworthy the first time it guessed wrong. */
export async function seedRegistry(opts: { includeRepos?: boolean; root?: string } = {}): Promise<SeedResult> {
  const root = opts.root ?? dataRoot();
  const registry = loadRegistry(root);
  const bySlug = new Map(registry.sites.map((s) => [s.slug, s]));
  const byHost = new Map(registry.sites.map((s) => [hostOf(s.url), s]));
  const added: ConsentSiteEntry[] = [];
  const paused: string[] = [];

  for (const store of localStores(root)) {
    if (bySlug.has(store.slug) || byHost.has(hostOf(store.url))) continue;
    const url = productionUrl(store.url);
    const staging = isStagingHost(url);
    const entry: ConsentSiteEntry = {
      slug: store.slug,
      client: store.name,
      url,
      cmp: "unknown",
      regions: ["us"],
      status: staging ? "paused" : "active",
    };
    if (staging) paused.push(store.slug);
    if (store.githubRepo) entry.repo = store.githubRepo;
    added.push(entry);
    bySlug.set(entry.slug, entry);
    byHost.set(hostOf(entry.url), entry);
  }

  const unresolvedRepos: string[] = [];
  if (opts.includeRepos) {
    for (const repo of await candidateRepos()) {
      const slug = repo.split("/")[1];
      if (!slug || bySlug.has(slug)) continue;
      if (registry.sites.some((s) => s.repo === repo)) continue;
      // Deliberately not invented: the production domain is genuinely not in the theme code for
      // almost every repo, and a guessed URL would scan the wrong site or nothing at all.
      unresolvedRepos.push(repo);
    }
  }

  if (added.length > 0) {
    saveRegistry({ sites: [...registry.sites, ...added] }, root);
  }
  return { added, paused, unresolvedRepos, total: registry.sites.length + added.length };
}

function localStores(root: string): StoreConfig[] {
  const dir = storesDir(root);
  if (!existsSync(dir)) return [];
  const out: StoreConfig[] = [];
  for (const slug of readdirSync(dir)) {
    const path = storeConfigPath(slug, root);
    if (!existsSync(path)) continue;
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8")) as StoreConfig;
      if (cfg?.slug && cfg?.url) out.push(cfg);
    } catch {
      // unreadable config.json — nothing to seed from
    }
  }
  return out;
}

/** Only uses a GitHub token that's already cached; seeding must never trigger a login prompt. */
async function candidateRepos(): Promise<string[]> {
  try {
    const { hasCachedValidGithubToken, getGithubToken } = await import("../../github-auth.js");
    if (!(await hasCachedValidGithubToken())) return [];
    const { listGithubRepos } = await import("../../github.js");
    const repos = await listGithubRepos(await getGithubToken(), 300);
    return repos.map((r) => r.fullName);
  } catch {
    return [];
  }
}

/** A stores/ entry's URL is whatever was last audited, which for a theme pulled via the Shopify
 * CLI is a preview link (`?preview_theme_id=…&_ab=0`). That renders an *unpublished* theme, so
 * any consent verdict drawn from it would describe code no shopper is running. Strip the query
 * entirely — a storefront homepage never needs one. */
function productionUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function isStagingHost(url: string): boolean {
  try {
    return /(^|\.)myshopify\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
}
