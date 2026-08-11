import { MANIFEST_BLOB_PATH, type Manifest, type ManifestEntry } from "@barrel/site-audit-shared";
import { readBlobJson, writeBlobJson } from "../blob.js";

export async function readManifest(): Promise<Manifest> {
  return (await readBlobJson<Manifest>(MANIFEST_BLOB_PATH)) ?? { reports: [] };
}

export async function appendToManifest(entry: ManifestEntry): Promise<void> {
  const manifest = await readManifest();
  manifest.reports = manifest.reports.filter((r) => r.id !== entry.id);
  manifest.reports.unshift(entry);
  await writeBlobJson(MANIFEST_BLOB_PATH, manifest);
}
