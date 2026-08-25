import type { ThemeOpportunity, ThemeOrigin, ThemeProfileSection } from "@/lib/shared";

const ORIGIN_LABELS: Record<ThemeOrigin, string> = {
  "shopify-stock": "Stock Shopify theme",
  "shopify-fork": "Forked Shopify theme",
  "third-party": "Third-party / agency theme",
  custom: "Custom-built",
  unknown: "Unidentified",
};

/** Forks are the one origin worth colouring as a caution: the theme still carries a stock theme's
 * name, so it looks updatable when it isn't. */
const ORIGIN_STYLES: Record<ThemeOrigin, string> = {
  "shopify-stock": "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]",
  "shopify-fork": "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  "third-party": "bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]",
  custom: "bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]",
  unknown: "bg-[#F5F5F4] text-[#6B6B6B] border-[#E5E5E5]",
};

const IMPACT_STYLES: Record<ThemeOpportunity["impact"], string> = {
  high: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
  medium: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  low: "bg-[#F5F5F4] text-[#6B6B6B] border-[#E5E5E5]",
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}
    >
      {children}
    </span>
  );
}

function OpportunityCard({ opportunity }: { opportunity: ThemeOpportunity }) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-[#1A1A1A] leading-snug">{opportunity.title}</div>
        <div className="flex items-center gap-1.5">
          <Pill className={IMPACT_STYLES[opportunity.impact]}>{opportunity.impact} impact</Pill>
          {opportunity.effort && (
            <Pill className="bg-[#F5F5F4] text-[#6B6B6B] border-[#E5E5E5]">{opportunity.effort} effort</Pill>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-[#6B6B6B] leading-relaxed">{opportunity.detail}</p>
      {opportunity.recommendation && (
        <p className="mt-2.5 text-sm text-[#1A1A1A] leading-relaxed">
          <span className="font-semibold">Do this: </span>
          {opportunity.recommendation}
        </p>
      )}
      <div className="mt-2.5 text-[10px] uppercase tracking-wider text-[#9A9A9A]">
        {opportunity.source === "scan" ? "Found by file scan" : "Found by AI code review"}
      </div>
    </div>
  );
}

export function ThemeProfile({
  section,
  /** AI-found opportunities from the theme-architecture assessment, merged into the same list so a
   * reader sees one set of opportunities rather than two competing ones. */
  aiOpportunities = [],
}: {
  section: ThemeProfileSection;
  aiOpportunities?: ThemeOpportunity[];
}) {
  const { identity, facts } = section;
  const impactRank: Record<ThemeOpportunity["impact"], number> = { high: 0, medium: 1, low: 2 };
  const opportunities = [...section.opportunities, ...aiOpportunities].sort(
    (a, b) => impactRank[a.impact] - impactRank[b.impact],
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">Theme In Use</div>
        <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <span className="text-xl font-semibold text-[#000000] tracking-tight">
              {identity.name ?? "Unnamed theme"}
            </span>
            {identity.version && <span className="text-sm text-[#6B6B6B]">v{identity.version}</span>}
            <Pill className={ORIGIN_STYLES[identity.origin]}>{ORIGIN_LABELS[identity.origin]}</Pill>
          </div>
          <div className="mt-1.5 text-sm text-[#6B6B6B]">
            {identity.author ? `By ${identity.author}` : "No author declared"}
            {identity.basedOn && identity.basedOn !== identity.name ? ` · based on Shopify ${identity.basedOn}` : ""}
          </div>
          <p className="mt-3 text-sm text-[#1A1A1A] leading-relaxed">{identity.detail}</p>
          {identity.documentationUrl && (
            <a
              href={identity.documentationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-medium text-[#1E40AF] hover:underline"
            >
              Theme documentation →
            </a>
          )}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
          What The Codebase Is Made Of
        </div>
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden divide-y divide-[#E5E5E5]">
          {facts.map((fact) => (
            <div key={fact.label} className="px-5 py-3.5 sm:flex sm:items-baseline sm:gap-5">
              <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase sm:w-[180px] sm:shrink-0">
                {fact.label}
              </div>
              <div className="mt-1 sm:mt-0">
                <div className="text-sm font-medium text-[#1A1A1A]">{fact.value}</div>
                {fact.detail && <div className="text-sm text-[#6B6B6B] mt-0.5 leading-relaxed">{fact.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
          Codebase Opportunities{opportunities.length > 0 ? ` (${opportunities.length})` : ""}
        </div>
        {opportunities.length === 0 ? (
          <div className="bg-white border border-[#E5E5E5] rounded-lg p-4">
            <div className="text-sm font-semibold text-[#1A1A1A]">No codebase opportunities found</div>
            <p className="mt-1.5 text-sm text-[#6B6B6B] leading-relaxed">
              The scan found no deprecated tags, oversized assets, stale build output, or missing Online Store 2.0
              features in this theme.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {opportunities.map((opportunity, i) => (
              <OpportunityCard key={`${opportunity.source}-${i}-${opportunity.title}`} opportunity={opportunity} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
