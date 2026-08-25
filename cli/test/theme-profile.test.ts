// The theme profile is the one section of the report that claims to say *what this store runs* —
// a named theme, a named version, a named author — and every claim in it is read as fact by a
// client. So the bias here is the same as in security-checks.test.ts: proving the analyzer refuses
// to overclaim. A theme misreported as stock (when it's a fork that can never take an upstream
// update) or a backup file recommended as migration work costs real money in the wrong direction.
//
// Fixtures are real directory trees in a temp dir rather than mocks: the analyzer's whole job is
// reading files off disk, and a mocked fs would test the mock.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { analyzeThemeProfile } from "../src/analyzers/theme-profile.js";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Writes a theme on disk from a path -> contents map and returns its root. */
function makeTheme(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "theme-profile-"));
  tempDirs.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

function themeInfo(fields: Record<string, string>, { trailingComma = false } = {}): string {
  const entries = Object.entries({ name: "theme_info", ...fields })
    .map(([k, v]) => `    "${k}": "${v}"`)
    .join(",\n");
  return `[\n  {\n${entries}${trailingComma ? "," : ""}\n  }\n]`;
}

/** The minimum that makes a directory look like an Online Store 2.0 theme, so a test can add only
 * the files whose effect it is actually asserting. */
const BASE_THEME: Record<string, string> = {
  "layout/theme.liquid": "{% sections 'header-group' %}{{ content_for_layout }}",
  "templates/index.json": '{"sections":{"main":{"type":"main-index"}},"order":["main"]}',
  "sections/header-group.json": '{"type":"header","sections":{},"order":[]}',
  "sections/footer-group.json": '{"type":"footer","sections":{},"order":[]}',
  "sections/main-index.liquid": '<div></div>{% schema %}{"name":"Index"}{% endschema %}',
};

const opportunityTitles = (root: string) =>
  (analyzeThemeProfile(root)?.opportunities ?? []).map((o) => o.title).join(" | ");

describe("theme identity", () => {
  it("reads name, version and author out of theme_info", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "config/settings_schema.json": themeInfo({
        theme_name: "Horizon",
        theme_version: "3.5.1",
        theme_author: "Shopify",
        theme_documentation_url: "https://help.shopify.com/",
      }),
    });
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.name, "Horizon");
    assert.equal(identity.version, "3.5.1");
    assert.equal(identity.author, "Shopify");
    assert.equal(identity.documentationUrl, "https://help.shopify.com/");
  });

  it("calls a Shopify-authored stock theme stock", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "config/settings_schema.json": themeInfo({ theme_name: "Dawn", theme_version: "15.3.0", theme_author: "Shopify" }),
    });
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.origin, "shopify-stock");
    assert.equal(identity.basedOn, "Dawn");
  });

  // The distinction the whole classification exists for: a fork keeps the stock name, so name
  // alone would report it as updatable from upstream when merging a Dawn release would clobber it.
  it("calls a stock name with a different author a fork, not stock", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "config/settings_schema.json": themeInfo({
        theme_name: "Dawn — Acme",
        theme_version: "2.1.0",
        theme_author: "Acme Agency",
      }),
    });
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.origin, "shopify-fork");
    assert.equal(identity.basedOn, "Dawn");
    assert.match(identity.detail, /fork/);
  });

  it("calls a named non-Shopify theme third-party", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "config/settings_schema.json": themeInfo({
        theme_name: "Barrel Base Framework",
        theme_version: "1.6.1",
        theme_author: "Barrel LLC",
      }),
    });
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.origin, "third-party");
    assert.equal(identity.basedOn, undefined);
  });

  // Shopify's own parser tolerates trailing commas and real production settings_schema.json files
  // contain them, so a strict JSON.parse alone loses the identity of a perfectly working theme.
  it("still reads theme_info from a settings_schema.json with a trailing comma", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "config/settings_schema.json": themeInfo(
        { theme_name: "Impulse", theme_version: "7.4.0", theme_author: "Archetype Themes" },
        { trailingComma: true },
      ),
    });
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.name, "Impulse");
    assert.equal(identity.version, "7.4.0");
    assert.equal(identity.origin, "third-party");
  });

  it("says so rather than guessing when there is no theme_info at all", () => {
    const root = makeTheme({ ...BASE_THEME, "config/settings_schema.json": '[{"name":"colors","settings":[]}]' });
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.origin, "custom");
    assert.equal(identity.name, undefined);
  });

  it("says so rather than guessing when there is no settings_schema.json", () => {
    const root = makeTheme(BASE_THEME);
    const identity = analyzeThemeProfile(root)!.identity;
    assert.equal(identity.origin, "unknown");
    assert.match(identity.detail, /No config\/settings_schema\.json/);
  });

  it("returns null for a directory that isn't there", () => {
    assert.equal(analyzeThemeProfile(join(tmpdir(), "definitely-not-a-theme-dir-9e1f")), null);
  });
});

describe("codebase facts", () => {
  it("reports the template architecture and section groups it found", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "templates/product.json": "{}",
      "templates/customers/login.liquid": "<form></form>",
    });
    const facts = analyzeThemeProfile(root)!.facts;
    const architecture = facts.find((f) => f.label === "Template architecture")!;
    assert.match(architecture.value, /Online Store 2\.0 — 2 JSON \/ 1 Liquid/);
    assert.match(architecture.detail!, /2 section groups \(header \+ footer\)/);
  });

  it("names the bundler and libraries it found in package.json", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "package.json": JSON.stringify({
        devDependencies: { vite: "^5.0.0", tailwindcss: "^3.4.0" },
        scripts: { build: "vite build" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'",
    });
    const tooling = analyzeThemeProfile(root)!.facts.find((f) => f.label === "Build tooling")!;
    assert.match(tooling.value, /Vite/);
    assert.match(tooling.value, /Tailwind CSS/);
    assert.match(tooling.detail!, /pnpm-lock\.yaml/);
  });

  // Hashed output with no committed config is not "no build" — it is a build that lives on
  // somebody's laptop, which is a different (and worse) problem with different advice.
  it("says where the build is when hashed output is committed without a build config", () => {
    const root = makeTheme({
      ...BASE_THEME,
      // Five, because one hash-looking filename is a font weight and only a run of them is a
      // build — see HASHED_ASSET_MIN_FILES.
      "assets/theme-DmyZHTp3.js": "console.log(1)",
      "assets/theme-BczSmmvf.js": "console.log(2)",
      "assets/theme-8yF1ExKb.js": "console.log(3)",
      "assets/cart-CZAcUf1x.js": "console.log(4)",
      "assets/cart-Dgc4Wbwq.js": "console.log(5)",
    });
    const tooling = analyzeThemeProfile(root)!.facts.find((f) => f.label === "Build tooling")!;
    assert.match(tooling.detail!, /lives outside this repo/);
    assert.match(opportunityTitles(root), /build output is committed, but its build isn't/);
  });

  it("names the front-end libraries it can see, and doesn't invent ones it can't", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "assets/gallery.js": "customElements.define('x-gallery', Gallery)",
      "assets/swiper-B8OfTuF9.js": "/* swiper */",
    });
    const frontend = analyzeThemeProfile(root)!.facts.find((f) => f.label === "Front-end approach")!;
    assert.match(frontend.value, /Native web components/);
    assert.match(frontend.value, /Swiper/);
    assert.doesNotMatch(frontend.value, /React|Vue|Alpine/);
  });

  it("says plain Liquid when there is genuinely no framework signal", () => {
    const frontend = analyzeThemeProfile(makeTheme(BASE_THEME))!.facts.find((f) => f.label === "Front-end approach")!;
    assert.equal(frontend.value, "Plain Liquid + vanilla JS");
  });
});

describe("codebase opportunities", () => {
  it("flags deprecated {% include %} and cites the file", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "sections/hero.liquid": "{% include 'legacy-hero' %}{% schema %}{\"name\":\"Hero\"}{% endschema %}",
      "snippets/legacy-hero.liquid": "<h1></h1>",
    });
    const found = analyzeThemeProfile(root)!.opportunities.find((o) => /include/.test(o.title))!;
    assert.match(found.detail, /sections\/hero\.liquid/);
    assert.match(found.recommendation!, /render/);
  });

  it("groups several generations of one bundle as stale build output", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "assets/theme-DmyZHTp3.css": "a".repeat(600_000),
      "assets/theme-BczSmmvf.css": "b".repeat(600_000),
      "assets/theme-8yF1ExKb.css": "c".repeat(600_000),
    });
    assert.match(opportunityTitles(root), /Stale build output/);
  });

  // `product-recommendations.js` is a filename, not a hash: reading it as `product` + hash makes
  // three unrelated files that happen to share a prefix look like abandoned build output.
  it("does not read a word as a content hash", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "assets/product-recommendations.js": "//",
      "assets/product-placeholder.js": "//",
      "assets/product-quickview.js": "//",
    });
    assert.doesNotMatch(opportunityTitles(root), /Stale build output/);
  });

  // Same prefix and extension, but three different segment lengths: one bundler emits one hash
  // length, so this is three files that share a prefix, not three generations of one bundle.
  it("does not read same-prefix files of differing segment length as one bundle", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "assets/Epilogue-Bold.ttf": "f".repeat(1000),
      "assets/Epilogue-BoldItalic.ttf": "f".repeat(1000),
      "assets/Epilogue-MediumItalic.ttf": "f".repeat(1000),
    });
    assert.doesNotMatch(opportunityTitles(root), /Stale build output/);
  });

  it("flags oversized images and animated GIFs separately", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "assets/badge-bestseller.gif": "g".repeat(2_000_000),
      "assets/hero.png": "p".repeat(800_000),
    });
    const titles = opportunityTitles(root);
    assert.match(titles, /oversized image/);
    assert.match(titles, /animated GIF/);
  });

  it("flags legacy font formats", () => {
    const root = makeTheme({ ...BASE_THEME, "assets/Epilogue-Bold.ttf": "f".repeat(200_000) });
    assert.match(opportunityTitles(root), /legacy-format font file/);
  });

  it("flags page-builder-owned templates and names the app", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "templates/page.replo.08997633-549d-4e9a-94b2-6001157f99a3.liquid": "<div></div>",
    });
    const found = analyzeThemeProfile(root)!.opportunities.find((o) => /page-builder/.test(o.title))!;
    assert.match(found.detail, /replo/);
  });

  // A template named …_backup_do_not_delete wants deleting, not converting to JSON. Recommending
  // migration work on a dead file spends the client's budget on nothing.
  it("does not recommend migrating a backup or page-builder template to JSON", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "templates/page.rewind_menu_backup_do_not_delete.liquid": "<div></div>",
      "templates/page.replo.abc12345-0000-0000-0000-000000000000.liquid": "<div></div>",
    });
    assert.doesNotMatch(opportunityTitles(root), /still Liquid-only/);
  });

  it("counts gift_card and robots as ineligible rather than un-migrated", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "templates/gift_card.liquid": "<div></div>",
      "templates/robots.txt.liquid": "User-agent: *",
    });
    assert.doesNotMatch(opportunityTitles(root), /still Liquid-only/);
  });

  it("flags a theme with no JSON templates as pre-Online Store 2.0, at high impact", () => {
    const root = makeTheme({
      "layout/theme.liquid": "{{ content_for_layout }}",
      "templates/index.liquid": "<div></div>",
      "templates/product.liquid": "<div></div>",
      "sections/header.liquid": "<header></header>",
    });
    const found = analyzeThemeProfile(root)!.opportunities.find((o) => /Online Store 2\.0/.test(o.title))!;
    assert.equal(found.impact, "high");
  });

  it("flags a missing footer section group but not a present header one", () => {
    const files = { ...BASE_THEME };
    delete files["sections/footer-group.json"];
    const found = analyzeThemeProfile(makeTheme(files))!.opportunities.find((o) => /section group/.test(o.title))!;
    assert.equal(found.title, "No footer section group");
  });

  it("does not flag app blocks or theme blocks when the theme already supports them", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "sections/main-index.liquid":
        '<div></div>{% schema %}{"name":"Index","blocks":[{"type":"@app"},{"type":"@theme"}]}{% endschema %}',
      "blocks/text.liquid": '<p></p>{% schema %}{"name":"Text"}{% endschema %}',
    });
    const titles = opportunityTitles(root);
    assert.doesNotMatch(titles, /app blocks/);
    assert.doesNotMatch(titles, /Theme blocks not adopted/);
  });

  it("sorts opportunities highest impact first", () => {
    const root = makeTheme({
      ...BASE_THEME,
      "assets/badge.gif": "g".repeat(4_000_000),
      "sections/hero.liquid": "{% include 'x' %}{% schema %}{\"name\":\"Hero\"}{% endschema %}",
      "snippets/x.liquid": "<i></i>",
    });
    const impacts = analyzeThemeProfile(root)!.opportunities.map((o) => o.impact);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    assert.deepEqual(
      impacts,
      [...impacts].sort((a, b) => rank[a] - rank[b]),
    );
  });

  it("marks every scan-derived opportunity as coming from the scan, not from AI", () => {
    const root = makeTheme({ ...BASE_THEME, "assets/hero.png": "p".repeat(900_000) });
    const opportunities = analyzeThemeProfile(root)!.opportunities;
    assert.ok(opportunities.length > 0);
    assert.ok(opportunities.every((o) => o.source === "scan"));
  });
});
