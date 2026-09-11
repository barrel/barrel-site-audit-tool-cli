import { killAll } from "chrome-launcher";
import type { ReportCoverage, SectionCoverage, SectionKey, SectionTruncation } from "@barrel/site-audit-shared";

/** Records what every analyzer did, so the report can distinguish "ran and found nothing" from
 * "never looked" — see SectionStatus for why those being indistinguishable was a problem.
 *
 * It is also where the run stops being able to hang forever. There was no timeout of any kind
 * around an analyzer before this: a Lighthouse pass that never returned took the whole audit with
 * it, with no output and nothing in the record to say which stage it died in. */

/** Ceiling on one analyzer's wall-clock time.
 *
 * Sized off the slowest thing that legitimately happens: a Lighthouse sweep is eight full page
 * loads across four journey pages and two form factors, and on a cold cache over a slow connection
 * that genuinely takes minutes. The budget is not a performance target — it is the point past
 * which "still working" and "wedged" stop being distinguishable, and a report that names the
 * wedged section beats an audit that never finishes. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** sitespeed.io is three real-browser iterations in a separate CLI with its own browser
 * automation, opted into precisely because the caller accepts it is slow. */
export const SLOW_ANALYZER_TIMEOUT_MS = 20 * 60_000;

class TimeoutError extends Error {}

export interface RunSectionOptions {
  timeoutMs?: number;
}

export interface CoverageTracker {
  /** The record so far. Mutated as the run proceeds; read once at the end. */
  readonly coverage: ReportCoverage;
  /** The operator asked for this not to run. */
  skipped(key: SectionKey, reason: string): void;
  /** An input nobody withheld on purpose is missing. */
  notApplicable(key: SectionKey, reason: string): void;
  /** The analyzer kept only some of what it found. */
  truncated(key: SectionKey, truncation: SectionTruncation): void;
  /** Run an analyzer, recording when it started and finished and what became of it. Returns
   * `undefined` where the analyzer failed, so a caller assigning straight onto `sections` behaves
   * exactly as it did before — the difference is that the failure is now written down.
   *
   * A `null` result counts as a failure. Most analyzers here swallow their own errors and return
   * null, which moves the "crashed looks like clean" conflation inside the analyzer rather than
   * removing it; at this call site the reader's takeaway is the same either way — the section is a
   * coverage gap. Preconditions that are knowable *before* calling (no theme, no GA4 property, no
   * ADA scope) are not this: generate.ts checks those and records `not-applicable` without ever
   * invoking the analyzer. */
  run<T>(
    key: SectionKey,
    fn: () => Promise<T> | T,
    options?: RunSectionOptions,
  ): Promise<NonNullable<T> | undefined>;
}

function withTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`exceeded its ${Math.round(timeoutMs / 60_000)}-minute budget`)), timeoutMs);
    Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
  });
}

export function createCoverageTracker(): CoverageTracker {
  const coverage: ReportCoverage = {};

  function set(key: SectionKey, entry: SectionCoverage): void {
    coverage[key] = { ...coverage[key], ...entry };
  }

  return {
    coverage,

    skipped(key, reason) {
      set(key, { status: "skipped", reason });
    },

    notApplicable(key, reason) {
      set(key, { status: "not-applicable", reason });
    },

    truncated(key, truncation) {
      const existing = coverage[key];
      // Only ever annotates a section that ran — a cap on output nothing produced is nonsense,
      // and silently creating a "ran" entry here would be a way to launder a skip into a result.
      if (existing?.status === "ran") set(key, { ...existing, truncated: truncation });
    },

    async run(key, fn, options = {}) {
      const startedAt = new Date().toISOString();
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      try {
        const value = await withTimeout(fn, timeoutMs);
        const finishedAt = new Date().toISOString();
        if (value === null || value === undefined) {
          set(key, { status: "failed", startedAt, finishedAt, reason: "the analyzer produced no result" });
          return undefined;
        }
        set(key, { status: "ran", startedAt, finishedAt });
        return value;
      } catch (err: unknown) {
        // A timed-out analyzer is almost always a wedged headless Chrome, and chrome-launcher
        // spawns each one detached — nothing else in this process will ever close it, and it would
        // hold the audit open past its own last line. killAll() closes exactly the browsers this
        // process opened (see shutdown.ts), and analyzers run strictly one at a time, so the only
        // live browser at this moment is the one that just failed to finish.
        if (err instanceof TimeoutError) killAll();
        set(key, {
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          reason: err instanceof Error ? err.message : String(err),
        });
        return undefined;
      }
    },
  };
}
