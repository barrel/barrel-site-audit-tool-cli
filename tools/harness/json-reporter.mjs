// A node:test reporter that emits one JSON object per line.
//
// Node ships tap/spec/dot/junit reporters; none of them gives the harness a structured list of
// which individual tests failed, and the retry logic needs exactly that — re-running a whole file
// to confirm one flaky assertion is both slower and less informative than re-running the test.
// Parsing nested TAP back into that structure is more code, and more fragile code, than this.
export default async function* jsonReporter(source) {
  for await (const event of source) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      const { name, nesting, details, file, line } = event.data;
      // Suites report a pass/fail of their own once their children are done; counting them would
      // double every result.
      if (details?.type === "suite") continue;
      yield `${JSON.stringify({
        status: event.type === "test:pass" ? (event.data.skip || event.data.todo ? "skipped" : "passed") : "failed",
        name,
        nesting,
        file,
        line,
        ms: details?.duration_ms ?? 0,
        error: details?.error ? String(details.error.message ?? details.error).slice(0, 2000) : undefined,
      })}\n`;
    }
  }
}
