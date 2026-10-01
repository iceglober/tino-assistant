import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { RouteError } from "../../../components/RouteError";
import { SaveBar } from "../../../components/settings/SaveBar";
import { SettingField } from "../../../components/settings/SettingField";
import { useSettingsForm } from "../../../components/settings/useSettingsForm";
import { StatusBadge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Section } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/Dialog";
import { Notice } from "../../../components/ui/Notice";
import { type ActionResult, useFetcherToast } from "../../../hooks/useFetcherToast";
import { useOrg } from "../../../layouts/app-shell";
import { useSettings } from "../../../layouts/settings-layout";
import { numberError, specsFor } from "../../../lib/settings";
import { runSettingsAction } from "../../../lib/settings-action";
import type { Route } from "./+types/knowledge";

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  return runSettingsAction(params.slug, request);
}

const SPECS = specsFor("knowledge");
const KEYS = SPECS.map((s) => s.key);

const HINTS: Record<string, string> = {
  "kb.recencyWeight":
    "how much newer messages win over older ones when tino looks things up. 0 ignores age; 1 strongly prefers recent. empty uses the default.",
  "kb.recencyTauDays":
    "how fast old messages fade: after this many days a message counts for half as much. empty uses the default.",
};

export default function KnowledgeSettings() {
  const { settings, platform } = useSettings();
  const { org, slug } = useOrg();
  const kb = org.status.kb;
  const form = useSettingsForm(settings, KEYS, "knowledge settings");
  const errors = Object.fromEntries(KEYS.map((k) => [k, numberError(k, String(form.value(k) ?? ""))]));
  const invalid = Object.values(errors).some(Boolean);

  const rebuild = useFetcher();
  const [confirming, setConfirming] = useState(false);
  useFetcherToast(rebuild, () => setConfirming(false));

  return (
    <div className="stack-lg">
      <div className="row row--between">
        <h2>knowledge base</h2>
        <StatusBadge ok={kb.enabled} okText="on" offText="off" warn />
      </div>
      <p className="prose">
        tino reads the history people connect, distills it into facts and themes, and looks there first when answering.
      </p>

      {kb.enabled ? (
        <Notice tone="ok" title="on">
          <p>
            embedding with <span className="mono">{kb.embedModel ?? "the default model"}</span>.{" "}
            <Link to={`/${slug}/knowledge`}>see what it knows →</Link>
          </p>
        </Notice>
      ) : (
        <Notice tone="warn" title="off">
          <p>{kb.reason ?? "it needs an embeddings model."}</p>
          <p>
            {platform.platformEmbeddings
              ? "tino can provide embeddings for you — make sure a model is set up."
              : "add an OpenAI key, or an Azure embedding deployment, in "}
            {platform.platformEmbeddings ? null : <Link to={`/${slug}/settings/model`}>model settings</Link>}
            {platform.platformEmbeddings ? null : "."}
          </p>
        </Notice>
      )}

      <Section title="recency" sub="tune how much freshness matters when tino searches what it knows.">
        <div>
          {SPECS.map((s) => (
            <SettingField
              key={s.key}
              spec={s}
              value={form.value(s.key)}
              onChange={(v) => form.set(s.key, v)}
              hint={HINTS[s.key]}
              error={errors[s.key]}
              optional
            />
          ))}
        </div>
        <div style={{ marginTop: "var(--s-4)" }}>
          <SaveBar
            dirty={form.dirty}
            saving={form.saving}
            onSave={() => form.save()}
            onReset={form.reset}
            error={form.applyError}
            disabled={invalid}
          />
        </div>
      </Section>

      <Section
        title="start over"
        sub="wipe everything indexed and distilled for this org, and read it all again from scratch. use this after changing the embeddings model."
      >
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={!kb.enabled}>
          rebuild the knowledge base
        </Button>
        {rebuild.data && !(rebuild.data as ActionResult).ok ? (
          <p className="field__error" role="alert">
            {(rebuild.data as { error: string }).error}
          </p>
        ) : null}
      </Section>

      <ConfirmDialog
        open={confirming}
        title="rebuild the knowledge base?"
        confirmLabel="wipe and rebuild"
        destructive
        busy={rebuild.state !== "idle"}
        onCancel={() => setConfirming(false)}
        onConfirm={() => rebuild.submit({ intent: "rebuild" }, { method: "post", encType: "application/json" })}
      >
        <p>
          every fact, theme and indexed excerpt for <strong>{org.org.name}</strong> is deleted — for everyone. tino then
          re-reads connected history, which can take hours and uses model credits.
        </p>
        <p>connections and settings stay as they are.</p>
      </ConfirmDialog>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} compact />;
}
