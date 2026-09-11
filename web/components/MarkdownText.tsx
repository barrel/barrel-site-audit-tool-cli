import { Fragment } from "react";

/** Renders the one piece of markdown that reaches this app — `[label](https://url)` — as a real
 * link.
 *
 * Lighthouse writes its audit descriptions in markdown, and several of them end in a "Learn more"
 * link. Findings run those through stripMarkdownLinks and re-surface the URL as a recommendation,
 * but the checklist sections printed `detail` verbatim, so a reader got
 * `[accessibility tree](https://developer.chrome.com/...)` in the middle of a sentence — the
 * markup on screen and the destination unreachable.
 *
 * Deliberately not a markdown renderer. This is the only construct that appears, and a full parser
 * would be a dependency and an injection surface for text that ultimately comes from a third
 * party. Anything that is not a link is printed as plain text, never as HTML. */
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function MarkdownText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const [raw, label, href] = match;
    const start = match.index;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(
      <a
        key={`${start}-${href}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-[#C5C5C5] underline-offset-2 hover:text-[#1A1A1A]"
      >
        {label}
      </a>,
    );
    lastIndex = start + raw.length;
  }

  if (lastIndex === 0) return <>{text}</>;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
