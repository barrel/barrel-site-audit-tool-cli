import type { ConsentInventory, InventoryVendor } from "./shared";

/** RFC 4180 quoting.
 *
 * Every field is quoted rather than only the ones that need it. Inventory cells routinely contain
 * commas, semicolons and newlines — a recommended fix is a sentence, and a host list is
 * comma-separated — and conditional quoting is where CSV exports break: one unquoted comma shifts
 * every subsequent column on that row, silently, and the reader sees a plausible table with the
 * wrong values in it. */
function cell(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** The declared-classification cell, matching what the on-screen table shows. */
function declaredText(v: InventoryVendor): string {
  if (!v.declared) return "Not readable";
  if (v.declared.category) {
    return v.declared.conflict ? `${v.declared.category} — ${v.declared.conflict}` : v.declared.category;
  }
  return v.declared.absent ?? "Not classified";
}

const VERDICT_LABEL: Record<InventoryVendor["classifiedCorrectly"], string> = {
  correct: "Yes",
  incorrect: "No",
  partly: "Partly",
  unclassified: "No rule",
  unknown: "Not readable",
};

/** The inventory as a spreadsheet.
 *
 * The client asks for this deliverable as "a Google sheet or doc", and a CSV is what actually gets
 * there: Sheets imports it directly, and the columns arrive in the same order as the on-screen
 * table so the two are recognisably the same artifact.
 *
 * Sections are stacked into one file rather than split across several endpoints — the vendor table,
 * the pixel registry, the plan and the opportunities — because the whole point is that one download
 * is the deliverable. Sheets renders the blank-line separators as empty rows, which is exactly how
 * a human would lay this out by hand. */
export function toCsv(inventory: ConsentInventory, siteLabel: string, scannedAt: string): string {
  const rows: string[] = [];

  rows.push([cell(`Cookie & script inventory — ${siteLabel}`)].join(","));
  rows.push([cell(`Scanned ${scannedAt}`)].join(","));
  rows.push(
    [
      cell(
        inventory.classificationSource
          ? `Declared classifications read from ${inventory.classificationSource}`
          : `No CMP classification readable — ${inventory.classificationUnavailable ?? "reason not recorded"}. The "Classified correctly?" column reports nothing about this site's configuration either way.`,
      ),
    ].join(","),
  );
  rows.push(
    [
      cell(
        inventory.aiGenerated
          ? "Vendor, load mechanism, cookies, storage, declared classification, consent behaviour and severity are observations from the scan. Purposes marked (inferred), recommended fixes and the plan were written by a model from those observations."
          : `Vendor, load mechanism, cookies, storage, declared classification, consent behaviour and severity are observations from the scan. Purposes and fixes were not generated${inventory.aiError ? `: ${inventory.aiError}` : "."}`,
      ),
    ].join(","),
  );
  rows.push("");

  rows.push(
    [
      "Vendor",
      "Purpose / Category",
      "How it loads",
      "Cookies & storage observed",
      inventory.classificationSource ? `${inventory.classificationSource} classification` : "CMP classification",
      "Classified correctly?",
      "Fires before / despite consent?",
      "Severity",
      "Notes",
      "Recommended fix",
      "Hosts",
    ]
      .map(cell)
      .join(","),
  );

  for (const v of inventory.vendors) {
    const storage = [...v.cookies, ...v.storageKeys].join("; ");
    rows.push(
      [
        cell(v.name),
        cell(
          `${v.purpose || "Not identified"}${v.purposeSource === "inferred" ? " (inferred)" : ""} — ${v.observedCategory}`,
        ),
        cell(v.load.description),
        cell(storage || "None observed"),
        cell(declaredText(v)),
        cell(VERDICT_LABEL[v.classifiedCorrectly]),
        cell(v.consentBehaviour),
        cell(v.severity === "none" ? "" : v.severity.toUpperCase()),
        cell((v.notes ?? []).join(" ")),
        cell(v.recommendedFix ?? ""),
        cell(v.hosts.join("; ")),
      ].join(","),
    );
  }

  if (inventory.shopifyPixels.length > 0) {
    rows.push("");
    rows.push([cell("Shopify web pixels (from the storefront's pixel registry)")].join(","));
    rows.push(
      ["Pixel ID", "Type", "Runtime context", "privacyPurposes", "Attributed to", "Configuration"].map(cell).join(","),
    );
    for (const p of inventory.shopifyPixels) {
      rows.push(
        [
          cell(p.id),
          cell(p.type),
          cell(p.runtimeContext),
          cell(p.privacyPurposes.length === 0 ? "NONE — runs regardless of consent" : p.privacyPurposes.join(" + ")),
          cell(p.vendorKey ? (inventory.vendors.find((v) => v.key === p.vendorKey)?.name ?? p.vendorKey) : "Not attributed"),
          cell(p.configuration ?? ""),
        ].join(","),
      );
    }
  }

  if (inventory.fixPlan.length > 0) {
    rows.push("");
    rows.push([cell("Plan to complete the fixes")].join(","));
    rows.push(["#", "Step", "Detail", "Owner", "Effort", "Vendors"].map(cell).join(","));
    for (const step of inventory.fixPlan) {
      rows.push(
        [
          cell(step.order),
          cell(step.title),
          cell(step.detail),
          cell(step.owner ?? ""),
          cell(step.effort ?? ""),
          cell(step.vendors.map((k) => inventory.vendors.find((v) => v.key === k)?.name ?? k).join("; ")),
        ].join(","),
      );
    }
  }

  if (inventory.opportunities.length > 0) {
    rows.push("");
    rows.push(
      [
        cell(
          "Compliant ways to collect more — NOT compliance fixes; nothing here substitutes for the plan above",
        ),
      ].join(","),
    );
    rows.push(["Opportunity", "Detail", "Requires first"].map(cell).join(","));
    for (const o of inventory.opportunities) {
      rows.push([cell(o.title), cell(o.detail), cell(o.requires ?? "")].join(","));
    }
  }

  return rows.join("\r\n");
}
