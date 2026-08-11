export function screenshotUrl(blobPath: string): string {
  return `/api/screenshot/${blobPath.replace(/^screenshots\//, "")}`;
}
