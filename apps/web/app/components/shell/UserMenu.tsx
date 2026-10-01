import type { Me } from "@tino/contracts";
import { Link, useNavigate } from "react-router";
import { signOut } from "../../lib/auth";
import { initials } from "../../lib/format";
import { Popover } from "./Popover";

export function Avatar({ name, email, size = 28 }: { name: string | null; email: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {initials(name ?? email)}
    </span>
  );
}

export function UserMenu({ me, placement = "below", tone }: { me: Me; placement?: "below" | "above"; tone?: "rail" }) {
  const navigate = useNavigate();
  const { account } = me;
  return (
    <Popover
      label={`account menu for ${account.email}`}
      placement={placement}
      align={placement === "above" ? "start" : "end"}
      className={tone === "rail" ? "user-menu user-menu--rail" : "user-menu"}
      trigger={
        <>
          <Avatar name={account.name} email={account.email} />
          <span className="user-menu__who">
            <span className="user-menu__name">{account.name ?? account.email.split("@")[0]}</span>
            <span className="user-menu__email">{account.email}</span>
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="menu__label">{account.email}</div>
          <Link className="menu__item" to="/account" onClick={close}>
            your account
          </Link>
          <Link className="menu__item" to="/orgs" onClick={close}>
            your orgs
          </Link>
          <div className="menu__sep" />
          <button
            type="button"
            className="menu__item"
            onClick={async () => {
              close();
              await signOut();
              navigate("/signin");
            }}
          >
            sign out
          </button>
        </>
      )}
    </Popover>
  );
}
