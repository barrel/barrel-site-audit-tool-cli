import { NextRequest, NextResponse } from "next/server";
import { getStoreConfig, saveStoreConfig } from "@/lib/data";
import { getLabsSession } from "@/lib/labs-session";
import { NotConnectedError, findThemeRootInRepo, githubRepo, splitFullName } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Records (or clears) a store's GitHub connection from the dashboard.
 *
 * Only ever writes the store's own config — never the repository. `"read"` mode is complete after
 * this call: nothing has to be on any particular disk, so a connection made here works for the
 * next audit whoever runs it. `"pull"` mode is different, because "a copy on disk" means a
 * specific disk: the dashboard records the connection here and the actual clone is done by the
 * local agent (`barrel-audit serve` → POST /github/pull), which is the only thing that has one.
 */

interface LinkBody {
  slug?: string;
  /** "owner/repo". Empty string disconnects. */
  repo?: string;
  branch?: string;
  mode?: "pull" | "read";
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as LinkBody | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
  const mode = body?.mode === "pull" ? "pull" : "read";

  if (!slug) return NextResponse.json({ error: "Missing store slug." }, { status: 400 });

  const config = await getStoreConfig(slug);
  if (!config) {
    return NextResponse.json(
      {
        error:
          `No store "${slug}" has been synced yet. Run an audit for it once, or \`barrel-audit init-store ${slug}\`, ` +
          `so its config exists to connect a repo to.`,
      },
      { status: 404 },
    );
  }

  // Disconnect. themeSubdir goes with it: it describes a path inside the repo that is no longer
  // connected, and leaving it behind would silently misdirect a later pull-theme or local run.
  if (!repo) {
    const { githubRepo: _r, githubBranch: _b, githubMode: _m, themeSubdir: _s, githubConnectedAt: _a, githubConnectedBy: _by, ...rest } = config;
    await saveStoreConfig(rest);
    return NextResponse.json({ connected: false });
  }

  try {
    splitFullName(repo);
  } catch (err: unknown) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }

  try {
    // Resolve the repo before saving anything: it confirms this login can actually see it, and
    // supplies the default branch when none was chosen. Saving an unreadable repo would look like
    // success here and fail on the next run, which is the wrong place to find out.
    const resolved = await githubRepo(repo);
    const branch = body?.branch?.trim() || resolved.defaultBranch;

    // Where the theme sits inside the repo — one tree read, no checkout. The check that matters:
    // a connection to a repo with no layout/theme.liquid produces a report with no Theme Code
    // section, which reads as "nothing to flag" rather than "never looked".
    const location = await findThemeRootInRepo(repo, branch).catch(() => null);

    const session = await getLabsSession();
    await saveStoreConfig({
      ...config,
      githubRepo: resolved.fullName,
      githubBranch: branch,
      githubMode: mode,
      // Omitted rather than empty when the theme is at the repo root: an empty string would have
      // every later run look for a directory called "".
      ...(location?.subdir ? { themeSubdir: location.subdir } : { themeSubdir: undefined }),
      githubConnectedAt: new Date().toISOString(),
      githubConnectedBy: session?.email,
    });

    return NextResponse.json({
      connected: true,
      repo: resolved.fullName,
      branch,
      mode,
      private: resolved.private,
      themeSubdir: location?.subdir || undefined,
      warning: location
        ? location.found
          ? undefined
          : `Connected, but no layout/theme.liquid was found in ${resolved.fullName} (${branch})` +
            `${location.truncated ? " — GitHub truncated the file listing, so it may be there and simply not visible in one read" : ""}. ` +
            `Theme code review will error out on the next run rather than quietly producing an empty section.`
        : `Connected, but the repo's file listing couldn't be read, so the theme path wasn't verified.`,
    });
  } catch (err: unknown) {
    if (err instanceof NotConnectedError) {
      return NextResponse.json(
        { error: "Not connected to GitHub in this browser — connect above first.", connected: false },
        { status: 401 },
      );
    }
    const message = String((err as Error)?.message ?? err);
    return NextResponse.json(
      {
        error: /not found|404/i.test(message)
          ? `GitHub has no repository "${repo}" that this login can see. Check the name, or whether you have access to it.`
          : `Could not connect that repo: ${message}`,
      },
      { status: 400 },
    );
  }
}
