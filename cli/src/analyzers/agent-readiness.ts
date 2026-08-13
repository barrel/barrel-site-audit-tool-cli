import * as cheerio from "cheerio";
import type { AgentReadinessSection, HealthCheckItem, HealthStatus, ThemeConcern } from "@barrel/site-audit-shared";
import {
  AI_CRAWLERS,
  collectSchemaNodes,
  isCrawlerAllowed,
  parseJsonLdBlocks,
  parseRobotsGroups,
  safeFetch,
} from "./geo-seo.js";

// Real product-page + policy-page fetches (plain fetch, no browser) — bounded so a large
// catalog can't turn this into dozens of requests per run.
const MAX_PRODUCTS_SAMPLED = 8;
const MAX_ISSUES = 20;

const POLICY_PATHS = ["/policies/refund-policy", "/policies/shipping-policy", "/policies/terms-of-service"];

function check(id: string, label: string, status: HealthStatus, detail: string, recommendation?: string): HealthCheckItem {
  return { id, label, status, detail, recommendation };
}

interface FeedVariant {
  productHandle: string;
  productTitle: string;
  sku: string;
  price: string;
}

interface FeedProduct {
  handle: string;
  title: string;
  variants: FeedVariant[];
  options: { name: string; values: string[] }[];
}

async function fetchFeedProducts(origin: string, limit: number): Promise<FeedProduct[]> {
  const res = await safeFetch(`${origin}/products.json?limit=${limit}`);
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as {
      products?: Array<{
        handle: string;
        title: string;
        options?: Array<{ name: string; values: string[] }>;
        variants?: Array<{ sku?: string; price?: string }>;
      }>;
    };
    return (data.products ?? []).map((p) => ({
      handle: p.handle,
      title: p.title,
      options: p.options ?? [],
      variants: (p.variants ?? [])
        .filter((v) => v.sku)
        .map((v) => ({ productHandle: p.handle, productTitle: p.title, sku: v.sku!, price: v.price ?? "" })),
    }));
  } catch {
    return [];
  }
}

interface VariantOffer {
  sku?: string;
  price?: string;
  priceCurrency?: string;
  availability?: string;
  hasReturnPolicy: boolean;
  hasShippingDetails: boolean;
}

/** Walks every schema.org "Product" node in the page's JSON-LD — covers both a single-variant
 * product (top-level @type Product with its own offers) and a multi-variant ProductGroup
 * (each hasVariant entry is itself a Product carrying its own sku + nested offers). Pulling sku
 * from the Product node rather than the Offer node matters: Shopify's ProductGroup pattern puts
 * sku on the variant-Product, not on the nested Offer. */
function extractVariantOffers(html: string): VariantOffer[] {
  const results: VariantOffer[] = [];
  for (const block of parseJsonLdBlocks(html)) {
    collectSchemaNodes(block, (node) => {
      const t = node["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (!types.includes("Product")) return;
      const offerRaw = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offerRaw) ? offerRaw[0] : offerRaw;
      results.push({
        sku: node.sku as string | undefined,
        price: offer?.price as string | undefined,
        priceCurrency: offer?.priceCurrency as string | undefined,
        availability: offer?.availability as string | undefined,
        hasReturnPolicy: Boolean(offer?.hasMerchantReturnPolicy),
        hasShippingDetails: Boolean(offer?.shippingDetails),
      });
    });
  }
  return results;
}

function hasServerRenderedPriceMeta($: cheerio.CheerioAPI): boolean {
  return Boolean(
    $('meta[itemprop="price"]').attr("content") ||
      $('meta[property="product:price:amount"]').attr("content") ||
      $('[itemprop="price"]').attr("content"),
  );
}

// Common size-label spellings collapsed to one canonical bucket, so "XL" / "X-Large" /
// "Extra Large" are recognized as the same size rather than three different ones.
const SIZE_SYNONYMS: Record<string, string> = {
  xs: "extra small",
  "x-small": "extra small",
  xsmall: "extra small",
  "extra small": "extra small",
  s: "small",
  small: "small",
  m: "medium",
  medium: "medium",
  l: "large",
  large: "large",
  xl: "extra large",
  "x-large": "extra large",
  xlarge: "extra large",
  "extra large": "extra large",
  xxl: "extra extra large",
  "2xl": "extra extra large",
  "xx-large": "extra extra large",
  "extra extra large": "extra extra large",
};

function normalizeSizeValue(raw: string): string {
  const key = raw.trim().toLowerCase();
  return SIZE_SYNONYMS[key] ?? key;
}

function findSizeInconsistencies(products: FeedProduct[]): ThemeConcern[] {
  const bucketToRawForms = new Map<string, Set<string>>();
  for (const p of products) {
    for (const opt of p.options) {
      if (!opt.name.toLowerCase().includes("size")) continue;
      for (const value of opt.values) {
        const canonical = normalizeSizeValue(value);
        if (!bucketToRawForms.has(canonical)) bucketToRawForms.set(canonical, new Set());
        bucketToRawForms.get(canonical)!.add(value.trim());
      }
    }
  }

  const issues: ThemeConcern[] = [];
  for (const [canonical, rawForms] of bucketToRawForms) {
    if (rawForms.size > 1) {
      issues.push({
        title: `Inconsistent size label: "${canonical}"`,
        severity: "medium",
        detail: `${rawForms.size} different spellings used across the catalog for the same size — ${[...rawForms].map((f) => `"${f}"`).join(", ")}.`,
        recommendation: "Standardize on one spelling per size across every product's option values, so an AI shopping agent comparing SKUs doesn't treat these as different sizes.",
      });
    }
  }
  return issues;
}

export async function analyzeAgentReadiness(url: string): Promise<AgentReadinessSection | null> {
  try {
    const origin = new URL(url).origin;

    const [robotsRes, feedProductsAll] = await Promise.all([
      safeFetch(`${origin}/robots.txt`),
      fetchFeedProducts(origin, MAX_PRODUCTS_SAMPLED),
    ]);

    if (feedProductsAll.length === 0) return null;

    const robotsText = robotsRes && robotsRes.ok ? await robotsRes.text() : "";
    const robotsGroups = parseRobotsGroups(robotsText);

    const issues: ThemeConcern[] = [];

    // --- 1. AI crawler access ---
    const blockedCrawlers = AI_CRAWLERS.filter((c) => !isCrawlerAllowed(robotsGroups, c.id));
    const crawlerCheck =
      blockedCrawlers.length === 0
        ? check(
            "agent-crawler-access",
            "AI crawler access",
            "pass",
            `All ${AI_CRAWLERS.length} major AI shopping/answer-engine crawlers are allowed by robots.txt.`,
          )
        : check(
            "agent-crawler-access",
            "AI crawler access",
            blockedCrawlers.length === AI_CRAWLERS.length ? "fail" : "warn",
            `${blockedCrawlers.map((c) => c.name).join(", ")} blocked by robots.txt — products can't be recommended in those agents' shopping interfaces.`,
            "Remove the blanket Disallow for these agents (or add an explicit Allow) — the discovery value of being recommended by an AI shopping agent outweighs the crawl load.",
          );

    // --- Fetch each sampled product's live PDP HTML (plain fetch — this IS the pre-hydration, server-rendered snapshot) ---
    const pdpFetches = await Promise.all(
      feedProductsAll.map(async (p) => {
        const res = await safeFetch(`${origin}/products/${p.handle}`);
        return { product: p, html: res && res.ok ? await res.text() : "" };
      }),
    );

    // --- 2. Server-rendered price/stock ---
    let productsWithServerPrice = 0;
    let productsWithServerAvailability = 0;
    const hydrationIssues: ThemeConcern[] = [];
    for (const { product, html } of pdpFetches) {
      if (!html) continue;
      const $ = cheerio.load(html);
      const offers = extractVariantOffers(html);
      const hasPrice = offers.some((o) => o.price) || hasServerRenderedPriceMeta($);
      const hasAvailability = offers.some((o) => o.availability);
      if (hasPrice) productsWithServerPrice++;
      else {
        hydrationIssues.push({
          title: `Price not detectable in server-rendered HTML: ${product.title}`,
          severity: "high",
          detail: `No Offer/price schema or price meta tag found in the raw HTML for /products/${product.handle} — an agent that doesn't execute JavaScript may abandon the crawl or skip this product entirely.`,
          recommendation: "Ensure Product/Offer JSON-LD (or a price meta tag) renders server-side, not only after client-side hydration.",
        });
      }
      if (hasAvailability) productsWithServerAvailability++;
    }
    const commerceDataStatus: HealthStatus =
      productsWithServerPrice === pdpFetches.length
        ? "pass"
        : productsWithServerPrice === 0
          ? "fail"
          : "warn";
    const commerceDataCheck = check(
      "agent-server-rendered-commerce-data",
      "Price/stock in server-rendered HTML",
      commerceDataStatus,
      `${productsWithServerPrice}/${pdpFetches.length} sampled product page(s) expose price in the raw (pre-JS) HTML, ${productsWithServerAvailability}/${pdpFetches.length} expose availability.`,
      commerceDataStatus === "pass"
        ? undefined
        : "Render price/availability into the initial HTML (via Product/Offer JSON-LD or server-side content) rather than relying on client-side JS to populate them.",
    );
    issues.push(...hydrationIssues.slice(0, 5));

    // --- 3. Per-SKU Offer schema completeness ---
    const allOffers = pdpFetches.flatMap(({ html }) => (html ? extractVariantOffers(html) : []));
    let completeOffers = 0;
    for (const offer of allOffers) {
      const missing: string[] = [];
      if (!offer.sku) missing.push("sku");
      if (!offer.price) missing.push("price");
      if (!offer.priceCurrency) missing.push("priceCurrency");
      if (!offer.availability) missing.push("availability");
      if (missing.length === 0) {
        completeOffers++;
      } else if (issues.length < MAX_ISSUES) {
        issues.push({
          title: `Incomplete Offer schema${offer.sku ? `: SKU ${offer.sku}` : ""}`,
          severity: missing.includes("price") || missing.includes("availability") ? "high" : "medium",
          detail: `Missing ${missing.join(", ")} on this variant's Offer schema.`,
          recommendation: `Add ${missing.join(", ")} to the Offer/Product JSON-LD for this variant so agents can quote accurate price and availability without guessing.`,
        });
      }
    }
    const skuCoverage = allOffers.length > 0 ? completeOffers / allOffers.length : 0;
    const skuSchemaStatus: HealthStatus = skuCoverage >= 0.9 ? "pass" : skuCoverage >= 0.5 ? "warn" : "fail";
    const skuSchemaCheck = check(
      "agent-sku-schema-completeness",
      "Per-SKU Offer schema completeness",
      skuSchemaStatus,
      `${completeOffers}/${allOffers.length} sampled SKU(s) have complete Offer schema (sku, price, priceCurrency, availability) — checked per-variant, not just sampled once for the whole product.`,
    );

    // --- 4. Machine-readable policies ---
    const anyReturnPolicy = allOffers.some((o) => o.hasReturnPolicy);
    const anyShippingDetails = allOffers.some((o) => o.hasShippingDetails);
    const policiesReachable = (
      await Promise.all(POLICY_PATHS.map((path) => safeFetch(`${origin}${path}`)))
    ).some((r) => r?.ok);
    const policyStatus: HealthStatus = anyReturnPolicy && anyShippingDetails ? "pass" : anyReturnPolicy || anyShippingDetails ? "warn" : "fail";
    const policyCheck = check(
      "agent-machine-readable-policies",
      "Machine-readable return/shipping policy",
      policyStatus,
      policyStatus === "fail"
        ? `No structured hasMerchantReturnPolicy/shippingDetails found on sampled Offers${policiesReachable ? " — the policy pages exist but as prose, not structured data" : ""}. Vague policies mean agents can't answer buyer questions and drop the store from the shortlist.`
        : `hasMerchantReturnPolicy present on ${allOffers.filter((o) => o.hasReturnPolicy).length}/${allOffers.length} sampled Offers, shippingDetails on ${allOffers.filter((o) => o.hasShippingDetails).length}/${allOffers.length}.`,
      policyStatus === "pass"
        ? undefined
        : "Add schema.org MerchantReturnPolicy and OfferShippingDetails to each product's Offer — return window, shipping cost, and warranty as structured data an agent can parse, not a prose policy page.",
    );

    // --- 5. Size-attribute consistency ---
    const sizeIssues = findSizeInconsistencies(feedProductsAll);
    issues.push(...sizeIssues.slice(0, MAX_ISSUES - issues.length));
    const sizeStatus: HealthStatus = sizeIssues.length === 0 ? "pass" : sizeIssues.length <= 2 ? "warn" : "fail";
    const sizeCheck = check(
      "agent-attribute-consistency",
      "Size-attribute consistency across SKUs",
      sizeStatus,
      sizeIssues.length === 0
        ? "No inconsistent size-label spellings found across the sampled catalog."
        : `${sizeIssues.length} size(s) have inconsistent spellings across the catalog (e.g. "XL" vs "X-Large") — this breaks agent-side spec/price comparison across SKUs.`,
    );

    // --- 6. Feed vs. PDP price drift ---
    const offersBySku = new Map(allOffers.filter((o) => o.sku).map((o) => [o.sku!, o]));
    let comparedCount = 0;
    let driftCount = 0;
    for (const p of feedProductsAll) {
      for (const v of p.variants) {
        const pdpOffer = offersBySku.get(v.sku);
        if (!pdpOffer?.price) continue;
        comparedCount++;
        const feedPrice = Number.parseFloat(v.price);
        const pdpPrice = Number.parseFloat(pdpOffer.price);
        if (Number.isFinite(feedPrice) && Number.isFinite(pdpPrice) && Math.abs(feedPrice - pdpPrice) > 0.01) {
          driftCount++;
          if (issues.length < MAX_ISSUES) {
            issues.push({
              title: `Feed/PDP price drift: ${p.title} (${v.sku})`,
              severity: "high",
              detail: `products.json lists $${v.price}, but the live PDP's Offer schema shows $${pdpOffer.price} for the same SKU.`,
              recommendation: "Investigate what's stale — a caching layer, a pricing app that only updates one surface, or a sync job — since this specific mismatch causes agent mistrust and shopping-feed disapprovals.",
            });
          }
        }
      }
    }
    const driftStatus: HealthStatus = comparedCount === 0 ? "warn" : driftCount === 0 ? "pass" : driftCount / comparedCount > 0.1 ? "fail" : "warn";
    const driftCheck = check(
      "agent-feed-drift",
      "Feed vs. PDP price accuracy",
      driftStatus,
      comparedCount === 0
        ? "Couldn't match any SKU between products.json and the sampled PDPs' Offer schema to compare."
        : `${driftCount}/${comparedCount} sampled SKU(s) show a price mismatch between products.json and the live PDP.`,
    );

    const checks = [crawlerCheck, commerceDataCheck, skuSchemaCheck, policyCheck, sizeCheck, driftCheck];
    const weights: Record<HealthStatus, number> = { pass: 100, warn: 55, fail: 0 };
    const score = Math.round(checks.reduce((sum, c) => sum + weights[c.status], 0) / checks.length);

    return {
      score,
      checks,
      skusSampled: allOffers.length,
      issues: issues.slice(0, MAX_ISSUES),
    };
  } catch {
    return null;
  }
}
