import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Linting has one authority in this repo, and it is `pnpm check` (tools/harness/lint.mjs) —
  // which runs the same ESLint config against every package and understands the baseline of
  // pre-existing problems recorded in tools/lint-baseline.json. Next runs its own ESLint pass
  // during `next build`, without that baseline, so leaving it on would fail every deploy over
  // problems the gate has already accounted for — and would report them twice on the runs where
  // it did not. The gate runs before `pnpm build` gets this far.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
