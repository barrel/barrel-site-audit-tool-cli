// Lighthouse audit descriptions contain markdown links like "[Learn more](url).";
// strip them down to plain text for display outside a markdown renderer.
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// Pulls the URL out of a Lighthouse audit description's "[Learn more](url)" link, if present,
// so it can be surfaced as remediation guidance instead of being discarded by stripMarkdownLinks.
export function extractMarkdownLinkUrl(text: string): string | undefined {
  return text.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/)?.[1];
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
