import * as chromeLauncher from "chrome-launcher";
import type { PixelFinding, PixelPlatformResult, PixelSection, PixelStatus } from "@barrel/site-audit-shared";

interface PlatformSignature {
  id: string;
  name: string;
  networkPattern: RegExp;
  inlinePattern: RegExp;
}

const PLATFORMS: PlatformSignature[] = [
  {
    id: "meta",
    name: "Meta Pixel",
    networkPattern: /connect\.facebook\.net|facebook\.com\/tr/i,
    inlinePattern: /fbq\s*\(/i,
  },
  {
    id: "google",
    name: "Google Ads + GA4",
    networkPattern: /googletagmanager\.com\/gtag|google-analytics\.com\/g\/collect|googleadservices\.com/i,
    inlinePattern: /gtag\s*\(/i,
  },
  {
    id: "clarity",
    name: "Microsoft Clarity",
    networkPattern: /clarity\.ms/i,
    inlinePattern: /clarity\s*\(/i,
  },
  {
    id: "tiktok",
    name: "TikTok Pixel",
    networkPattern: /analytics\.tiktok\.com/i,
    inlinePattern: /ttq\./i,
  },
  {
    id: "pinterest",
    name: "Pinterest Tag",
    networkPattern: /ct\.pinterest\.com/i,
    inlinePattern: /pintrk\s*\(/i,
  },
];

const CONSENT_SIGNALS = [
  /onetrust/i,
  /optanon/i,
  /cookiebot/i,
  /cookie-consent/i,
  /gdpr-consent/i,
  /shopify\.customerprivacy/i,
  /trackingconsentaccepted/i,
];

export async function analyzePixels(url: string): Promise<PixelSection> {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  const requestUrls: string[] = [];
  let html = "";

  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });
    try {
      const page = await browser.newPage();
      page.on("request", (req) => requestUrls.push(req.url()));

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      html = await page.content().catch(() => "");
    } finally {
      await browser.disconnect();
    }
  } finally {
    await chrome.kill();
  }

  const networkHaystack = requestUrls.join("\n");

  const platforms: PixelPlatformResult[] = PLATFORMS.map((p) => {
    const firing = p.networkPattern.test(networkHaystack);
    const configured = !firing && (p.networkPattern.test(html) || p.inlinePattern.test(html));
    const status: PixelStatus = firing ? "firing" : configured ? "configured" : "not-found";
    const detail =
      status === "firing"
        ? "Network request(s) detected during page load."
        : status === "configured"
          ? "Referenced in page code but no network request observed."
          : "No reference found in code or network traffic.";
    return { id: p.id, name: p.name, status, detail };
  });

  const consentMechanismDetected = CONSENT_SIGNALS.some((re) => re.test(html));

  const findings: PixelFinding[] = [];
  // Whether consent actually *works* is the Privacy Compliance section's job — it drives the banner
  // through five browser states, where this analyzer only ever sees one unclicked page load.
  // Duplicating a verdict here would let the two sections contradict each other in the same
  // report, so this one now reports presence and stops there.
  const firingPlatforms = platforms.filter((p) => p.status === "firing");
  if (firingPlatforms.length > 0 && !consentMechanismDetected) {
    findings.push({
      severity: "error",
      title: "Marketing pixels fire without a cookie-consent mechanism",
      detail: `${firingPlatforms.map((p) => p.name).join(", ")} fired on page load with no consent banner or Shopify Customer Privacy API usage detected. See the Privacy Compliance section for the behavioural detail.`,
      recommendation:
        "Migrate pixel tracking to Shopify's Customer Events (Settings > Customer events > Add custom pixel), which auto-gates firing behind the Customer Privacy API, or install a consent-management app (OneTrust, Cookiebot) configured to block marketing pixels until consent is granted.",
    });
  }

  const metaPlatform = platforms.find((p) => p.id === "meta");
  if (metaPlatform?.status === "firing" && /fbq\s*\(/i.test(html)) {
    findings.push({
      severity: "warning",
      title: "Meta Pixel called directly from page code",
      detail: "An inline fbq() call was found in the page HTML — verify this isn't bypassing Shopify's native Customer Privacy API controls.",
      recommendation:
        "Remove the hardcoded fbq() snippet from theme.liquid or the app block that injects it, and replace it with the Meta Pixel via Settings > Customer events > Add custom pixel — this routes consent state through Shopify's Customer Privacy API automatically instead of firing unconditionally.",
    });
  }

  const penalty = findings.reduce((sum, f) => sum + (f.severity === "error" ? 40 : f.severity === "warning" ? 15 : 5), 0);
  const score = Math.max(0, 100 - penalty);

  return { score, platforms, consentMechanismDetected, findings };
}
