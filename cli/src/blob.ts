import { get, put } from "@vercel/blob";
import { dataRoot } from "./paths.js";

export async function readBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    // useCache: false — this is read-modify-write territory (the manifest gets read then
    // re-uploaded on every run); a CDN-cached stale read here silently drops other reports.
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return (await new Response(result.stream).json()) as T;
  } catch {
    return null;
  }
}

export async function writeBlobJson(pathname: string, data: unknown): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(`BLOB_READ_WRITE_TOKEN is not set. Add it to ${dataRoot()}/.env (see README).`);
  }
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** Uploads binary content (e.g. a screenshot) to Blob storage and returns its pathname.
 * Returns null (never throws) so a screenshot upload failure never fails the whole audit. */
export async function writeBlobBinary(pathname: string, data: Buffer, contentType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    await put(pathname, data, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return pathname;
  } catch {
    return null;
  }
}
