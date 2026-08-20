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
  /** Paths that are this vendor's plumbing rather than measurement — fetching a web font, or
   * asking for the geo-IP that decides which signup form to render.
   *
   * Narrow by design, and an allowlist of the known-innocuous rather than of the known-tracking:
   * an endpoint nobody has catalogued still counts as a transmission, so the failure mode is a
   * finding that can be checked against its evidence rather than one that is never raised. */
  infrastructure?: RegExp;
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
  {
    id: "klaviyo",
    name: "Klaviyo",
    category: "marketing",
    pattern: /klaviyo\.com|static\.klaviyo\.com/i,
    // Fonts, form definitions and the geo-IP lookup that picks one. Klaviyo's actual measurement
    // lives at /onsite/track-analytics, /client/events and /api/track, none of which match here.
    infrastructure: /\/custom-fonts\/|\/forms\/api\/|\/onsite\/js\/|\/media\/js\//i,
  },

  // ── Analytics ────────────────────────────────────────────────────────────────────────────
  { id: "ga4", name: "Google Analytics 4", category: "analytics", pattern: /google-analytics\.com\/(g|j)\/collect|googletagmanager\.com\/gtag\/js/i },
  { id: "gtm", name: "Google Tag Manager", category: "analytics", pattern: /googletagmanager\.com\/gtm\.js/i },
  { id: "clarity", name: "Microsoft Clarity", category: "analytics", pattern: /clarity\.ms/i },
  { id: "hotjar", name: "Hotjar", category: "analytics", pattern: /hotjar\.(com|io)/i },
  { id: "northbeam", name: "Northbeam", category: "analytics", pattern: /northbeam\.io/i },
  { id: "triplewhale", name: "Triple Whale", category: "analytics", pattern: /triplewhale\.com|triplepixel/i },
  { id: "elevar", name: "Elevar", category: "analytics", pattern: /elevar\.(com|dev)|getelevar\.com/i },

  // ── Session replay & chat ────────────────────────────────────────────────────────────────
  // Categorised analytics, but the sharpest exposure in the catalogue: unlike a page-view pixel
  // these capture what a visitor typed and clicked. That is the "contents of a communication"
  // language CIPA §631 turns on, which is why gating them matters more than their category
  // suggests — and why "strictly necessary" is the wrong bucket for a chat widget.
  { id: "fullstory", name: "FullStory", category: "analytics", pattern: /fullstory\.com/i },
  { id: "logrocket", name: "LogRocket", category: "analytics", pattern: /logrocket\.(com|io)|lr-in\.com/i },
  { id: "smartlook", name: "Smartlook", category: "analytics", pattern: /smartlook\.(com|cloud)/i },
  { id: "mouseflow", name: "Mouseflow", category: "analytics", pattern: /mouseflow\.com/i },
  { id: "luckyorange", name: "Lucky Orange", category: "analytics", pattern: /luckyorange\.(com|net)/i },
  { id: "intercom", name: "Intercom", category: "analytics", pattern: /intercom\.(io|com)|intercomcdn\.com/i },
  { id: "drift", name: "Drift", category: "analytics", pattern: /drift\.com|driftt\.com/i },
  { id: "gorgias", name: "Gorgias", category: "analytics", pattern: /gorgias\.(com|chat)/i },
  { id: "zendesk-chat", name: "Zendesk Chat", category: "analytics", pattern: /zopim\.com|zdassets\.com/i },
  { id: "tidio", name: "Tidio", category: "analytics", pattern: /tidio(chat)?\.(com|co)/i },
  { id: "tawk", name: "Tawk.to", category: "analytics", pattern: /tawk\.to/i },

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
  [/^_fs_|^fs_uid$|^_lr_|^smartlook|^mf_|^__lo_/i, "analytics"],
  [/^intercom-|^drift[_a-z]*$|^gorgias|^__zlcmid$|^tidio/i, "analytics"],
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

/** Static assets a vendor serves: its own library, plus the fonts and images that come with it. */
const ASSET_PATH = /\.(js|mjs|cjs|css|map|json|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|ico|html?)$/i;

/** Library and config endpoints that carry no file extension to recognise them by.
 *
 * `googletagmanager.com/gtag/js` is a script download whose path simply ends in a bare `js`, and
 * `connect.facebook.net/signals/config/<id>` is the pixel fetching its own configuration. Both
 * were being read as identified events: 16 of 18 recorded "Google Analytics 4 fired before
 * consent" findings cited nothing but `gtag/js`, and under a correct Consent Mode setup that file
 * is *supposed* to load early so it can receive the denied default. The report was telling
 * clients to undo the thing they had done right. */
const EXTENSIONLESS_ASSET = /\/(gtag\/js|gtm\/js|tag\/[^/]+|signals\/config\/|compose\/|widget\/|sdk\/|loader)(\/|$)/i;

export type RequestKind = "script" | "transmission";

/** Fetching a vendor's library, or telling that vendor about this visitor?
 *
 * These are different claims and only one of them is what a consent choice is about. Downloading
 * `fbevents.js` discloses an IP and a referrer; `facebook.com/tr?id=…&ev=PageView` sends Meta an
 * identified event. Reporting both as "the pixel fired" hands a client's developer a finding they
 * can correctly dismiss — and once one blocker is dismissed, the real ones go with it.
 *
 * Judged on the path rather than a per-vendor allowlist so an endpoint nobody has catalogued yet
 * is treated as a transmission. Erring toward "this transmitted" is the safe direction: it can be
 * checked against the quoted evidence, whereas a missed transmission is invisible. */
export function classifyRequest(url: string, signature?: TrackerSignature): RequestKind {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "transmission";
  }
  // The file extension is checked first and wins. `analytics.tiktok.com/i18n/pixel/events.js`
  // contains "pixel" and is still just a script download — letting a path segment outrank the
  // extension reported the library fetch as an identified event.
  // Extension first, and it is the only thing that can rule out a transmission. A path segment
  // like /pixel/ or /collect/ used to be checked here too, but it could only ever agree with the
  // fallback below — and had it been checked first it would have re-classified
  // `analytics.tiktok.com/i18n/pixel/events.js` as an identified event, which is the exact bug
  // the extension rule exists to prevent. Everything not ruled out is treated as a transmission,
  // so an endpoint nobody has catalogued produces a finding that can be checked against its
  // evidence rather than one that is never raised.
  if (ASSET_PATH.test(path)) return "script";
  if (EXTENSIONLESS_ASSET.test(path)) return "script";
  if (signature?.infrastructure?.test(path)) return "script";
  return "transmission";
}

/** The query parameters that make a request evidence rather than an assertion.
 *
 * A finding that says "Meta Pixel transmitted after the visitor opted out" is worth exactly as
 * much as the reader's ability to verify it. Naming the pixel ID and the event lets them do that
 * without trusting us. Deliberately a fixed allowlist of well-known, non-personal fields — the
 * point is to identify the transmission, not to capture whatever the page happened to send. */
const IDENTIFYING_PARAMS = [
  "id", "tid", "ev", "en", "event", "pid", "cid", "aid", "gcs", "npa", "us_privacy", "gdpr",
  "gdpr_consent", "dl", "t", "ti",
];

export function describeTransmission(url: string): string {
  try {
    const parsed = new URL(url);
    const parts: string[] = [];
    for (const key of IDENTIFYING_PARAMS) {
      const value = parsed.searchParams.get(key);
      if (value) parts.push(`${key}=${value.slice(0, 60)}`);
    }
    const where = `${parsed.host}${parsed.pathname}`;
    return parts.length > 0 ? `${where} (${parts.join(", ")})` : where;
  } catch {
    return url.slice(0, 120);
  }
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

/** Trackers that sent this vendor data about the visitor — script loads excluded.
 *
 * This is what every blocker-severity assertion reads. `matchTrackers` stays as it is, because
 * "is this vendor present on the page at all" is still a question worth answering. */
export function matchTransmissions(urls: string[]): TrackerSignature[] {
  const fired = new Set<string>();
  for (const url of urls) {
    for (const t of TRACKERS) {
      if (fired.has(t.id) || !t.pattern.test(url)) continue;
      if (classifyRequest(url, t) !== "transmission") continue;
      if (isConsentDeniedPing(url, t.category)) continue;
      fired.add(t.id);
    }
  }
  return TRACKERS.filter((t) => fired.has(t.id));
}

/** Trackers whose library was fetched without any data being sent. */
export function matchScriptLoads(urls: string[]): TrackerSignature[] {
  const transmitted = new Set(matchTransmissions(urls).map((t) => t.id));
  const loaded = new Set<string>();
  for (const url of urls) {
    for (const t of TRACKERS) {
      if (loaded.has(t.id) || transmitted.has(t.id) || !t.pattern.test(url)) continue;
      if (classifyRequest(url, t) === "script") loaded.add(t.id);
    }
  }
  return TRACKERS.filter((t) => loaded.has(t.id));
}

/** Whether this specific URL is a transmission for the tracker that matched it. Used by the
 * evidence renderer so a quoted URL always supports the sentence above it. */
export function isTransmissionFor(url: string, t: TrackerSignature): boolean {
  return classifyRequest(url, t) === "transmission" && !isConsentDeniedPing(url, t.category);
}

export function trackersInCategory(ids: string[], category: TrackerCategory): TrackerSignature[] {
  return TRACKERS.filter((t) => ids.includes(t.id) && t.category === category);
}

export function trackerById(id: string): TrackerSignature | undefined {
  return TRACKERS.find((t) => t.id === id);
}
