function hostnameFor(storeUrl: string): string | null {
  try {
    return new URL(storeUrl).hostname;
  } catch {
    return null;
  }
}

/** Small favicon thumbnail for a report row — a quick visual anchor for the audited site.
 * Uses Google's favicon service since we don't crawl/store each site's logo ourselves. */
export function SiteFavicon({ storeUrl, size = 28 }: { storeUrl: string; size?: number }) {
  const hostname = hostnameFor(storeUrl);
  if (!hostname) return <div className="rounded-md bg-[#f0efed] shrink-0" style={{ width: size, height: size }} />;

  return (
    <div
      className="rounded-md border border-[#E5E5E5] bg-white shrink-0 flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`}
        alt=""
        width={size - 8}
        height={size - 8}
        className="object-contain"
      />
    </div>
  );
}
