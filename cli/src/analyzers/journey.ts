/** Discovers the small set of pages that carry a Shopify shopping journey — shared by
 * performance.ts (Lighthouse) and accessibility.ts (axe-core), so both analyzers scan the
 * exact same page set without duplicating the discovery logic. */
export interface JourneyPage {
  page: string;
  url: string;
}

async function urlIsReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "follow", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function discoverJourneyPages(baseUrl: string): Promise<JourneyPage[]> {
  const base = new URL(baseUrl);
  // A Shopify theme-preview link's realism lives entirely in its query string
  // (preview_theme_id/key/pb) — carry it onto every discovered page, not just Home, or
  // Collection/Product/Cart silently fall back to auditing the LIVE published theme instead.
  const withPreview = (path: string, extraParams?: Record<string, string>) => {
    const u = new URL(path, base);
    for (const [key, value] of base.searchParams) u.searchParams.set(key, value);
    if (extraParams) for (const [key, value] of Object.entries(extraParams)) u.searchParams.set(key, value);
    return u.toString();
  };

  const pages: JourneyPage[] = [{ page: "Home", url: baseUrl }];

  const collectionUrl = withPreview("/collections/all");
  if (await urlIsReachable(collectionUrl)) {
    pages.push({ page: "Collection", url: collectionUrl });
  }

  try {
    const res = await fetch(withPreview("/products.json", { limit: "1" }), { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { products?: Array<{ handle?: string }> };
      const handle = data.products?.[0]?.handle;
      if (handle) pages.push({ page: "Product", url: withPreview(`/products/${handle}`) });
    }
  } catch {
    // no products.json or no products — skip the PDP page
  }

  pages.push({ page: "Cart", url: withPreview("/cart") });

  return pages;
}
