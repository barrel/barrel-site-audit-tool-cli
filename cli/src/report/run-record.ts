// Publishes what a run is doing, right now, to Blob — so following an audit doesn't depend on
// holding an HTTP connection open to the process running it. That's what makes a cloud run
// followable at all (the sandbox is not reachable from the browser, and no serverless function
// can stay alive for a 12-minute audit), and it incidentally fixes the same weakness locally:
// closing the tab no longer loses track of a run that's still going.
//
// Entirely opt-in: with no BARREL_RUN_ID in the environment every function here is a no-op, so a
// plain `barrel-audit run` from a terminal behaves exactly as it did before.
import {
  RUNS_INDEX_BLOB_PATH,
  runRecordBlobPath,
  type RunMode,
  type RunRecord,
  type RunStatus,
  type RunnerInfo,
  type RunsIndex,
  type StoreConfig,
} from "@barrel/site-audit-shared";
import { readBlobJson, writeBlobJson } from "../blob.js";
import { cliVersion } from "../version.js";

/** Newest-first, capped: this list is read in full on every write, and nobody scrolls back
 * through a thousand finished runs. Older entries just fall off — the reports they produced are
 * unaffected, they live in the manifest. */
const MAX_INDEXED_RUNS = 200;

/** Stage lines arrive in bursts (Lighthouse alone emits one per page per device). One Blob write
 * every couple of seconds is plenty for a UI that polls at the same rate. */
const STAGE_WRITE_INTERVAL_MS = 2_000;

export function runMode(): RunMode {
  return process.env.BARREL_RUNNER === "cloud" ? "cloud" : "local";
}

/** Stamped onto the report itself, so a score is always readable alongside the machine that
 * produced it. Populated even for runs with no BARREL_RUN_ID — it costs nothing and makes the
 * cross-runner warnings in the dashboard work for terminal runs too. */
export function runnerInfo(): RunnerInfo {
  const vcpus = Number(process.env.BARREL_RUNNER_VCPUS);
  return {
    mode: runMode(),
    cliVersion: cliVersion(),
    ...(process.env.BARREL_RUNNER_REGION ? { region: process.env.BARREL_RUNNER_REGION } : {}),
    ...(Number.isFinite(vcpus) && vcpus > 0 ? { vcpus } : {}),
  };
}

function runId(): string | null {
  return process.env.BARREL_RUN_ID?.trim() || null;
}

let current: RunRecord | null = null;
let lastStageWrite = 0;
let pendingStage: string | null = null;

async function writeRecord(record: RunRecord): Promise<void> {
  // Never let a status write fail the audit it's describing: the report is the point, this is
  // commentary on it.
  await writeBlobJson(runRecordBlobPath(record.runId), record).catch(() => {});
}

async function updateIndex(record: RunRecord): Promise<void> {
  try {
    const index = (await readBlobJson<RunsIndex>(RUNS_INDEX_BLOB_PATH)) ?? { runs: [] };
    index.runs = [record, ...index.runs.filter((r) => r.runId !== record.runId)].slice(0, MAX_INDEXED_RUNS);
    await writeBlobJson(RUNS_INDEX_BLOB_PATH, index);
  } catch {
    // Same reasoning as writeRecord: the per-run blob is the one that matters, and it's written
    // independently of this.
  }
}

export async function startRunRecord(store: StoreConfig, target: string): Promise<void> {
  const id = runId();
  if (!id) return;
  current = {
    runId: id,
    mode: runMode(),
    status: "running",
    storeSlug: store.slug,
    storeName: store.name,
    target,
    startedAt: new Date().toISOString(),
    cliVersion: cliVersion(),
  };
  lastStageWrite = 0;
  await writeRecord(current);
  await updateIndex(current);
}

/** Fire-and-forget on purpose — the caller is `onStage`, which runs inside the audit's hot path
 * between analyzers and must not wait on the network. */
export function updateRunStage(stage: string): void {
  if (!current) return;
  current.stage = stage;
  pendingStage = stage;
  const now = Date.now();
  if (now - lastStageWrite < STAGE_WRITE_INTERVAL_MS) return;
  lastStageWrite = now;
  pendingStage = null;
  void writeRecord({ ...current });
}

export async function finishRunRecord(
  outcome: { status: RunStatus; reportId?: string; overallScore?: number; error?: string },
): Promise<void> {
  if (!current) return;
  // Flush a stage that was throttled away, so a run that fails mid-analyzer says which one.
  if (pendingStage) current.stage = pendingStage;
  current = {
    ...current,
    ...outcome,
    finishedAt: new Date().toISOString(),
  };
  await writeRecord(current);
  await updateIndex(current);
}

/** The single failure path, called from index.ts's top-level handler. Covers the case where the
 * run never got far enough to start a record at all (a bad target, a missing token) — there's a
 * run id, so the dashboard is watching for something, and "failed: <reason>" beats a record that
 * never appears. */
export async function recordRunFailure(error: string): Promise<void> {
  if (current) {
    await finishRunRecord({ status: "failed", error });
    return;
  }
  const id = runId();
  if (!id) return;
  const record: RunRecord = {
    runId: id,
    mode: runMode(),
    status: "failed",
    storeSlug: "",
    storeName: "",
    target: process.env.BARREL_RUN_TARGET ?? "",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error,
    cliVersion: cliVersion(),
  };
  await writeRecord(record);
  await updateIndex(record);
}
