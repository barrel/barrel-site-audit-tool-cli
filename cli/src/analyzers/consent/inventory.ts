import type {
  ClassificationVerdict,
  ConsentInventory,
  ConsentStateId,
  DeclaredClassification,
  InventorySeverity,
  InventoryVendor,
  ShopifyWebPixel,
  TrackerCategory,
} from "@barrel/site-audit-shared";
import type { CmpClassification, CmpClassificationRule } from "./adapters/types.js";
import type { RawShopifyPixel, RawStateCapture } from "./engine.js";
import { hostFromUrl, keyOwner, profileForKey, registrableDomain } from "./vendors.js";

/** The CMP category vocabulary, mapped onto ours *only* for the purpose of comparing the two.
 *
 * Every vendor invents its own words for the same four buckets, and the comparison is the whole
 * point of the "classified correctly?" column, so some mapping is unavoidable. What is avoidable
 * is letting the mapping leak into the report: the vendor's own label is always what gets printed,
 * and this table is used solely to decide whether their label and our observation agree.
 *
 * `null` means the label carries no category claim — Osano's `BLOCKED` says a tag is gated
 * without saying by which category, and `HIDDEN` is a suppression state rather than a purpose.
 * A null must never be compared as though it agreed or disagreed with anything. */
const CMP_CATEGORY_MAP: Array<[RegExp, TrackerCategory | null]> = [
  [/^IGNORE/i, null],
  [/BLOCKED|HIDDEN|BLACKLIST/i, null],
  [/UNCLASSIFIED/i, null],
  [/ESSENTIAL|NECESSARY|C0001|STRICTLY/i, "essential"],
  [/ANALYTIC|STATISTIC|PERFORMANCE|C0002/i, "analytics"],
  [/MARKETING|ADVERTIS|TARGETING|SOCIAL|C0004|C0005/i, "marketing"],
  [/PERSONALIZ|PREFERENCE|FUNCTIONAL|STORAGE|C0003/i, "preferences"],
];

function cmpCategoryToOurs(label: string): TrackerCategory | null {
  for (const [pattern, category] of CMP_CATEGORY_MAP) {
    if (pattern.test(label)) return category;
  }
  return null;
}

/** A vendor tag the vendor itself has marked to bypass the CMP. Its own case because no amount of
 * dashboard configuration overrides it, so the fix is different: the markup has to change. */
function isVendorOptOut(label: string): boolean {
  return /^IGNORE/i.test(label);
}

/** The states in which a vendor firing means it fired *before any choice was made*.
 *
 * `clean` only. `dismiss` is deliberately excluded even though nothing was consented there
 * either: whether closing a banner counts as a choice is the question suite H exists to ask, and
 * borrowing that unsettled question into a factual column would state a legal position as an
 * observation. */
const PRE_CONSENT_STATES: ConsentStateId[] = ["clean"];

function matchRule(rules: CmpClassificationRule[], hosts: string[]): CmpClassificationRule | undefined {
  return rules.find((rule) => {
    const ruleHost = hostFromUrl(rule.match) ?? rule.match;
    return hosts.some(
      (h) => h === ruleHost || registrableDomain(h) === registrableDomain(ruleHost) || rule.match.includes(h),
    );
  });
}

/** Turns Shopify's registry entry into the report's shape, and identifies the vendor behind it.
 *
 * The `configuration` blob is where the vendor actually shows: Shopify records a pixel's app
 * client ID but not its name, and the settings routinely carry an `accountID` or `pixelId` that
 * matches a vendor account seen elsewhere in the traffic. */
function toShopifyPixel(raw: RawShopifyPixel): ShopifyWebPixel {
  return {
    id: String(raw.id ?? "unknown"),
    type: raw.type ?? "unknown",
    runtimeContext: raw.runtimeContext ?? "unknown",
    privacyPurposes: Array.isArray(raw.privacyPurposes) ? raw.privacyPurposes : [],
    apiClientId: raw.apiClientId,
    dataSharingState: raw.dataSharingState,
    configuration: raw.configuration,
  };
}

/** Which Shopify pixel, if any, is this vendor's.
 *
 * Matched on the pixel's own configuration text mentioning one of the vendor's hosts or its
 * account identifier. Deliberately conservative: an unmatched pixel is reported on its own in
 * `shopifyPixels` rather than attached to a plausible-looking vendor, because a wrong attribution
 * would put a `privacyPurposes: []` finding on an innocent row. */
function pixelForVendor(
  pixels: ShopifyWebPixel[],
  key: string,
  hosts: string[],
  initiators: string[],
): ShopifyWebPixel | undefined {
  // The initiator chain is the strongest evidence available and is tried first: Shopify serves
  // each sandboxed pixel from `/web-pixels@…/app/web-pixel-<id>@…/pixel.modern.js`, so a request
  // caused by that script names the pixel's own id outright. Config-text matching is the fallback
  // and only ever a heuristic.
  for (const init of initiators) {
    const id = /web-pixel-(\d+)/.exec(init)?.[1];
    if (!id) continue;
    const match = pixels.find((p) => p.id === id);
    if (match) return match;
  }
  const needles = [key, ...hosts.map((h) => registrableDomain(h).split(".")[0])].filter((n) => n.length > 3);
  return pixels.find((p) => {
    const text = `${p.configuration ?? ""}`.toLowerCase();
    return needles.some((n) => text.includes(n.toLowerCase()));
  });
}

/** How this vendor's code got onto the page, and the sentence the report prints for it.
 *
 * Order matters and encodes what a reader needs first. A Shopify web pixel is named first because
 * it is the case a CMP cannot fix at all. A hardcoded theme tag comes before an injected one
 * because when a vendor is loaded both ways the theme copy is the one that runs ungated. */
function describeLoad(
  hosts: string[],
  initiators: string[],
  headScripts: string[],
  bodyScripts: string[],
  pixel: ShopifyWebPixel | undefined,
  documentUrl: string,
): InventoryVendor["load"] {
  // Matched on the whole script URL rather than its host: Shopify's app-proxy rewrites a vendor's
  // script to `cdn.shopify.com/proxy/<hash>/apps.bazaarvoice.com/...`, where the vendor's own host
  // survives only in the path. Matching on host alone reported those as "load mechanism not
  // observed" for a tag sitting plainly in the theme head.
  const inDocument = (list: string[]) =>
    list.filter((s) => {
      const h = hostFromUrl(s);
      if (h && hosts.some((vh) => registrableDomain(vh) === registrableDomain(h))) return true;
      return hosts.some((vh) => s.includes(vh));
    });

  const inHead = inDocument(headScripts);
  const inBody = inDocument(bodyScripts);

  if (pixel) {
    const purposes = pixel.privacyPurposes.length > 0 ? pixel.privacyPurposes.join(" + ") : "NONE";
    return {
      mechanism: "shopify-web-pixel",
      description: `Shopify ${pixel.type.toLowerCase()} web pixel ${pixel.id}, privacyPurposes = ${purposes}, runtimeContext ${pixel.runtimeContext}`,
      shopifyPixel: pixel,
      injectedBy: initiators.length > 0 ? initiators : undefined,
    };
  }

  if (inHead.length > 0) {
    return { mechanism: "theme-head", description: `Hardcoded in theme <head> (${inHead[0]})`, injectedBy: initiators.length > 0 ? initiators : undefined };
  }
  if (inBody.length > 0) {
    return { mechanism: "theme-body", description: `Hardcoded in theme <body> (${inBody[0]})`, injectedBy: initiators.length > 0 ? initiators : undefined };
  }

  // A tag manager is called out by name because the fix lives in a different tool, and usually
  // with a different team, than a theme edit.
  const gtm = initiators.find((i) => /googletagmanager\.com\/gtm\.js/.test(i));
  if (gtm) {
    const id = /[?&]id=(GTM-[A-Z0-9]+)/i.exec(gtm)?.[1];
    return { mechanism: "tag-manager", description: `Injected by Google Tag Manager${id ? ` (${id})` : ""}`, injectedBy: initiators };
  }

  // Shopify's web-pixels runtime, which serves each pixel from the *storefront's own* origin —
  // `/web-pixels@<bundle>/app/web-pixel-<id>@<hash>/pixel.modern.js` and the `/cdn/wpm/` loader.
  // Both are first-party URLs, so without this the sandboxed pixels all read as "injected by
  // cabotcreamery.com", which names the shop rather than the mechanism and points at no fix.
  const wpm = initiators.find((i) => /\/web-pixels|\/cdn\/wpm\//.test(i));
  if (wpm) {
    const id = /web-pixel-(\d+)/.exec(wpm)?.[1];
    return {
      mechanism: "shopify-web-pixel",
      description: id
        ? `Shopify web pixel ${id} (sandboxed runtime, served first-party)`
        : "Shopify web pixels runtime (sandboxed)",
      injectedBy: initiators,
    };
  }

  // An initiator that is the document itself means the HTML the server sent contained the tag —
  // the parser started the request, nothing injected it. That is the same fact as "hardcoded in
  // the theme", and reporting it as "injected by <the shop's own domain>" named the victim rather
  // than the cause.
  const docOrigin = hostFromUrl(documentUrl);
  const parserInserted = initiators.some((i) => {
    const h = hostFromUrl(i);
    return h !== null && docOrigin !== null && h === docOrigin && !/\.js(\?|$)/.test(i);
  });
  if (parserInserted) {
    return { mechanism: "theme-head", description: "Written into the page HTML by the theme", injectedBy: initiators };
  }

  if (initiators.length > 0) {
    const first = initiators[0];
    const h = hostFromUrl(first);
    return {
      mechanism: "vendor-chain",
      description: `Injected by ${h ? registrableDomain(h) : "another script"} (${first.slice(0, 90)})`,
      injectedBy: initiators,
    };
  }
  return { mechanism: "unknown", description: "Load mechanism not observed", injectedBy: undefined };
}

/** The verdict for the "is it classified correctly?" column, and the sentence explaining it.
 *
 * The distinctions here are the ones that decide whether this column survives contact with the
 * client's developer, so each is deliberate:
 *
 * - **unknown** — we could not read any classification. Our gap, not theirs, and it must never
 *   present as a finding about their configuration.
 * - **unclassified** — the ruleset is readable and nothing in it covers this vendor. Reported as
 *   its own verdict rather than as `incorrect` because an absent gating marker has a second
 *   innocent explanation: a tag injected by JavaScript was never a script tag for the CMP to
 *   rewrite. Calling that "misclassified" would be an accusation the evidence doesn't support.
 * - **incorrect** — the CMP's own label contradicts what the vendor demonstrably is.
 *
 * The behavioural claim is kept out of this verdict entirely and reported in its own column. A
 * vendor can be classified correctly and still fire when it shouldn't — that is a broken *gate*,
 * not a broken classification, and merging the two loses the distinction the fix depends on. */
function judgeClassification(
  declared: DeclaredClassification | undefined,
  observedCategory: TrackerCategory,
  classificationReadable: boolean,
): { verdict: ClassificationVerdict; note?: string } {
  if (!classificationReadable) {
    return {
      verdict: "unknown",
      note: "No classification could be read from this CMP, so this column reports nothing about the client's configuration either way.",
    };
  }
  if (!declared?.category) {
    if (observedCategory === "essential") {
      return { verdict: "unclassified", note: "No rule covers this vendor. It behaves as essential, so no gating is expected." };
    }
    return {
      verdict: "unclassified",
      note: `No gating rule covers this vendor, and it behaves as ${observedCategory}. Consistent with either no rule existing or the tag being injected by script rather than written into the page — the fix differs, so confirm which in the CMP dashboard.`,
    };
  }

  const label = declared.category;
  if (isVendorOptOut(label)) {
    return {
      verdict: "incorrect",
      note: `The vendor's own markup tells the CMP not to gate this tag (${label}). No dashboard setting overrides that — the markup has to change.`,
    };
  }

  const claimed = cmpCategoryToOurs(label);
  if (claimed === null) {
    return {
      verdict: "partly",
      note: `The CMP gates this tag but its marker (${label}) does not name a category, so whether it is gated on the right one cannot be read from the page.`,
    };
  }
  if (claimed === observedCategory) return { verdict: "correct" };
  if (claimed === "essential" && observedCategory !== "essential") {
    return {
      verdict: "incorrect",
      note: `Declared ${label} — treated as strictly necessary and never gated — but it behaves as ${observedCategory}.`,
    };
  }
  return {
    verdict: "incorrect",
    note: `Declared ${label}, but it behaves as ${observedCategory}.`,
  };
}

/** Severity for a vendor row.
 *
 * Graded on disclosure, not on category alone. A marketing tag transmitting after an explicit
 * rejection is the worst case in the table because the visitor said no and was overridden; the
 * same tag transmitting before anyone was asked is bad but is at least the failure mode every
 * un-gated site has. A script load with no transmission is a weaker claim and is graded as such,
 * so a client's developer who checks the evidence finds the severity matches what they see. */
function gradeSeverity(v: {
  observedCategory: TrackerCategory;
  firesBeforeConsent: boolean;
  firesDespiteRejection: boolean;
  transmittedIn: ConsentStateId[];
  scriptLoadedIn: ConsentStateId[];
}): InventorySeverity {
  if (v.observedCategory === "essential") return "none";
  const transmitted = v.transmittedIn.length > 0;
  if (v.firesDespiteRejection && v.observedCategory === "marketing") return "critical";
  if (v.firesDespiteRejection) return "high";
  if (v.firesBeforeConsent && v.observedCategory === "marketing") return transmitted ? "high" : "medium";
  if (v.firesBeforeConsent) return transmitted ? "medium" : "low";
  return "none";
}

/** The sentence in the "fires before / despite consent?" column.
 *
 * Always names the state the observation came from. "Yes" on its own invites the reply "yes when?",
 * and a column a developer cannot check is a column they will dismiss. */
function describeConsentBehaviour(v: {
  firesBeforeConsent: boolean;
  firesDespiteRejection: boolean;
  transmittedIn: ConsentStateId[];
  scriptLoadedIn: ConsentStateId[];
  rejectReached: boolean;
}): string {
  const parts: string[] = [];
  if (v.firesDespiteRejection) {
    parts.push("YES — transmits after an explicit Reject All");
  } else if (v.firesBeforeConsent) {
    parts.push(
      v.transmittedIn.includes("clean")
        ? "YES — transmits on a clean load, before any choice"
        : "Script only — library fetched before any choice, no data sent",
    );
  } else if (v.transmittedIn.length > 0) {
    parts.push(`No — transmits only after consent (${v.transmittedIn.join(", ")})`);
  } else if (v.scriptLoadedIn.length > 0) {
    parts.push("No transmission observed in any state");
  } else {
    parts.push("Not observed");
  }
  // A negative claim earned in a state that was never reached is not a negative claim at all.
  if (!v.rejectReached && !v.firesDespiteRejection) {
    parts.push("(Reject state could not be reached, so post-rejection behaviour is unproven)");
  }
  return parts.join(" ");
}

export interface BuildInventoryInput {
  states: RawStateCapture[];
  classification: CmpClassification | null;
  /** Label for the CMP whose classification was read, e.g. "Osano". */
  cmpLabel: string;
  /** The scanned URL. Used to recognise a request the page's own HTML started, which is the
   * signature of a tag written into the theme rather than injected by a script. */
  url: string;
}

/** Assembles the vendor inventory from what the five browser states observed.
 *
 * Entirely deterministic. Every column this produces is a restatement of something the scanner
 * saw, which is what lets the AI pass that follows be limited to prose: purposes for uncatalogued
 * vendors, wording for fixes, and the plan. No model output is allowed to become a verdict in
 * `classifiedCorrectly`, `firesBeforeConsent` or `severity`, because those are the claims a client
 * will forward to a vendor and they have to be traceable to an observation. */
export function buildInventory(input: BuildInventoryInput): ConsentInventory {
  const { states, classification, cmpLabel, url: documentUrl } = input;
  const reached = states.filter((s) => s.reached);
  const rejectReached = reached.some((s) => s.state === "reject");

  // The registry is the same in every state; the first state that read it wins.
  const rawPixels = reached.find((s) => (s.inventoryFacts?.shopifyPixels?.length ?? 0) > 0)?.inventoryFacts?.shopifyPixels ?? [];
  const shopifyPixels = rawPixels.map(toShopifyPixel);

  const headScripts = Array.from(new Set(reached.flatMap((s) => s.inventoryFacts?.headScripts ?? [])));
  const bodyScripts = Array.from(new Set(reached.flatMap((s) => s.inventoryFacts?.bodyScripts ?? [])));

  const classificationReadable = Boolean(classification && !classification.unavailable);
  const rules = classification?.rules ?? [];

  const keys = Array.from(new Set(reached.flatMap((s) => (s.vendorObservations ?? []).map((o) => o.key))));

  const vendors: InventoryVendor[] = keys.map((key) => {
    const perState = reached
      .map((s) => ({ state: s.state, obs: (s.vendorObservations ?? []).find((o) => o.key === key) }))
      .filter((x): x is { state: ConsentStateId; obs: NonNullable<typeof x.obs> } => Boolean(x.obs));

    const hosts = Array.from(new Set(perState.flatMap((x) => x.obs.hosts)));
    const initiators = Array.from(new Set(perState.flatMap((x) => x.obs.initiators)));
    const transmittedIn = perState.filter((x) => x.obs.transmitted).map((x) => x.state);
    const scriptLoadedIn = perState.filter((x) => x.obs.scriptLoaded && !x.obs.transmitted).map((x) => x.state);

    const profile = profileForKey(key);
    const name = profile?.name ?? (hosts[0] ? registrableDomain(hosts[0]) : key);
    const observedCategory: TrackerCategory = profile?.category ?? "preferences";

    // Cookies and storage keys are attributed by owner rather than by category, so a vendor's own
    // identity cookie lands on its own row instead of in an undifferentiated category bucket.
    const cookies = Array.from(
      new Set(reached.flatMap((s) => s.cookies.filter((c) => keyOwner(c.name) === key).map((c) => c.name))),
    );
    const storageKeys = Array.from(
      new Set(
        reached.flatMap((s) =>
          (s.inventoryFacts?.storageKeys ?? []).filter((raw) => keyOwner(raw.split(":").slice(1).join(":")) === key),
        ),
      ),
    );

    const pixel = pixelForVendor(shopifyPixels, key, hosts, initiators);
    if (pixel) pixel.vendorKey = key;

    const rule = matchRule(rules, hosts);
    const declared: DeclaredClassification | undefined = classificationReadable
      ? rule
        ? { category: rule.category, rule: rule.match, conflict: rule.pinnedTo ? `Rule pinned to ${rule.pinnedTo}` : undefined }
        : { absent: "No rule covers this vendor" }
      : undefined;

    const firesBeforeConsent = perState.some(
      (x) => PRE_CONSENT_STATES.includes(x.state) && (x.obs.transmitted || x.obs.scriptLoaded),
    );
    const firesDespiteRejection = perState.some((x) => x.state === "reject" && x.obs.transmitted);

    const { verdict, note } = judgeClassification(declared, observedCategory, classificationReadable);

    // A Shopify pixel gated on nothing is an independent finding about the same vendor, and one
    // the CMP cannot fix. Carried as a note so it travels with the row rather than being buried
    // in the pixel table below it.
    const notes: string[] = [];
    if (note) notes.push(note);
    if (pixel && pixel.privacyPurposes.length === 0) {
      notes.push(
        `Shopify web pixel ${pixel.id} declares no privacyPurposes, so Shopify runs it whatever the visitor chose. This is set on the pixel, not in the CMP.`,
      );
    }
    if (pixel && pixel.runtimeContext === "OPEN") {
      notes.push(`Web pixel ${pixel.id} runs unsandboxed (runtimeContext OPEN) with full access to the page.`);
    }

    return {
      key,
      name,
      purpose: profile?.purpose ?? "",
      purposeSource: profile ? ("catalogue" as const) : ("inferred" as const),
      observedCategory,
      hosts,
      load: describeLoad(hosts, initiators, headScripts, bodyScripts, pixel, documentUrl),
      cookies,
      storageKeys,
      declared,
      classifiedCorrectly: verdict,
      classificationNote: note,
      transmittedIn,
      scriptLoadedIn,
      firesBeforeConsent,
      firesDespiteRejection,
      consentBehaviour: describeConsentBehaviour({
        firesBeforeConsent,
        firesDespiteRejection,
        transmittedIn,
        scriptLoadedIn,
        rejectReached,
      }),
      severity: gradeSeverity({ observedCategory, firesBeforeConsent, firesDespiteRejection, transmittedIn, scriptLoadedIn }),
      notes: notes.length > 0 ? notes : undefined,
    };
  });

  // Worst first, and within a severity the vendors that transmit before the ones that only load a
  // script — the table is read top-down and the first rows should be the ones worth acting on.
  const ORDER: InventorySeverity[] = ["critical", "high", "medium", "low", "none"];
  vendors.sort((a, b) => {
    const bySeverity = ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byTransmission = Number(b.transmittedIn.length > 0) - Number(a.transmittedIn.length > 0);
    if (byTransmission !== 0) return byTransmission;
    return a.name.localeCompare(b.name);
  });

  return {
    vendors,
    shopifyPixels,
    classificationSource: classificationReadable
      ? `${cmpLabel}${classification?.variant ? ` (${classification.variant})` : ""}`
      : undefined,
    classificationUnavailable: classificationReadable
      ? undefined
      : (classification?.unavailable ??
        `No consent classification could be read${cmpLabel ? ` from ${cmpLabel}` : ""}. The "classified correctly?" column reports nothing about the client's configuration.`),
    fixPlan: [],
    opportunities: [],
    aiGenerated: false,
  };
}
