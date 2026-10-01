import { redirect } from "react-router";
import { SETTINGS_PAGES } from "../../../layouts/settings-layout";
import { orgContext } from "../../../lib/session";
import type { Route } from "./+types/index";

/** /settings goes to the first section that still needs doing (or the model page). */
export async function clientLoader({ params, context }: Route.ClientLoaderArgs) {
  const { status } = context.get(orgContext);
  const next = SETTINGS_PAGES.find((p) => p.done && !p.done(status));
  throw redirect(`/${params.slug}/settings/${next?.to ?? "model"}`);
}

export default function SettingsIndex() {
  return null;
}
