import * as cheerio from "cheerio";
import type { HealthCheckItem, HealthSection, HealthStatus } from "@barrel/site-audit-shared";
import { extractSchemaTypes } from "./geo-seo.js";

async function safeFetch(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, { redirect: "follow", ...init });
    return res;
  } catch {
    return null;
  }
}

function check(id: string, label: string, status: HealthStatus, detail: string, recommendation?: string): HealthCheckItem {
  return { id, label, status, detail, recommendation };
}

export async function analyzeHealth(url: string): Promise<HealthSection> {
  const checks: HealthCheckItem[] = [];
  const origin = new URL(url).origin;

  // HTTPS
  checks.push(
    url.startsWith("https://")
      ? check("https", "HTTPS enabled", "pass", "Storefront is served over HTTPS.")
      : check(
          "https",
          "HTTPS enabled",
          "fail",
          "Storefront is not served over HTTPS.",
          "In Shopify Admin, go to Online Store > Domains and confirm the primary domain shows a valid SSL certificate; if it's stuck provisioning, remove and re-add the domain's DNS records, then force a redirect from http:// to https:// once the cert is issued.",
        ),
  );

  const homeRes = await safeFetch(url);
  const html = homeRes ? await homeRes.text() : "";
  const $ = html ? cheerio.load(html) : null;

  if (!homeRes || !homeRes.ok) {
    checks.push(
      check(
        "reachable",
        "Homepage reachable",
        "fail",
        `Could not fetch homepage (${homeRes ? homeRes.status : "network error"}).`,
        "Check Online Store > Preferences for an active storefront password, and verify the domain's DNS/A/CNAME records point at Shopify — a network error or non-200 on the homepage usually means one of those two.",
      ),
    );
  } else {
    checks.push(check("reachable", "Homepage reachable", "pass", `Responded with ${homeRes.status}.`));
  }

  if ($) {
    const title = $("title").first().text().trim();
    checks.push(
      title
        ? check("title", "Page title present", "pass", `"${title}" (${title.length} chars)`)
        : check(
            "title",
            "Page title present",
            "fail",
            "No <title> tag found.",
            'Add a <title> tag inside <head> in layout/theme.liquid, e.g. `<title>{{ page_title }}{% unless page_title contains shop.name %} - {{ shop.name }}{% endunless %}</title>`, and confirm no template overrides it with an empty block.',
          ),
    );

    const description = $('meta[name="description"]').attr("content")?.trim();
    checks.push(
      description
        ? check("meta-description", "Meta description present", "pass", `${description.length} chars`)
        : check(
            "meta-description",
            "Meta description present",
            "fail",
            "No meta description found.",
            'Add `<meta name="description" content="{{ page_description | default: shop.description | escape }}">` to layout/theme.liquid, and set a homepage-specific description under Online Store > Preferences > "Homepage title and meta description".',
          ),
    );

    const viewport = $('meta[name="viewport"]').attr("content");
    checks.push(
      viewport
        ? check("viewport", "Responsive viewport meta tag", "pass", viewport)
        : check(
            "viewport",
            "Responsive viewport meta tag",
            "fail",
            "No viewport meta tag found.",
            'Add `<meta name="viewport" content="width=device-width,initial-scale=1">` inside <head> in layout/theme.liquid — required for correct mobile layout and for the Lighthouse mobile-friendly score.',
          ),
    );

    const canonical = $('link[rel="canonical"]').attr("href");
    checks.push(
      canonical
        ? check("canonical", "Canonical URL set", "pass", canonical)
        : check(
            "canonical",
            "Canonical URL set",
            "warn",
            "No canonical link tag found.",
            'Add `<link rel="canonical" href="{{ canonical_url }}">` inside <head> in layout/theme.liquid to prevent duplicate-content issues from tracking params and filtered/sorted collection URLs.',
          ),
    );

    // Parses and identifies actual schema.org @type values (recursing into nested nodes, e.g.
    // Shopify's ProductGroup/hasVariant) rather than just counting <script> blocks — a count
    // alone doesn't say whether the structured data that matters is actually present. See
    // geo-seo.ts's GEO section for the detailed per-type breakdown (Organization/WebSite/
    // Product/Offer/BreadcrumbList/FAQPage), each with its own pass/warn and recommendation.
    const schemaTypes = extractSchemaTypes(html);
    checks.push(
      schemaTypes.length > 0
        ? check("structured-data", "Structured data (JSON-LD)", "pass", `Found: ${schemaTypes.join(", ")}.`)
        : check(
            "structured-data",
            "Structured data (JSON-LD)",
            "warn",
            "No JSON-LD structured data found.",
            'Add an Organization + WebSite JSON-LD block to layout/theme.liquid (name, url, logo, sameAs social links) via a `<script type="application/ld+json">` tag, so search engines and AI answer engines can identify the brand entity.',
          ),
    );

    const images = $("img");
    const missingAlt = images.filter((_, el) => !$(el).attr("alt")?.trim()).length;
    const total = images.length;
    const altStatus: HealthStatus = total === 0 ? "pass" : missingAlt === 0 ? "pass" : missingAlt / total > 0.25 ? "fail" : "warn";
    checks.push(
      check(
        "image-alt",
        "Image alt text coverage",
        altStatus,
        total === 0 ? "No images found on homepage." : `${total - missingAlt}/${total} images have alt text.`,
        altStatus === "pass"
          ? undefined
          : 'Add descriptive `alt` text to every <img>. For Shopify-native image tags use `{{ image | image_url: width: 800 | image_tag: alt: image.alt | default: product.title }}`; for hand-coded theme images, write alt text describing the image\'s content, not the filename. Decorative images only should use `alt=""`.',
      ),
    );

    const scripts = $("script[src]");
    const thirdPartyScripts = scripts.filter((_, el) => {
      const src = $(el).attr("src") ?? "";
      return src.startsWith("http") && !src.includes(new URL(url).hostname);
    }).length;
    const thirdPartyStatus: HealthStatus = thirdPartyScripts > 15 ? "fail" : thirdPartyScripts > 8 ? "warn" : "pass";
    checks.push(
      check(
        "third-party-scripts",
        "Third-party script count",
        thirdPartyStatus,
        `${thirdPartyScripts} third-party script tag(s) detected (apps/pixels add weight).`,
        thirdPartyStatus === "pass"
          ? undefined
          : "Audit installed apps under Settings > Apps and uninstall any not in active use. For scripts you need to keep, defer non-critical ones (analytics, chat widgets) with `defer`/`async` or load them after first user interaction instead of blocking the initial page render.",
      ),
    );

    const passwordForm = $('form[action*="password"]').length > 0 || /storefront_password/i.test(html);
    checks.push(
      passwordForm
        ? check(
            "public-access",
            "Storefront publicly accessible",
            "fail",
            "Store appears to be behind a Shopify password page.",
            "Remove the storefront password in Shopify Admin > Online Store > Preferences (bottom of the page) unless the store is intentionally pre-launch.",
          )
        : check("public-access", "Storefront publicly accessible", "pass", "No password gate detected."),
    );
  }

  const robotsRes = await safeFetch(`${origin}/robots.txt`);
  checks.push(
    robotsRes?.ok
      ? check("robots-txt", "robots.txt present", "pass", `${origin}/robots.txt responded 200.`)
      : check(
          "robots-txt",
          "robots.txt present",
          "warn",
          "robots.txt missing or unreachable.",
          "Shopify serves /robots.txt automatically for every storefront. If it's unreachable, check for a robots.txt.liquid override in the theme's templates that may be erroring, and confirm no CDN/proxy in front of the domain is blocking the path.",
        ),
  );

  const sitemapRes = await safeFetch(`${origin}/sitemap.xml`);
  checks.push(
    sitemapRes?.ok
      ? check("sitemap-xml", "sitemap.xml present", "pass", `${origin}/sitemap.xml responded 200.`)
      : check(
          "sitemap-xml",
          "sitemap.xml present",
          "warn",
          "sitemap.xml missing or unreachable.",
          "Shopify serves /sitemap.xml automatically for every storefront. If it's unreachable, verify the primary domain has fully propagated (Online Store > Domains) and that no CDN/proxy rule in front of it is blocking the path.",
        ),
  );

  const weights: Record<HealthStatus, number> = { pass: 100, warn: 60, fail: 0 };
  const score = Math.round(checks.reduce((sum, c) => sum + weights[c.status], 0) / checks.length);

  return { score, checks };
}
