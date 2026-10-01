import { Fragment, type ReactNode, useMemo } from "react";
import { type Block, type Inline, parseBlocks } from "../../lib/markdown";

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity
        return <Fragment key={i}>{n.v}</Fragment>;
      case "code":
        // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity
        return <code key={i}>{n.v}</code>;
      case "strong":
        // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case "em":
        // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity
        return <em key={i}>{renderInline(n.c)}</em>;
      case "del":
        // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity
        return <del key={i}>{renderInline(n.c)}</del>;
      case "link":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderInline(n.c)}
          </a>
        );
      default:
        return null;
    }
  });
}

const lines = (ls: Inline[][]): ReactNode =>
  ls.map((l, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {renderInline(l)}
    </Fragment>
  ));

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={i}>{lines(b.lines)}</p>;
    case "h":
      return (
        <p key={i} className="md-h">
          <strong>{renderInline(b.c)}</strong>
        </p>
      );
    case "quote":
      return <blockquote key={i}>{lines(b.lines)}</blockquote>;
    case "ul":
      return (
        <ul key={i}>
          {b.items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items have no identity
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} start={b.start}>
          {b.items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items have no identity
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre key={i} className="md-code" data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      );
    default:
      return null;
  }
}

/** Renders Tino's reply text (a small Markdown subset) without injecting HTML. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div className="md">{blocks.map(renderBlock)}</div>;
}
