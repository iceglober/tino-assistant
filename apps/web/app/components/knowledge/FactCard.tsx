import type { KbFact } from "@tino/contracts";
import { useState } from "react";
import { fmtDate, fmtRange, plural } from "../../lib/format";
import { sourceLabel } from "./labels";

export function FactCard({ fact }: { fact: KbFact }) {
  const [open, setOpen] = useState(false);
  const sameDay = fact.firstSeen.slice(0, 10) === fact.lastSeen.slice(0, 10);
  return (
    <li className="fact">
      <span className={`kind kind--${fact.kind}`}>{fact.kind}</span>
      <div className="fact__body">
        <p className="fact__claim">{fact.statement}</p>
        {fact.detail ? <p className="fact__detail">{fact.detail}</p> : null}
        <p className="fact__meta">
          <span>{sameDay ? fmtDate(fact.lastSeen) : fmtRange(fact.firstSeen, fact.lastSeen)}</span>
          {fact.confidence < 0.6 ? (
            <span title={`confidence ${Math.round(fact.confidence * 100)}%`}>· tentative</span>
          ) : null}
          {fact.evidence.length > 0 ? (
            <button type="button" className="btn btn--link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "hide" : "show"} {plural(fact.evidence.length, "source")}
            </button>
          ) : null}
        </p>
        {open ? (
          <ul className="evidence">
            {fact.evidence.map((e, i) => (
              <li key={e.permalink ?? `${e.ts}-${i}`}>
                <p className="evidence__head">
                  <span className="badge">{sourceLabel(e.source)}</span>
                  <span className="muted">{fmtDate(e.ts)}</span>
                  {e.permalink ? (
                    <a href={e.permalink} target="_blank" rel="noopener noreferrer">
                      open ↗
                    </a>
                  ) : null}
                </p>
                <p className="evidence__text">{e.snippet}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
