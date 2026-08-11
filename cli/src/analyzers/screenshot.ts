import * as chromeLauncher from "chrome-launcher";

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
