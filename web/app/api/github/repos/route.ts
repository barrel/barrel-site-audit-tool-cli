import { NextRequest, NextResponse } from "next/server";
import { NotConnectedError, githubBranches, searchGithubRepos } from "@/lib/github";

export const dynamic = "force-dynamic";

/** Repo search for the dashboard's picker — GitHub-side, so it works on an instance with more
 * repositories than any page could list.
 *
 * `?branches=owner/repo` asks for one repo's branches instead, which is the second thing the
 * picker needs and not worth its own route. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  try {
    const forBranches = params.get("branches");
    if (forBranches) {
      return NextResponse.json({ branches: await githubBranches(forBranches) });
    }

    const repos = await searchGithubRepos({
      query: params.get("q") ?? undefined,
      org: params.get("org") ?? undefined,
      limit: Number.parseInt(params.get("limit") ?? "30", 10) || 30,
      includeArchived: params.get("archived") === "1",
    });
    return NextResponse.json({ repos });
  } catch (err: unknown) {
    if (err instanceof NotConnectedError) {
      return NextResponse.json({ error: "Not connected to GitHub in this browser.", connected: false }, { status: 401 });
    }
    const message = String((err as Error)?.message ?? err);
    // GitHub's search endpoint allows 30 requests a minute. Worth naming, because the symptom (an
    // empty result for a repo the person knows exists) otherwise reads as "it can't find it".
    const rateLimited = /rate limit|secondary rate/i.test(message);
    return NextResponse.json(
      {
        error: rateLimited
          ? "GitHub is rate-limiting the search (30 a minute). Wait a moment and try again."
          : `GitHub search failed: ${message}`,
      },
      { status: rateLimited ? 429 : 502 },
    );
  }
}
