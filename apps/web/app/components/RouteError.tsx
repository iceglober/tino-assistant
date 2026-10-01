import { isRouteErrorResponse, Link, useRevalidator } from "react-router";
import { isApiError } from "../lib/api";
import { errorMessage } from "../lib/format";
import { ADMINS_ONLY } from "../lib/session";
import { Button, ButtonLink } from "./ui/Button";

/**
 * The shared error boundary body: explains what happened in plain words and
 * offers the one useful next step (retry, go home, sign in).
 */
export function RouteError({ error, compact }: { error: unknown; compact?: boolean }) {
  const revalidator = useRevalidator();
  const retrying = revalidator.state === "loading";

  const status = isRouteErrorResponse(error) ? error.status : isApiError(error) ? error.status : 0;
  const code = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : ""
    : isApiError(error)
      ? error.error
      : "";

  if (code === ADMINS_ONLY) {
    return (
      <div className="route-error" role="alert">
        <p className="eyebrow">admins only</p>
        <h1>this page is for admins.</h1>
        <p className="lede">
          ask an admin in your org if something here needs changing — they can also make you an admin from the team page.
        </p>
        <div className="row">
          <ButtonLink to=".." relative="path" variant="secondary">
            back to overview
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (code === "verify_email") {
    return (
      <div className="route-error" role="alert">
        <p className="eyebrow">one more step</p>
        <h1>confirm your email first.</h1>
        <p className="lede">this org only lets in verified addresses. open the link we emailed you, then come back.</p>
        <div className="row">
          <ButtonLink to="/verify-email" variant="primary">
            resend the link
          </ButtonLink>
          <Button variant="ghost" onClick={() => revalidator.revalidate()} loading={retrying}>
            i've confirmed — retry
          </Button>
        </div>
      </div>
    );
  }

  if (status === 404) {
    return (
      <div className="route-error" role="alert">
        <p className="eyebrow">not found</p>
        <h1>nothing here.</h1>
        <p className="lede">
          {isApiError(error)
            ? "either this org doesn't exist or you aren't a member of it."
            : "the page you asked for doesn't exist."}
        </p>
        <div className="row">
          <ButtonLink to="/orgs" variant="secondary">
            your orgs
          </ButtonLink>
        </div>
      </div>
    );
  }

  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string" && error.data
      ? error.data
      : error.statusText
    : errorMessage(error);

  return (
    <div className={compact ? "route-error route-error--compact" : "route-error"} role="alert">
      <p className="eyebrow">{status ? `error ${status}` : "something broke"}</p>
      <h1>that didn't load.</h1>
      <p className="lede">{message}</p>
      <div className="row">
        <Button variant="primary" onClick={() => revalidator.revalidate()} loading={retrying}>
          try again
        </Button>
        <Link to="/" className="btn btn--ghost">
          go home
        </Link>
      </div>
      {import.meta.env.DEV && error instanceof Error && error.stack ? (
        <pre className="route-error__stack">{error.stack}</pre>
      ) : null}
    </div>
  );
}
