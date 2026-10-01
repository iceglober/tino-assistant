import { redirect } from "react-router";
import { homeFor, meContext } from "../lib/session";
import type { Route } from "./+types/home";

/** `/` decides: one org → it; several (or joinable ones) → /orgs; none → /new. */
export async function clientLoader({ context }: Route.ClientLoaderArgs) {
  throw redirect(homeFor(context.get(meContext)));
}

export default function Home() {
  return null;
}
