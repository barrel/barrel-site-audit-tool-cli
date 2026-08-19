"use client";

/** Print / Save-as-PDF trigger.
 *
 * The browser's own print dialog rather than a server-side PDF renderer: it already produces a
 * faithful PDF from the print stylesheet, needs no headless Chrome on the deployed instance, and
 * keeps selectable text and working links in the output — which a rasterised page would not. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
    >
      Print / Save as PDF
    </button>
  );
}
