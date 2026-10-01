import type { KbItem } from "@tino/contracts";
import { fmtDate } from "../../lib/format";
import { sourceLabel } from "./labels";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function ChunkList({ items }: { items: KbItem[] }) {
  return (
    <ul className="chunks">
      {items.map((it, i) => {
        const channel = str(it.meta.channelName);
        const subject = str(it.meta.subject);
        return (
          <li key={it.id ?? `${it.ts}-${i}`} className="chunk">
            <p className="chunk__head">
              <span className="badge">{sourceLabel(it.source)}</span>
              {channel ? <span>#{channel}</span> : null}
              {subject ? <span className="chunk__subject">{subject}</span> : null}
              <span className="muted">{fmtDate(it.ts)}</span>
              {typeof it.sim === "number" ? <span className="muted">· {Math.round(it.sim * 100)}% match</span> : null}
              {it.permalink ? (
                <a href={it.permalink} target="_blank" rel="noopener noreferrer">
                  open ↗
                </a>
              ) : null}
            </p>
            <pre className="chunk__text">{it.text}</pre>
          </li>
        );
      })}
    </ul>
  );
}
