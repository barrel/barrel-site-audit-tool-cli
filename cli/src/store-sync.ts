// Keeps a store's config.json in two places: the local stores/<slug>/config.json a CLI run reads,
// and a mirror in Blob that the hosted dashboard — and a cloud run, which has no stores/ directory
// of its own — can read and write. Blob is the shared copy, not the source of truth: a local run
// never waits on it, and every function here is a no-op without BLOB_READ_WRITE_TOKEN so the CLI
// keeps working entirely offline.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  STORES_INDEX_BLOB_PATH,
  storeConfigBlobPath,
  type StoreConfig,
  type StoresIndex,
} from "@barrel/site-audit-shared";
import { readBlobJson, writeBlobJson } from "./blob.js";
import { dataRoot, storeConfigPath, storesDir, storeThemeDir } from "./paths.js";

/** Everything except the fields that only mean something on one machine. `localThemeDir` is an
 * absolute path in somebody's home directory: shared, it would point a cloud run (or a
 * teammate's) at a directory that doesn't exist, and silently skip code review. */
function shareable(store: StoreConfig): StoreConfig {
  const { localThemeDir: _localThemeDir, ...rest } = store;
  return rest;
}

export async function mirrorStoreConfig(store: StoreConfig): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    // Merged over whatever is already up there, never a blind overwrite. The same store can exist
    // in more than one data root on one machine (a barrel-site-audit checkout and ~/.barrel-audit
    // both have stores/), and those copies know different things: one may carry the linked GitHub
    // repo, the other the GA4 property. Overwriting silently drops the half the writer didn't have.
    const existing = (await readStoreConfigFromBlob(store.slug).catch(() => null)) ?? undefined;
    await writeBlobJson(storeConfigBlobPath(store.slug), { ...existing, ...shareable(store) });
    const index = (await readBlobJson<StoresIndex>(STORES_INDEX_BLOB_PATH)) ?? { stores: [] };
    index.stores = [
      { slug: store.slug, name: store.name, url: store.url, updatedAt: new Date().toISOString() },
      ...index.stores.filter((s) => s.slug !== store.slug),
    ];
    await writeBlobJson(STORES_INDEX_BLOB_PATH, index);
  } catch {
    // Best-effort by design: a store you can't share is still a store you can audit.
  }
}

export async function readStoreConfigFromBlob(slug: string): Promise<StoreConfig | null> {
  return await readBlobJson<StoreConfig>(storeConfigBlobPath(slug));
}

/** Materializes a store created elsewhere (the dashboard, or a teammate) into the local
 * stores/ directory so the rest of the CLI — all of which reads config.json synchronously — finds
 * it. Call before resolveStore() anywhere a slug might refer to a store this machine has never
 * seen. Returns true if it wrote one. */
export async function ensureLocalStoreConfig(slugOrUrl: string): Promise<boolean> {
  if (slugOrUrl.includes("://")) return false;
  const configPath = storeConfigPath(slugOrUrl);
  if (existsSync(configPath)) return false;

  const fromBlob = await readStoreConfigFromBlob(slugOrUrl).catch(() => null);
  if (!fromBlob) return false;

  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(storeThemeDir(slugOrUrl), { recursive: true });
  writeFileSync(configPath, JSON.stringify(fromBlob, null, 2));
  return true;
}

/** One-shot backfill: pushes every store this machine already has into the shared Blob registry.
 * Only needed once, when a checkout full of stores predates the registry — after that every write
 * path mirrors on its own. */
export async function syncAllStores(): Promise<{ synced: string[]; skipped: string[] }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(`BLOB_READ_WRITE_TOKEN is not set. Add it to ${dataRoot()}/.env (see README).`);
  }
  const dir = storesDir();
  const synced: string[] = [];
  const skipped: string[] = [];
  const slugs = existsSync(dir) ? readdirSync(dir) : [];

  for (const slug of slugs) {
    const configPath = storeConfigPath(slug);
    if (!existsSync(configPath)) continue;
    try {
      const store = JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig;
      await mirrorStoreConfig(store);
      synced.push(slug);
    } catch {
      skipped.push(slug);
    }
  }
  return { synced, skipped };
}
