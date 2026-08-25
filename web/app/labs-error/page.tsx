export const dynamic = "force-dynamic";

/** Where a failed SSO handoff lands.
 *
 * This page is deliberately reachable with no session. Sending a failed handoff back to `/`
 * instead would put the browser straight back into the gate, which re-authorizes, which fails the
 * same way — an infinite redirect loop that surfaces as ERR_TOO_MANY_REDIRECTS and says nothing
 * about the cause. A dead end that names the cause is worth more than a retry that cannot work. */
const REASONS: Record<string, { title: string; body: string }> = {
  missing_token: {
    title: "Barrel Labs did not send a sign-in token.",
    body:
      "The sign-in came back without the token this app needs. That usually means the link was " +
      "opened out of order or truncated — starting again from the top normally clears it.",
  },
  invalid_token: {
    title: "The sign-in token could not be verified.",
    body:
      "Barrel Labs sent a token this app refused. The usual causes are a LABS_APP_SLUG here that " +
      "no longer matches the slug registered in Labs, a Labs signing key that has just been " +
      "rotated, or a clock that is badly out of step.",
  },
};

export default async function LabsErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const detail = REASONS[reason ?? ""] ?? {
    title: "Sign-in did not complete.",
    body: "Barrel Labs did not finish handing this app a verified identity.",
  };

  return (
    <div className="min-h-screen bg-[#f9f8f6] flex items-center justify-center px-4">
      <div className="w-full max-w-[60ch] bg-white border border-[#E5E5E5] rounded-lg p-8">
        <div className="text-[10px] font-semibold text-[#B91C1C] uppercase tracking-wider">
          Sign-in failed
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-[#1A1A1A] tracking-tight">Barrel Site Audit</h1>
        <p className="mt-4 text-sm font-medium text-[#1A1A1A]">{detail.title}</p>
        <p className="mt-2 text-sm text-[#6B6B6B] leading-relaxed">{detail.body}</p>
        <p className="mt-3 text-sm text-[#6B6B6B] leading-relaxed">
          If trying again does not help, this is a configuration problem rather than something you
          can fix from here — ask in <span className="font-medium text-[#1A1A1A]">#barrel</span>.
        </p>
        <div className="mt-6 flex items-center gap-3">
          {/* Not a link back to "/" — that is the gate, and re-entering it is what loops. This
              starts the handshake from the Labs end instead. */}
          <a
            href="https://barrel-labs.vercel.app/go/site-audit"
            className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
          >
            Try again via Barrel Labs
          </a>
        </div>
      </div>
    </div>
  );
}
