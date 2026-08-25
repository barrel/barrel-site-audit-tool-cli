// Which URL stands for each page group on this storefront.
//
// The site audit's discoverJourneyPages() (analyzers/journey.ts) answers a narrower version of this
// question — it wants *a* collection and *a* product so Lighthouse and axe have somewhere to run.
// A CRO audit is going to put these pages in front of a client and argue about them, so which one
// gets picked matters:
//
//  - /collections/all is the wrong PLP. Plenty of themes disable it, and where it works it is a
//    firehose with none of the merchandising a real collection has. The largest published
//    collection is what a shopper actually browses.
//  - The first product in products.json is the wrong PDP. It is whatever sorts first, which is
//    usually a gift card or an oldest-first archive item. The product with the most GA4 views is
//    the page the client's traffic is actually landing on, and the one worth reviewing.
//  - The cart has to have something in it. An empty cart page is a page that says "your cart is
//    empty" and nothing else, and a slide about it would be worthless.

import type { CroBrief, CroPageGroup } from "@barrel/site-audit-shared";

export interface CroTarget {
  group: CroPageGroup;
  url: string;
  /** For the cart and checkout groups: the variant to put in the cart first, via the storefront's
   * own AJAX cart API from inside the page. Without it the cart renders empty. */
  variantId?: number;
  /** Nav is captured on the home page with the menu opened rather than at a URL of its own. */
  openMenu?: boolean;
}

export interface DiscoverOptions {
  groups: readonly CroPageGroup[];
  brief?: CroBrief;
  /** Product handle with the most GA4 views, when a property is linked. The whole reason the
   * analytics step is worth running before the capture. */
  topProductHandle?: string;
  onNote?: (note: string) => void;
}

/** A Shopify theme-preview link's realism lives entirely in its query string
 * (preview_theme_id/key/pb) — carry it onto every discovered page, or every group but Home
 * silently audits the LIVE published theme instead. Same reasoning as journey.ts. */
function withPreview(base: URL, path: string, extraParams?: Record<string, string>): string {
  const u = new URL(path, base);
  for (const [key, value] of base.searchParams) u.searchParams.set(key, value);
  if (extraParams) for (const [key, value] of Object.entries(extraParams)) u.searchParams.set(key, value);
  return u.toString();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface ShopifyCollection {
  handle?: string;
  title?: string;
  products_count?: number;
}

interface ShopifyProduct {
  handle?: string;
  title?: string;
  variants?: Array<{ id?: number; available?: boolean }>;
}

/** The largest published collection, by product count.
 *
 * Falls back to /collections/all only when collections.json is unavailable — some stores disable
 * it — and the caller records that fallback as a limitation, because a PLP slide about
 * /collections/all is a slide about a page the merchandiser never touched. */
async function findCollection(base: URL, onNote?: (note: string) => void): Promise<string | null> {
  const data = await fetchJson<{ collections?: ShopifyCollection[] }>(
    withPreview(base, "/collections.json", { limit: "250" }),
  );
  const collections = (data?.collections ?? []).filter((c) => c.handle && (c.products_count ?? 0) > 0);
  if (collections.length > 0) {
    collections.sort((a, b) => (b.products_count ?? 0) - (a.products_count ?? 0));
    const best = collections[0];
    onNote?.(`PLP: /collections/${best.handle} (${best.products_count} products, the largest published collection)`);
    return withPreview(base, `/collections/${best.handle}`);
  }

  const fallback = withPreview(base, "/collections/all");
  if (await urlIsReachable(fallback)) {
    onNote?.("PLP: /collections/all — collections.json listed nothing, so the catch-all collection was used instead.");
    return fallback;
  }
  return null;
}

/** The product to review, and a variant of it that can actually be added to a cart. */
async function findProduct(
  base: URL,
  topProductHandle: string | undefined,
  onNote?: (note: string) => void,
): Promise<{ url: string; handle: string; variantId?: number } | null> {
  const candidates: string[] = [];
  if (topProductHandle) candidates.push(topProductHandle);

  if (candidates.length === 0 || !topProductHandle) {
    const data = await fetchJson<{ products?: ShopifyProduct[] }>(withPreview(base, "/products.json", { limit: "20" }));
    for (const product of data?.products ?? []) {
      if (product.handle) candidates.push(product.handle);
    }
  }

  for (const handle of candidates) {
    // The per-product .js endpoint, not the listing: it carries the variant ids, and it confirms
    // the handle is real before a screenshot is taken of a 404.
    const product = await fetchJson<ShopifyProduct>(withPreview(base, `/products/${handle}.js`));
    if (!product?.handle) continue;
    const variant = product.variants?.find((v) => v.available && v.id) ?? product.variants?.find((v) => v.id);
    if (handle === topProductHandle) {
      onNote?.(`PDP: /products/${handle} — the most-viewed product in GA4 over the analysis window.`);
    } else {
      onNote?.(`PDP: /products/${handle} — GA4 was not available, so the first purchasable product was used.`);
    }
    return { url: withPreview(base, `/products/${handle}`), handle, variantId: variant?.id };
  }
  return null;
}

async function urlIsReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "follow", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** A search term the store will actually return results for — a word from a real product title.
 * A hardcoded term ("shirt") produces an empty results page on most stores, and a slide about an
 * empty search page says nothing about the search experience. */
function searchTermFrom(productTitle: string | undefined): string {
  const word = (productTitle ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""))
    .filter((w) => w.length > 3)[0];
  return word || "gift";
}

export interface DiscoverResult {
  targets: CroTarget[];
  /** Groups that could not be resolved to a page, and why. Carried into the report so a missing
   * slide is explained rather than absent. */
  limitations: string[];
}

export async function discoverCroPages(baseUrl: string, options: DiscoverOptions): Promise<DiscoverResult> {
  const base = new URL(baseUrl);
  const wanted = new Set(options.groups);
  const targets: CroTarget[] = [];
  const limitations: string[] = [];
  const overrides = options.brief?.pageUrls ?? {};

  // Resolved up front because three groups need them: the PDP itself, the cart (a variant to add)
  // and search (a term the catalogue will match).
  const needsProduct = wanted.has("pdp") || wanted.has("cart") || wanted.has("checkout") || wanted.has("search");
  const product = needsProduct ? await findProduct(base, options.topProductHandle, options.onNote) : null;
  const productTitle = product
    ? (await fetchJson<ShopifyProduct>(withPreview(base, `/products/${product.handle}.js`)))?.title
    : undefined;

  const add = (group: CroPageGroup, url: string | null, extra: Partial<CroTarget> = {}) => {
    const override = overrides[group];
    const resolved = override ?? url;
    if (!resolved) {
      limitations.push(`No ${group.toUpperCase()} page could be discovered on this storefront, so it has no slide.`);
      return;
    }
    if (override) options.onNote?.(`${group.toUpperCase()}: ${override} (from the client brief)`);
    targets.push({ group, url: resolved, ...extra });
  };

  if (wanted.has("nav")) add("nav", baseUrl, { openMenu: true });
  if (wanted.has("home")) add("home", baseUrl);
  if (wanted.has("plp")) add("plp", await findCollection(base, options.onNote));
  if (wanted.has("pdp")) add("pdp", product?.url ?? null);

  if (wanted.has("cart")) {
    if (!product?.variantId) {
      limitations.push(
        "The cart was captured without a product in it: no purchasable variant could be found to add, so the page shown is the empty-cart state.",
      );
      add("cart", withPreview(base, "/cart"));
    } else {
      add("cart", withPreview(base, "/cart"), { variantId: product.variantId });
    }
  }

  if (wanted.has("checkout")) {
    if (!product?.variantId) {
      limitations.push("Checkout could not be captured: reaching it needs an item in the cart, and no purchasable variant was found.");
    } else {
      add("checkout", withPreview(base, "/checkout"), { variantId: product.variantId });
    }
  }

  if (wanted.has("search")) {
    add("search", withPreview(base, "/search", { q: searchTermFrom(productTitle) }));
  }

  return { targets, limitations };
}
