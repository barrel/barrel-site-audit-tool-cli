import type { TrackerCategory } from "@barrel/site-audit-shared";
import { TRACKERS, type TrackerSignature } from "./trackers.js";

/** A vendor the inventory can name without asking the model.
 *
 * Separate from `TRACKERS` on purpose. `TRACKERS` is the list the *assertions* run against, and
 * adding a storefront app to it would change what the test suites claim: a review widget is not
 * a tracker and should not make C1 fail. But it is still a third party receiving requests from
 * the page, so the *inventory* has to list it. This catalogue exists to name those without
 * inventing a purpose for something well known. */
export interface VendorProfile {
  key: string;
  name: string;
  purpose: string;
  category: TrackerCategory;
  /** Hosts belonging to this vendor beyond its own registrable domain — a vendor serving from a
   * CDN domain of its own, or a rebranded host. */
  extraHosts?: RegExp;
}

/** Storefront apps and services that are not trackers but do appear in the network log.
 *
 * Categorised the way a CMP would have to categorise them, which is frequently *not* essential:
 * a review widget that sets an identity cookie is doing more than rendering reviews. Where the
 * honest answer is "depends what it's configured to do", `preferences` is used rather than
 * guessing `marketing` — the same rule the cookie categoriser follows, and for the same reason. */
export const VENDOR_CATALOGUE: VendorProfile[] = [
  { key: "rebuyengine.com", name: "Rebuy", purpose: "Personalised product recommendations & upsells", category: "preferences" },
  { key: "gotolstoy.com", name: "Tolstoy", purpose: "Shoppable video widget", category: "preferences" },
  { key: "shoppinggives.com", name: "ShoppingGives", purpose: "Charitable donation at checkout", category: "preferences" },
  { key: "govalos.com", name: "Valos", purpose: "Storefront app (order/delivery experience)", category: "preferences" },
  { key: "bazaarvoice.com", name: "Bazaarvoice", purpose: "Ratings & reviews platform", category: "preferences" },
  { key: "marker.io", name: "Marker.io", purpose: "Internal QA & visual bug reporting widget", category: "preferences" },
  { key: "justone.ai", name: "JustOne.ai", purpose: "AI on-site merchandising/assistant", category: "preferences" },
  { key: "route.com", name: "Route", purpose: "Shipping protection & package tracking", category: "preferences" },
  { key: "shipscout.app", name: "ShipScout", purpose: "Shipping-rate A/B testing", category: "preferences" },
  { key: "okendo.io", name: "Okendo", purpose: "Ratings & reviews platform", category: "preferences" },
  { key: "yotpo.com", name: "Yotpo", purpose: "Reviews & loyalty platform", category: "preferences" },
  { key: "stamped.io", name: "Stamped", purpose: "Reviews & loyalty platform", category: "preferences" },
  { key: "loyaltylion.com", name: "LoyaltyLion", purpose: "Loyalty & rewards programme", category: "preferences" },
  { key: "smile.io", name: "Smile.io", purpose: "Loyalty & rewards programme", category: "preferences" },
  { key: "recharge.com", name: "Recharge", purpose: "Subscription management", category: "preferences" },
  { key: "digioh.com", name: "Digioh", purpose: "On-site pop-ups, quizzes & lead capture", category: "marketing" },
  { key: "lightboxcdn.com", name: "Digioh / Lightbox", purpose: "On-site pop-ups & lead capture", category: "marketing" },
  { key: "privy.com", name: "Privy", purpose: "On-site pop-ups & email capture", category: "marketing" },
  { key: "justuno.com", name: "Justuno", purpose: "On-site pop-ups & email capture", category: "marketing" },
  { key: "postscript.io", name: "Postscript", purpose: "SMS marketing capture & subscriber identification", category: "marketing" },
  { key: "tatari.tv", name: "Tatari", purpose: "TV & streaming ad attribution", category: "marketing" },
  { key: "adnxs.com", name: "Xandr / AppNexus", purpose: "DMP identity resolution & audience pixel", category: "marketing" },
  { key: "dstillery.com", name: "Dstillery", purpose: "Audience targeting & ad retargeting", category: "marketing" },
  { key: "bidr.io", name: "Beeswax", purpose: "DSP audience segment sync", category: "marketing" },
  { key: "usbrowserspeed.com", name: "usbrowserspeed.com", purpose: "Cookie / ID sync", category: "marketing" },
  { key: "mplatform.com", name: "MPlatform", purpose: "Identity & audience sync", category: "marketing" },
  { key: "merchant-center-analytics.goog", name: "Google Merchant Center", purpose: "Product feed conversion measurement", category: "marketing" },
  { key: "gigit.com", name: "Gigit", purpose: "Storefront app", category: "preferences" },

  // The consent platforms themselves. Categorised essential — a CMP has to run before any choice
  // is made or it could never collect one — and kept in the table rather than filtered out,
  // because a CMP that appears here having transmitted *nothing* is the finding: its script was
  // fetched and it never initialised. On the site that prompted this catalogue, Cookiebot's
  // `uc.js` returns 200 and `window.CookieConsent` never appears, so nothing on the page is gated.
  { key: "cookiebot.com", name: "Cookiebot", purpose: "Consent management platform", category: "essential" },
  { key: "osano.com", name: "Osano", purpose: "Consent management platform", category: "essential" },
  { key: "onetrust.com", name: "OneTrust", purpose: "Consent management platform", category: "essential" },
  { key: "cookielaw.org", name: "OneTrust", purpose: "Consent management platform", category: "essential" },
  { key: "cookieyes.com", name: "CookieYes", purpose: "Consent management platform", category: "essential" },
];

/** Hosts that are the platform, the site itself, or plain content delivery.
 *
 * Excluded from the inventory rather than listed as essential. An inventory that opens with
 * fifteen rows for Shopify's own infrastructure and a font CDN buries the six rows that matter,
 * and the client did not ask what their web host is. Shopify's *analytics* is not in here — it
 * stays in the catalogue as `trekkie`, because it is a tracker and belongs in the table. */
const PLATFORM_HOSTS =
  /(^|\.)(shopifysvc\.com|shopifycdn\.com|shopifycloud\.com|shop\.app|shopifyapps\.com|myshopify\.com)$/i;

const CONTENT_HOSTS =
  /(^|\.)(typekit\.net|cloudinary\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|gstatic\.com|jquery\.com|jsdelivr\.net|unpkg\.com|cloudflare\.com|cdnjs\.cloudflare\.com)$/i;

/** Two-level public suffixes we have to keep intact to get a meaningful vendor key.
 *
 * Without this, `foo.co.uk` groups as `co.uk` and every British vendor collapses into one row.
 * Deliberately a short list of the suffixes that actually turn up on client storefronts rather
 * than a bundled copy of the public-suffix list, which would be a dependency for one function. */
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp",
  "co.za", "com.br", "com.mx", "com.sg", "co.in", "com.tr",
]);

/** The registrable domain — the unit a client thinks in and a CMP rule is written against.
 *
 * `static.klaviyo.com`, `a.klaviyo.com` and `static-tracking.klaviyo.com` are one vendor and one
 * row, not three. Falls back to the host itself for anything unparseable, so an odd host produces
 * its own row rather than vanishing. */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, "");
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether this host should appear in the inventory at all. First-party hosts are dropped by the
 * caller, which knows the site's own domain; this covers the platform and content CDNs. */
export function isInfrastructureHost(host: string): boolean {
  return PLATFORM_HOSTS.test(host) || CONTENT_HOSTS.test(host);
}

/** The tracker signature matching a URL, if any. Used to attribute a discovered host to a
 * catalogued vendor before falling back to the extended catalogue or the model.
 *
 * Matched against **host + pathname only, never the query string.** Cookie-sync endpoints name
 * their partner in a parameter — `odr.mookie1.com/sync?partner=amazon-adsystem.com` — and matching
 * the whole URL attributed ten unrelated ad-tech hosts to Amazon Ads, merging their rows and
 * putting `s.amazon-adsystem.com` in Google Ads' host list. A vendor is identified by where the
 * request *went*, not by whom it mentions. */
export function trackerForUrl(url: string): TrackerSignature | undefined {
  let target = url;
  try {
    const parsed = new URL(url);
    target = `${parsed.host}${parsed.pathname}`;
  } catch {
    /* unparseable — fall back to the whole string rather than matching nothing */
  }
  return TRACKERS.find((t) => t.pattern.test(target));
}

export function vendorProfileForHost(host: string): VendorProfile | undefined {
  const domain = registrableDomain(host);
  return VENDOR_CATALOGUE.find((v) => v.key === domain || v.extraHosts?.test(host));
}

/** The inventory's vendor key for a URL.
 *
 * A catalogued tracker keys by its **tracker id**, not by its domain, because one vendor legitimately
 * serves from several registrable domains: Meta is `connect.facebook.net` *and* `facebook.com/tr`,
 * and Google Ads spans four. Keying by domain would split one vendor across four rows and make the
 * "fires despite consent" verdict read as though each fragment behaved differently.
 *
 * Everything else keys by registrable domain, which is also what a CMP rule is written against. */
export function vendorKeyForUrl(url: string): string | null {
  const tracker = trackerForUrl(url);
  if (tracker) return tracker.id;
  const host = hostFromUrl(url);
  if (!host) return null;
  const profile = vendorProfileForHost(host);
  return profile?.key ?? registrableDomain(host);
}

/** Cookie and storage keys attributable to a vendor, beyond what `categorizeCookie` handles.
 *
 * `categorizeCookie` answers "what category is this cookie?"; this answers "whose is it?", which
 * is what puts the cookie on the right inventory row. Keys nobody claims are reported on an
 * "unattributed" row rather than being dropped — an unexplained identity cookie is a finding.
 *
 * Values are inventory vendor keys in the same space `vendorKeyForUrl` returns: a tracker id
 * where the vendor is catalogued as a tracker, a registrable domain otherwise. A cookie landing
 * on a different key from its own vendor's requests would produce two rows for one vendor. */
const KEY_OWNERS: Array<[RegExp, string]> = [
  [/^_fbp$|^_fbc$/i, "meta"],
  [/^_gcl_|^_gac_/i, "google-ads"],
  [/^_ga$|^_ga_|^_gid$|^_gat/i, "ga4"],
  [/^_ttp$|^ttcsid|^tt_s?_?pixel|^tt_sessionId$|^tt_appInfo/i, "tiktok"],
  [/^_scid|^_sctr$|^_scsrid|^_scida/i, "snapchat"],
  [/^_pin_unauth/i, "pinterest"],
  [/^_uetsid|^_uetvid|^MUID$/i, "bing"],
  [/^_rdt_uuid$/i, "reddit"],
  [/^__kla_id$|^klaviyo/i, "klaviyo"],
  [/^_attn_/i, "attentive"],
  [/^_clck$|^_clsk$|^_cltk$/i, "clarity"],
  [/^_hj/i, "hotjar"],
  // StackAdapt's own identifiers. The page's `saCookies` global enumerates exactly these, which
  // is what attributes them — `sa-user-id` on its own is too generic a name to claim.
  [/^sa-user-id/i, "stackadapt"],
  [/^AMP_|^amp-exp-/i, "amplitude"],
  [/^__spdt$/i, "spotify-ads"],
  [/^TriplePixel$|^di_pmt_wt$/i, "triplewhale"],
  [/^___ELEVAR|^_elevar/i, "elevar"],
  [/^BVBRANDID$|^BVBRANDSID$/i, "bazaarvoice.com"],
  [/^_ruid$|^_rsession$/i, "rebuyengine.com"],
  [/^digioh|^dgdr$/i, "digioh.com"],
];

export function keyOwner(name: string): string | undefined {
  for (const [pattern, owner] of KEY_OWNERS) {
    if (pattern.test(name)) return owner;
  }
  return undefined;
}

/** What one browser state saw of one vendor.
 *
 * A distillation, not a request log. The engine holds every request — several hundred per state
 * across five states — and the inventory needs the vendor-level roll-up rather than the traffic.
 * Distilling here rather than storing the raw log keeps an archived scan a readable size while
 * preserving every fact the table's columns actually print. */
export interface VendorObservation {
  key: string;
  hosts: string[];
  /** Sent this vendor data about the visitor. */
  transmitted: boolean;
  /** Only fetched its library. */
  scriptLoaded: boolean;
  /** Script URLs observed causing this vendor's requests. */
  initiators: string[];
  /** One transmission URL, kept as the evidence the row's verdict rests on. */
  sampleTransmission?: string;
}

/** The minimum an observation needs about a request. Structural rather than importing the
 * engine's `ObservedRequest`, so this module stays a leaf and the engine can import from it. */
export interface RequestLike {
  url: string;
  completed: boolean;
  initiator?: string[];
}

/** Rolls a state's request log up into one observation per vendor.
 *
 * `firstPartyHost` is dropped, as are the platform and content CDNs: the client asked which third
 * parties are on their site, and an inventory whose first fifteen rows are Shopify's own
 * infrastructure buries the six that matter.
 *
 * **Known blind spot.** A vendor CNAMEd onto the site's own domain — `data.shop.example.com`
 * resolving to a tracker — is first-party by hostname and matches no vendor pattern, so nothing
 * here distinguishes it from the shop's own endpoints and it will be dropped. Keeping every
 * first-party host instead would fill the table with the site's own asset and API routes. A
 * catalogued vendor is still kept when it appears on a first-party host, which covers the common
 * case of a *separate* vendor-owned domain used as a first-party CNAME; catching a genuinely
 * cloaked subdomain needs a DNS lookup the scanner does not do. */
export function observeVendors(
  requests: RequestLike[],
  firstPartyHost: string,
  classify: (url: string) => "script" | "transmission",
): VendorObservation[] {
  const byKey = new Map<string, VendorObservation>();
  const firstParty = registrableDomain(firstPartyHost);

  for (const req of requests) {
    if (!req.completed) continue;
    const host = hostFromUrl(req.url);
    if (!host) continue;
    if (isInfrastructureHost(host)) continue;

    const key = vendorKeyForUrl(req.url);
    if (!key) continue;
    // The site's own domain is dropped only when nothing else claims it. A catalogued tracker or a
    // known vendor served from a first-party subdomain is a CNAME-cloaked third party, and
    // dropping it would hide the row most worth showing.
    if (registrableDomain(host) === firstParty && !trackerForUrl(req.url) && !vendorProfileForHost(host)) continue;

    let obs = byKey.get(key);
    if (!obs) {
      obs = { key, hosts: [], transmitted: false, scriptLoaded: false, initiators: [] };
      byKey.set(key, obs);
    }
    if (!obs.hosts.includes(host)) obs.hosts.push(host);
    for (const init of req.initiator ?? []) {
      const initHost = hostFromUrl(init);
      // A vendor's own library appearing as its own initiator says nothing about how it got here.
      if (initHost && registrableDomain(initHost) === registrableDomain(host)) continue;
      if (!obs.initiators.includes(init) && obs.initiators.length < 6) obs.initiators.push(init);
    }
    if (classify(req.url) === "transmission") {
      obs.transmitted = true;
      obs.sampleTransmission ??= req.url;
    } else {
      obs.scriptLoaded = true;
    }
  }

  return Array.from(byKey.values());
}

/** Name, purpose and category for a vendor key, from whichever catalogue holds it.
 *
 * Returns undefined for a key in neither, which is the signal that the model has to supply a
 * purpose — and that the row must be labelled as inferred when it does. */
export function profileForKey(key: string): { name: string; purpose: string; category: TrackerCategory } | undefined {
  const tracker = TRACKERS.find((t) => t.id === key);
  if (tracker) return { name: tracker.name, purpose: tracker.purpose, category: tracker.category };
  const profile = VENDOR_CATALOGUE.find((v) => v.key === key);
  if (profile) return { name: profile.name, purpose: profile.purpose, category: profile.category };
  return undefined;
}
