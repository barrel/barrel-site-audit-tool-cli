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
            Install it once (about five minutes)
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-4">
            You install one command, called{" "}
            <span className="font-mono text-[#1A1A1A]">barrel-audit</span>. There is no project
            folder to download, nothing to drag into Terminal, and nothing to keep up to date by
            hand — once it&apos;s installed it runs from whatever folder you happen to be in. If
            someone already did this on your computer, skip straight to{" "}
            <b className="text-[#1A1A1A]">Running a report</b> below.
          </p>

          <p className="text-sm font-semibold text-[#1A1A1A] mb-1.5">1. Node.js 22 or newer</p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Type <span className="font-mono text-[#1A1A1A]">node --version</span> in Terminal. If
            it prints <span className="font-mono text-[#1A1A1A]">v22</span> or higher you&apos;re
            done. If it errors, or shows something lower, install the{" "}
            <b className="text-[#1A1A1A]">LTS</b> version from{" "}
            <a
              href="https://nodejs.org"
              target="_blank"
              rel="noreferrer"
              className="text-[#2563EB] hover:underline"
            >
              nodejs.org
            </a>{" "}
            and try again.
          </p>

          <p className="text-sm font-semibold text-[#1A1A1A] mb-1.5">2. The tool</p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Paste these four lines into Terminal, one at a time. They point npm at Barrel&apos;s
            private package registry, prove who you are using your GitHub account, and install the
            command:
          </p>
          <Code>
            gh auth refresh -h github.com -s read:packages
            <br />
            npm config set @barrel:registry https://npm.pkg.github.com
            <br />
            npm config set //npm.pkg.github.com/:_authToken &quot;$(gh auth token)&quot;
            <br />
            npm install -g @barrel/site-audit-cli
          </Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            If the first line says <span className="font-mono text-[#1A1A1A]">gh</span> isn&apos;t
            found, install the GitHub command-line tool first with{" "}
            <span className="font-mono text-[#1A1A1A]">brew install gh</span> then{" "}
            <span className="font-mono text-[#1A1A1A]">gh auth login</span>, and start again. Both
            steps open your browser to approve — that&apos;s expected.
          </p>

          <p className="text-sm font-semibold text-[#1A1A1A] mt-5 mb-1.5">3. Its credentials</p>
          <Code>barrel-audit setup</Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            It asks for one required token — the key that lets your finished reports appear on this
            site. Ask in Slack <span className="font-mono text-[#1A1A1A]">#barrel</span> for it, or
            copy it from the Vercel dashboard (the{" "}
            <span className="font-mono text-[#1A1A1A]">barrel-site-audit</span> project → Storage →
            the Blob store → <span className="font-mono text-[#1A1A1A]">.env.local</span> tab). It
            tests the token before saving anything, so a bad paste fails right there instead of ten
            minutes into an audit. Two optional keys follow — one turns on the AI-written summary
            and recommendations, one turns on pulling theme code from GitHub — and pressing Enter
            skips either.
          </p>

          <div className="mt-4">
            <Callout>
              That&apos;s the whole install. Later on:{" "}
              <span className="font-mono text-[#1A1A1A]">barrel-audit setup --check</span> re-tests
              your keys without changing them, and{" "}
              <span className="font-mono text-[#1A1A1A]">
                npm install -g @barrel/site-audit-cli@latest
              </span>{" "}
              upgrades to the newest version — worth running if a report is missing a section you
              can see on this site.
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
              black-and-white window will open — that&apos;s where you&apos;ll type commands. It
              does not matter which folder it opens in.
            </p>
          </Step>

          <Step n={2} title="Run the audit — paste the client's website address">
            <p>
              Type the following, replacing the example web address with the real client
              storefront, then press Enter:
            </p>
            <Code>barrel-audit run https://client-store.com</Code>
            <p>
              That&apos;s the whole command, and it works from any folder — there&apos;s nothing to{" "}
              <span className="font-mono text-[#1A1A1A]">cd</span> into first. You&apos;ll see
              progress messages scroll by — this is normal. A full check (the homepage, a
              collection page, a product page and the cart, on both phone and computer) can take
              several minutes. Just let it run.
            </p>
            <Callout>
              If this is a brand-new store and GitHub access is set up, it may pause here to ask:
              &quot;Connect a GitHub repo now?&quot; Type{" "}
              <span className="font-mono text-[#1A1A1A]">y</span> and Enter if the theme&apos;s
              code lives in a GitHub repo and you want the deeper code checks in this same run.
              The very first time, it&apos;ll show a short code and a github.com link — open the
              link, type in the code, and click Approve; after that it remembers you on this
              computer and won&apos;t ask again. Then you&apos;ll get to search and pick the repo.
              Otherwise type <span className="font-mono text-[#1A1A1A]">n</span> and Enter to skip
              it; nothing breaks either way.
            </Callout>
          </Step>

          <Step n={3} title="View the finished report">
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
              in your browser and sign in with your Barrel Google account — there is no separate
              password. The new report is already sitting at the top of the list — no extra step to
              publish it. You can search by store name and page through past reports too.
            </p>
            <p className="mt-2">
              Need to send the report to someone without site access — a client or prospect?
              Click <span className="font-medium text-[#1A1A1A]">Share</span> at the top of any
              report page. It copies a private link that opens the full report with no login
              required and stops working after 30 days.
            </p>
          </Step>

          <Step n={4} title="Or drive it from this site instead of typing">
            <p>
              Prefer a form to a command line? Leave the local helper running in Terminal:
            </p>
            <Code>barrel-audit serve</Code>
            <p>
              It prints a one-time code. Paste that into the{" "}
              <b className="text-[#1A1A1A]">Local agent</b> box on the{" "}
              <a href="/run" className="text-[#2563EB] hover:underline">
                Run Audit
              </a>{" "}
              page (once per computer), then fill in the store, tick what to include, and press
              Run. The audit still happens on your machine — that&apos;s where Chrome and the theme
              code are — while this site drives it and streams the log back to you.
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
            store&apos;s underlying code for messy or leftover files, the tool needs the
            theme&apos;s files. If you already have the theme repo on your computer, that&apos;s
            one flag — run this from inside that folder:
          </p>
          <Code>barrel-audit run https://client-store.com --local-repo .</Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            Otherwise let the tool fetch its own copy from Shopify:
          </p>
          <div className="mt-3">
            <Code>barrel-audit pull-theme &lt;slug&gt; --store &lt;slug&gt;.myshopify.com</Code>
          </div>
          <p className="text-sm text-[#6B6B6B] mt-3">
            (This opens a browser window to log in to Shopify — normal, just approve it.)
            Or, if you already have the theme&apos;s files some other way — downloaded from
            Shopify, unzipped, whatever — drop them into{" "}
            <span className="font-mono text-[#1A1A1A]">
              ~/.barrel-audit/stores/&lt;slug&gt;/theme
            </span>{" "}
            yourself, no command needed. Then run step 2 again.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Optional: use the theme code from a GitHub repo instead
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            If the client&apos;s theme code lives in a GitHub repo rather than a live Shopify store,
            you can point the audit at the repo — no Shopify login needed. The easiest way is the{" "}
            <a href="/repos" className="text-[#2563EB] hover:underline">
              Theme Repos
            </a>{" "}
            page: connect GitHub, search for the repo, pick a branch, done. No terminal involved.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            You&apos;ll be asked one question there — <strong className="font-semibold text-[#1A1A1A]">how</strong>{" "}
            audits should read it:
          </p>
          <ul className="text-sm text-[#6B6B6B] list-disc pl-5 space-y-1.5 mb-3">
            <li>
              <strong className="font-semibold text-[#1A1A1A]">Read it from GitHub each run</strong> — nothing is
              kept. Every audit downloads that branch as it is right then, reads it, and deletes it. Pick this
              unless you have a reason not to: each report reflects today&apos;s code, and no client code sits on
              your laptop.
            </li>
            <li>
              <strong className="font-semibold text-[#1A1A1A]">Pull a copy to my machine</strong> — downloads it
              once into your own folder, and later audits read that copy until you pull again. Pick this if you
              want the code on your computer to look at, or you need to run an audit offline. This one needs the
              helper (<span className="font-mono text-[#1A1A1A]">barrel-audit serve</span>) running.
            </li>
          </ul>
          <p className="text-sm text-[#6B6B6B] mb-3">Or from a terminal, if you prefer:</p>
          <Code>barrel-audit link-repo &lt;slug-or-url&gt;</Code>
          <p className="text-sm text-[#6B6B6B] mt-3">
            It asks which of the two modes you want, then lets you search your repos by typing a few letters. It
            searches GitHub itself rather than a downloaded list, so it finds a repo however many the org has.
          </p>
          <p className="text-sm text-[#6B6B6B] mt-3">
            The first time — in the browser or the terminal — you&apos;ll see a short code and a github.com link:
            open the link, type in the code, click Approve. After that you won&apos;t be asked again (in the
            terminal, on that computer; in the browser, in that browser). This needs one shared GitHub app ID,
            which <span className="font-mono text-[#1A1A1A]">barrel-audit setup</span> asks for as its last
            (optional) question — ask in Slack <span className="font-mono text-[#1A1A1A]">#barrel</span> for it
            if you skipped that, then re-run setup.
          </p>
          <p className="text-sm text-[#6B6B6B] mt-3">
            <strong className="font-semibold text-[#1A1A1A]">This is read-only.</strong> Connecting a repo lets
            this tool read the code. It never commits, pushes, creates a branch, or opens anything on GitHub. The
            only thing in this tool that ever writes to a repo is the &ldquo;Suggest fix&rdquo; button on a
            report&apos;s Developer tab, which opens a pull request for a person to review and asks you to confirm at
            every step.
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
          <p className="text-sm text-[#6B6B6B] mt-3">
            Once a property is linked, the report also gets a{" "}
            <span className="font-medium text-[#1A1A1A]">Data Analysis</span> tab: the audit
            crossed with that store&apos;s real numbers, ranked by where conversion is actually
            weakest — mobile against desktop, one landing page against the site average. Press
            Generate on the tab; it takes a few seconds. Every figure it shows comes from
            Google Analytics or from the report itself, gap sizes describe the 28 days measured
            rather than predicting a return, and if the property has too little history or no
            ecommerce tracking it says so and stops instead of guessing. Without a linked
            property the tab isn&apos;t there at all.
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
            items also flow into the Developer tab alongside everything else.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            From Terminal instead, put the scope in a text file and point at it — handy since it
            usually spans several lines:
          </p>
          <div className="mt-3">
            <Code>barrel-audit run &lt;slug-or-url&gt; --ada-scope-file ./ada-scope.txt</Code>
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
            barrel-audit run &lt;slug-or-url&gt; --competitor https://competitor-site.com
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
            <span className="font-mono text-[#1A1A1A]">/Users/you/code/client-theme</span>. You don't
            have to know that path by heart: with the local agent connected, "Browse…" next to the box
            opens a folder picker for your own machine, and marks every folder that actually holds a
            theme, so you can click your way to it. It's remembered for that store, so you only enter
            it once. If it's left blank and the store
            has no code saved from before, the run stops immediately and tells you — rather than
            spending ten minutes and handing back a report that quietly has no code findings in it.
            Auditing a prospect whose code you don't have? Untick that box.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            To use this from the hosted version of the site (not just when running it on your
            own computer), run{" "}
            <span className="font-mono text-[#1A1A1A]">barrel-audit serve</span> in Terminal first
            — it prints a one-time code. Paste that code into the &ldquo;Local agent&rdquo; box at
            the top of the Run Audit form (only needs to be done once per computer), and from then
            on &ldquo;Run audit&rdquo; works from the hosted dashboard too, not just your own
            machine&apos;s copy of the site.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            <b className="text-[#1A1A1A]">No <span className="font-mono">pnpm</span> in front of
            it.</b> Written that way, the command runs from any folder — including a client theme
            repo, which is the intended setup: the agent runs in the theme repo on your machine and
            the dashboard in your browser drives it from there. Adding{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm</span> makes it work only from inside a
            copy of the audit tool&apos;s own repo, and fail confusingly anywhere else — what
            follows is the whole story, because the failure it produces looks like a bug in this
            tool and isn&apos;t one.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Leaving the <span className="font-mono text-[#1A1A1A]">pnpm</span> on is worth avoiding,
            and the reason is subtle: the prefix isn&apos;t broken in itself, but it makes the CLI
            depend on the <i>theme repo&apos;s</i> dependencies, which have nothing to do with this
            tool. In a folder with no{" "}
            <span className="font-mono text-[#1A1A1A]">package.json</span> you get{" "}
            <span className="font-mono text-[#1A1A1A]">ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND</span>.
            In a theme repo that <i>does</i> have one — the normal case, since most themes have a
            build — pnpm adopts <i>that</i> repo as the workspace and runs{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm install</span> on the theme before it
            will run anything. If that install is healthy, the command works. If it&apos;s broken
            for any reason of the theme&apos;s own, you never reach the CLI: what you see is a{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm install</span> failure ending in{" "}
            <span className="font-mono text-[#1A1A1A]">runDepsStatusCheck</span>, which looks like a
            bug in this tool and isn&apos;t one.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            One cause worth recognising, because pnpm creates it silently: pnpm 11 writes an
            unresolved <span className="font-mono text-[#1A1A1A]">allowBuilds:</span> block into the
            theme&apos;s own <span className="font-mono text-[#1A1A1A]">pnpm-workspace.yaml</span>{" "}
            (literally <span className="font-mono text-[#1A1A1A]">esbuild: set this to true or
            false</span>) and then fails every install with{" "}
            <span className="font-mono text-[#1A1A1A]">ERR_PNPM_IGNORED_BUILDS</span> until those
            are real booleans. The same error arrives a second way — a theme with unapproved build
            scripts of its own (<span className="font-mono text-[#1A1A1A]">Ignored build scripts:
            esbuild, protobufjs, swiper</span>), fixed with{" "}
            <span className="font-mono text-[#1A1A1A]">pnpm approve-builds</span> in that repo.
            Either way, the shortcut is to call{" "}
            <span className="font-mono text-[#1A1A1A]">barrel-audit</span> directly — it doesn&apos;t
            use the theme&apos;s dependencies at all, so it works whatever state that install is in.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            The Recommendations tab is the one you present
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Every other tab in a report is evidence. Recommendations is the argument. It reads the
            whole finished report — Lighthouse, axe, site health, consent, security, SEO/GEO, agent
            readiness, the UX audit, the theme codebase, and the store&apos;s real GA4 traffic and
            revenue when a property is linked — and comes back with the five to ten things to do
            next, ordered by how much each should move <b>conversion</b> rather than by how severe
            it is technically. A critical lint error no shopper can perceive ranks below a slow
            product page, several related technical findings become one business-level action, and
            anything only a developer cares about stays on the Developer tab where it belongs.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Each item is written to be said out loud in a client meeting: the action, the part of
            the experience it moves, why it matters commercially, what we&apos;d actually do, what
            to expect, and the specific audit figures behind it. It opens on what&apos;s already
            working, cited with real numbers, before anything it suggests changing — the tone is a
            partnership, not a verdict, because we often built the site ourselves. Expected impact
            stays honest and directional: it will never invent a percentage lift for the store.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            <span className="font-medium text-[#1A1A1A]">Copy for deck</span> puts the whole set on
            your clipboard as structured markdown — headline, strengths and all ten items — ready to
            paste into slides. It needs an{" "}
            <span className="font-mono text-[#1A1A1A]">ANTHROPIC_API_KEY</span>; leave the
            &ldquo;Client-ready recommendations&rdquo; box ticked on the run form (or skip it with{" "}
            <span className="font-mono text-[#1A1A1A]">--skip-recommendations</span>).
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Every report has a Deck view
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            <span className="font-medium text-[#1A1A1A]">Deck view</span>, in the report header,
            turns the finished report into slides — the same 16:9 pages a CRO audit produces, one
            point each: the overall score, where the storefront stands, what it already gets right,
            the key findings, the speed and traffic numbers, the consent and security exposure, the
            recommendations with the reason each one matters, the quick wins, how the work splits by
            effort, and the top eight fixes for the build team. Print or Save as PDF gives one
            landscape slide per page.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            It is composed from the report, not generated: no model call, no API key, nothing new to
            run. Every figure on a slide is one the audit measured, so a deck can&apos;t say
            something the run didn&apos;t find — and every report already in the dashboard has a deck,
            including ones from long before this existed. A slide whose section was skipped is
            simply absent rather than padded, so a thin run makes a short deck instead of a
            confident-looking empty one.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            <span className="font-medium text-[#1A1A1A]">Copy key points</span> puts the whole deck
            on your clipboard as markdown, one heading per slide and one line per point, for pasting
            into Slides or Keynote — the same words the printed pages carry. The deck is best with a
            run that produced the executive summary and the client recommendations; without them it
            falls back to the scores, the measurements and the fix list.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Privacy &amp; Compliance is its own tab now
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Every report has a{" "}
            <span className="font-medium text-[#1A1A1A]">Privacy &amp; Compliance</span> tab, between
            ADA and Data Analysis. It holds the three sections that used to sit at the bottom of
            Overview: <b>Privacy Compliance</b> (the consent scan and the cookie &amp; script
            inventory), <b>Security &amp; Compliance</b> (headers, transport, cookie flags, exposed
            paths, script supply chain) and <b>Trust &amp; Privacy</b> (the Lighthouse
            best-practices findings, the console errors, and the marketing-pixel detail).
          </p>
          <p className="text-sm text-[#6B6B6B]">
            They belong together: all three answer what the storefront exposes to a visitor and to
            the network, and all three are scored on the compliance scale rather than the A-F one.
            On Overview they were below the roadmap, which is the part of a report people stop
            reading at — and this is usually the page a client forwards to their own legal or
            security people on its own. Nothing about the scan changed, and reports you ran before
            today show the new tab without a re-run.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            One report for a whole Privacy Compliance scan
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Running the bulk scan across every site produces one scan. Open it on the Privacy
            Compliance page and choose <b>Shareable report</b> for a single document covering all of
            its sites: a summary, every site ranked worst first, what each failed test ID means, and
            the fixes grouped by failure. It also explains how the score is calculated — what each
            severity is worth, why untested results are left out, and why one blocker caps a site
            below 50.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            Use <b>Print / Save as PDF</b> to hand it to someone, or <b>Download CSV</b> for one
            spreadsheet row per site.
          </p>
          <p className="text-sm text-[#6B6B6B] mt-3">
            To share it outside Barrel, use <b>Create protected link</b> on the report. Enter the
            emails allowed to open it, set a password and pick an expiry. The recipient needs the
            link, one of those emails <i>and</i> the password; five wrong tries lock it for 15
            minutes, and <b>Revoke</b> cuts access straight away. Send the password by a different
            route than the link.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Privacy Compliance takes inventory of every cookie and script
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The behavioural suites answer <em>&ldquo;is consent working?&rdquo;</em>. They never
            answered the question a client opens with —{" "}
            <em>&ldquo;what is running on my site, and is each thing classified and firing
            correctly?&rdquo;</em> Privacy Compliance now carries a{" "}
            <span className="font-medium text-[#1A1A1A]">Cookie &amp; script inventory</span>: one
            row per vendor, with its purpose, how it gets onto the page, the cookies and browser
            storage it writes, what the CMP declares it to be, whether that&apos;s right, whether it
            fires before or despite a choice, a severity and a specific fix.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Vendors are discovered from live traffic rather than matched against our tracker list,
            so the uncatalogued ones — usually the majority, and the ones nobody has accounted for —
            show up too. <span className="font-medium text-[#1A1A1A]">How it loads</span> names
            whoever owns the fix: a theme edit, a change in a named GTM container, or a Shopify web
            pixel, which a cookie banner cannot gate at all. Those get their own table, because{" "}
            <span className="font-mono text-[#1A1A1A]">privacyPurposes</span> is the only place
            Shopify records whether a pixel respects consent — and an empty list means it runs
            whatever the visitor chose.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Purposes for unknown vendors, the fixes and the plan are written by AI and marked as
            such; the verdicts are not. Whether something is classified correctly, and whether it
            fired before consent, are computed from what the scan observed — those are the claims
            you forward to a vendor. Where no CMP classification could be read, the report says so
            once and states plainly that the column reports nothing about the site&apos;s setup
            either way.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            It closes with an ordered fix plan and, kept separate, compliant ways to collect more
            data — those are not compliance fixes and it says so. Grab the whole thing as{" "}
            <span className="font-medium text-[#1A1A1A]">Inventory CSV</span> from the per-site
            report when you need it in a Google Sheet. Skip it with{" "}
            <span className="font-mono text-[#1A1A1A]">--no-tag-inventory</span>.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Privacy Compliance now says what the site gets right
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The Privacy Compliance section used to read as a list of problems, because the checks
            that passed were mixed in with the ones that failed under headings named after test
            suites. It now opens a <span className="font-medium text-[#1A1A1A]">What&apos;s working</span>{" "}
            list: every check confirmed to be behaving correctly, grouped by what it means for a
            visitor — before they choose, when they reject, when they accept, after the choice is
            made — in the scanner&apos;s own words, each with its test ID beside it.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            It ends with the tags proven to obey the visitor: the ones that fired once consent was
            given and stayed silent when it was refused. The count reads{" "}
            <em>&ldquo;12 of 15 confirmed checks passed&rdquo;</em> rather than out of all 32 — a
            check that couldn&apos;t be tested is never counted as one the site passed. It appears
            on both the store&apos;s report and the standalone privacy report, including reports
            already run, and needs no re-scan.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Theme Check tells you what theme the store runs
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The <b>Theme &amp; Codebase</b> section at the top of Theme Check reads the theme&apos;s
            own settings file and reports its name, version and author — and, more usefully, whether
            that&apos;s a stock Shopify theme, a <b>fork</b> of one (the name still says Dawn or
            Horizon but the author doesn&apos;t, so upstream releases can no longer be merged in), a
            third-party or agency theme, or something built from scratch. When the theme can&apos;t
            identify itself, it says so rather than guessing.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Below that is what the codebase is actually made of: template architecture and section
            groups, theme blocks and app-block support, Liquid line count, asset weight with the
            largest files named, JS and CSS totals, the build tooling actually committed to the
            repo, the front-end libraries genuinely detectable in the code, localization, metafield
            and metaobject usage, and whether lint config and CI exist at all.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            Then the codebase opportunities that fall out of it, each citing its own evidence —
            deprecated tags with the files they&apos;re in, oversized images and animated GIFs with
            their real sizes, legacy font formats, several generations of the same bundle left
            behind in assets, page-builder-owned templates, unadopted Online Store 2.0 features,
            jQuery named down to the file it&apos;s bundled inside. All of that is a file scan, so
            it needs theme code but no API key. It&apos;s careful the other way too: a
            &ldquo;backup, do not delete&rdquo; template is never recommended as migration work.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Getting AI to draft an actual code fix
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            On the Developer tab, any item that points at a specific theme file shows a
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
            A CRO audit is a different report, run a different way
          </h3>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Everything above produces a <b>site audit</b>: scores, technical findings, a dev to-do
            list. A <b>CRO audit</b> is a separate deliverable under the{" "}
            <span className="font-medium text-[#1A1A1A]">CRO Audits</span> tab — the slides of a
            client deck rather than a scored report. It reviews the storefront by page type (nav,
            home, collection, product, cart) at both a phone and a laptop width, and crosses that
            with the store&apos;s own Google Analytics.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            It runs in two passes, split by what each one physically needs. The first drives a real
            browser, so it runs from your machine:
          </p>
          <Code>barrel-audit cro &lt;url-or-slug&gt;</Code>
          <p className="text-sm text-[#6B6B6B] mt-3 mb-3">
            That captures each page type, records what it measured, and writes the UX and
            competitor slides. You can also start it from{" "}
            <span className="font-medium text-[#1A1A1A]">CRO Audits → New CRO audit</span> if the
            local agent is running (same setup as &ldquo;Run audit&rdquo; above).
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            The second pass is a <b>Generate</b> button on the finished audit and runs on this
            website — no browser, no terminal. It reads the store&apos;s Google Analytics for the
            conversion picture, then writes the four key insights across everything the audit
            found. A store with Analytics linked can get that half with no local setup at all.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Before the first run, fill in the client&apos;s <b>CRO brief</b> (linked from any store
            on the CRO Audits page): up to three competitors, what analytics and heatmap tools they
            actually have, whether they sell subscriptions, and what they already think is wrong.
            It is saved on the store, so later audits reuse it.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-3">
            Every bullet is editable — hover it and click <b>Edit</b>. Edits are saved separately
            from the generated audit, so the record of what the tool actually concluded is never
            rewritten, and a bullet can be hidden from the deck rather than deleted.{" "}
            <b>Deck view</b> prints one 16:9 slide per page for a PDF, and{" "}
            <b>Share with client</b> makes a 30-day link that opens without a Barrel account.
          </p>
          <p className="text-sm text-[#6B6B6B]">
            Three parts of the CRO process are still done by hand and the report says so on the
            page: heatmaps and session recordings, the voice-of-customer review analysis, and the
            CX journey map. See{" "}
            <span className="font-mono text-[#1A1A1A]">docs/cro-audit.md</span> for what the tool
            does and does not do, step by step.
          </p>
        </section>

        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-6 mb-8">
          <h3 className="text-lg font-semibold text-[#000000] tracking-tight mb-3">
            Tracking progress over multiple audits
          </h3>
          <p className="text-sm text-[#6B6B6B]">
            Running the same store more than once — e.g. before/during/after a build — just
            works: re-run <span className="font-mono text-[#1A1A1A]">barrel-audit run</span>{" "}
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
                No. The moment the command in step 2 finishes, the report is already live on the
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
              <div className="font-semibold text-[#1A1A1A] mb-1">It won't let me in.</div>
              <div className="text-[#6B6B6B]">
                Sign-in goes through Barrel Labs using your Barrel Google account. If Labs says
                access is denied, someone needs to add you to this tool in Barrel Labs — ask in
                Slack <span className="font-mono text-[#1A1A1A]">#barrel</span>.
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">
                How do I sign out, or get to another Barrel tool?
              </div>
              <div className="text-[#6B6B6B]">
                Both live in the black-on-white Barrel Labs bar across the top of every page — the
                same bar every Barrel tool has.{" "}
                <span className="font-mono text-[#1A1A1A]">◆ TOOLS</span> lists the other tools
                your Barrel account can open, and{" "}
                <span className="font-mono text-[#1A1A1A]">EJECT</span> signs you out of this tool
                and returns you to Barrel Labs. The row underneath it is this tool&rsquo;s own
                navigation.
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#1A1A1A] mb-1">
                Where did Privacy Compliance go?
              </div>
              <div className="text-[#6B6B6B]">
                The <b>Privacy Compliance</b> item in this tool&rsquo;s own navigation — the
                fleet-wide list of where client sites are setting tracking cookies before consent —
                is limited to Barrel Labs admins. A single store&rsquo;s compliance section is not:
                it is on that report&rsquo;s <b>Privacy &amp; Compliance</b> tab, and every report,
                like everything else here, is open to everyone who can sign in.
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
                On your computer it&apos;s just the{" "}
                <span className="font-mono text-[#1A1A1A]">barrel-audit</span> command, installed
                from Barrel&apos;s private package registry, plus a{" "}
                <span className="font-mono text-[#1A1A1A]">~/.barrel-audit</span> folder holding
                your key and each store&apos;s working files. Everything a report needs is
                published straight to this site, so nothing is stored in the folder you run from.
                The source lives in Barrel&apos;s GitHub as{" "}
                <span className="font-mono text-[#1A1A1A]">barrel-site-audit-tool-cli</span> — you
                only need that to change the tool, not to use it. Ask in{" "}
                <span className="font-mono text-[#1A1A1A]">#barrel</span> if the install commands
                fail on your machine.
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
