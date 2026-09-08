Route group, not a URL segment: `(tabs)/page.tsx` still serves `/reports/[slug]/[id]`.

It exists so `layout.tsx` — the report chrome: header bar, score/store heading, the tab strip and
the methodology footer — wraps the report's tab pages and nothing else. The deck view is a sibling
of this group rather than a member of it, because a slide deck is a different presentation of the
same report, not another tab of it: it has no tab strip, no scroll-spy nav, and prints as landscape
slides rather than as a document.
