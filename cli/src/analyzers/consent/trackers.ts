import type { TrackerCategory } from "@barrel/site-audit-shared";

/** A third-party tag we can recognise from network traffic alone.
 *
 * The `category` is the whole point. "Did tracking stop after reject?" is the wrong question —
 * essential tags are *supposed* to keep running, and under a granular choice analytics may
 * legitimately continue while marketing must not. Only a categorised tracker list can tell the
 * difference between a CMP that works and one that blocks indiscriminately. */
export interface TrackerSignature {
  id: string;
  name: string;
  category: TrackerCategory;
  pattern: RegExp;
}

export const TRACKERS: TrackerSignature[] = [
  // ── Marketing ────────────────────────────────────────────────────────────────────────────
  { id: "meta", name: "Meta Pixel", category: "marketing", pattern: /connect\.facebook\.net|facebook\.com\/tr/i },
  { id: "google-ads", name: "Google Ads", category: "marketing", pattern: /googleadservices\.com|googlesyndication\.com|google\.com\/pagead|doubleclick\.net/i },
  { id: "tiktok", name: "TikTok Pixel", category: "marketing", pattern: /analytics\.tiktok\.com/i },
  { id: "pinterest", name: "Pinterest Tag", category: "marketing", pattern: /ct\.pinterest\.com|s\.pinimg\.com\/ct/i },
  { id: "snapchat", name: "Snap Pixel", category: "marketing", pattern: /sc-static\.net\/scevent|tr\.snapchat\.com/i },
  { id: "bing", name: "Microsoft/Bing UET", category: "marketing", pattern: /bat\.bing\.com/i },
  { id: "linkedin", name: "LinkedIn Insight", category: "marketing", pattern: /snap\.licdn\.com|px\.ads\.linkedin\.com/i },
  { id: "reddit", name: "Reddit Pixel", category: "marketing", pattern: /redditstatic\.com\/ads|alb\.reddit\.com/i },
  { id: "criteo", name: "Criteo", category: "marketing", pattern: /criteo\.(com|net)/i },
  { id: "amazon-ads", name: "Amazon Ads", category: "marketing", pattern: /amazon-adsystem\.com/i },
  { id: "rakuten", name: "Rakuten", category: "marketing", pattern: /linksynergy\.com|rakutenmarketing\.com/i },
  { id: "impact", name: "Impact", category: "marketing", pattern: /impactradius-event\.com|impact\.com/i },
  { id: "attentive", name: "Attentive", category: "marketing", pattern: /attentivemobile\.com|attn\.tv/i },
  { id: "klaviyo", name: "Klaviyo", category: "marketing", pattern: /klaviyo\.com|static\.klaviyo\.com/i },

  // ── Analytics ────────────────────────────────────────────────────────────────────────────
  { id: "ga4", name: "Google Analytics 4", category: "analytics", pattern: /google-analytics\.com\/(g|j)\/collect|googletagmanager\.com\/gtag\/js/i },
  { id: "gtm", name: "Google Tag Manager", category: "analytics", pattern: /googletagmanager\.com\/gtm\.js/i },
  { id: "clarity", name: "Microsoft Clarity", category: "analytics", pattern: /clarity\.ms/i },
  { id: "hotjar", name: "Hotjar", category: "analytics", pattern: /hotjar\.(com|io)/i },
  { id: "northbeam", name: "Northbeam", category: "analytics", pattern: /northbeam\.io/i },
  { id: "triplewhale", name: "Triple Whale", category: "analytics", pattern: /triplewhale\.com|triplepixel/i },
  { id: "elevar", name: "Elevar", category: "analytics", pattern: /elevar\.(com|dev)|getelevar\.com/i },

  // ── Essential ────────────────────────────────────────────────────────────────────────────
  // Shopify's own first-party analytics. Listed so it's visibly accounted for rather than
  // silently uncategorised — but never asserted against, because Shopify gates it through the
  // Customer Privacy API on its own and blocking it is not ours to demand.
  { id: "trekkie", name: "Shopify Trekkie", category: "essential", pattern: /shopify\.com\/.*\/trekkie|monorail-edge\.shopifysvc\.com/i },
];

/** Cookie-name → category. Prefix match, longest first, so `_shopify_marketing` beats `_shopify_`. */
const COOKIE_CATEGORIES: Array<[RegExp, TrackerCategory]> = [
  [/^_fbp$|^_fbc$|^fr$/i, "marketing"],
  [/^_gcl_|^_gac_|^IDE$|^test_cookie$|^MUID$/i, "marketing"],
  [/^_ttp$|^_scid$|^_pin_unauth$|^_uetsid|^_uetvid|^_rdt_uuid$/i, "marketing"],
  [/^__kla_id$|^_attn_/i, "marketing"],
  [/^_shopify_marketing/i, "marketing"],
  [/^_ga$|^_ga_|^_gid$|^_gat/i, "analytics"],
  [/^_clck$|^_clsk$|^_hj/i, "analytics"],
  [/^_shopify_analytics|^_shopify_y$|^_shopify_s$/i, "analytics"],
  [/^_orig_referrer$|^_landing_page$/i, "analytics"],
  [/^localization$|^cart_|^secure_customer_sig$|^_secure_session_id$/i, "essential"],
  [/^_shopify_essential$|^_tracking_consent$|^_cmp_a$/i, "essential"],
  [/^CookieConsent$|^OptanonConsent$|^OptanonAlertBoxClosed$|^osano_|^cookieyes-consent$/i, "essential"],
];

/** Everything unrecognised lands in `preferences` rather than `marketing`: an unknown cookie is
 * not evidence of a marketing tag, and guessing "marketing" would manufacture blocker-severity
 * failures out of cookies we simply haven't catalogued yet. */
export function categorizeCookie(name: string): TrackerCategory {
  for (const [pattern, category] of COOKIE_CATEGORIES) {
    if (pattern.test(name)) return category;
  }
  return "preferences";
}

/** Google's Consent Mode status parameter, e.g. `gcs=G100`.
 *
 * Four characters: a literal `G`, then whether Consent Mode is active at all, then `ad_storage`,
 * then `analytics_storage` — each `0` (denied) or `1` (granted). */
const GCS_PARAM = /[?&]gcs=G([01])([01])([01])/i;

export interface ConsentModePing {
  adStorage: boolean;
  analyticsStorage: boolean;
}

/** Reads the Consent Mode state a Google request declares about itself, or null when it declares
 * nothing — a plain library load carries no `gcs`, and absence is not consent. */
export function readConsentModePing(url: string): ConsentModePing | null {
  const m = GCS_PARAM.exec(url);
  if (!m || m[1] !== "1") return null;
  return { adStorage: m[2] === "1", analyticsStorage: m[3] === "1" };
}

/** True when a request carries an explicit Consent Mode *denial* for `category`.
 *
 * This is the difference between a tag tracking someone and a tag reporting that it isn't. After
 * a rejection a correctly-configured Google tag still calls home — cookieless, with `gcs=G100`
 * and `npa=1` — precisely to say consent was withheld. Counting that as "marketing fired" flags
 * the correct implementation and the broken one identically, which is worse than not checking:
 * it teaches the reader that a blocker finding means nothing. */
export function isConsentDeniedPing(url: string, category: TrackerCategory): boolean {
  const ping = readConsentModePing(url);
  if (!ping) return false;
  if (category === "marketing") return !ping.adStorage;
  if (category === "analytics") return !ping.analyticsStorage;
  return false;
}

/** Which trackers actually fired, judged per request rather than against one joined haystack.
 *
 * Per-request matching is what makes the denial check above possible at all: a tag that sends ten
 * denied pings and one real hit has still fired, and a tag that sends only denied pings has not. */
export function matchTrackers(urls: string[]): TrackerSignature[] {
  const fired = new Set<string>();
  for (const url of urls) {
    for (const t of TRACKERS) {
      if (fired.has(t.id)) continue;
      if (!t.pattern.test(url)) continue;
      if (isConsentDeniedPing(url, t.category)) continue;
      fired.add(t.id);
    }
  }
  return TRACKERS.filter((t) => fired.has(t.id));
}

export function trackersInCategory(ids: string[], category: TrackerCategory): TrackerSignature[] {
  return TRACKERS.filter((t) => ids.includes(t.id) && t.category === category);
}

export function trackerById(id: string): TrackerSignature | undefined {
  return TRACKERS.find((t) => t.id === id);
}
