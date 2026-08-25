// Turns a dashboard-submitted CRO run request into the exact argv `cro` expects, validated up front
// so nothing unvalidated reaches a spawned child process's argv.
//
// Separate from run-args.ts rather than added to it, for two reasons: the two commands share no
// flags, and the drift test that keeps run-args.ts in step with web/app/api/run/route.ts works by
// comparing every `--flag` literal in each file — a CRO flag living in run-args.ts would read as a
// site-audit flag the dashboard had forgotten to send.

import { validateTarget } from "./run-args.js";
import { CRO_DEVICES, CRO_PAGE_GROUPS, type CroDevice, type CroPageGroup } from "./cro-types.js";

export interface CroRunBody {
  target: string;
  /** Skip the page-group capture and the UX slides drafted from it. Leaves a run that does nothing
   * a browser is needed for, which is only useful alongside --skip-competitors=false. */
  skipUx?: boolean;
  skipCompetitors?: boolean;
  /** Capture the pages and write the evidence blob, but draft no slides. For a run whose
   * interpretation you intend to do (or redo) from the dashboard. */
  captureOnly?: boolean;
  /** Also walk checkout step 1. Off by default because reaching it means adding a real item to a
   * real cart on the client's live store, which leaves an abandoned checkout in their admin. */
  checkout?: boolean;
  groups?: CroPageGroup[];
  devices?: CroDevice[];
  /** Competitor storefronts for the benchmark step. Saved to the store's brief, so a later run for
   * the same store does not need them again. */
  competitorUrls?: string[];
}

/** Three is the working number for a competitive benchmark, and each one is a full page-group
 * capture — the same real local browser cost as auditing the client's own site. */
export const MAX_CRO_COMPETITORS = 3;

/** Checkout is excluded from the default set on purpose — see CroRunBody.checkout. */
export const DEFAULT_CRO_GROUPS: readonly CroPageGroup[] = ["nav", "home", "plp", "pdp", "cart"];

export function validateGroups(values: string[]): CroPageGroup[] {
  const allowed = new Set<string>(CRO_PAGE_GROUPS);
  const out: CroPageGroup[] = [];
  for (const raw of values) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (!allowed.has(value)) {
      throw new Error(`"${raw}" is not a page group. Expected one of: ${CRO_PAGE_GROUPS.join(", ")}.`);
    }
    if (!out.includes(value as CroPageGroup)) out.push(value as CroPageGroup);
  }
  return out;
}

export function validateDevices(values: string[]): CroDevice[] {
  const allowed = new Set<string>(CRO_DEVICES);
  const out: CroDevice[] = [];
  for (const raw of values) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (!allowed.has(value)) {
      throw new Error(`"${raw}" is not a device. Expected one of: ${CRO_DEVICES.join(", ")}.`);
    }
    if (!out.includes(value as CroDevice)) out.push(value as CroDevice);
  }
  return out;
}

export function buildCroArgs(body: CroRunBody): string[] {
  const target = validateTarget(body.target, "URL/slug");
  const args = ["cro", target];

  if (body.skipUx) args.push("--skip-ux");
  if (body.skipCompetitors) args.push("--skip-competitors");
  if (body.captureOnly) args.push("--capture-only");
  if (body.checkout) args.push("--checkout");

  const groups = validateGroups(body.groups ?? []);
  if (groups.length > 0) args.push("--groups", groups.join(","));

  const devices = validateDevices(body.devices ?? []);
  if (devices.length > 0) args.push("--devices", devices.join(","));

  const competitors = (body.competitorUrls ?? []).map((c) => c.trim()).filter(Boolean);
  if (competitors.length > MAX_CRO_COMPETITORS) {
    throw new Error(`At most ${MAX_CRO_COMPETITORS} competitor URLs are supported.`);
  }
  for (const c of competitors) {
    args.push("--competitor", validateTarget(c, "Competitor URL"));
  }

  return args;
}
