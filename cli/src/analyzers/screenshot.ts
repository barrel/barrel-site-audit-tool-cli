import * as chromeLauncher from "chrome-launcher";
import type { Page } from "puppeteer-core";

// `networkidle2` at goto() only means the network settled — it says nothing about JS/
// IntersectionObserver-based lazy-loaded sections (extremely common in Shopify themes), which
// never even start loading their real image/height until scrolled into view. Without this,
// fullPage screenshots come out with correct-but-inflated height (the lazy sections' real,
// eventual height) full of gray placeholder boxes where the never-triggered images would be.
// Scrolling all the way down first — in steps, matching how a real visitor would encounter the
// page — fires those loaders for every section before the shot is taken.
// Exported because the CRO capture (analyzers/cro/capture.ts) takes a dozen full-page shots per
// run and needs exactly this treatment. A second implementation there would have been the same
// lazy-load bug rediscovered from scratch.
export async function autoScrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Resolves once every currently-present <img> has finished loading (or errored) — bounded by
 * the caller's own timeout race, not this function, so one stuck image can't hang the capture. */
export async function waitForImages(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        })),
    ),
  );
}

/** Captures a full-page mobile-viewport screenshot (JPEG) of the given URL.
 * Returns null (never throws) so a screenshot failure never fails the whole audit. */
export async function captureScreenshot(url: string): Promise<Buffer | null> {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 2 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      await autoScrollToBottom(page);
      // Race, not a plain await — a single lazy embed (a chat widget iframe, a broken third-party
      // image) with no load/error signal should degrade to "good enough" rather than time out the
      // whole screenshot.
      await Promise.race([waitForImages(page), new Promise((resolve) => setTimeout(resolve, 4000))]);

      const buffer = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true });
      return Buffer.from(buffer);
    } finally {
      await browser.disconnect();
    }
  } catch {
    return null;
  } finally {
    await chrome.kill();
  }
}
