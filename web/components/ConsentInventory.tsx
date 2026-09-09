import type {
  ClassificationVerdict,
  ConsentInventory as Inventory,
  InventorySeverity,
  InventoryVendor,
} from "@/lib/shared";

const SEVERITY_LABEL: Record<InventorySeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "—",
};
const SEVERITY_COLOR: Record<InventorySeverity, string> = {
  critical: "#B91C1C",
  high: "#EA580C",
  medium: "#D97706",
  low: "#6B6B6B",
  none: "#9A9A9A",
};

/** The verdict wording is deliberately not a bare yes/no.
 *
 * "Not readable" and "No rule" both leave the client without an answer, but only the second is a
 * finding about their configuration — and a column that rendered them identically would invite a
 * client to fix something that isn't broken, or to trust a gap we simply couldn't see into. */
const VERDICT_LABEL: Record<ClassificationVerdict, string> = {
  correct: "Yes",
  incorrect: "No",
  partly: "Partly",
  unclassified: "No rule",
  unknown: "Not readable",
};
const VERDICT_COLOR: Record<ClassificationVerdict, string> = {
  correct: "#10B981",
  incorrect: "#B91C1C",
  partly: "#D97706",
  unclassified: "#EA580C",
  unknown: "#9A9A9A",
};

function declaredText(v: InventoryVendor): string {
  if (!v.declared) return "Not readable";
  if (v.declared.category) {
    return v.declared.conflict ? `${v.declared.category} — ${v.declared.conflict}` : v.declared.category;
  }
  return v.declared.absent ?? "Not classified";
}

/** The vendor inventory — the "take stock of every cookie and script" deliverable.
 *
 * One row per vendor rather than per host or per cookie, because that is the unit a client acts
 * on: a CMP rule is written against a domain, a theme edit removes one script tag, and a Shopify
 * pixel is configured once. Klaviyo's five hosts are one decision, not five.
 *
 * The columns mirror the question that gets asked: what is this, how did it get here, what does
 * the CMP think it is, is that right, and does it behave accordingly. Every one of those except
 * the purpose is derived from an observation rather than written by a model. */
export function ConsentInventory({ inventory, siteLabel }: { inventory: Inventory; siteLabel?: string }) {
  const { vendors, shopifyPixels, fixPlan, opportunities } = inventory;
  if (vendors.length === 0) return null;

  const actionable = vendors.filter((v) => v.severity !== "none").length;
  const inferred = vendors.filter((v) => v.purposeSource === "inferred").length;
  const ungatedPixels = shopifyPixels.filter((p) => p.privacyPurposes.length === 0);

  return (
    <div className="space-y-4">
      <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
        <div className="px-5 py-3 border-b border-[#E5E5E5] flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Cookie &amp; script inventory</h2>
            <p className="mt-0.5 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">
              Every third party observed on {siteLabel ?? "the storefront"}, what it is for, how it gets onto the
              page, and whether it fires in a way that respects the visitor&apos;s choice. Discovered from live
              traffic, so vendors nobody catalogued appear here too.
            </p>
          </div>
          <div className="text-xs text-[#6B6B6B] shrink-0 text-right">
            <div>
              <span className="text-lg font-semibold tabular-nums text-[#1A1A1A]">{vendors.length}</span> vendors
            </div>
            <div className="mt-0.5">
              <span className="font-semibold tabular-nums" style={{ color: actionable > 0 ? "#B91C1C" : "#10B981" }}>
                {actionable}
              </span>{" "}
              need attention
            </div>
          </div>
        </div>

        {/* Said once at the top rather than repeated down every row. When no ruleset could be read
            the "classified correctly?" column is uniformly uninformative, and forty identical
            "not readable" cells read as forty findings instead of one missing input. */}
        {inventory.classificationUnavailable ? (
          <div className="px-5 py-2.5 border-b border-[#E5E5E5] bg-[#fafafa] text-xs text-[#6B6B6B] leading-relaxed">
            <strong className="text-[#1A1A1A]">No CMP classification was readable.</strong>{" "}
            {inventory.classificationUnavailable} The <em>Classified correctly?</em> column below therefore says
            nothing about this site&apos;s configuration either way — it is not a finding.
          </div>
        ) : (
          <div className="px-5 py-2.5 border-b border-[#E5E5E5] bg-[#fafafa] text-xs text-[#6B6B6B] leading-relaxed">
            Declared classifications read from <strong className="text-[#1A1A1A]">{inventory.classificationSource}</strong>.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ tableLayout: "fixed", minWidth: 1500 }}>
            <colgroup>
              <col style={{ width: 150 }} />
              <col style={{ width: 175 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 165 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 260 }} />
            </colgroup>
            <thead className="bg-[#fafafa]">
              <tr className="text-left text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                <th className="px-3 py-2.5">Vendor</th>
                <th className="px-3 py-2.5">Purpose</th>
                <th className="px-3 py-2.5">How it loads</th>
                <th className="px-3 py-2.5">Cookies &amp; storage</th>
                <th className="px-3 py-2.5">
                  {inventory.classificationSource ? `${inventory.classificationSource} says` : "CMP classification"}
                </th>
                <th className="px-3 py-2.5">Classified correctly?</th>
                <th className="px-3 py-2.5">Fires before / despite consent?</th>
                <th className="px-3 py-2.5">Severity</th>
                <th className="px-3 py-2.5">Recommended fix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {vendors.map((v) => (
                <tr key={v.key} className="align-top hover:bg-[#fafafa] break-inside-avoid">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-[#1A1A1A] leading-snug">{v.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-[#9A9A9A] break-all">
                      {v.hosts.slice(0, 3).join(", ")}
                      {v.hosts.length > 3 ? ` +${v.hosts.length - 3}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-[#1A1A1A] leading-snug">
                    {v.purpose || <span className="text-[#D4D4D4]">Not identified</span>}
                    {/* Labelled on the row, not just in a footnote: a client forwarding this table
                        to a vendor must be able to see which purposes we established and which we
                        inferred from a hostname. */}
                    {v.purposeSource === "inferred" && (
                      <span
                        className="ml-1 align-middle rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-[#EDECE8] text-[#6B6B6B]"
                        title="Not in our catalogue — purpose inferred from the hostname and observed behaviour"
                      >
                        inferred
                      </span>
                    )}
                    <div className="mt-0.5 text-[10px] text-[#9A9A9A] capitalize">{v.observedCategory}</div>
                  </td>
                  <td className="px-3 py-3 text-[#6B6B6B] leading-snug break-words">{v.load.description}</td>
                  <td className="px-3 py-3 leading-snug">
                    {v.cookies.length === 0 && v.storageKeys.length === 0 ? (
                      <span className="text-[#D4D4D4]">None observed</span>
                    ) : (
                      <>
                        {v.cookies.length > 0 && (
                          <div className="font-mono text-[10px] text-[#1A1A1A] break-all">{v.cookies.join(", ")}</div>
                        )}
                        {v.storageKeys.length > 0 && (
                          <div className="mt-1 font-mono text-[10px] text-[#6B6B6B] break-all">
                            {v.storageKeys.join(", ")}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[#6B6B6B] leading-snug break-words">{declaredText(v)}</td>
                  <td className="px-3 py-3">
                    <span className="font-semibold" style={{ color: VERDICT_COLOR[v.classifiedCorrectly] }}>
                      {VERDICT_LABEL[v.classifiedCorrectly]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[#1A1A1A] leading-snug break-words">{v.consentBehaviour}</td>
                  <td className="px-3 py-3">
                    <span className="font-semibold" style={{ color: SEVERITY_COLOR[v.severity] }}>
                      {SEVERITY_LABEL[v.severity]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[#6B6B6B] leading-snug break-words">
                    {v.recommendedFix ?? <span className="text-[#D4D4D4]">—</span>}
                    {v.notes?.map((n, i) => (
                      <div key={i} className="mt-1.5 text-[10px] text-[#9A9A9A] leading-relaxed">
                        {n}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-2.5 border-t border-[#E5E5E5] bg-[#fafafa] text-[10px] text-[#9A9A9A] leading-relaxed">
          Vendor, load mechanism, cookies, storage, declared classification, consent behaviour and severity are
          observations from the scan.
          {inventory.aiGenerated
            ? " Purposes for uncatalogued vendors, the recommended fixes and the plan below were written by a model from those observations."
            : ` Purposes and fixes were not generated${inventory.aiError ? `: ${inventory.aiError}` : "."}`}
          {inferred > 0 &&
            (inferred === 1 ? " 1 vendor carries an inferred purpose." : ` ${inferred} vendors carry an inferred purpose.`)}
        </div>
      </section>

      {shopifyPixels.length > 0 && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
          <div className="px-5 py-3 border-b border-[#E5E5E5]">
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Shopify web pixels</h2>
            <p className="mt-0.5 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">
              Read from the storefront&apos;s own pixel registry. <strong>privacyPurposes</strong> is the only place
              the platform records whether a pixel is gated on consent — an empty list means Shopify runs it
              whatever the visitor chose, and no CMP setting can change that.
              {ungatedPixels.length > 0 && (
                <>
                  {" "}
                  <strong className="text-[#B91C1C]">
                    {ungatedPixels.length} of {shopifyPixels.length} declare no purposes.
                  </strong>
                </>
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ tableLayout: "fixed", minWidth: 760 }}>
              <colgroup>
                <col style={{ width: 130 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 230 }} />
                <col style={{ width: 190 }} />
              </colgroup>
              <thead className="bg-[#fafafa]">
                <tr className="text-left text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                  <th className="px-3 py-2.5">Pixel ID</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Runtime</th>
                  <th className="px-3 py-2.5">privacyPurposes</th>
                  <th className="px-3 py-2.5">Attributed to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E5]">
                {shopifyPixels.map((p) => (
                  <tr key={p.id} className="align-top hover:bg-[#fafafa]">
                    <td className="px-3 py-2.5 font-mono text-[10px] text-[#1A1A1A]">{p.id}</td>
                    <td className="px-3 py-2.5 text-[#6B6B6B]">{p.type}</td>
                    <td className="px-3 py-2.5 text-[#6B6B6B]">
                      {p.runtimeContext}
                      {/* OPEN means the pixel runs in the page itself with full DOM access, not in
                          Shopify's sandbox — a materially different exposure from STRICT. */}
                      {p.runtimeContext === "OPEN" && (
                        <span className="ml-1 text-[10px] font-semibold" style={{ color: "#D97706" }}>
                          unsandboxed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.privacyPurposes.length === 0 ? (
                        <span className="font-semibold" style={{ color: "#B91C1C" }}>
                          NONE — runs regardless of consent
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-[#1A1A1A]">{p.privacyPurposes.join(" + ")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#6B6B6B]">
                      {p.vendorKey ? (
                        vendors.find((v) => v.key === p.vendorKey)?.name ?? p.vendorKey
                      ) : (
                        <span className="text-[#9A9A9A]">Not attributed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {fixPlan.length > 0 && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
          <div className="px-5 py-3 border-b border-[#E5E5E5]">
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Plan to complete the fixes</h2>
            <p className="mt-0.5 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">
              Ordered so no step wastes the one before it — the gate that governs everything comes before the tags
              it governs, and a tag being removed is not first reclassified.
            </p>
          </div>
          <ol className="divide-y divide-[#E5E5E5]">
            {fixPlan.map((step) => (
              <li key={step.order} className="px-5 py-3.5 break-inside-avoid">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-[10px] font-semibold text-[#9A9A9A]">{step.order}</span>
                  <span className="text-sm font-semibold text-[#1A1A1A]">{step.title}</span>
                  {step.owner && (
                    <span className="rounded px-1.5 py-px text-[10px] font-semibold bg-[#EDECE8] text-[#6B6B6B]">
                      {step.owner}
                    </span>
                  )}
                  {step.effort && <span className="text-[10px] text-[#9A9A9A] capitalize">{step.effort}</span>}
                </div>
                <p className="mt-1 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">{step.detail}</p>
                {step.vendors.length > 0 && (
                  <div className="mt-1.5 font-mono text-[10px] text-[#9A9A9A] break-all">
                    {step.vendors
                      .map((k) => vendors.find((v) => v.key === k)?.name ?? k)
                      .join(", ")}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {opportunities.length > 0 && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
          <div className="px-5 py-3 border-b border-[#E5E5E5]">
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Compliant ways to collect more</h2>
            {/* Structurally separate from the fix plan, and said plainly: an opportunity is not a
                remedy. A section that let "recover modelled conversions" sit beside "stop
                transmitting after opt-out" would invite the reader to treat them as equivalent
                work, and the second is the only one that has to happen. */}
            <p className="mt-0.5 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">
              Ways to close tracking gaps <em>while</em> honouring consent. These are not compliance fixes and
              nothing here substitutes for the plan above — where an opportunity depends on a fix landing first,
              it says so.
            </p>
          </div>
          <ul className="divide-y divide-[#E5E5E5]">
            {opportunities.map((o, i) => (
              <li key={i} className="px-5 py-3.5 break-inside-avoid">
                <div className="text-sm font-semibold text-[#1A1A1A]">{o.title}</div>
                <p className="mt-1 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">{o.detail}</p>
                {o.requires && (
                  <p className="mt-1 text-[10px] text-[#D97706] leading-relaxed">Requires first: {o.requires}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
