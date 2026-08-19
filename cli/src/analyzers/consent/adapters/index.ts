import type { Page } from "puppeteer-core";
import type { CmpVendor } from "@barrel/site-audit-shared";
import type { CmpAdapter } from "./types.js";
import { cookiebotAdapter } from "./cookiebot.js";
import { onetrustAdapter } from "./onetrust.js";
import { osanoAdapter } from "./osano.js";
import { cookieyesAdapter } from "./cookieyes.js";
import { shopifyAdapter } from "./shopify.js";
import { heuristicAdapter } from "./heuristic.js";

export * from "./types.js";

/** Order matters. Vendor CMPs come first because a store can have both a real CMP *and* the
 * Shopify Customer Privacy API present — in that case the vendor CMP is the thing a shopper
 * actually interacts with, and driving Shopify's API directly would bypass the banner under test.
 * heuristic is last for the same reason: it would happily match a vendor banner. */
const ADAPTERS: CmpAdapter[] = [cookiebotAdapter, onetrustAdapter, osanoAdapter, cookieyesAdapter, shopifyAdapter, heuristicAdapter];

export function adapterFor(vendor: CmpVendor): CmpAdapter | null {
  return ADAPTERS.find((a) => a.id === vendor) ?? null;
}

/** Which CMP is on this page? `expected` short-circuits detection when sites.yml already records
 * the vendor — not just faster, but more reliable on a store where two CMP globals coexist. */
export async function detectCmp(page: Page, expected?: CmpVendor | "unknown"): Promise<CmpAdapter | null> {
  if (expected && expected !== "unknown" && expected !== "none") {
    const pinned = adapterFor(expected);
    if (pinned && (await pinned.detect(page).catch(() => false))) return pinned;
  }
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(page).catch(() => false)) return adapter;
  }
  return null;
}
