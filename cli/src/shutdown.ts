import { killAll } from "chrome-launcher";

const SHOW_CURSOR = "\u001B[?25h";

/** Every headless Chrome in an audit is launched by chrome-launcher (Lighthouse, axe, the ADA
 * probe, pixels, UX, screenshots, competitors), and chrome-launcher spawns each one `detached` —
 * in its own process group, reparented to init. That means the process-group kill behind the
 * dashboard's Stop button (killRunTree in web/app/api/run/route.ts and cli/src/commands/serve.ts)
 * reaches this CLI but *not* the browsers it started: verified by observing a Chrome with ppid 1
 * still running, and still spawning renderers, a minute after its parent audit had been killed.
 *
 * chrome-launcher tracks its instances in module state, so killAll() closes exactly the browsers
 * this process opened and nothing else — notably not the user's own Chrome. In a normal run the
 * analyzers' own `finally` blocks handle this; a signal skips every one of them, which is what
 * this is for. killAll() is synchronous, so it completes before the process.exit() below.
 *
 * Not registered for SIGKILL, which by definition can't be — a `kill -9` of an audit can still
 * leave a browser behind, which is why killRunTree only escalates to SIGKILL after giving SIGTERM
 * five seconds to get here first. */
export function installBrowserCleanup(): void {
  let shuttingDown = false;

  const handle = (signal: "SIGINT" | "SIGTERM" | "SIGHUP", exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // ora hides the cursor while spinning and restores it when stopped, which a signal skips;
    // without this an interactive Ctrl+C leaves the terminal with an invisible cursor.
    if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR);
    const failures = killAll();
    console.log(
      `\nStopped (${signal}) — closed the headless browsers this run opened.` +
        (failures.length > 0 ? ` ${failures.length} may not have exited cleanly.` : ""),
    );
    process.exit(exitCode);
  };

  // process.once, not process.on: a second signal while the first is still being handled should
  // fall through to Node's default and kill this process outright, rather than be swallowed.
  process.once("SIGINT", () => handle("SIGINT", 130));
  process.once("SIGTERM", () => handle("SIGTERM", 143));
  process.once("SIGHUP", () => handle("SIGHUP", 129));
}
