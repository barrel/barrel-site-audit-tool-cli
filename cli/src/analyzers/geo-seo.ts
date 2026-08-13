import * as cheerio from "cheerio";
import type {
  BestPracticeRow,
  BestPracticeVerdict,
  GeoSection,
  GeoSeoSection,
  HealthCheckItem,
  HealthStatus,
  SeoOpportunity,
  SeoSection,
} from "@barrel/site-audit-shared";

export async function safeFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { redirect: "follow", cache: "no-store" });
  } catch {
    return null;
  }
}

function check(id: string, label: string, status: HealthStatus, detail: string): HealthCheckItem {
  return { id, label, status, detail };
}

// AI/LLM crawlers that matter for generative-engine discoverability — chat answer engines
// (GPTBot, ClaudeBot, PerplexityBot), model-training crawlers (Google-Extended, Applebot-Extended,
// CCBot feeds many open models), and OpenAI's ChatGPT-search crawler.
export const AI_CRAWLERS = [
  { id: "gptbot", name: "GPTBot (OpenAI)" },
  { id: "oai-searchbot", name: "OAI-SearchBot (ChatGPT search)" },
  { id: "chatgpt-user", name: "ChatGPT-User (OpenAI)" },
  { id: "claudebot", name: "ClaudeBot (Anthropic)" },
  { id: "perplexitybot", name: "PerplexityBot" },
  { id: "google-extended", name: "Google-Extended (Gemini training)" },
  { id: "applebot-extended", name: "Applebot-Extended (Apple Intelligence)" },
  { id: "ccbot", name: "CCBot (Common Crawl)" },
];

export interface RobotsGroup {
  agents: string[];
  disallow: string[];
  allow: string[];
}

export function parseRobotsGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRuleSinceAgent = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || sawRuleSinceAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
        sawRuleSinceAgent = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (key === "disallow" && current) {
      current.disallow.push(value);
      sawRuleSinceAgent = true;
    } else if (key === "allow" && current) {
      current.allow.push(value);
      sawRuleSinceAgent = true;
    }
  }
  return groups;
}

// Heuristic, not a spec-perfect robots.txt evaluator: a bot is "blocked" only on a blanket
// Disallow (/ or empty-path) in its own group or the wildcard group, with no Allow rule at all.
export function isCrawlerAllowed(groups: RobotsGroup[], botId: string): boolean {
  const specific = groups.find((g) => g.agents.includes(botId));
  const group = specific ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  const blanketDisallow = group.disallow.some((d) => d === "/" || d === "");
  if (!blanketDisallow) return true;
  return group.allow.length > 0;
}

// Walks the full JSON-LD tree (not just top-level items) so @type values nested under
// hasVariant/offers/publisher/etc. are found too — e.g. Shopify's ProductGroup wraps each
// variant's Product+Offer inside hasVariant, which a top-level-only scan would miss entirely.
export function collectSchemaNodes(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaNodes(item, visit);
    return;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record["@type"]) visit(record);
    for (const key of Object.keys(record)) {
      if (key === "@type") continue;
      collectSchemaNodes(record[key], visit);
    }
  }
}

export function parseJsonLdBlocks(html: string): unknown[] {
  const $ = cheerio.load(html);
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      blocks.push(JSON.parse($(el).contents().text()));
    } catch {
      // malformed JSON-LD — skip
    }
  });
  return blocks;
}

function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>();
  for (const block of parseJsonLdBlocks(html)) {
    collectSchemaNodes(block, (node) => {
      const t = node["@type"];
      (Array.isArray(t) ? t : [t]).forEach((x) => types.add(String(x)));
    });
  }
  return [...types];
}

function extractOrganizationSameAs(html: string): string[] {
  const results = new Set<string>();
  for (const block of parseJsonLdBlocks(html)) {
    collectSchemaNodes(block, (node) => {
      const t = node["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (types.includes("Organization") && node.sameAs) {
        const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
        sameAs.forEach((s) => results.add(String(s)));
      }
    });
  }
  return [...results];
}

function buildSeoOpportunities($: cheerio.CheerioAPI): SeoOpportunity[] {
  const opportunities: SeoOpportunity[] = [];

  const title = $("title").first().text().trim();
  if (!title) {
    opportunities.push({
      title: "Missing page title",
      impact: "high",
      detail: "No <title> tag found on the homepage.",
      recommendation: "Add a unique, descriptive <title> (aim for 50–60 characters) that includes the brand name and primary offering.",
    });
  } else if (title.length > 60) {
    opportunities.push({
      title: "Page title is too long",
      impact: "medium",
      detail: `Title is ${title.length} characters — search engines and AI answer engines typically truncate past ~60.`,
      recommendation: "Shorten the title to under 60 characters, keeping the primary keyword near the front.",
    });
  } else if (title.length < 15) {
    opportunities.push({
      title: "Page title is short and under-descriptive",
      impact: "low",
      detail: `Title is only ${title.length} characters.`,
      recommendation: "Expand the title to better describe the page and include relevant keywords (aim for 50–60 characters).",
    });
  }

  const description = $('meta[name="description"]').attr("content")?.trim();
  if (!description) {
    opportunities.push({
      title: "Missing meta description",
      impact: "high",
      detail: "No meta description found on the homepage.",
      recommendation: "Add a compelling 150–160 character meta description summarizing the page for search results.",
    });
  } else if (description.length > 160) {
    opportunities.push({
      title: "Meta description is too long",
      impact: "low",
      detail: `Description is ${description.length} characters — will be truncated in search results.`,
      recommendation: "Trim the meta description to under 160 characters.",
    });
  }

  const h1s = $("h1");
  if (h1s.length === 0) {
    opportunities.push({
      title: "Missing H1 heading",
      impact: "medium",
      detail: "No <h1> found on the homepage.",
      recommendation: "Add a single, descriptive H1 that states the page's primary topic.",
    });
  } else if (h1s.length > 1) {
    opportunities.push({
      title: "Multiple H1 headings",
      impact: "low",
      detail: `${h1s.length} <h1> tags found on the homepage.`,
      recommendation: "Use a single H1 per page and structure supporting content with H2/H3.",
    });
  }

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (!ogTitle || !ogImage) {
    opportunities.push({
      title: "Incomplete Open Graph tags",
      impact: "medium",
      detail: "Missing og:title and/or og:image meta tags.",
      recommendation: "Add Open Graph tags so links render properly when shared on social platforms and in AI chat previews.",
    });
  }

  const canonical = $('link[rel="canonical"]').attr("href");
  if (!canonical) {
    opportunities.push({
      title: "No canonical URL",
      impact: "low",
      detail: "No canonical link tag found on the homepage.",
      recommendation: "Add a self-referencing canonical tag to avoid duplicate-content issues.",
    });
  }

  return opportunities;
}

export async function analyzeGeoSeo(url: string): Promise<GeoSeoSection | null> {
  try {
    const origin = new URL(url).origin;

    const [homeRes, robotsRes, llmsTxtRes, productsRes] = await Promise.all([
      safeFetch(url),
      safeFetch(`${origin}/robots.txt`),
      safeFetch(`${origin}/llms.txt`),
      safeFetch(`${origin}/products.json?limit=1`),
    ]);

    const html = homeRes && homeRes.ok ? await homeRes.text() : "";
    const $ = html ? cheerio.load(html) : cheerio.load("<html></html>");
    const robotsText = robotsRes && robotsRes.ok ? await robotsRes.text() : "";
    const robotsGroups = parseRobotsGroups(robotsText);
    const llmsTxtPresent = Boolean(llmsTxtRes?.ok);
    const productFeedReachable = Boolean(productsRes?.ok);

    // Product/Offer schema lives on product pages, not the homepage — fetch one via the
    // products.json feed so this check actually looks in the right place.
    let productPageHtml = "";
    if (productsRes && productsRes.ok) {
      try {
        const data = (await productsRes.json()) as { products?: Array<{ handle?: string }> };
        const handle = data.products?.[0]?.handle;
        if (handle) {
          const productRes = await safeFetch(`${origin}/products/${handle}`);
          if (productRes && productRes.ok) productPageHtml = await productRes.text();
        }
      } catch {
        // products.json didn't parse as expected — skip the product-page fetch
      }
    }

    const homeSchemaTypes = extractSchemaTypes(html);
    const productSchemaTypes = productPageHtml ? extractSchemaTypes(productPageHtml) : [];
    const schemaTypes = [...new Set([...homeSchemaTypes, ...productSchemaTypes])];
    // ProductGroup is schema.org's own type for a multi-variant product (the modern Shopify
    // pattern) — it's a valid substitute for a plain Product type, not a lesser one.
    const hasProductSchema = productSchemaTypes.some((t) => t === "Product" || t === "ProductGroup");
    const hasOfferSchema = productSchemaTypes.some((t) => t === "Offer" || t === "AggregateOffer");
    const hasFaqSchema = schemaTypes.some((t) => t === "FAQPage" || t === "QAPage");
    const sameAs = extractOrganizationSameAs(html);

    // --- SEO opportunities ---
    const opportunities = buildSeoOpportunities($);
    const seoPenalty = opportunities.reduce(
      (sum, o) => sum + (o.impact === "high" ? 25 : o.impact === "medium" ? 12 : 5),
      0,
    );
    const seoScore = Math.max(0, 100 - seoPenalty);
    const seo: SeoSection = { score: seoScore, opportunities };

    // --- GEO checks (AI-crawler access, llms.txt, structured data, product feed) ---
    const blockedCrawlers = AI_CRAWLERS.filter((c) => !isCrawlerAllowed(robotsGroups, c.id));
    const checks: HealthCheckItem[] = [
      blockedCrawlers.length === 0
        ? check(
            "ai-crawlers",
            "AI crawler access",
            "pass",
            `All ${AI_CRAWLERS.length} major AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) are allowed by robots.txt.`,
          )
        : check(
            "ai-crawlers",
            "AI crawler access",
            blockedCrawlers.length === AI_CRAWLERS.length ? "fail" : "warn",
            `${blockedCrawlers.map((c) => c.name).join(", ")} blocked by robots.txt.`,
          ),
      check(
        "llms-txt",
        "llms.txt present",
        llmsTxtPresent ? "pass" : "warn",
        llmsTxtPresent
          ? `${origin}/llms.txt responded 200.`
          : "No llms.txt found — an emerging convention that gives AI agents a clean, structured summary of the site.",
      ),
      check(
        "structured-data",
        "Product structured data",
        !productPageHtml
          ? "warn"
          : hasProductSchema && hasOfferSchema
            ? "pass"
            : hasProductSchema || hasOfferSchema
              ? "warn"
              : "fail",
        !productPageHtml
          ? "Couldn't reach a product page via products.json to check for Product/Offer schema."
          : productSchemaTypes.length > 0
            ? `Schema.org types found on a sample product page: ${productSchemaTypes.join(", ")}.`
            : "No Product/Offer schema.org structured data found on a sample product page.",
      ),
      check(
        "product-feed",
        "Machine-readable product feed",
        productFeedReachable ? "pass" : "fail",
        productFeedReachable
          ? `${origin}/products.json is reachable — AI shopping agents can read accurate product/price/availability data.`
          : `${origin}/products.json is not reachable.`,
      ),
    ];
    const checkWeights: Record<HealthStatus, number> = { pass: 100, warn: 55, fail: 0 };
    const geoChecksScore = checks.reduce((sum, c) => sum + checkWeights[c.status], 0) / checks.length;

    // --- Agentic commerce & AI-discoverability best-practices verdict table ---
    const agenticCommerce: BestPracticeRow[] = [
      {
        dimension: "Structured product data for AI agents",
        verdict: hasProductSchema && hasOfferSchema ? "good" : hasProductSchema || hasOfferSchema ? "needs-improvement" : "poor",
        evidence: hasProductSchema && hasOfferSchema
          ? "Product and Offer schema both present — AI shopping agents (ChatGPT, Gemini, Perplexity Shopping) can accurately extract price, availability, and SKU data."
          : "Add complete Product + Offer JSON-LD to every product page so AI agents can quote accurate price and availability instead of guessing from rendered text.",
      },
      {
        dimension: "Machine-readable product feed",
        verdict: productFeedReachable ? "good" : "poor",
        evidence: productFeedReachable
          ? "Shopify's native /products.json feed is reachable, giving agentic-commerce crawlers a reliable, structured product catalog."
          : "/products.json is not reachable — this is Shopify's built-in machine-readable catalog and should be open by default; investigate why it's blocked.",
      },
      {
        dimension: "AI crawler access",
        verdict: blockedCrawlers.length === 0 ? "good" : blockedCrawlers.length === AI_CRAWLERS.length ? "poor" : "needs-improvement",
        evidence: blockedCrawlers.length === 0
          ? "robots.txt allows the major AI/LLM crawlers to index this storefront for answer-engine and agentic-shopping surfaces."
          : `robots.txt blocks: ${blockedCrawlers.map((c) => c.name).join(", ") || "all major AI crawlers"}. Being blocked here means this site won't surface in ChatGPT, Claude, or Perplexity shopping answers.`,
      },
      {
        dimension: "Conversational / FAQ content structure",
        verdict: hasFaqSchema ? "good" : "needs-improvement",
        evidence: hasFaqSchema
          ? "FAQPage/QAPage structured data found — well-suited for AI answer engines to extract direct Q&A content."
          : "No FAQ/Q&A structured data found. Adding an FAQ section with FAQPage schema helps AI answer engines cite this site directly for product and policy questions.",
      },
      {
        dimension: "Brand entity clarity",
        verdict: sameAs.length > 0 ? "good" : "needs-improvement",
        evidence: sameAs.length > 0
          ? `Organization schema links to ${sameAs.length} external profile(s) (${sameAs.slice(0, 3).join(", ")}${sameAs.length > 3 ? ", ..." : ""}), helping LLMs disambiguate and trust the brand entity.`
          : "No Organization schema with sameAs links found. Adding these (official social profiles, Wikipedia/Crunchbase, etc.) helps LLMs correctly identify and trust the brand as a distinct entity.",
      },
    ];
    const verdictWeights: Record<BestPracticeVerdict, number> = { good: 100, "needs-improvement": 55, poor: 0 };
    const agenticScore = agenticCommerce.reduce((sum, r) => sum + verdictWeights[r.verdict], 0) / agenticCommerce.length;

    const geoScore = Math.round((geoChecksScore + agenticScore) / 2);
    const geo: GeoSection = { score: geoScore, checks, agenticCommerce };

    const healthRating = Math.round((seoScore + geoScore) / 2);

    return { healthRating, seo, geo };
  } catch {
    return null;
  }
}
