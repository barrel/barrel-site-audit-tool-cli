import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** This package's own version, read from the package.json shipped alongside dist/ rather than
 * hardcoded so it can never drift from what was actually published. Stamped onto every report
 * (`runner.cliVersion`) — which build produced a number is part of reading it, especially once
 * the same audit can run on a laptop or in a sandbox image pinned to an older CLI. */
export function cliVersion(): string {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8")).version;
  } catch {
    return "unknown";
  }
}
