import { ButtonLink } from "../components/ui/Button";
import type { Route } from "./+types/not-found";

export const meta: Route.MetaFunction = () => [{ title: "not found · tino" }];

export default function NotFound() {
  return (
    <main className="solo" id="main">
      <div className="route-error">
        <p className="eyebrow">404</p>
        <h1>nothing lives here.</h1>
        <p className="lede">the link might be old, or mistyped.</p>
        <div className="row">
          <ButtonLink to="/" variant="primary">
            take me home
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
