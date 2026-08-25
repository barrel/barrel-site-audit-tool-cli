import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  CodebaseFact,
  OpportunityImpact,
  ThemeIdentity,
  ThemeOpportunity,
  ThemeOrigin,
  ThemeProfileSection,
} from "@barrel/site-audit-shared";

/** Shopify's own free themes, past and present. Used only to answer "is this a stock theme, a fork
 * of one, or something else" — matched against `theme_name`, which is what a fork keeps and a
 * rename loses, so both halves of the comparison (name and author) are needed to tell them apart. */
const STOCK_SHOPIFY_THEMES = [
  "Horizon",
  "Dawn",
  "Trade",
  "Craft",
  "Sense",
  "Refresh",
  "Studio",
  "Spotlight",
  "Publisher",
  "Ride",
  "Taste",
  "Colorblock",
  "Origin",
  "Crave",
  "Debut",
  "Brooklyn",
  "Minimal",
  "Supply",
  "Venture",
  "Boundless",
  "Narrative",
  "Express",
  "Simple",
  "Jumpstart",
];

/** Page-builder apps that write their own `templates/page.<app>.<id>.liquid` files. Same list as
 * theme-structure's signatures, but matched against template filenames rather than file contents. */
const PAGE_BUILDER_TEMPLATE_RE = /\b(replo|shogun|pagefly|gempages|zipify|ecomposer)\b/i;

/** Liquid templates Shopify has no JSON equivalent for — never an Online Store 2.0 migration
 * target, so flagging them as "still legacy" would be a false positive every single time. */
const JSON_INELIGIBLE_TEMPLATES = new Set(["gift_card", "robots.txt", "cart"]);

/** Same pattern theme-structure uses to spot leftover files. A template called
 * `page.rewind_menu_backup_do_not_delete.liquid` wants deleting, not converting to JSON, so it is
 * excluded from the migration list rather than recommended as work. */
const JUNK_NAME_RE = /(^|[-_.])(test|copy|backup|bak|old|tmp|deprecated)([-_.]|$)/i;

/** `theme-DmyZHTp3.css` -> prefix `theme`, segment `DmyZHTp3`, ext `.css`. Splits a filename at its
 * last plausible hash boundary so the trailing segment can be judged on its own. */
const HASHED_ASSET_RE = /^(.*?)[-.]([A-Za-z0-9_-]{8,})(\.[a-z0-9]+)$/;

interface SplitName {
  prefix: string;
  segment: string;
  ext: string;
}

function splitHashed(rel: string): SplitName | null {
  const match = basename(rel).match(HASHED_ASSET_RE);
  return match ? { prefix: match[1], segment: match[2], ext: match[3] } : null;
}

/**
 * Does this trailing segment look like a bundler's content hash rather than part of a filename?
 *
 * Deliberately permissive, because the only thing it gates is *wording* — whether the build-tooling
 * fact says "no build step" or "the build lives outside this repo" — and it takes several matching
 * files (HASHED_ASSET_MIN_FILES) before even that changes. The strict judgement, the one that can
 * tell a client to delete files, is `confirmedHashGroups` below.
 *
 * Real hashes are not all alike: Vite/Rollup emit base64url that often contains no digit at all
 * (`BczSmmvf`), while Webpack and esbuild emit lowercase hex. Requiring a digit — the obvious
 * rule — silently misses most Vite output.
 */
function looksLikeHash(segment: string): boolean {
  if (segment.length < 8) return false;
  if (/^[0-9a-f]{8,}$/.test(segment)) return true;
  const mixedCase = /[A-Z]/.test(segment) && /[a-z]/.test(segment);
  return mixedCase || /[0-9]/.test(segment);
}

/** How many hash-looking asset filenames it takes before a theme is called bundler-built. One
 * `Epilogue-BoldItalic.ttf` is a font weight; twenty hash-looking names are a build. */
const HASHED_ASSET_MIN_FILES = 5;

/** How many siblings sharing a prefix, extension AND segment length it takes to *confirm* content
 * hashing. One bundler emits one hash length, so `theme-DmyZHTp3/BczSmmvf/8yF1ExKb.css` are three
 * generations of one bundle — where `Epilogue-Bold/BoldItalic/Medium.ttf` (lengths 4/10/6) and
 * `product-recommendations/placeholder/quickview.js` (15/11/9) are just files with a shared
 * prefix. Requiring equal length is what separates the two without guessing at word-ness. */
const CONFIRMED_HASH_GROUP_MIN = 3;

/** Prefix+extension keys whose files are confirmed generations of one content-hashed bundle. */
function confirmedHashGroups(assetFiles: ThemeFile[]): Map<string, ThemeFile[]> {
  const byShape = new Map<string, ThemeFile[]>();
  for (const f of assetFiles) {
    const split = splitHashed(f.rel);
    if (!split || !looksLikeHash(split.segment)) continue;
    const key = `${split.prefix}*${split.ext}\u0000${split.segment.length}`;
    byShape.set(key, [...(byShape.get(key) ?? []), f]);
  }

  const confirmed = new Map<string, ThemeFile[]>();
  for (const [shapeKey, group] of byShape) {
    if (group.length < CONFIRMED_HASH_GROUP_MIN) continue;
    // Drop the segment-length discriminator from the key now that it has done its job — what the
    // report shows is `theme*.css`, not `theme*.css\u00008`.
    confirmed.set(shapeKey.split("\u0000")[0], group);
  }
  return confirmed;
}

/** `assets/product-B0YBOcEk.js` -> `product*.js`, `assets/base.css` -> `base.css`. The identity of
 * a bundle across rebuilds, which is what the framework scan wants: a theme with eight generations
 * of the same twelve bundles has twelve distinct files in it, and reading one of each is enough. */
function bundleStem(rel: string): string {
  const split = splitHashed(rel);
  return split && looksLikeHash(split.segment) ? `${split.prefix}*${split.ext}` : basename(rel);
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
const LEGACY_FONT_EXTS = new Set([".ttf", ".otf", ".eot", ".woff"]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".shopify", "dist", ".cache"]);

interface ThemeFile {
  /** Path relative to the theme root, forward-slashed. */
  rel: string;
  abs: string;
  bytes: number;
}

function walkTheme(dir: string): ThemeFile[] {
  const out: ThemeFile[] = [];
  const walk = (sub: string) => {
    let entries: string[];
    try {
      entries = readdirSync(join(dir, sub));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const rel = sub ? `${sub}/${entry}` : entry;
      const abs = join(dir, rel);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(rel);
      else out.push({ rel, abs, bytes: stat.size });
    }
  };
  walk("");
  return out;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

const THEME_INFO_KEYS = ["theme_name", "theme_version", "theme_author", "theme_documentation_url"] as const;

/** Shopify's own JSON parser tolerates trailing commas, and real settings_schema.json files in
 * production themes do contain them — a strict JSON.parse alone loses theme identity on a
 * perfectly working theme. So: try strict, then retry with trailing commas stripped, and if even
 * that fails pull the four theme_info strings out directly rather than giving up on the file. */
function readThemeInfo(raw: string): Record<string, unknown> | "unparseable" | null {
  const findInfo = (text: string): Record<string, unknown> | undefined => {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.find((entry): entry is Record<string, unknown> => {
      return typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).name === "theme_info";
    });
  };

  for (const candidate of [raw, raw.replace(/,(\s*[}\]])/g, "$1")]) {
    try {
      const info = findInfo(candidate);
      // Parsed cleanly but has no theme_info block — a real answer, not a parse failure.
      return info ?? null;
    } catch {
      // Try the next, more forgiving form.
    }
  }

  const scraped: Record<string, unknown> = {};
  for (const key of THEME_INFO_KEYS) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
    if (match) scraped[key] = match[1];
  }
  return Object.keys(scraped).length > 0 ? scraped : "unparseable";
}

/** Reads the `theme_info` block out of config/settings_schema.json — the only self-declaration a
 * Shopify theme carries about its own name, version and author. */
function readIdentity(themeDir: string): ThemeIdentity {
  const schemaPath = join(themeDir, "config", "settings_schema.json");
  const raw = readOrNull(schemaPath);
  if (!raw) {
    return {
      origin: "unknown",
      detail: "No config/settings_schema.json in the synced theme, so the theme can't identify itself.",
    };
  }

  const info = readThemeInfo(raw);

  if (info === "unparseable") {
    return {
      origin: "unknown",
      detail: "config/settings_schema.json could not be parsed and declares no readable theme_info block.",
    };
  }

  if (info === null) {
    return {
      origin: "custom",
      detail:
        "config/settings_schema.json has no theme_info block — typical of a theme built from scratch rather than " +
        "installed from the Theme Store.",
    };
  }

  const str = (key: string): string | undefined => {
    const value = info[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  const name = str("theme_name");
  const version = str("theme_version");
  const author = str("theme_author");
  const documentationUrl = str("theme_documentation_url");

  const basedOn = name ? STOCK_SHOPIFY_THEMES.find((t) => new RegExp(`\\b${t}\\b`, "i").test(name)) : undefined;
  const byShopify = /^shopify\b/i.test(author ?? "");

  let origin: ThemeOrigin;
  let detail: string;
  const stamp = `config/settings_schema.json declares "${name ?? "(unnamed)"}"${version ? ` v${version}` : ""}${
    author ? ` by ${author}` : ""
  }`;

  if (basedOn && byShopify) {
    origin = "shopify-stock";
    detail = `${stamp} — a stock Shopify theme, so upstream ${basedOn} releases can be merged in.`;
  } else if (basedOn) {
    origin = "shopify-fork";
    detail = `${stamp} — the name still matches Shopify's stock ${basedOn} theme but the author doesn't, so this is a fork carrying its own version number.`;
  } else if (name) {
    origin = "third-party";
    detail = `${stamp} — a named third-party or agency theme, not one of Shopify's stock themes.`;
  } else {
    origin = "custom";
    detail = "config/settings_schema.json has a theme_info block but no theme_name, so the theme is effectively unnamed.";
  }

  return { name, version, author, documentationUrl, origin, basedOn, detail };
}

interface BuildTooling {
  /** Human-readable summary for the facts table. */
  summary: string;
  detail: string;
  /** True when there is a real bundler config/dependency, not just a bare package.json. */
  hasBundler: boolean;
}

const BUNDLER_DEPS: Record<string, string> = {
  vite: "Vite",
  webpack: "Webpack",
  rollup: "Rollup",
  esbuild: "esbuild",
  parcel: "Parcel",
  gulp: "Gulp",
  "@shopify/cli": "Shopify CLI",
};

const EXTRA_DEPS: Record<string, string> = {
  tailwindcss: "Tailwind CSS",
  typescript: "TypeScript",
  sass: "Sass",
  postcss: "PostCSS",
  alpinejs: "Alpine.js",
  vue: "Vue",
  react: "React",
  svelte: "Svelte",
  "@hotwired/stimulus": "Stimulus",
  jquery: "jQuery",
};

function detectBuildTooling(themeDir: string, files: ThemeFile[]): BuildTooling {
  const pkgRaw = readOrNull(join(themeDir, "package.json"));
  const configFiles = files
    .filter((f) => !f.rel.includes("/"))
    .map((f) => f.rel)
    .filter((rel) => /^(vite|webpack|rollup|gulpfile|tailwind|postcss|svelte)\.config\./i.test(rel));

  if (!pkgRaw) {
    return {
      summary: configFiles.length > 0 ? `No package.json (config files present: ${configFiles.join(", ")})` : "None",
      detail:
        configFiles.length > 0
          ? "Build configs are committed but package.json isn't, so the build can't be reproduced from this theme alone."
          : "No package.json or bundler config — Liquid, CSS and JS are committed to assets/ directly and edited in place.",
      hasBundler: false,
    };
  }

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return { summary: "package.json present (unparseable)", detail: "package.json exists but is not valid JSON.", hasBundler: false };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const bundlers = Object.entries(BUNDLER_DEPS)
    .filter(([dep]) => dep in deps)
    .map(([, label]) => label);
  const extras = Object.entries(EXTRA_DEPS)
    .filter(([dep]) => dep in deps)
    .map(([, label]) => label);

  const named = [...bundlers, ...extras];
  const lockfile = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"].find((f) =>
    files.some((file) => file.rel === f),
  );
  const scriptNames = Object.keys(pkg.scripts ?? {});

  return {
    summary: named.length > 0 ? named.join(", ") : "package.json only",
    detail:
      `${formatCount(Object.keys(deps).length, "dependency", "dependencies")}` +
      (lockfile ? `, ${lockfile}` : ", no lockfile committed") +
      (scriptNames.length > 0 ? `, scripts: ${scriptNames.slice(0, 6).join(", ")}` : ", no npm scripts") +
      ".",
    hasBundler: bundlers.length > 0 || configFiles.length > 0,
  };
}

/** Front-end signals worth naming in a client-facing audit, in the order they should be reported.
 * Each is matched against Liquid source plus the smaller JS files in assets/. */
const FRONTEND_SIGNALS: { label: string; re: RegExp }[] = [
  { label: "Native web components", re: /customElements\.define\s*\(/ },
  { label: "Alpine.js", re: /\bx-data\s*=|alpinejs/i },
  { label: "Vue", re: /\bVue\.createApp\s*\(|createApp\s*\(|vue(\.runtime)?\.(esm|global|min)/i },
  { label: "React", re: /\breact-dom\b|ReactDOM\.(createRoot|render)\s*\(/ },
  { label: "Stimulus / Hotwire", re: /@hotwired\/stimulus|data-controller\s*=/ },
  { label: "htmx", re: /\bhx-(get|post|swap)\s*=/ },
  { label: "jQuery", re: /\bjquery\b|\bjQuery\s*\(|\$\(document\)\.ready/i },
  { label: "Swiper", re: /\bnew\s+Swiper\s*\(|\bswiper[-.]/i },
  { label: "Splide", re: /\bnew\s+Splide\s*\(|\bsplide[-.]/i },
  { label: "GSAP", re: /\bgsap\b/i },
];

/** JS/CSS files bigger than this aren't read for framework detection — a 600 KB minified bundle
 * costs more to scan than the signal is worth, and its filename usually gives it away anyway. */
const MAX_ASSET_SCAN_BYTES = 200_000;
/** Cap on how many files get read at all, so a 1,300-file assets/ directory stays cheap. Applied
 * after deduplicating by bundle stem, so the budget buys 200 *distinct* files rather than 200
 * generations of the same six — which is most or all of a real theme's distinct assets. */
const MAX_ASSETS_SCANNED = 200;

function severityFor(bytes: number, high: number, medium: number): OpportunityImpact {
  if (bytes >= high) return "high";
  if (bytes >= medium) return "medium";
  return "low";
}

const IMPACT_ORDER: Record<OpportunityImpact, number> = { high: 0, medium: 1, low: 2 };

/**
 * What theme this store runs, what its codebase is made of, and what could be improved in it.
 *
 * Entirely deterministic: every fact and every opportunity below is read off the files on disk and
 * cites the count or filename it came from, so nothing here depends on an API key and nothing here
 * can be a hallucination. The AI architecture assessment (theme-architecture.ts) is handed this
 * output as grounding rather than re-deriving it.
 *
 * Deliberately does not repeat theme-structure's findings (orphaned sections/snippets, junk
 * filenames, competing page-builder apps) — those already have their own section in the report.
 */
export function analyzeThemeProfile(themeDir: string): ThemeProfileSection | null {
  if (!existsSync(themeDir)) return null;
  const files = walkTheme(themeDir);
  if (files.length === 0) return null;

  const identity = readIdentity(themeDir);
  const facts: CodebaseFact[] = [];
  const opportunities: ThemeOpportunity[] = [];

  const inDir = (dir: string) => files.filter((f) => f.rel === dir || f.rel.startsWith(`${dir}/`));
  const templateFiles = inDir("templates");
  const sectionFiles = inDir("sections");
  const snippetFiles = inDir("snippets");
  const blockFiles = inDir("blocks").filter((f) => f.rel.endsWith(".liquid"));
  const assetFiles = inDir("assets");
  const localeFiles = inDir("locales").filter((f) => f.rel.endsWith(".json"));

  const jsonTemplates = templateFiles.filter((f) => f.rel.endsWith(".json"));
  const liquidTemplates = templateFiles.filter((f) => f.rel.endsWith(".liquid"));
  const sectionGroups = sectionFiles.filter((f) => f.rel.endsWith(".json"));
  const liquidSections = sectionFiles.filter((f) => f.rel.endsWith(".liquid"));

  // --- Liquid source: read it all once, everything below is derived from this. -----------------
  const liquidFiles = files.filter((f) => f.rel.endsWith(".liquid"));
  const liquidSource = new Map<string, string>();
  let liquidLines = 0;
  for (const f of liquidFiles) {
    const content = readOrNull(f.abs);
    if (content === null) continue;
    liquidSource.set(f.rel, content);
    liquidLines += content.split("\n").length;
  }
  const allLiquid = [...liquidSource.values()].join("\n");

  // --- Template architecture -------------------------------------------------------------------
  const hasHeaderGroup = sectionGroups.some((f) => /header-group/.test(f.rel));
  const hasFooterGroup = sectionGroups.some((f) => /footer-group/.test(f.rel));
  facts.push({
    label: "Template architecture",
    value:
      jsonTemplates.length > 0
        ? `Online Store 2.0 — ${jsonTemplates.length} JSON / ${liquidTemplates.length} Liquid`
        : `Legacy Liquid templates — ${liquidTemplates.length} Liquid, no JSON`,
    detail:
      sectionGroups.length > 0
        ? `${formatCount(sectionGroups.length, "section group")} (${[hasHeaderGroup && "header", hasFooterGroup && "footer"]
            .filter(Boolean)
            .join(" + ") || "non-standard"}), so layout chrome is merchant-editable.`
        : "No section groups, so the header and footer are only editable in code.",
  });

  const appBlockSections = liquidSections.filter((f) => /"@app"/.test(liquidSource.get(f.rel) ?? ""));
  const themeBlockAccepting = [...liquidSource.entries()].filter(
    ([rel, content]) => (rel.startsWith("sections/") || rel.startsWith("blocks/")) && /"@theme"/.test(content),
  );
  facts.push({
    label: "Blocks & extensibility",
    value:
      blockFiles.length > 0
        ? `${formatCount(blockFiles.length, "theme block")}, ${appBlockSections.length}/${liquidSections.length} sections accept app blocks`
        : `No blocks/ directory · ${appBlockSections.length}/${liquidSections.length} sections accept app blocks`,
    detail:
      themeBlockAccepting.length > 0
        ? `${themeBlockAccepting.length} section(s)/block(s) declare "@theme", the current Shopify block model.`
        : 'No section declares "@theme", so blocks can only be the fixed types each section hard-codes.',
  });

  // --- Liquid footprint ------------------------------------------------------------------------
  facts.push({
    label: "Liquid footprint",
    value: `${liquidLines.toLocaleString()} lines across ${liquidFiles.length} files`,
    detail: `${liquidSections.length} sections, ${snippetFiles.filter((f) => f.rel.endsWith(".liquid")).length} snippets, ${templateFiles.length} templates.`,
  });

  // --- Assets ----------------------------------------------------------------------------------
  const assetBytes = assetFiles.reduce((sum, f) => sum + f.bytes, 0);
  const biggestAssets = [...assetFiles].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  facts.push({
    label: "Assets",
    value: `${assetFiles.length} files · ${formatBytes(assetBytes)}`,
    detail:
      biggestAssets.length > 0
        ? `Largest: ${biggestAssets.map((f) => `${basename(f.rel)} (${formatBytes(f.bytes)})`).join(", ")}.`
        : undefined,
  });

  // Computed here rather than down in the opportunities because the mere presence of hashed
  // filenames changes what the build-tooling fact means: hashed output with no committed config is
  // a build that lives somewhere else, not the absence of one.
  const hashGroups = confirmedHashGroups(assetFiles);
  const hashedAssetCount = assetFiles.filter((f) => {
    const split = splitHashed(f.rel);
    return split !== null && looksLikeHash(split.segment);
  }).length;
  const hasHashedBundles = hashedAssetCount >= HASHED_ASSET_MIN_FILES;

  const scriptAssets = assetFiles.filter((f) => /\.(js|mjs)$/.test(f.rel));
  const styleAssets = assetFiles.filter((f) => /\.(css|scss)$/.test(f.rel));
  const scriptBytes = scriptAssets.reduce((sum, f) => sum + f.bytes, 0);
  const styleBytes = styleAssets.reduce((sum, f) => sum + f.bytes, 0);
  facts.push({
    label: "JS & CSS in the theme",
    value: `${formatBytes(scriptBytes)} JS (${scriptAssets.length} files) · ${formatBytes(styleBytes)} CSS (${styleAssets.length} files)`,
    detail: "Uncompressed on-disk size of theme-owned assets — app scripts loaded at runtime are not counted here.",
  });

  // --- Build tooling ---------------------------------------------------------------------------
  const tooling = detectBuildTooling(themeDir, files);
  facts.push({
    label: "Build tooling",
    value: tooling.summary,
    detail:
      !tooling.hasBundler && hasHashedBundles
        ? `Assets carry content-hashed bundler filenames (${hashedAssetCount} of ${assetFiles.length} files), but no package.json ` +
          "or bundler config is committed — the build that produces them lives outside this repo, so nobody working " +
          "from this checkout alone can reproduce or change it."
        : tooling.detail,
  });

  // --- Front-end approach ----------------------------------------------------------------------
  // Uncompiled sources count too: a theme with a build step keeps its real front-end code in
  // frontend/ or src/, and only its minified output in assets/.
  const sourceScripts = files.filter(
    (f) => /^(frontend|src)\//.test(f.rel) && /\.(js|mjs|ts|jsx|tsx|css|scss)$/.test(f.rel),
  );
  // One representative (the largest) per bundle stem, so eight generations of product-*.js cost
  // one read rather than eight and the budget reaches the files that are actually distinct.
  const byStem = new Map<string, ThemeFile>();
  for (const f of [...scriptAssets, ...styleAssets, ...sourceScripts]) {
    if (f.bytes > MAX_ASSET_SCAN_BYTES) continue;
    const key = bundleStem(f.rel);
    const existing = byStem.get(key);
    if (!existing || f.bytes > existing.bytes) byStem.set(key, f);
  }
  // Ordered by how likely a file is to *carry* a framework signal rather than by size: the theme's
  // own uncompiled sources first, then script assets, then stylesheets. Sorting purely by size
  // spends the whole budget on big minified CSS bundles, which say nothing about the front end.
  const scanRank = (rel: string): number => {
    if (/^(frontend|src)\//.test(rel)) return 0;
    if (/\.(js|mjs|ts|jsx|tsx)$/.test(rel)) return 1;
    return 2;
  };
  const scannable = [...byStem.values()]
    .sort((a, b) => scanRank(a.rel) - scanRank(b.rel) || b.bytes - a.bytes)
    .slice(0, MAX_ASSETS_SCANNED);
  const scanned = scannable.map((f) => ({ rel: f.rel, text: `${f.rel}\n${readOrNull(f.abs) ?? ""}` }));
  const assetSource = scanned
    .map((f) => f.text)
    // Every asset filename, scanned or not — a name like swiper-B8OfTuF9.js is itself the signal.
    .concat(assetFiles.map((f) => f.rel))
    .join("\n");
  const frontendHaystack = `${allLiquid}\n${assetSource}`;

  /** Which files a signal was actually seen in — asset contents, asset filenames, or Liquid. Used
   * so an opportunity can cite the file rather than guess at where the dependency comes from. */
  const filesMatching = (re: RegExp): string[] => [
    ...scanned.filter((f) => re.test(f.text)).map((f) => f.rel),
    ...assetFiles.filter((f) => re.test(f.rel)).map((f) => f.rel),
    ...[...liquidSource.entries()].filter(([, content]) => re.test(content)).map(([rel]) => rel),
  ];
  const frontend = FRONTEND_SIGNALS.filter((s) => s.re.test(frontendHaystack)).map((s) => s.label);
  facts.push({
    label: "Front-end approach",
    value: frontend.length > 0 ? frontend.join(", ") : "Plain Liquid + vanilla JS",
    detail:
      frontend.length > 0
        ? "Detected from the theme's own Liquid and assets/ — a long list here usually means several eras of build layered on top of each other."
        : "No JS framework or component library signatures found in the theme's own code.",
  });

  // --- Localization ----------------------------------------------------------------------------
  const marketVariants = sectionGroups.filter((f) => /\.context\./.test(f.rel));
  facts.push({
    label: "Localization",
    value: `${formatCount(localeFiles.length, "locale file")}`,
    detail:
      marketVariants.length > 0
        ? `${marketVariants.length} market-specific section-group variant(s) (.context.*), so layout differs per market.`
        : "No market-specific section-group variants.",
  });

  // --- Custom data -----------------------------------------------------------------------------
  const metafieldRefs = (allLiquid.match(/\.metafields\./g) ?? []).length;
  const metaobjectRefs = (allLiquid.match(/metaobject/gi) ?? []).length;
  facts.push({
    label: "Custom data",
    value: `${metafieldRefs} metafield reference${metafieldRefs === 1 ? "" : "s"} · ${metaobjectRefs} metaobject reference${metaobjectRefs === 1 ? "" : "s"}`,
    detail:
      metafieldRefs === 0 && metaobjectRefs === 0
        ? "No metafields or metaobjects in the theme — merchant-editable content is limited to theme settings."
        : "Counted across all Liquid files; higher numbers mean more content lives in Shopify's own data model rather than hard-coded.",
  });

  // --- Repo hygiene ----------------------------------------------------------------------------
  const hasThemeCheckConfig = files.some((f) => /^\.theme-check\.ya?ml$/.test(f.rel));
  const hasCi = files.some((f) => f.rel.startsWith(".github/workflows/"));
  const hasReadme = files.some((f) => /^readme\.md$/i.test(f.rel));
  const hygiene = [
    hasThemeCheckConfig ? ".theme-check.yml" : null,
    hasCi ? "GitHub Actions" : null,
    hasReadme ? "README" : null,
  ].filter(Boolean) as string[];
  facts.push({
    label: "Repo hygiene",
    value: hygiene.length > 0 ? hygiene.join(", ") : "None found",
    detail:
      hygiene.length === 3
        ? "Lint config, CI and docs are all committed with the theme."
        : `Missing: ${[!hasThemeCheckConfig && ".theme-check.yml", !hasCi && "CI workflow", !hasReadme && "README"].filter(Boolean).join(", ")}.`,
  });

  // ============================== Opportunities =================================================

  // Deprecated {% include %}. Shopify has deprecated it in favour of {% render %}, which gets an
  // isolated scope — the shared scope is the actual bug source, not the deprecation itself.
  const includeFiles = [...liquidSource.entries()].filter(([, content]) => /\{%-?\s*include\s+/.test(content));
  const includeCount = (allLiquid.match(/\{%-?\s*include\s+/g) ?? []).length;
  if (includeCount > 0) {
    opportunities.push({
      title: `${formatCount(includeCount, "deprecated {% include %} tag")} still in the theme`,
      impact: includeCount >= 25 ? "medium" : "low",
      effort: "low",
      detail: `Found across ${formatCount(includeFiles.length, "file")}, starting with ${includeFiles
        .slice(0, 3)
        .map(([rel]) => rel)
        .join(", ")}. Unlike {% render %}, {% include %} shares the parent's variable scope, so a snippet can silently overwrite a caller's variables.`,
      recommendation:
        "Swap each {% include 'x' %} for {% render 'x' %}, passing whatever variables the snippet was implicitly reading as explicit arguments, then re-run theme-check to confirm nothing broke.",
      source: "scan",
    });
  }

  // Oversized images shipped through assets/ — these bypass Shopify's CDN image transforms
  // entirely, so they're served at full weight to every visitor.
  const heavyImages = assetFiles
    .filter((f) => IMAGE_EXTS.has(extname(f.rel).toLowerCase()) && f.bytes > 300_000)
    .sort((a, b) => b.bytes - a.bytes);
  if (heavyImages.length > 0) {
    const worst = heavyImages[0];
    opportunities.push({
      title: `${formatCount(heavyImages.length, "oversized image")} committed to assets/`,
      impact: severityFor(worst.bytes, 1_000_000, 500_000),
      effort: "low",
      detail: `${heavyImages
        .slice(0, 4)
        .map((f) => `${basename(f.rel)} (${formatBytes(f.bytes)})`)
        .join(", ")}${heavyImages.length > 4 ? `, +${heavyImages.length - 4} more` : ""} — ${formatBytes(
        heavyImages.reduce((s, f) => s + f.bytes, 0),
      )} in total. Files in assets/ are served as-is: Shopify's image_url transforms and WebP conversion only apply to images uploaded to Files or a product/collection.`,
      recommendation:
        "Move these into Shopify Files (or the relevant product/collection record) and render them through `image_url: width: …` + `image_tag`, so each visitor gets a correctly-sized WebP instead of the full-weight original.",
      source: "scan",
    });
  }

  // Animated GIFs — the single most reliably wasteful asset format on a storefront.
  const heavyGifs = assetFiles.filter((f) => f.rel.toLowerCase().endsWith(".gif") && f.bytes > 400_000);
  if (heavyGifs.length > 0) {
    const gifBytes = heavyGifs.reduce((s, f) => s + f.bytes, 0);
    opportunities.push({
      title: `${formatCount(heavyGifs.length, "animated GIF")} where a video or WebP would be a fraction of the weight`,
      impact: severityFor(gifBytes, 3_000_000, 1_000_000),
      effort: "low",
      detail: `${heavyGifs
        .slice(0, 4)
        .map((f) => `${basename(f.rel)} (${formatBytes(f.bytes)})`)
        .join(", ")} — ${formatBytes(gifBytes)} of GIF. An animated WebP or a muted looping MP4 typically lands at 5-15% of the same GIF's size at the same visual quality.`,
      recommendation:
        "Re-encode each as animated WebP (or a muted, looping, autoplaying <video> for anything longer than a second or two) and swap the asset reference; keep the GIF only as a fallback if IE-era support genuinely matters.",
      source: "scan",
    });
  }

  // Legacy font formats. woff2 is supported everywhere the storefront is, at roughly half the size.
  const legacyFonts = assetFiles.filter((f) => LEGACY_FONT_EXTS.has(extname(f.rel).toLowerCase()));
  if (legacyFonts.length > 0) {
    const fontBytes = legacyFonts.reduce((s, f) => s + f.bytes, 0);
    opportunities.push({
      title: `${formatCount(legacyFonts.length, "legacy-format font file")} in assets/`,
      impact: severityFor(fontBytes, 1_500_000, 400_000),
      effort: "low",
      detail: `${legacyFonts
        .slice(0, 4)
        .map((f) => `${basename(f.rel)} (${formatBytes(f.bytes)})`)
        .join(", ")}${legacyFonts.length > 4 ? `, +${legacyFonts.length - 4} more` : ""} — ${formatBytes(
        fontBytes,
      )} in .ttf/.otf/.eot/.woff. Every browser that can render this storefront supports woff2, which is roughly half the size of the same face as .ttf.`,
      recommendation:
        "Convert each face to woff2, serve woff2 only in @font-face (no fallback src needed), and delete the old files — or move to Shopify's own font_url picker where the face is available there.",
      source: "scan",
    });
  }

  // Several content-hashed generations of the same bundle sitting side by side: the build ran,
  // the old output was never cleaned up, and the theme now ships dead weight.
  const staleGroups = [...hashGroups.entries()];
  if (staleGroups.length > 0) {
    const staleBytes = staleGroups.reduce(
      // Only one generation of each bundle can be the live one, so all but the largest is dead
      // weight. Sorted first so the estimate doesn't depend on readdir order.
      (sum, [, group]) =>
        sum +
        [...group]
          .sort((a, b) => b.bytes - a.bytes)
          .slice(1)
          .reduce((s, f) => s + f.bytes, 0),
      0,
    );
    opportunities.push({
      title: `Stale build output accumulating in assets/ (${formatCount(staleGroups.length, "bundle")} with 3+ generations)`,
      impact: severityFor(staleBytes, 2_000_000, 500_000),
      effort: "low",
      detail: `${staleGroups
        .slice(0, 3)
        .map(([key, group]) => `${key} × ${group.length}`)
        .join(", ")} — roughly ${formatBytes(staleBytes)} of superseded bundles still committed. Content-hashed filenames mean old generations are never overwritten, only orphaned.`,
      recommendation:
        "Clear assets/ of the hashed outputs as part of the build (or add them to .gitignore and publish from CI), so only the generation the current Liquid references is ever committed.",
      source: "scan",
    });
  }

  // Page-builder-owned page templates: the theme no longer controls those pages' markup.
  const builderTemplates = liquidTemplates.filter((f) => PAGE_BUILDER_TEMPLATE_RE.test(basename(f.rel)));
  if (builderTemplates.length > 0) {
    const apps = [
      ...new Set(builderTemplates.map((f) => basename(f.rel).match(PAGE_BUILDER_TEMPLATE_RE)?.[1]?.toLowerCase())),
    ].filter(Boolean) as string[];
    opportunities.push({
      title: `${formatCount(builderTemplates.length, "page template")} owned by a page-builder app, not the theme`,
      impact: builderTemplates.length >= 5 ? "medium" : "low",
      effort: "medium",
      detail: `${builderTemplates
        .slice(0, 4)
        .map((f) => basename(f.rel))
        .join(", ")}${builderTemplates.length > 4 ? `, +${builderTemplates.length - 4} more` : ""} (${apps.join(
        ", ",
      )}). These pages render the app's own markup and load its runtime, so they don't inherit the theme's components, settings or performance budget — and they break if the app is uninstalled.`,
      recommendation: `Rebuild the highest-traffic of these pages as native JSON templates using the theme's own sections, then delete the ${apps.join(
        "/",
      )} template and confirm the page still resolves before uninstalling the app.`,
      source: "scan",
    });
  }

  // Liquid-only templates that have a JSON equivalent available — the actual OS 2.0 gap.
  const migratableTemplates = liquidTemplates.filter((f) => {
    const name = basename(f.rel, ".liquid");
    // "page.contact.liquid" -> "page" (an alternate template of a migratable type), but
    // "robots.txt.liquid" -> "robots.txt", which has no JSON form at all. Both spellings are
    // checked because splitting on "." alone turns the second into "robots" and loses the match.
    const full = f.rel.replace(/^templates\//, "").replace(/\.liquid$/, "");
    return (
      !JSON_INELIGIBLE_TEMPLATES.has(full) &&
      !JSON_INELIGIBLE_TEMPLATES.has(full.split(".")[0]) &&
      !PAGE_BUILDER_TEMPLATE_RE.test(basename(f.rel)) &&
      !JUNK_NAME_RE.test(name)
    );
  });
  if (jsonTemplates.length > 0 && migratableTemplates.length > 0) {
    opportunities.push({
      title: `${formatCount(migratableTemplates.length, "template")} still Liquid-only in an otherwise Online Store 2.0 theme`,
      impact: "low",
      effort: "medium",
      detail: `${migratableTemplates
        .slice(0, 4)
        .map((f) => basename(f.rel))
        .join(", ")}${migratableTemplates.length > 4 ? `, +${migratableTemplates.length - 4} more` : ""}, against ${
        jsonTemplates.length
      } JSON templates. Liquid templates can't be edited in the theme customizer at all, so any change to them is a developer ticket.`,
      recommendation:
        "Convert each to a JSON template whose sections wrap the existing markup, so merchants can reorder and configure the page without a deploy.",
      source: "scan",
    });
  } else if (jsonTemplates.length === 0 && liquidTemplates.length > 0) {
    opportunities.push({
      title: "Theme predates Online Store 2.0 — no JSON templates at all",
      impact: "high",
      effort: "high",
      detail: `All ${liquidTemplates.length} templates are Liquid, and there are no section groups. Nothing in this theme is reorderable in the customizer, app blocks can't be installed without code, and most current Shopify features (theme blocks, section groups, per-market layout) assume a JSON template architecture.`,
      recommendation:
        "Plan a migration to Online Store 2.0: convert the highest-traffic templates (index, product, collection) to JSON first, extract their markup into sections with schemas, then add header/footer section groups.",
      source: "scan",
    });
  }

  // Section groups: header/footer stuck in code.
  if (jsonTemplates.length > 0 && (!hasHeaderGroup || !hasFooterGroup)) {
    const missing = [!hasHeaderGroup && "header", !hasFooterGroup && "footer"].filter(Boolean).join(" and ");
    opportunities.push({
      title: `No ${missing} section group`,
      impact: "medium",
      effort: "medium",
      detail: `The theme has ${jsonTemplates.length} JSON templates but no ${missing}-group.json in sections/, so the ${missing} is rendered straight from layout/theme.liquid and can't be reordered or extended in the customizer.`,
      recommendation: `Add sections/${!hasHeaderGroup ? "header" : "footer"}-group.json listing the current ${missing} sections, and replace the hard-coded {% section %} calls in layout/theme.liquid with {% sections '${!hasHeaderGroup ? "header" : "footer"}-group' %}.`,
      source: "scan",
    });
  }

  // Theme blocks — the current extensibility model, and the one Horizon-era features assume.
  if (jsonTemplates.length > 0 && blockFiles.length === 0 && themeBlockAccepting.length === 0) {
    opportunities.push({
      title: "Theme blocks not adopted",
      impact: "medium",
      effort: "medium",
      detail: `No blocks/ directory and no section declares "@theme" across ${liquidSections.length} sections. Every section therefore hard-codes its own block types, so the same "image + text" block has to be re-implemented per section and can't be reused or nested.`,
      recommendation:
        'Extract the block types that repeat across sections into blocks/*.liquid, then let the sections that should accept them declare `"blocks": [{ "type": "@theme" }]` in their schema.',
      source: "scan",
    });
  }

  // App blocks — whether apps can be installed without a developer.
  if (liquidSections.length > 0 && appBlockSections.length === 0) {
    opportunities.push({
      title: "No section accepts app blocks",
      impact: "medium",
      effort: "low",
      detail: `None of the ${liquidSections.length} sections declare a "@app" block type, so every app that offers a theme-app-extension block (reviews, upsells, size charts, loyalty widgets) has to be installed by pasting its snippet into Liquid instead.`,
      recommendation:
        'Add `{ "type": "@app" }` to the blocks array in the schemas of the sections apps actually target — product information, cart, and the main collection/page sections are the usual ones.',
      source: "scan",
    });
  }

  // jQuery: a whole library's download and parse cost for what the platform now does natively.
  const jqueryRe = /\bjquery\b/i;
  if (jqueryRe.test(frontendHaystack)) {
    // Named files first: "jQuery is in these files" is checkable, where "jQuery is in the theme
    // somewhere" invites the reader to go looking. The cap keeps a bundled copy in twenty
    // components from turning into a twenty-filename paragraph.
    const where = [...new Set(filesMatching(jqueryRe).map((rel) => basename(rel)))];
    opportunities.push({
      title: "jQuery still in use in the theme",
      impact: "low",
      effort: "medium",
      detail:
        (where.length > 0
          ? `Seen in ${where.slice(0, 4).join(", ")}${where.length > 4 ? `, +${where.length - 4} more` : ""}. `
          : "") +
        "Everything jQuery is used for here — selection, events, fetch, DOM manipulation — is native in every " +
        "browser this storefront supports, so the library is download and parse cost for behaviour the platform " +
        "already provides.",
      recommendation:
        "Port the jQuery call sites to querySelector/addEventListener/fetch (they map almost one-to-one), then drop " +
        "the jQuery asset and its script tag from layout/theme.liquid — or, if it turns out to be bundled inside " +
        "another asset, rebuild that asset without it.",
      source: "scan",
    });
  }

  // Two genuinely different situations, and the wrong advice for either one is wasted work: a
  // theme with no build at all needs one adding; a theme whose build output is committed without
  // its build needs the build itself brought into the repo.
  if (!tooling.hasBundler && hasHashedBundles) {
    opportunities.push({
      title: "The theme's build output is committed, but its build isn't",
      impact: "medium",
      effort: "low",
      detail: `${hashedAssetCount} of the ${assetFiles.length} files in assets/ carry content-hashed bundler filenames — output from a bundler — while the theme has no package.json or bundler config committed. Whoever has that build configuration on their machine is the only person who can change the theme's JS or CSS, and there's no way to verify that what's deployed matches any source.`,
      recommendation:
        "Bring the build into this repo: commit the package.json, lockfile and bundler config that produce these assets, and add the source files they compile from — then a `pnpm build` from a fresh clone should reproduce what's in assets/.",
      source: "scan",
    });
  } else if (!tooling.hasBundler && scriptBytes + styleBytes > 1_000_000) {
    opportunities.push({
      title: `${formatBytes(scriptBytes + styleBytes)} of JS/CSS committed with no build step`,
      impact: "medium",
      effort: "medium",
      detail: `${scriptAssets.length} JS and ${styleAssets.length} CSS files in assets/ totalling ${formatBytes(
        scriptBytes + styleBytes,
      )}, with no bundler config or dependency in the theme. Without a build there's no minification, no tree-shaking and no way to split what a given template actually needs.`,
      recommendation:
        "Add a minimal Vite (or esbuild) build that minifies and bundles assets/ entry points per template, and keep the sources in a src/ directory so the committed assets/ becomes generated output.",
      source: "scan",
    });
  }

  // Total assets/ weight: not itself a page-weight problem, but a strong signal of accumulation.
  if (assetBytes > 20 * 1024 * 1024) {
    opportunities.push({
      title: `assets/ has grown to ${formatBytes(assetBytes)} across ${assetFiles.length} files`,
      impact: "low",
      effort: "medium",
      detail:
        "Most of this is never requested by a visitor, but all of it is downloaded on every theme pull, slows the Shopify CLI and theme editor, and makes it hard to tell which files are live.",
      recommendation:
        "Grep the Liquid for each of the largest assets, delete the ones nothing references (theme-structure's orphan list is a starting point), and move genuine media into Shopify Files instead of the theme.",
      source: "scan",
    });
  }

  // Metafields used heavily but metaobjects not at all — usually repeated content modelled as
  // loose per-product fields instead of one reusable entry.
  if (metafieldRefs >= 25 && metaobjectRefs === 0) {
    opportunities.push({
      title: "Metafields used heavily, metaobjects not at all",
      impact: "low",
      effort: "medium",
      detail: `${metafieldRefs} metafield references across the theme and zero metaobject references. Repeated structured content (ingredient lists, size guides, care instructions, shared FAQ blocks) is therefore being re-entered per product rather than defined once and referenced.`,
      recommendation:
        "Identify the metafield groups that repeat the same shape across products, define a metaobject for each, and point a single metaobject_reference metafield at it so content is edited in one place.",
      source: "scan",
    });
  }

  // Lint config and CI: the cheapest possible guard against the theme-check issues in this report.
  if (!hasThemeCheckConfig || !hasCi) {
    opportunities.push({
      title: "No lint or CI configuration committed with the theme",
      impact: "low",
      effort: "low",
      detail: [
        !hasThemeCheckConfig ? "No .theme-check.yml, so theme-check runs with defaults (or not at all) and nobody agrees on which rules are errors." : null,
        !hasCi ? "No .github/workflows, so nothing checks a theme change before it reaches a live theme." : null,
      ]
        .filter(Boolean)
        .join(" "),
      recommendation:
        "Add a .theme-check.yml pinning the rules this team cares about, plus a GitHub Actions workflow running `shopify theme check` on every pull request — the issues listed in Theme Code Quality then stop recurring.",
      source: "scan",
    });
  }

  opportunities.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);

  return { identity, facts, opportunities };
}
