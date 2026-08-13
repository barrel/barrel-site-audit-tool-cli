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

// Every report is timestamped by the CLI operator's run, and the team is Eastern-based —
// render consistently in America/New_York (handles EST/EDT automatically) rather than
// whatever timezone the Vercel serverless function happens to be running in (UTC).
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}
