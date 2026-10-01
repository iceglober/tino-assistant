import type { Me, OrgSummary, Role } from "@tino/contracts";
import { Link } from "react-router";
import { Popover } from "./Popover";

export function OrgSwitcher({ me, current, role }: { me: Me; current: OrgSummary; role: Role }) {
  const others = me.memberships.filter((m) => m.org.id !== current.id && m.status !== "suspended");
  return (
    <Popover
      label={`current org: ${current.name}. switch org`}
      className="org-switch"
      trigger={
        <>
          <span className="org-mark" aria-hidden="true">
            {current.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="org-switch__text">
            <span className="org-switch__name">{current.name}</span>
            <span className="org-switch__role">{role}</span>
          </span>
          <span className="org-switch__chev" aria-hidden="true">
            ⌄
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="menu__label">switch org</div>
          <span className="menu__item" aria-current="true">
            <span aria-hidden="true">✓</span> {current.name}
          </span>
          {others.map((m) => (
            <Link key={m.org.id} to={`/${m.org.slug}`} className="menu__item" onClick={close}>
              <span aria-hidden="true" style={{ visibility: "hidden" }}>
                ✓
              </span>{" "}
              {m.org.name}
            </Link>
          ))}
          <div className="menu__sep" />
          <Link to="/orgs" className="menu__item" onClick={close}>
            all orgs{me.joinable.length ? ` · ${me.joinable.length} to join` : ""}
          </Link>
          {me.canCreateOrg ? (
            <Link to="/new" className="menu__item" onClick={close}>
              create an org
            </Link>
          ) : null}
        </>
      )}
    </Popover>
  );
}
