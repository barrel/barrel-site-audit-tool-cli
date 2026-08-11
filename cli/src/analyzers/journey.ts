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
  const origin = new URL(baseUrl).origin;
  const pages: JourneyPage[] = [{ page: "Home", url: baseUrl }];

  const collectionUrl = `${origin}/collections/all`;
  if (await urlIsReachable(collectionUrl)) {
    pages.push({ page: "Collection", url: collectionUrl });
  }

  try {
    const res = await fetch(`${origin}/products.json?limit=1`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { products?: Array<{ handle?: string }> };
      const handle = data.products?.[0]?.handle;
      if (handle) pages.push({ page: "Product", url: `${origin}/products/${handle}` });
    }
  } catch {
    // no products.json or no products — skip the PDP page
  }

  pages.push({ page: "Cart", url: `${origin}/cart` });

  return pages;
}
