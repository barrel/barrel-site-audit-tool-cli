import type {
  AiUsage,
  ConsentInventory,
  InventoryFixStep,
  InventoryOpportunity,
  InventorySeverity,
  InventoryVendor,
  TrackerCategory,
} from "@barrel/site-audit-shared";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

const INVENTORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendorGuidance", "fixPlan", "opportunities"],
  properties: {
    vendorGuidance: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "recommendedFix"],
        properties: {
          key: { type: "string", description: "The vendor key exactly as given to you." },
          purpose: {
            type: "string",
            description:
              "What this vendor does, 4-12 words, in the terms a marketer would use. ONLY for vendors marked NEEDS PURPOSE. Omit otherwise.",
          },
          category: {
            type: "string",
            enum: ["essential", "analytics", "marketing", "preferences"],
            description:
              "Category for a vendor marked NEEDS PURPOSE. Omit for every other vendor — theirs is already established and yours would be ignored.",
          },
          recommendedFix: {
            type: "string",
            description:
              "One or two sentences naming the concrete change and where it is made. Reference the actual load mechanism given to you.",
          },
        },
      },
    },
    fixPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["order", "title", "detail", "vendors"],
        properties: {
          order: { type: "number" },
          title: { type: "string" },
          detail: { type: "string" },
          owner: { type: "string", description: "Who does it, e.g. 'Theme developer', 'GTM owner', 'Shopify admin'." },
          effort: { type: "string", enum: ["quick", "moderate", "involved"] },
          vendors: { type: "array", items: { type: "string" }, description: "Vendor keys this step resolves." },
        },
      },
    },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          requires: { type: "string" },
        },
      },
    },
  },
} as const;

interface VendorGuidance {
  key: string;
  purpose?: string;
  category?: TrackerCategory;
  recommendedFix: string;
}

/** What the model is shown about one vendor.
 *
 * Deliberately the observations rather than the verdicts we drew from them, plus the verdicts as
 * fixed context. The model is being asked to write the fix, not to re-decide whether the vendor
 * misbehaved — so the behavioural facts arrive as settled, and there is nothing in the schema it
 * could use to overturn them. */
function describeVendor(v: InventoryVendor): string {
  const lines = [
    `- key: ${v.key}`,
    `  name: ${v.name}`,
    v.purposeSource === "inferred"
      ? `  purpose: NEEDS PURPOSE — not in our catalogue. Hosts: ${v.hosts.join(", ")}`
      : `  purpose: ${v.purpose} (category ${v.observedCategory})`,
    `  hosts: ${v.hosts.join(", ") || "none"}`,
    `  how it loads: ${v.load.description}`,
    `  cookies: ${v.cookies.join(", ") || "none observed"}`,
    `  storage: ${v.storageKeys.join(", ") || "none observed"}`,
    `  CMP says: ${
      v.declared?.category
        ? `${v.declared.category}${v.declared.rule ? ` (rule: ${v.declared.rule})` : ""}`
        : v.declared?.absent
          ? "no rule covers it"
          : "not readable"
    }`,
    `  classified correctly: ${v.classifiedCorrectly}${v.classificationNote ? ` — ${v.classificationNote}` : ""}`,
    `  consent behaviour: ${v.consentBehaviour}`,
    `  severity: ${v.severity}`,
  ];
  if (v.load.shopifyPixel) {
    const p = v.load.shopifyPixel;
    lines.push(
      `  shopify pixel: id ${p.id}, type ${p.type}, runtimeContext ${p.runtimeContext}, privacyPurposes ${
        p.privacyPurposes.length > 0 ? p.privacyPurposes.join("+") : "NONE"
      }`,
    );
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a privacy engineer writing the remediation half of a cookie & tag inventory for an
ecommerce client. A behavioural scan has already run: it drove the consent banner through reject, accept and
analytics-only states and recorded what each vendor actually did. You are given its findings.

Your job is THREE things and nothing else:

1. For each vendor, a \`recommendedFix\`. Name the concrete change and the place it is made, using the load
   mechanism you were given. "Hardcoded in theme <head>" means a theme edit; "Injected by Google Tag Manager
   (GTM-XXXX)" means a change to that container's trigger; a Shopify web pixel with privacyPurposes = NONE means
   setting privacyPurposes on the pixel itself — say so explicitly, because no CMP setting can gate that pixel.
   Where the CMP has a rule that is wrong, say what to change it to. Never write "review this" or "ensure
   compliance" — the reader is the developer who has to make the edit.

2. For vendors marked NEEDS PURPOSE, a \`purpose\` and a \`category\`. These are vendors absent from our catalogue,
   identified only by hostname. Say what the vendor is if you recognise the domain; if you do not recognise it,
   say what the evidence supports and no more (e.g. "unidentified third-party ID sync") and choose the category
   that evidence supports. Do NOT invent a company or a product name for a domain you do not know. Guessing
   "marketing" for something you cannot identify is also wrong — choose "preferences" when you genuinely cannot tell.

3. A \`fixPlan\` (ordered, 3-8 steps) and \`opportunities\` (0-5).

RULES:
- Never contradict or re-litigate a "consent behaviour", "classified correctly" or "severity" value you were
  given. Those came from observation. If one looks wrong to you, write the fix for what was observed.
- A fix plan step must be ordered so it does not waste work: removing a tag comes before reclassifying it, and
  fixing the thing that gates everything comes before fixing what it gates.
- \`opportunities\` are ways to collect MORE data while HONOURING consent — server-side tagging, Consent Mode v2
  modelling, first-party identifiers gathered after opt-in, moving a vendor onto a consented Shopify pixel.
  They are NOT compliance fixes and must never read as one. If a site's consent posture is broken, an
  opportunity that depends on it being fixed must say so in \`requires\`.
- Do not recommend removing a vendor purely because it is uncatalogued.`;

export interface InventoryAiResult {
  inventory: ConsentInventory;
  usage?: AiUsage;
}

/** Severity is recomputed after the model supplies a category for an uncatalogued vendor.
 *
 * Kept identical in logic to `gradeSeverity` in inventory.ts and applied only to rows whose
 * category was inferred. Without this, the Tatari-style chains — a dozen ad-tech hosts nobody has
 * catalogued, all firing under full opt-out — would grade as `preferences` and sort to the bottom
 * of the table, which is the opposite of the truth. The inferred category is what makes the
 * severity meaningful, and the row stays labelled `inferred` so the reader knows which it is. */
function regradeInferred(v: InventoryVendor): InventorySeverity {
  if (v.observedCategory === "essential") return "none";
  const transmitted = v.transmittedIn.length > 0;
  if (v.firesDespiteRejection && v.observedCategory === "marketing") return "critical";
  if (v.firesDespiteRejection) return "high";
  if (v.firesBeforeConsent && v.observedCategory === "marketing") return transmitted ? "high" : "medium";
  if (v.firesBeforeConsent) return transmitted ? "medium" : "low";
  return "none";
}

/** Adds purposes, fixes, a plan and opportunities to a deterministic inventory.
 *
 * Returns the inventory unchanged (with `aiError` set) rather than throwing on any failure. The
 * deterministic columns are the substance of the deliverable and a missing API key must degrade
 * the table, never withhold it. */
export async function enrichInventory(
  inventory: ConsentInventory,
  context: { url: string; cmpLabel: string; cmpDetail: string; impliedConsent?: string },
): Promise<InventoryAiResult> {
  if (inventory.vendors.length === 0) return { inventory };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { inventory: { ...inventory, aiError: "ANTHROPIC_API_KEY not set — purposes and fixes were not generated." } };
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const userContent = [
      `Site: ${context.url}`,
      `Consent platform: ${context.cmpLabel} — ${context.cmpDetail}`,
      context.impliedConsent ? `CMP consent model: ${context.impliedConsent}` : "",
      inventory.classificationSource
        ? `Classification read from: ${inventory.classificationSource}`
        : `Classification NOT readable: ${inventory.classificationUnavailable ?? "unknown reason"}`,
      "",
      `Shopify web pixels in the registry (${inventory.shopifyPixels.length}):`,
      ...inventory.shopifyPixels.map(
        (p) =>
          `- ${p.id} type ${p.type}, runtimeContext ${p.runtimeContext}, privacyPurposes ${
            p.privacyPurposes.length > 0 ? p.privacyPurposes.join("+") : "NONE"
          }${p.configuration ? `, config ${p.configuration.slice(0, 120)}` : ""}`,
      ),
      "",
      `Vendors observed (${inventory.vendors.length}):`,
      ...inventory.vendors.map(describeVendor),
    ]
      .filter(Boolean)
      .join("\n");

    // A real storefront yields 40+ vendor rows, and one `recommendedFix` each plus the plan and
    // the opportunities overran 8192 — the response was cut mid-string and the whole enrichment
    // was lost to a JSON parse error. Sized for the widest table observed, with room to spare,
    // because that failure mode is silent and total.
    //
    // Streamed rather than awaited whole: at this ceiling the SDK refuses a non-streaming request
    // outright ("Streaming is required for operations that may take longer than 10 minutes"), and
    // lowering the ceiling to avoid that would reintroduce the truncation it was raised to fix.
    const response = await client.messages
      .stream({
        model: "claude-opus-5",
        max_tokens: 32_000,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: INVENTORY_SCHEMA } },
        messages: [{ role: "user", content: userContent }],
      })
      .finalMessage();

    // Named explicitly, because a truncated response fails as "Unterminated string in JSON at
    // position 6920" — which reads like a malformed schema rather than a ceiling that needs
    // raising, and sent the first diagnosis of this exact failure down the wrong path.
    if (response.stop_reason === "max_tokens") {
      return {
        inventory: {
          ...inventory,
          aiError: `The model's response was cut off at the token limit with ${inventory.vendors.length} vendors to cover. Purposes and fixes were not generated.`,
        },
      };
    }

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) return { inventory: { ...inventory, aiError: "The model returned no text block." } };

    const parsed = JSON.parse(textBlock.text) as {
      vendorGuidance: VendorGuidance[];
      fixPlan: InventoryFixStep[];
      opportunities: InventoryOpportunity[];
    };

    const byKey = new Map(parsed.vendorGuidance.map((g) => [g.key, g]));
    const vendors = inventory.vendors.map((v) => {
      const g = byKey.get(v.key);
      if (!g) return v;
      // Purpose and category are taken only where ours was absent. A catalogued vendor's purpose
      // is identical across every site we scan, and letting a per-run inference overwrite it would
      // make the same vendor read differently in two clients' reports for no reason.
      const inferred = v.purposeSource === "inferred";
      const next: InventoryVendor = {
        ...v,
        purpose: inferred && g.purpose ? g.purpose : v.purpose,
        observedCategory: inferred && g.category ? g.category : v.observedCategory,
        recommendedFix: g.recommendedFix,
      };
      if (inferred && g.category && g.category !== v.observedCategory) {
        next.severity = regradeInferred(next);
      }
      return next;
    });

    // Re-sort: an inferred category can move a row's severity, and the table's whole value is
    // that the first row is the one to act on.
    const ORDER: InventorySeverity[] = ["critical", "high", "medium", "low", "none"];
    vendors.sort((a, b) => {
      const bySeverity = ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity);
      if (bySeverity !== 0) return bySeverity;
      const byTransmission = Number(b.transmittedIn.length > 0) - Number(a.transmittedIn.length > 0);
      if (byTransmission !== 0) return byTransmission;
      return a.name.localeCompare(b.name);
    });

    // A plan step's `vendors` are cross-references the report renders as links back into the
    // table, and the model reaches for the vendor's domain where our key is a tracker id —
    // "snapchat.com" for `snapchat`. An unresolvable key would render as a dead reference, so
    // each is mapped back where that is unambiguous and dropped where it is not. Dropping one
    // costs a cross-link; keeping a wrong one attributes a fix to the wrong vendor.
    const validKeys = new Set(vendors.map((v) => v.key));
    const byDomain = new Map(
      vendors.flatMap((v) => v.hosts.map((h) => [h.replace(/^www\./, ""), v.key] as const)),
    );
    const resolveKey = (raw: string): string | null => {
      if (validKeys.has(raw)) return raw;
      const direct = byDomain.get(raw);
      if (direct) return direct;
      // Last resort: a key whose own hosts end in the string the model used.
      const suffixed = vendors.find((v) => v.hosts.some((h) => h === raw || h.endsWith(`.${raw}`)));
      return suffixed?.key ?? null;
    };
    const fixPlan: InventoryFixStep[] = parsed.fixPlan
      .map((step) => ({
        ...step,
        vendors: Array.from(new Set((step.vendors ?? []).map(resolveKey).filter((k): k is string => k !== null))),
      }))
      .sort((a, b) => a.order - b.order);

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      inventory: {
        ...inventory,
        vendors,
        fixPlan,
        opportunities: parsed.opportunities,
        aiGenerated: true,
      },
      usage: {
        model: "claude-opus-5",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
      },
    };
  } catch (err) {
    return {
      inventory: {
        ...inventory,
        aiError: `Purposes and fixes could not be generated: ${(err as Error)?.message ?? String(err)}`,
      },
    };
  }
}
