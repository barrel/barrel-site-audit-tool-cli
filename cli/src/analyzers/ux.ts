import * as chromeLauncher from "chrome-launcher";
import * as cheerio from "cheerio";
import type { AiUsage, HealthCheckItem, HealthStatus, UxOpportunity, UxSection } from "@barrel/site-audit-shared";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

// A realistic, current desktop Chrome UA — chrome-launcher's default headless UA advertises
// itself as "HeadlessChrome", which is an easy, unnecessary bot signal for a legitimate audit
// tool to be sending. This isn't fingerprint spoofing, just not needlessly announcing automation.
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random 2–4s pause between page loads — one collection page + one product page, loaded
 * sequentially through a single browser session, with human-plausible dwell time in between.
 * This is the "throttle": no parallel tabs, no rapid-fire requests, nothing that looks like a
 * scraper hammering the site — just two page views a normal visitor could plausibly make. */
function throttleDelay(): Promise<void> {
  return sleep(2000 + Math.random() * 2000);
}

function check(id: string, label: string, status: HealthStatus, detail: string): HealthCheckItem {
  return { id, label, status, detail };
}

async function discoverProductUrl(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/products.json?limit=1`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { products?: Array<{ handle?: string }> };
    const handle = data.products?.[0]?.handle;
    return handle ? `${origin}/products/${handle}` : null;
  } catch {
    return null;
  }
}

function hasAnyMarker(html: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(html));
}

const REVIEW_APP_MARKERS = [
  /judge\.?me|jdgm/i,
  /yotpo/i,
  /loox/i,
  /okendo/i,
  /stamped\.io|stamped-reviews/i,
  /ali-?reviews/i,
  /reviews\.io/i,
  /"@type"\s*:\s*"AggregateRating"/i,
];

const TRUST_BADGE_MARKERS = [
  /free shipping/i,
  /money.?back guarantee/i,
  /secure checkout/i,
  /satisfaction guarantee/i,
  /\b\d+.?day returns?\b/i,
  /ssl secure/i,
];

const ADD_TO_CART_MARKERS = [/name=["']add["']/i, />\s*add to (cart|bag)\s*</i, /add-to-cart/i];

const BREADCRUMB_MARKERS = [/aria-label=["']breadcrumb["']/i, /class=["'][^"']*breadcrumb/i, /"@type"\s*:\s*"BreadcrumbList"/i];

const COLLECTION_FILTER_MARKERS = [/class=["'][^"']*(facet|filter)/i, /<facet-filters/i, /data-filter/i];

const QUICK_ADD_MARKERS = [/quick.?add/i, /quick.?shop/i, /quick.?view/i];

// Some themes return HTTP 200 for a dead/renamed collection URL but render a friendly
// "nothing here" page instead of a real 404 — response.ok() alone won't catch that. Detecting
// it here avoids reporting misleading "no filters/no quick-add" warnings against an empty page.
const SOFT_404_MARKERS = [
  /page (you (requested|are looking for)|not found)/i,
  /doesn'?t exist/i,
  /nothing to see here/i,
  /we can'?t find/i,
  /404[\s-]*(error|page)/i,
];

interface PageCaptureResult {
  url: string;
  html: string;
  screenshot: Buffer;
}

async function loadAndCapture(
  page: import("puppeteer-core").Page,
  url: string,
): Promise<PageCaptureResult | null> {
  const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => null);
  if (!response || !response.ok()) return null;

  // Give lazy-loaded widgets (reviews apps in particular) a moment to render before capturing.
  await sleep(2000);

  const html = await page.content().catch(() => "");
  const screenshotData = await page.screenshot({ type: "jpeg", quality: 65, fullPage: false }).catch(() => null);
  if (!screenshotData) return null;

  return { url, html, screenshot: Buffer.from(screenshotData) };
}

function buildCollectionChecks(html: string): HealthCheckItem[] {
  return [
    check(
      "ux-collection-filters",
      "Collection filtering/sorting",
      hasAnyMarker(html, COLLECTION_FILTER_MARKERS) ? "pass" : "warn",
      hasAnyMarker(html, COLLECTION_FILTER_MARKERS)
        ? "Filter or facet UI detected on the collection page."
        : "No filter/facet UI detected — shoppers browsing a large catalog may struggle to narrow results.",
    ),
    check(
      "ux-collection-quick-add",
      "Quick add-to-cart from collection grid",
      hasAnyMarker(html, QUICK_ADD_MARKERS) ? "pass" : "warn",
      hasAnyMarker(html, QUICK_ADD_MARKERS)
        ? "Quick add/shop/view affordance detected on the collection grid."
        : "No quick-add affordance detected — shoppers must open each product page to add to cart, adding friction.",
    ),
    check(
      "ux-collection-breadcrumbs",
      "Breadcrumb navigation",
      hasAnyMarker(html, BREADCRUMB_MARKERS) ? "pass" : "warn",
      hasAnyMarker(html, BREADCRUMB_MARKERS)
        ? "Breadcrumb navigation detected."
        : "No breadcrumb navigation detected on the collection page.",
    ),
  ];
}

function buildProductChecks(html: string): HealthCheckItem[] {
  const $ = cheerio.load(html);
  const galleryImages = $('img[src*="/products/"], img[class*="product"], [class*="product-media"] img, [class*="product__media"] img').length;
  const totalImages = $("img").length;
  const imageCount = galleryImages > 0 ? galleryImages : totalImages;

  return [
    check(
      "ux-pdp-add-to-cart",
      "Add-to-cart visibility",
      hasAnyMarker(html, ADD_TO_CART_MARKERS) ? "pass" : "fail",
      hasAnyMarker(html, ADD_TO_CART_MARKERS)
        ? "Add-to-cart control detected on the product page."
        : "No add-to-cart control detected in the rendered page — this is critical; shoppers may not find a way to purchase.",
    ),
    check(
      "ux-pdp-reviews",
      "Reviews / social proof",
      hasAnyMarker(html, REVIEW_APP_MARKERS) ? "pass" : "warn",
      hasAnyMarker(html, REVIEW_APP_MARKERS)
        ? "A reviews widget or aggregate rating markup was detected."
        : "No reviews widget or rating markup detected — social proof is one of the strongest conversion levers on a PDP.",
    ),
    check(
      "ux-pdp-trust-badges",
      "Trust badges & shipping/return info",
      hasAnyMarker(html, TRUST_BADGE_MARKERS) ? "pass" : "warn",
      hasAnyMarker(html, TRUST_BADGE_MARKERS)
        ? "Shipping, return, or security trust messaging detected near the product."
        : "No shipping/return/security trust messaging detected — this is a common source of checkout hesitation.",
    ),
    check(
      "ux-pdp-images",
      "Product image count",
      imageCount > 1 ? "pass" : "warn",
      imageCount > 1
        ? `${imageCount} product image(s) detected.`
        : "Only one (or zero) product images detected — multiple angles/lifestyle shots typically lift conversion.",
    ),
    check(
      "ux-pdp-breadcrumbs",
      "Breadcrumb navigation",
      hasAnyMarker(html, BREADCRUMB_MARKERS) ? "pass" : "warn",
      hasAnyMarker(html, BREADCRUMB_MARKERS)
        ? "Breadcrumb navigation detected."
        : "No breadcrumb navigation detected on the product page.",
    ),
  ];
}

const UX_SCHEMA = {
  type: "object",
  properties: {
    opportunities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          page: { type: "string", enum: ["Collection", "Product"] },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          detail: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["title", "page", "impact", "detail", "recommendation"],
        additionalProperties: false,
      },
    },
  },
  required: ["opportunities"],
  additionalProperties: false,
} as const;

async function generateOpportunities(
  signalsSummary: string,
  images: Array<{ page: "Collection" | "Product"; buffer: Buffer }>,
): Promise<{ opportunities: UxOpportunity[]; usage: AiUsage } | null> {
  if (!process.env.ANTHROPIC_API_KEY || images.length === 0) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const content: Array<Record<string, unknown>> = [
      { type: "text", text: `Deterministic signals already detected on these pages:\n${signalsSummary}` },
    ];
    for (const img of images) {
      content.push({ type: "text", text: `${img.page} page screenshot (above the fold, mobile viewport):` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: img.buffer.toString("base64") },
      });
    }
    content.push({
      type: "text",
      text:
        "List 3-6 specific, concrete UX opportunities that would plausibly increase conversion rate on this " +
        "Shopify storefront. Ground each one in what's actually visible in the screenshots or the signals above — " +
        "no generic advice. Each needs a specific, actionable recommendation.",
    });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      system:
        "You are a conversion-rate-optimization expert reviewing screenshots of a Shopify collection page and/or " +
        "product page. Be specific and visual — reference layout, hierarchy, copy, and imagery you can actually see.",
      output_config: { format: { type: "json_schema", schema: UX_SCHEMA } },
      messages: [{ role: "user", content: content as any }],
    });

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) return null;

    const parsed = JSON.parse(textBlock.text) as { opportunities: UxOpportunity[] };
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      opportunities: parsed.opportunities,
      usage: {
        model: "claude-opus-5",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
      },
    };
  } catch {
    return null;
  }
}

export interface UxAnalysisResult {
  section: UxSection;
  screenshots: { collection?: Buffer; product?: Buffer };
  usage?: AiUsage;
}

/** UX/conversion audit over one collection page and one product page — deliberately not a
 * full-site crawl. Throttled (see throttleDelay) and identifies as a normal desktop browser
 * (see DESKTOP_UA) so this stays well clear of anything a WAF like Cloudflare would flag as
 * automated scraping: one browser session, two sequential page loads with a human-plausible
 * pause between them, no retries, no concurrency. Returns null (never throws) if neither page
 * could be loaded at all. */
export async function analyzeUx(baseUrl: string): Promise<UxAnalysisResult | null> {
  const origin = new URL(baseUrl).origin;
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(DESKTOP_UA);
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

      const checks: HealthCheckItem[] = [];
      const images: Array<{ page: "Collection" | "Product"; buffer: Buffer }> = [];
      const screenshots: UxAnalysisResult["screenshots"] = {};
      let collectionPage: UxSection["collectionPage"];
      let productPage: UxSection["productPage"];

      const collectionUrl = `${origin}/collections/all`;
      const collectionResult = await loadAndCapture(page, collectionUrl);
      if (collectionResult) {
        if (hasAnyMarker(collectionResult.html, SOFT_404_MARKERS)) {
          checks.push(
            check(
              "ux-collection-reachable",
              "Collection page reachable",
              "fail",
              `${collectionUrl} returned a 200 status but rendered a "not found"-style page — the default collection URL appears to be broken, renamed, or disabled.`,
            ),
          );
        } else {
          checks.push(...buildCollectionChecks(collectionResult.html));
        }
        images.push({ page: "Collection", buffer: collectionResult.screenshot });
        screenshots.collection = collectionResult.screenshot;
        collectionPage = { url: collectionResult.url };
      }

      await throttleDelay();

      const productUrl = await discoverProductUrl(origin);
      const productResult = productUrl ? await loadAndCapture(page, productUrl) : null;
      if (productResult) {
        checks.push(...buildProductChecks(productResult.html));
        images.push({ page: "Product", buffer: productResult.screenshot });
        screenshots.product = productResult.screenshot;
        productPage = { url: productResult.url };
      }

      if (checks.length === 0) return null;

      const checkWeights: Record<HealthStatus, number> = { pass: 100, warn: 55, fail: 0 };
      const score = Math.round(checks.reduce((sum, c) => sum + checkWeights[c.status], 0) / checks.length);

      const signalsSummary = checks.map((c) => `- ${c.label}: ${c.status} — ${c.detail}`).join("\n");
      const aiResult = await generateOpportunities(signalsSummary, images);

      return {
        section: {
          score,
          checks,
          opportunities: aiResult?.opportunities ?? [],
          collectionPage,
          productPage,
        },
        screenshots,
        usage: aiResult?.usage,
      };
    } finally {
      await browser.disconnect();
    }
  } catch {
    return null;
  } finally {
    await chrome.kill();
  }
}
