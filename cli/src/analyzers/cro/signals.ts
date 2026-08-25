// Deterministic signals read out of a rendered page's HTML — the non-AI half of every CRO finding.
//
// This module exists so the same question ("does this PDP show reviews?") has exactly one answer in
// the codebase. It started life inside analyzers/ux.ts, which asked it of one collection page and
// one product page; the CRO audit asks it of six page groups on two devices plus three
// competitors, and a second copy of these regexes would have drifted within a month. ux.ts now
// imports from here, so its two-page audit and the CRO tool's sweep can never disagree about what
// a trust badge is.
//
// Everything here is a marker match against HTML rather than a rendered-layout question. That is a
// real limitation and worth stating: a review widget present in the DOM but rendered 4,000px down
// counts as "present". The layout half of the question is what capture.ts's measurements and the
// screenshots are for.

import * as cheerio from "cheerio";
import type { HealthCheckItem, HealthStatus } from "@barrel/site-audit-shared";
import type { CroPageGroup } from "@barrel/site-audit-shared";

/** A realistic, current desktop Chrome UA — chrome-launcher's default headless UA advertises itself
 * as "HeadlessChrome", which is an easy, unnecessary bot signal for a legitimate audit tool to be
 * sending. This isn't fingerprint spoofing, just not needlessly announcing automation. */
export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** The mobile counterpart. A storefront that serves a different template to mobile — plenty do —
 * would otherwise be audited twice at desktop width with only the viewport changed, and the mobile
 * findings would be about a page no mobile visitor ever sees. */
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random 2–4s pause between page loads, with human-plausible dwell time. This is the "throttle":
 * no parallel tabs, no rapid-fire requests, nothing that looks like a scraper hammering the site —
 * just a sequence of page views a normal visitor could plausibly make. It matters more here than
 * in the two-page UX audit: a CRO sweep is a dozen loads, which is where a WAF starts paying
 * attention. */
export function throttleDelay(): Promise<void> {
  return sleep(2000 + Math.random() * 2000);
}

export function check(id: string, label: string, status: HealthStatus, detail: string): HealthCheckItem {
  return { id, label, status, detail };
}

export function hasAnyMarker(html: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(html));
}

/* ── Markers ─────────────────────────────────────────────────────────────────────────────────── */

export const REVIEW_APP_MARKERS = [
  /judge\.?me|jdgm/i,
  /yotpo/i,
  /loox/i,
  /okendo/i,
  /stamped\.io|stamped-reviews/i,
  /ali-?reviews/i,
  /reviews\.io/i,
  /"@type"\s*:\s*"AggregateRating"/i,
];

export const TRUST_BADGE_MARKERS = [
  /free shipping/i,
  /money.?back guarantee/i,
  /secure checkout/i,
  /satisfaction guarantee/i,
  /\b\d+.?day returns?\b/i,
  /ssl secure/i,
];

export const ADD_TO_CART_MARKERS = [/name=["']add["']/i, />\s*add to (cart|bag)\s*</i, /add-to-cart/i];

export const BREADCRUMB_MARKERS = [
  /aria-label=["']breadcrumb["']/i,
  /class=["'][^"']*breadcrumb/i,
  /"@type"\s*:\s*"BreadcrumbList"/i,
];

export const COLLECTION_FILTER_MARKERS = [/class=["'][^"']*(facet|filter)/i, /<facet-filters/i, /data-filter/i];

export const QUICK_ADD_MARKERS = [/quick.?add/i, /quick.?shop/i, /quick.?view/i];

/** Some themes return HTTP 200 for a dead/renamed collection URL but render a friendly "nothing
 * here" page instead of a real 404 — response.ok() alone won't catch that. Detecting it avoids
 * reporting misleading "no filters/no quick-add" warnings against an empty page. */
export const SOFT_404_MARKERS = [
  /page (you (requested|are looking for)|not found)/i,
  /doesn'?t exist/i,
  /nothing to see here/i,
  /we can'?t find/i,
  /404[\s-]*(error|page)/i,
];

const SEARCH_MARKERS = [/type=["']search["']/i, /name=["']q["']/i, /predictive-search/i, /aria-label=["'][^"']*search/i];

const SUBSCRIPTION_MARKERS = [
  /subscri(be|ption)/i,
  /recharge/i,
  /skio/i,
  /loop_?subscriptions/i,
  /selling_?plan/i,
  /deliver every/i,
];

const BUNDLE_MARKERS = [/\bbundle\b/i, /buy \d+ get/i, /\bkit\b.{0,40}\bsave\b/i];

/** The amount, not just the fact.
 *
 * "A free-shipping threshold is stated" is a weak piece of evidence, and it turned out to be an
 * actively harmful one: the model reads the threshold off the screenshot, writes a perfectly good
 * bullet about repeating "$50 away from free shipping" in the cart, and the figure check discards it
 * because $50 appears nowhere in the catalogue. Three real opportunities were thrown away that way
 * on the first live run. The check is right; the evidence was too thin. */
const FREE_SHIPPING_AMOUNT = /free shipping (?:on |for )?(?:orders )?(?:over|above|from)\s*([$£€]\s?[\d,]+(?:\.\d{2})?)/i;
const SPEND_FOR_SHIPPING_AMOUNT = /spend\s*([$£€]\s?[\d,]+(?:\.\d{2})?)[^.]{0,40}free shipping/i;

export function freeShippingThreshold(html: string): string | null {
  const match = FREE_SHIPPING_AMOUNT.exec(html) ?? SPEND_FOR_SHIPPING_AMOUNT.exec(html);
  return match?.[1]?.replace(/\s+/g, "") ?? null;
}

const FREE_SHIPPING_THRESHOLD_MARKERS = [
  /free shipping (on |for )?(orders )?(over|above|from)\s*[$£€]?\d/i,
  /spend\s*[$£€]?\d+.{0,30}free shipping/i,
  /[$£€]\d+\s*(away|more).{0,30}free shipping/i,
];

const LIVE_CHAT_MARKERS = [/gorgias/i, /intercom/i, /zendesk|zdassets/i, /tidio/i, /drift\.com/i, /crisp\.chat/i, /tawk\.to/i];

const FINANCING_MARKERS = [/afterpay/i, /klarna/i, /affirm/i, /sezzle/i, /shop ?pay installments/i, /\b4 interest.free/i];

const SIZE_GUIDE_MARKERS = [/size (guide|chart)/i, /fit (guide|predictor)/i];

const GIFT_CARD_MARKERS = [/gift ?card/i, /\/products\/gift/i];

const UPSELL_MARKERS = [
  /you (may|might) also like/i,
  /frequently bought together/i,
  /complete the (look|set)/i,
  /pairs well with/i,
  /rebuy/i,
];

const URGENCY_MARKERS = [
  /only \d+ left/i,
  /low stock/i,
  /selling fast/i,
  /\bin \d+ carts?\b/i,
  /ends (today|tonight|in)/i,
  /countdown/i,
];

const RETURNS_MARKERS = [/\breturns?\b/i, /\bexchange(s)?\b/i, /refund polic/i];

const EXPRESS_PAY_MARKERS = [/shop ?pay/i, /apple ?pay/i, /google ?pay/i, /paypal/i, /dynamic-checkout/i];

const GUEST_CHECKOUT_MARKERS = [/continue as guest/i, /guest checkout/i];

const STICKY_ATC_MARKERS = [/sticky[-_ ]?(atc|add[-_ ]?to[-_ ]?cart|buy)/i, /class=["'][^"']*sticky[^"']*cart/i];

/* ── Per-page-group signals ──────────────────────────────────────────────────────────────────── */

/** Kept byte-identical in behaviour to the version that lived in analyzers/ux.ts, so moving it here
 * changed no existing report. */
export function buildCollectionChecks(html: string): HealthCheckItem[] {
  const hasFilters = hasAnyMarker(html, COLLECTION_FILTER_MARKERS);
  const hasQuickAdd = hasAnyMarker(html, QUICK_ADD_MARKERS);
  const hasBreadcrumbs = hasAnyMarker(html, BREADCRUMB_MARKERS);
  return [
    check(
      "ux-collection-filters",
      "Collection filtering/sorting",
      hasFilters ? "pass" : "warn",
      hasFilters
        ? "Filter or facet UI detected on the collection page."
        : "No filter/facet UI detected — shoppers browsing a large catalog may struggle to narrow results.",
    ),
    check(
      "ux-collection-quick-add",
      "Quick add-to-cart from collection grid",
      hasQuickAdd ? "pass" : "warn",
      hasQuickAdd
        ? "Quick add/shop/view affordance detected on the collection grid."
        : "No quick-add affordance detected — shoppers must open each product page to add to cart, adding friction.",
    ),
    check(
      "ux-collection-breadcrumbs",
      "Breadcrumb navigation",
      hasBreadcrumbs ? "pass" : "warn",
      hasBreadcrumbs ? "Breadcrumb navigation detected." : "No breadcrumb navigation detected on the collection page.",
    ),
  ];
}

/** Also moved verbatim from analyzers/ux.ts. */
export function buildProductChecks(html: string): HealthCheckItem[] {
  const $ = cheerio.load(html);
  const galleryImages = $(
    'img[src*="/products/"], img[class*="product"], [class*="product-media"] img, [class*="product__media"] img',
  ).length;
  const totalImages = $("img").length;
  const imageCount = galleryImages > 0 ? galleryImages : totalImages;

  const hasAtc = hasAnyMarker(html, ADD_TO_CART_MARKERS);
  const hasReviews = hasAnyMarker(html, REVIEW_APP_MARKERS);
  const hasTrust = hasAnyMarker(html, TRUST_BADGE_MARKERS);
  const hasBreadcrumbs = hasAnyMarker(html, BREADCRUMB_MARKERS);

  return [
    check(
      "ux-pdp-add-to-cart",
      "Add-to-cart visibility",
      hasAtc ? "pass" : "fail",
      hasAtc
        ? "Add-to-cart control detected on the product page."
        : "No add-to-cart control detected in the rendered page — this is critical; shoppers may not find a way to purchase.",
    ),
    check(
      "ux-pdp-reviews",
      "Reviews / social proof",
      hasReviews ? "pass" : "warn",
      hasReviews
        ? "A reviews widget or aggregate rating markup was detected."
        : "No reviews widget or rating markup detected — social proof is one of the strongest conversion levers on a PDP.",
    ),
    check(
      "ux-pdp-trust-badges",
      "Trust badges & shipping/return info",
      hasTrust ? "pass" : "warn",
      hasTrust
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
      hasBreadcrumbs ? "pass" : "warn",
      hasBreadcrumbs ? "Breadcrumb navigation detected." : "No breadcrumb navigation detected on the product page.",
    ),
  ];
}

/** The navigation is reviewed on every CRO audit even though it is not a page. Counting its links
 * is the point: a mega-menu with ninety destinations and a five-item bar fail in opposite
 * directions, and both are common. */
export function buildNavChecks(html: string): HealthCheckItem[] {
  const $ = cheerio.load(html);
  const navLinks = $("header a, nav a").length;
  const topLevel = $("header nav > ul > li, nav > ul > li").length;
  const hasSearch = hasAnyMarker(html, SEARCH_MARKERS);

  return [
    check(
      "cro-nav-search",
      "Search in the header",
      hasSearch ? "pass" : "warn",
      hasSearch
        ? "A search input or predictive-search component is present in the header."
        : "No search affordance detected in the header — shoppers who arrive knowing what they want have no shortcut to it.",
    ),
    check(
      "cro-nav-top-level",
      "Top-level navigation breadth",
      topLevel === 0 ? "warn" : topLevel <= 7 ? "pass" : "warn",
      topLevel === 0
        ? "No top-level navigation list could be identified, so its breadth could not be assessed."
        : topLevel <= 7
          ? `${topLevel} top-level navigation item(s) — within the range shoppers scan comfortably.`
          : `${topLevel} top-level navigation items. Past roughly seven, shoppers stop scanning and fall back on search.`,
    ),
    check(
      "cro-nav-link-count",
      "Total header links",
      navLinks <= 60 ? "pass" : "warn",
      navLinks <= 60
        ? `${navLinks} link(s) in the header region.`
        : `${navLinks} links in the header region — a menu this dense is hard to scan and pushes the choice back onto the shopper.`,
    ),
    check(
      "cro-nav-cart-visible",
      "Cart affordance",
      /cart/i.test($("header").html() ?? "") ? "pass" : "warn",
      /cart/i.test($("header").html() ?? "")
        ? "A cart link or icon is present in the header."
        : "No cart affordance detected in the header — shoppers cannot see what they have added or get back to it.",
    ),
  ];
}

export function buildHomeChecks(html: string): HealthCheckItem[] {
  const $ = cheerio.load(html);
  const hasHeroCta = $("a.button, a.btn, [class*='hero'] a, [class*='banner'] a").length > 0;
  const hasReviews = hasAnyMarker(html, REVIEW_APP_MARKERS);
  const hasTrust = hasAnyMarker(html, TRUST_BADGE_MARKERS);
  const hasFreeShippingThreshold = hasAnyMarker(html, FREE_SHIPPING_THRESHOLD_MARKERS);
  const threshold = freeShippingThreshold(html);

  return [
    check(
      "cro-home-hero-cta",
      "Hero call to action",
      hasHeroCta ? "pass" : "warn",
      hasHeroCta
        ? "A linked call to action was detected in the hero/banner region."
        : "No call to action detected in the hero region — the first screen gives a shopper nothing to act on.",
    ),
    check(
      "cro-home-social-proof",
      "Social proof on the home page",
      hasReviews ? "pass" : "warn",
      hasReviews
        ? "Review or rating content is present on the home page."
        : "No review or rating content on the home page — first-time visitors have no third-party signal to weigh.",
    ),
    check(
      "cro-home-value-props",
      "Value propositions / trust messaging",
      hasTrust ? "pass" : "warn",
      hasTrust
        ? "Shipping, guarantee or returns messaging is present on the home page."
        : "No shipping, guarantee or returns messaging on the home page — the questions that stop a first purchase go unanswered.",
    ),
    check(
      "cro-home-shipping-threshold",
      "Free-shipping threshold stated",
      hasFreeShippingThreshold ? "pass" : "warn",
      hasFreeShippingThreshold
        ? threshold
          ? `A free-shipping threshold of ${threshold} is stated, which gives basket-building a target.`
          : "A free-shipping threshold is stated, which gives basket-building a target."
        : "No free-shipping threshold stated on the home page — a stated threshold is one of the few reliable levers on average order value.",
    ),
  ];
}

export function buildCartChecks(html: string): HealthCheckItem[] {
  const $ = cheerio.load(html);
  const hasCheckoutButton = /checkout/i.test(html);
  const hasUpsell = hasAnyMarker(html, UPSELL_MARKERS);
  const hasShippingNote = hasAnyMarker(html, FREE_SHIPPING_THRESHOLD_MARKERS);
  const cartThreshold = freeShippingThreshold(html);
  const hasTrust = hasAnyMarker(html, TRUST_BADGE_MARKERS);
  const hasExpressPay = hasAnyMarker(html, EXPRESS_PAY_MARKERS);
  const noteField = $("textarea[name*='note'], input[name*='note']").length > 0;

  return [
    check(
      "cro-cart-checkout-cta",
      "Checkout call to action",
      hasCheckoutButton ? "pass" : "fail",
      hasCheckoutButton
        ? "A checkout control is present in the cart."
        : "No checkout control detected in the cart — nothing here could be verified as a route to purchase.",
    ),
    check(
      "cro-cart-express-pay",
      "Express payment options",
      hasExpressPay ? "pass" : "warn",
      hasExpressPay
        ? "Accelerated checkout options (Shop Pay/Apple Pay/PayPal or similar) are offered in the cart."
        : "No accelerated checkout options detected in the cart — returning mobile shoppers have no one-tap route.",
    ),
    check(
      "cro-cart-shipping-clarity",
      "Shipping cost clarity",
      hasShippingNote ? "pass" : "warn",
      hasShippingNote
        ? cartThreshold
          ? `Shipping messaging is present in the cart, stating a free-shipping threshold of ${cartThreshold}.`
          : "Shipping cost or threshold messaging is present in the cart."
        : "No shipping messaging in the cart — unexpected shipping cost at checkout is the most cited reason for abandonment.",
    ),
    check(
      "cro-cart-upsell",
      "Cart upsell / cross-sell",
      hasUpsell ? "pass" : "warn",
      hasUpsell
        ? "Recommended or complementary products are offered in the cart."
        : "No cart recommendations detected — the highest-intent moment in the session passes without a basket-building prompt.",
    ),
    check(
      "cro-cart-trust",
      "Reassurance in the cart",
      hasTrust ? "pass" : "warn",
      hasTrust
        ? "Guarantee, returns or secure-checkout messaging is present in the cart."
        : "No guarantee or returns messaging in the cart — the last chance to answer a hesitation before payment.",
    ),
    check(
      "cro-cart-note",
      "Order note field",
      noteField ? "pass" : "warn",
      noteField ? "An order-note field is available." : "No order-note field detected in the cart.",
    ),
  ];
}

/** Checkout is Shopify-hosted and largely fixed, so the useful signals are the few things a
 * merchant does control: which express methods are offered, whether guest checkout is allowed, and
 * how many fields stand between the shopper and paying. */
export function buildCheckoutChecks(html: string): HealthCheckItem[] {
  const $ = cheerio.load(html);
  const fields = $("input:not([type='hidden']):not([type='submit']), select, textarea").length;
  const hasExpressPay = hasAnyMarker(html, EXPRESS_PAY_MARKERS);
  const hasGuest = hasAnyMarker(html, GUEST_CHECKOUT_MARKERS) || !/create an account/i.test(html);
  const hasTrust = hasAnyMarker(html, TRUST_BADGE_MARKERS);

  return [
    check(
      "cro-checkout-express-pay",
      "Express payment at checkout",
      hasExpressPay ? "pass" : "warn",
      hasExpressPay
        ? "Accelerated payment methods are offered at the top of checkout."
        : "No accelerated payment methods detected at checkout.",
    ),
    check(
      "cro-checkout-guest",
      "Guest checkout",
      hasGuest ? "pass" : "warn",
      hasGuest
        ? "Checkout can be completed without creating an account."
        : "Checkout appears to require an account — a forced sign-up is one of the largest single drop-offs in a funnel.",
    ),
    check(
      "cro-checkout-fields",
      "Form field count",
      fields === 0 ? "warn" : fields <= 14 ? "pass" : "warn",
      fields === 0
        ? "No form fields could be counted on the captured checkout step."
        : `${fields} visible form field(s) on the first checkout step.`,
    ),
    check(
      "cro-checkout-trust",
      "Reassurance at checkout",
      hasTrust ? "pass" : "warn",
      hasTrust
        ? "Returns, guarantee or security messaging is present at checkout."
        : "No returns, guarantee or security messaging detected at checkout.",
    ),
  ];
}

export function buildSearchChecks(html: string): HealthCheckItem[] {
  const hasResults = !hasAnyMarker(html, SOFT_404_MARKERS);
  const hasFilters = hasAnyMarker(html, COLLECTION_FILTER_MARKERS);
  return [
    check(
      "cro-search-results",
      "Search returns results",
      hasResults ? "pass" : "warn",
      hasResults
        ? "The search results page rendered results for the sampled term."
        : "The search results page rendered an empty/not-found state for the sampled term.",
    ),
    check(
      "cro-search-filters",
      "Filtering on search results",
      hasFilters ? "pass" : "warn",
      hasFilters
        ? "Search results can be filtered or sorted."
        : "Search results cannot be filtered — a shopper who searches broadly has no way to narrow.",
    ),
  ];
}

/** Dispatcher, so capture.ts does not carry a switch statement over page groups. */
export function signalsForGroup(group: CroPageGroup, html: string): HealthCheckItem[] {
  switch (group) {
    case "nav":
      return buildNavChecks(html);
    case "home":
      return buildHomeChecks(html);
    case "plp":
      return buildCollectionChecks(html);
    case "pdp":
      return buildProductChecks(html);
    case "cart":
      return buildCartChecks(html);
    case "checkout":
      return buildCheckoutChecks(html);
    case "search":
      return buildSearchChecks(html);
  }
}

/* ── Feature presence, for the competitive matrix ────────────────────────────────────────────── */

/** The features a benchmark table compares, in the order they are shown. */
export const CRO_FEATURES = [
  { key: "reviews", label: "Reviews / ratings", markers: REVIEW_APP_MARKERS },
  { key: "filters", label: "Collection filtering", markers: COLLECTION_FILTER_MARKERS },
  { key: "quickAdd", label: "Quick add to cart", markers: QUICK_ADD_MARKERS },
  { key: "search", label: "Header search", markers: SEARCH_MARKERS },
  { key: "subscription", label: "Subscriptions", markers: SUBSCRIPTION_MARKERS },
  { key: "bundles", label: "Bundles / kits", markers: BUNDLE_MARKERS },
  { key: "shippingThreshold", label: "Free-shipping threshold", markers: FREE_SHIPPING_THRESHOLD_MARKERS },
  { key: "stickyAtc", label: "Sticky add to cart", markers: STICKY_ATC_MARKERS },
  { key: "liveChat", label: "Live chat", markers: LIVE_CHAT_MARKERS },
  { key: "financing", label: "Instalments / financing", markers: FINANCING_MARKERS },
  { key: "sizeGuide", label: "Size / fit guide", markers: SIZE_GUIDE_MARKERS },
  { key: "giftCards", label: "Gift cards", markers: GIFT_CARD_MARKERS },
  { key: "upsell", label: "Upsell / cross-sell", markers: UPSELL_MARKERS },
  { key: "urgency", label: "Urgency / scarcity", markers: URGENCY_MARKERS },
  { key: "returns", label: "Returns messaging", markers: RETURNS_MARKERS },
] as const;

export type CroFeatureKey = (typeof CRO_FEATURES)[number]["key"];

/** Which of the compared features appear anywhere across a site's captured pages.
 *
 * Deliberately a union across every page rather than per page: "does this brand offer
 * subscriptions" is a question about the brand, and the answer can appear on the PDP, the cart or
 * only in the footer. Deterministic — no model involved — which is what makes the resulting table
 * safe to put in front of a client. */
export function detectFeatures(htmlByPage: string[]): Record<CroFeatureKey, boolean> {
  const out = {} as Record<CroFeatureKey, boolean>;
  for (const feature of CRO_FEATURES) {
    out[feature.key] = htmlByPage.some((html) => hasAnyMarker(html, [...feature.markers]));
  }
  return out;
}
