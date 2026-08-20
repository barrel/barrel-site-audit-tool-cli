import { PageTitle, TopNav } from "@/components/TopNav";

export const metadata = {
  title: "How to run a site audit — Barrel Site Audit",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center text-sm font-bold">
        {n}
      </div>
      <div className="flex-1 min-w-0 pb-8">
        <h3 className="text-base font-semibold text-[#1A1A1A] mb-1.5">{title}</h3>
        <div className="text-sm text-[#6B6B6B] leading-relaxed space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#1A1A1A] text-[#f0efed] rounded-lg px-4 py-3 font-mono text-[13px] overflow-x-auto">
      {children}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 bg-[#3B82F6]/[0.06] border border-[#3B82F6]/25 rounded-lg px-4 py-3 text-sm text-[#1A1A1A]">
      <span className="text-[#3B82F6] mt-px shrink-0">ⓘ</span>
      <div>{children}</div>
    </div>
  );
}

export default function InstructionsPage() {
  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="CLI Instructions" />

      <main className="max-w-[760px] mx-auto px-5 lg:px-8 py-12">
        <div className="mb-10">
          <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-2">
            Getting started
          </div>
          <h2 className="text-3xl font-semibold text-[#1A1A1A] tracking-tight mb-3">
            How to run a site audit
          </h2>
          <p className="text-[15px] text-[#6B6B6B] leading-relaxed">
            This tool checks a Shopify store's website — how fast it loads, whether it's easy to
            use for people with disabilities, how good it is for Google search, whether it's
            ready for AI shopping assistants like ChatGPT and Perplexity to find and recommend it,
            whether a couple of key pages (a collection page and a product page) are set up to
            convert browsers into buyers, whether marketing pixels (like Facebook or Google Ads
            tracking) are actually working, and more — plus an AI-generated, prioritized list of
            specific things to fix for speed and accessibility. It puts all of that into one clear
            report you can share with a client. No coding knowledge needed to run it — just some
            copy-and-pasting into a window called <b className="text-[#1A1A1A]">Terminal</b>.
          </p>
        </div>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-4">
            Before you start (one-time setup)
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-4">
            Someone technical (an engineer, or whoever set this tool up) needs to do this part
            once per computer. After that, running reports is just steps 1–4 below, every time.
          </p>
          <ul className="space-y-2.5 text-sm text-[#6B6B6B]">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
              <span>Node.js and pnpm installed (free developer tools — a 5-minute install)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
              <span>
                The <span className="font-mono text-[#1A1A1A]">barrel-site-audit</span> project
                downloaded from Barrel&apos;s GitHub onto your computer
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
              <span>
                A secret &quot;key&quot; file ({" "}
                <span className="font-mono text-[#1A1A1A]">.env</span>) that lets the tool save
                reports — ask in Slack{" "}
                <span className="font-mono text-[#1A1A1A]">#barrel</span> if you don&apos;t have
                this yet
              </span>
            </li>
          </ul>
          <div className="mt-4">
            <Callout>
              If any of this sounds unfamiliar, that&apos;s completely fine — ask an engineer to
              sit with you for 10 minutes the first time. Once it&apos;s set up, you won&apos;t
              need to think about it again.
            </Callout>
          </div>
        </section>

        <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-6">
          Running a report
        </h3>

        <div>
          <Step n={1} title="Open Terminal">
            <p>
              On a Mac: press <span className="font-mono text-[#1A1A1A]">Cmd + Space</span>, type{" "}
              <span className="font-mono text-[#1A1A1A]">Terminal</span>, and press Enter. A plain
              black-and-white window will open — that&apos;s where you&apos;ll type commands.
            </p>
          </Step>

          <Step n={2} title="Go to the project folder">
            <p>
              Type <span className="font-mono text-[#1A1A1A]">cd</span> (with a space after it),
              then drag the <span className="font-mono text-[#1A1A1A]">barrel-site-audit</span>{" "}
              folder from Finder directly into the Terminal window — it'll fill in the folder's
              path for you. Press Enter.
            </p>
          </Step>

          <Step n={3} title="Run the audit — paste the client's website address">
            <p>
              Type the following, replacing the example web address with the real client
              storefront, then press Enter:
            </p>
            <Code>pnpm barrel-audit run https://client-store.com</Code>
            <p>
              That&apos;s the whole command. You&apos;ll see progress messages scroll by — this is
              normal. A full check (including testing the homepage, a collection page, a product
              page, and the cart, on both phone and computer) can take several minutes. Just let it
              run.
            </p>
            <Callout>
              If this is a brand-new store and GitHub access is set up on the project, it may
              pause here to ask: &quot;Connect a GitHub repo now?&quot; Type{" "}
              <span className="font-mono text-[#1A1A1A]">y</span> and Enter if the theme&apos;s
              code lives in a GitHub repo and you want the deeper code checks in this same run.
              The very first time, it&apos;ll show a short code and a github.com link — open the
              link in your browser, type in the code, and click Approve; after that it
              remembers you on this computer and won&apos;t ask again. Then you&apos;ll get to
              search and pick the repo. Otherwise type{" "}
              <span className="font-mono text-[#1A1A1A]">n</span> and Enter to skip it; nothing
              breaks either way.
            </Callout>
          </Step>

          <Step n={4} title="View the finished report">
            <p>
              Open{" "}
              <a
                href="https://barrel-site-audit.vercel.app"
                target="_blank"
                rel="noreferrer"
                className="text-[#2563EB] hover:underline"
              >
                barrel-site-audit.vercel.app
              </a>{" "}
              in your browser, enter the site password (ask in{" "}
              <span className="font-mono text-[#1A1A1A]">#barrel</span> if you don&apos;t have
              it), and the new report is already sitting at the top of the list — no extra step to
              publish it. You can search by store name and page through past reports too.
            </p>
            <p className="mt-2">
              Need to send the report to someone without site access — a client or prospect?
              Click <span className="font-medium text-[#1A1A1A]">Share</span> at the top of any
              report page. It copies a private link that opens the full report with no login
              required and stops working after 30 days.
            </p>
          </Step>
        </div>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Optional: a deeper check using the theme's actual code
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The steps above already cover performance, SEO, accessibility, and tracking-pixel
            checks — no extra work needed. For an even deeper report that also reviews the
            store's underlying code for messy or leftover files, get the theme's files into the
            store's folder first:
          </p>
          <Code>pnpm barrel-audit pull-theme &lt;slug&gt; --store &lt;slug&gt;.myshopify.com</Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            (This opens a browser window to log in to Shopify — normal, just approve it.)
            Or, if you already have the theme's files some other way — downloaded from Shopify,
            unzipped, whatever — you can just drag and drop those files into the store's{" "}
            <span className="font-mono text-[#1A1A1A]">theme</span> folder yourself, no command
            needed. Then run step 3 again.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Optional: pulling the theme code from GitHub instead
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            If the client's theme code lives in a GitHub repo rather than a live Shopify store,
            this pulls it in the same way — no Shopify login needed. Works with a store slug
            from an earlier step, or you can paste the storefront URL directly, same as step 3:
          </p>
          <Code>pnpm barrel-audit link-repo &lt;slug-or-url&gt;</Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            The first time you run this, it shows a short code and a github.com link — open the
            link, type in the code, and click Approve. After that, you won&apos;t be asked
            again on this computer. Then you&apos;ll be asked to pick from your GitHub repos
            (type a few letters to search). This needs a one-time project setup too — an
            engineer adds a GitHub app ID to the{" "}
            <span className="font-mono text-[#1A1A1A]">.env</span> file once, shared by
            everyone — ask in Slack <span className="font-mono text-[#1A1A1A]">#barrel</span> if
            that hasn&apos;t been done yet. Then run step 3 again.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Optional: real traffic &amp; revenue numbers (Google Analytics)
          </h3>
          <p className="text-sm text-[#6B6B6B]">
            If a client's Google Analytics is connected, reports also show real sessions,
            conversion rate, average order value, and revenue — not just technical scores.
            This needs a one-time setup (an engineer creates a Google credential once) and,
            per client, one email added as a viewer on their end. See{" "}
            <span className="font-mono text-[#1A1A1A]">docs/ga4-setup.md</span> in the
            project for the walkthrough. Nothing else in the report is affected if this
            isn&apos;t set up — that section just doesn&apos;t appear.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Optional: checking off a client&apos;s ADA scope
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            If accessibility work was scoped for this client, paste that scope into the{" "}
            <span className="font-medium text-[#1A1A1A]">ADA scope</span> box on the Run Audit form
            — straight out of the SOW, bullets and all, one requirement per line. Every line comes
            back as a checklist item on the report&apos;s ADA tab: ticked when an automated check
            verified it, and otherwise carrying a specific instruction a developer can act on
            (which elements, on which page, and what to change).
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The checks behind those ticks are the industry-standard ones: axe-core, Google
            Lighthouse&apos;s accessibility audit — whose score is shown right on the section — and
            a live pass that tabs through each page the way a keyboard user does, watching for
            controls TAB can&apos;t reach, focus outlines that never appear, and a skip-navigation
            link that works. Items no automated test can settle (captions, a screen-reader pass,
            zoom behavior) are labelled as needing a manual check rather than quietly counted as
            done, with a checkbox you can tick yourself once you&apos;ve verified them.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The section has two copy buttons:{" "}
            <span className="font-medium text-[#1A1A1A]">Copy client update</span> gives you a
            plain-English summary to paste into an email — what&apos;s verified, what&apos;s
            outstanding, no jargon or CSS selectors — and{" "}
            <span className="font-medium text-[#1A1A1A]">Copy dev actions</span> gives the
            developer version, with the failing elements and the fix for each. Outstanding scope
            items also flow into the Dev To-Do list alongside everything else.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            From Terminal instead, put the scope in a text file and point at it — handy since it
            usually spans several lines:
          </p>
          <div className="mt-3">
            <Code>pnpm barrel-audit run &lt;slug-or-url&gt; --ada-scope-file ./ada-scope.txt</Code>
          </div>
          <p className="text-sm text-[#6B6B6B] mt-3">
            Either way the scope is saved against that store, so re-running the audit later
            re-checks the same list without you pasting it again.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Optional: comparing against a competitor
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Great for sales conversations — add one or more competitor storefront URLs and the
            report will include a side-by-side scorecard comparing them to the client's own
            site:
          </p>
          <Code>
            pnpm barrel-audit run &lt;slug-or-url&gt; --competitor https://competitor-site.com
          </Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            Add <span className="font-mono text-[#1A1A1A]">--competitor</span> again to compare
            against more than one site at once. Screenshots of the client's homepage — and of
            each competitor — are captured automatically and shown right in the report, no
            extra step needed.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Prefer clicking over typing?
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The "+ Run Audit" button on the landing page opens a form — paste a URL, check the
            boxes for what to include, click "Run audit," and watch it go. Changed your mind, or
            picked the wrong store? "Stop audit" on the progress screen ends the run on your
            machine straight away (it asks first, since nothing is saved).
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            If you leave "Theme code &amp; structure" checked, the audit needs the theme's actual
            source code. Put the folder path in the "Theme code location" box — the folder that
            contains <span className="font-mono text-[#1A1A1A]">layout/theme.liquid</span>, e.g.{" "}
            <span className="font-mono text-[#1A1A1A]">/Users/you/code/client-theme</span>. It's
            remembered for that store, so you only enter it once. If it's left blank and the store
            has no code saved from before, the run stops immediately and tells you — rather than
            spending ten minutes and handing back a report that quietly has no code findings in it.
            Auditing a prospect whose code you don't have? Untick that box.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            To use this from the hosted version of the site (not just when running it on your
            own computer), run{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm barrel-audit serve</span> in Terminal
            first — it prints a one-time code. Paste that code into the "Local agent" box at the
            top of the Run Audit form (only needs to be done once per computer), and from then on
            "Run audit" works from the hosted dashboard too, not just your own machine's copy of
            the site.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            That exact command only works from inside a copy of the audit tool's own repo. If you
            installed the CLI globally instead, drop the{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm</span> and run{" "}
            <span className="font-mono text-[#1A1A1A]">barrel-audit serve</span> from any folder —
            including a client theme repo. Running{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm barrel-audit serve</span> somewhere
            without a <span className="font-mono text-[#1A1A1A]">package.json</span> is what
            produces the <span className="font-mono text-[#1A1A1A]">
              ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND
            </span>{" "}
            error.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Getting AI to draft an actual code fix
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            On the Dev To-Do list, any item that points at a specific theme file shows a
            "Suggest fix" button. Clicking it (needs the same local agent set up above) asks
            Claude to draft a fix for just that one item and shows you the change before anything
            happens — nothing is written or sent anywhere until you review it.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            From there you get three independent choices, pick any: <b>Open in VS Code</b> to edit
            it yourself on a local branch first; <b>Test live</b> to preview the change on the
            actual storefront via the Shopify CLI, nothing pushed; or <b>Push branch &amp; open
            PR</b> to send it to GitHub for someone to review and merge normally. This never
            merges anything itself, and nothing runs for more than the one item you clicked.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Tracking progress over multiple audits
          </h3>
          <p className="text-sm text-[#6B6B6B]">
            Running the same store more than once — e.g. before/during/after a build — just
            works: re-run <span className="font-mono text-[#1A1A1A]">pnpm barrel-audit run</span>{" "}
            against the same slug or URL any time. The "Baseline & Reporting" link on the landing
            page and on every report shows every store's score trend over time, and any run can be marked the
            baseline (a "Set baseline" button on its row) so later runs show a clear improved/
            regressed delta against it — with no baseline set, the earliest run is used
            automatically.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-4">
            Common questions
          </h3>
          <div className="space-y-5 text-sm">
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">
                Do I need to "publish" or "deploy" anything after running a report?
              </div>
              <div className="text-[#6B6B6B]">
                No. The moment the command in step 3 finishes, the report is already live on the
                website. There's nothing else to do.
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">
                I typed the command and nothing seems to be happening.
              </div>
              <div className="text-[#6B6B6B]">
                That's normal for the first minute or two — it's opening a hidden browser and
                testing pages behind the scenes. As long as Terminal hasn't shown an error message
                in red, it's still working.
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">I don't know the site password.</div>
              <div className="text-[#6B6B6B]">
                Ask in Slack <span className="font-mono text-[#1A1A1A]">#barrel</span>.
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">Can I run this on the same store again later?</div>
              <div className="text-[#6B6B6B]">
                Yes — run the exact same command again any time (e.g. after a client makes
                changes). Nothing gets overwritten; every run is saved and kept in the report
                history for that store.
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">Where does this tool actually live?</div>
              <div className="text-[#6B6B6B]">
                It's a project in Barrel's GitHub, named{" "}
                <span className="font-mono text-[#1A1A1A]">barrel-site-audit</span>. If you don't
                have access or aren't sure how to download it, ask an engineer.
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
