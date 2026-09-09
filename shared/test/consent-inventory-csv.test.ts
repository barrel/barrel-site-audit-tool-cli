// The inventory's CSV export.
//
// Lives under shared/test/ because that (with cli/test/) is where the harness looks; the code it
// exercises is web/lib/consent-inventory-csv.ts, which is pure TypeScript with no React and no
// Next runtime — the same reason data-analysis.test.ts reaches across into web/.
//
// Worth testing rather than eyeballing: this file is the deliverable a client opens in Sheets, and
// every way a CSV goes wrong is silent. An unquoted comma shifts every later column on that row
// and the reader sees a plausible table with the wrong values in it — no error, no warning.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toCsv } from "../../web/lib/consent-inventory-csv.js";
import type { ConsentInventory, InventoryVendor } from "../../web/lib/shared.js";

function vendor(over: Partial<InventoryVendor> = {}): InventoryVendor {
  return {
    key: "meta",
    name: "Meta Pixel",
    purpose: "Ad conversion tracking",
    purposeSource: "catalogue",
    observedCategory: "marketing",
    hosts: ["connect.facebook.net", "www.facebook.com"],
    load: { mechanism: "theme-head", description: "Hardcoded in theme <head>" },
    cookies: ["_fbp"],
    storageKeys: [],
    classifiedCorrectly: "unknown",
    transmittedIn: ["clean"],
    scriptLoadedIn: [],
    firesBeforeConsent: true,
    firesDespiteRejection: false,
    consentBehaviour: "YES — transmits on a clean load, before any choice",
    severity: "high",
    ...over,
  };
}

function inventory(over: Partial<ConsentInventory> = {}): ConsentInventory {
  return {
    vendors: [vendor()],
    shopifyPixels: [],
    fixPlan: [],
    opportunities: [],
    aiGenerated: true,
    ...over,
  };
}

/** Splits one CSV record into its fields, honouring quotes. A deliberately independent
 * implementation — asserting against the same quoting logic that produced the string would prove
 * nothing about whether a spreadsheet can read it. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** The header row of the vendor table, and the row after it. */
function vendorTable(csv: string): { header: string[]; first: string[] } {
  const lines = csv.split("\r\n");
  const at = lines.findIndex((l) => l.startsWith('"Vendor"'));
  assert.notEqual(at, -1, "expected a vendor header row");
  return { header: fields(lines[at]), first: fields(lines[at + 1]) };
}

describe("inventory CSV", () => {
  it("survives a fix containing commas, quotes and a newline", () => {
    // A recommended fix is a sentence written by a model. It will contain commas, it may quote a
    // config value, and nothing stops it containing a line break.
    const csv = toCsv(
      inventory({
        vendors: [
          vendor({
            recommendedFix: 'Set privacyPurposes = ANALYTICS, MARKETING on pixel "1434583097".\nThen redeploy.',
          }),
        ],
      }),
      "Cabot Creamery",
      "scan-1",
    );
    const { header, first } = vendorTable(csv);
    assert.equal(first.length, header.length, "the row must have exactly as many fields as the header");
    const fixColumn = first[header.indexOf("Recommended fix")];
    assert.match(fixColumn, /privacyPurposes = ANALYTICS, MARKETING/);
    assert.match(fixColumn, /"1434583097"/);
    assert.match(fixColumn, /\nThen redeploy\./);
  });

  it("keeps a multi-host vendor in one field", () => {
    const csv = toCsv(inventory(), "Cabot Creamery", "scan-1");
    const { header, first } = vendorTable(csv);
    assert.equal(first.length, header.length);
    assert.equal(first[header.indexOf("Hosts")], "connect.facebook.net; www.facebook.com");
  });

  it("marks an inferred purpose in the cell itself", () => {
    // The label has to travel with the data. A client forwarding this sheet to a vendor must be
    // able to see which purposes we established and which were inferred from a hostname.
    const csv = toCsv(
      inventory({ vendors: [vendor({ purposeSource: "inferred", purpose: "Unidentified ID sync" })] }),
      "Cabot",
      "scan-1",
    );
    const { header, first } = vendorTable(csv);
    assert.match(first[header.indexOf("Purpose / Category")], /\(inferred\)/);
  });

  it("names the classification source in the column header when there is one", () => {
    const withSource = toCsv(inventory({ classificationSource: "Osano (live us-fl ruleset)" }), "C", "s");
    assert.ok(vendorTable(withSource).header.includes("Osano (live us-fl ruleset) classification"));

    const without = toCsv(inventory({ classificationUnavailable: "Nothing readable." }), "C", "s");
    assert.ok(vendorTable(without).header.includes("CMP classification"));
  });

  it("says up front that an unreadable classification is not a finding", () => {
    // The same honesty rule the on-screen table follows. A client must not read forty "Not
    // readable" cells as forty problems with their configuration.
    const csv = toCsv(
      inventory({ classificationUnavailable: "No consent classification could be read from Shopify Customer Privacy." }),
      "Cabot",
      "scan-1",
    );
    assert.match(csv, /reports nothing about this site's configuration either way/);
  });

  it("says when purposes and fixes were not generated", () => {
    const csv = toCsv(inventory({ aiGenerated: false, aiError: "ANTHROPIC_API_KEY not set." }), "C", "s");
    assert.match(csv, /Purposes and fixes were not generated: ANTHROPIC_API_KEY not set\./);
  });

  it("flags a pixel gated on nothing in the pixel table", () => {
    const csv = toCsv(
      inventory({
        shopifyPixels: [
          { id: "2518843449", type: "APP", runtimeContext: "STRICT", privacyPurposes: [] },
          { id: "1434583097", type: "APP", runtimeContext: "STRICT", privacyPurposes: ["ANALYTICS"], vendorKey: "meta" },
        ],
      }),
      "Cabot",
      "scan-1",
    );
    assert.match(csv, /NONE — runs regardless of consent/);
    // An attributed pixel resolves to the vendor's display name, not its internal key.
    assert.match(csv, /"Meta Pixel"/);
  });

  it("keeps opportunities labelled as not being compliance fixes", () => {
    const csv = toCsv(
      inventory({
        opportunities: [{ title: "Consent Mode v2", detail: "Model the rejected traffic.", requires: "Step 1" }],
      }),
      "Cabot",
      "scan-1",
    );
    assert.match(csv, /NOT compliance fixes/);
    assert.match(csv, /"Requires first"/);
  });

  it("resolves a fix step's vendor keys to names", () => {
    const csv = toCsv(
      inventory({
        fixPlan: [
          { order: 1, title: "Gate the pixel", detail: "Move it behind consent.", owner: "Theme developer", effort: "quick", vendors: ["meta"] },
        ],
      }),
      "Cabot",
      "scan-1",
    );
    const line = csv.split("\r\n").find((l) => l.includes("Gate the pixel"));
    assert.ok(line, "expected the fix step row");
    assert.match(line, /"Meta Pixel"/);
  });

  it("emits CRLF line endings and no bare newline outside a quoted field", () => {
    const csv = toCsv(inventory({ vendors: [vendor({ recommendedFix: "One.\nTwo." })] }), "C", "s");
    // Every record separator is a CRLF; the LF inside the fix is quoted, so stripping quoted
    // spans must leave no stray LF behind.
    const unquoted = csv.replace(/"(?:[^"]|"")*"/g, "");
    assert.doesNotMatch(unquoted, /(?<!\r)\n/, "found a bare LF outside a quoted field");
  });
});
