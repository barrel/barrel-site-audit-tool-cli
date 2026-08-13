/** Shopify theme-preview links (an unpublished-theme URL carrying `preview_theme_id`) render a
 * floating preview bar that injects extra DOM/script into the page and can redirect/rewrite the
 * initial request — both skew Lighthouse's layout-shift and load-timing metrics versus what a
 * real visitor sees on the published theme. Shopify's own preview bar respects `pb=0` to turn
 * itself off; append it whenever we detect a preview link, and leave every other URL untouched. */
export function normalizeAuditUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isShopifyPreview = /(^|\.)myshopify\.com$/i.test(parsed.hostname) && parsed.searchParams.has("preview_theme_id");
    if (isShopifyPreview) parsed.searchParams.set("pb", "0");
    return parsed.toString();
  } catch {
    return url;
  }
}
