import type { OrgOverview } from "@tino/contracts";
import { Link } from "react-router";
import { type ChecklistItem, Checklist } from "../../components/overview/Checklist";
import { PageHeader } from "../../components/PageHeader";
import { RouteError } from "../../components/RouteError";
import { StatusBadge } from "../../components/ui/Badge";
import { ButtonLink } from "../../components/ui/Button";
import { Section } from "../../components/ui/Card";
import { Notice } from "../../components/ui/Notice";
import { useOrg } from "../../layouts/app-shell";
import { firstName } from "../../lib/format";
import type { Route } from "./+types/overview";

export const meta: Route.MetaFunction = () => [{ title: "overview · tino" }];

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? "still up" : h < 12 ? "good morning" : h < 18 ? "good afternoon" : "good evening";
}

const clientWord = (c: "org" | "platform" | null) => (c === "org" ? "your own" : c === "platform" ? "tino's" : "");

function setupItems(status: OrgOverview["status"], slug: string): ChecklistItem[] {
  const s = (p: string) => `/${slug}/settings/${p}`;
  return [
    {
      key: "model",
      title: "model",
      done: status.model,
      detail: status.model
        ? "a model provider is connected — tino can think."
        : "pick OpenAI, Anthropic or Azure and paste an API key. nothing works until this is set.",
      to: s("model"),
      action: status.model ? "change" : "add a model",
    },
    {
      key: "slack",
      title: "Slack app",
      done: status.slack.installed,
      detail: status.slack.installed
        ? `installed with ${clientWord(status.slack.client) || "a"} Slack app${status.slack.teamId ? ` in workspace ${status.slack.teamId}` : ""}.`
        : "create your own Slack app from our manifest in one click, paste three values, then install it.",
      to: s("slack"),
      action: status.slack.installed ? "review" : "set up Slack",
    },
    {
      key: "google",
      title: "Google client",
      done: status.google.available,
      detail: status.google.available
        ? `people can connect Gmail and Calendar through ${clientWord(status.google.client)} Google client.`
        : (status.google.reason ??
          "create an OAuth client inside your Google Workspace — internal apps need no Google review."),
      caveat:
        status.google.available && status.google.pilot
          ? "tino's client is in pilot: people see an “unverified app” screen, and seats are limited."
          : undefined,
      to: s("google"),
      action: status.google.available ? "review" : "set up Google",
    },
    {
      key: "kb",
      title: "knowledge base",
      done: status.kb.enabled,
      detail: status.kb.enabled
        ? `on${status.kb.embedModel ? `, embedding with ${status.kb.embedModel}` : ""}. tino learns from connected history.`
        : (status.kb.reason ?? "turns on once a model with embeddings is configured."),
      to: s("knowledge"),
      action: status.kb.enabled ? "tune" : "check",
    },
  ];
}

function MyConnections({ overview, slug }: { overview: OrgOverview; slug: string }) {
  const { connections, status } = overview;
  const rows = [
    {
      key: "google",
      name: "Google",
      what: "mail and calendar",
      ok: connections.google,
      available: status.google.available,
      unavailable: "waiting on an admin to set up a Google client.",
    },
    {
      key: "slack",
      name: "Slack",
      what: "your DMs and private channels",
      ok: connections.slack,
      available: status.slack.installed,
      unavailable: "waiting on an admin to install the Slack app.",
    },
  ];
  return (
    <ul className="conn-summary">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="conn-summary__name">{r.name}</span>
          <span className="conn-summary__what muted">{r.available ? r.what : r.unavailable}</span>
          <StatusBadge ok={r.ok} okText="connected" offText={r.available ? "not connected" : "unavailable"} />
        </li>
      ))}
      <li>
        <span className="conn-summary__name">tools</span>
        <span className="conn-summary__what muted">MCP servers only you use</span>
        <span className="small muted">{connections.mcpServers || "none"}</span>
      </li>
      <li className="conn-summary__cta">
        <Link to={`/${slug}/connections`}>manage your connections →</Link>
      </li>
    </ul>
  );
}

export default function Overview() {
  const { me, org, slug, isAdmin } = useOrg();
  const name = firstName(me.account.name, me.account.email);
  const items = setupItems(org.status, slug);
  const done = items.filter((i) => i.done).length;
  const ready = org.status.model && org.status.slack.installed;

  if (isAdmin) {
    return (
      <div className="stack-lg">
        <PageHeader
          eyebrow={org.org.name}
          title={`${greeting()}, ${name}.`}
          lede={
            done === items.length
              ? "everything's set up. tino is live in Slack."
              : `${done} of ${items.length} set up. tino answers in Slack once the model and Slack app are in place.`
          }
          actions={
            <ButtonLink to={`/${slug}/chat`} variant={ready ? "primary" : "secondary"}>
              chat with tino
            </ButtonLink>
          }
        />

        <section aria-labelledby="setup-title">
          <div className="section__head">
            <h2 id="setup-title">setup</h2>
            <span className="small muted">
              {done}/{items.length}
            </span>
          </div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <Checklist items={items} label="setup steps" />
        </section>

        <div className="split">
          <Section title="your team" sub="invite people, or let anyone with your email domain join.">
            <ButtonLink to={`/${slug}/team`} variant="secondary">
              invite people
            </ButtonLink>
          </Section>
          <Section title="you">
            <MyConnections overview={org} slug={slug} />
          </Section>
        </div>
      </div>
    );
  }

  const missing = [
    !org.status.model && "a model",
    !org.status.slack.installed && "the Slack app",
  ].filter(Boolean) as string[];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={org.org.name}
        title={`${greeting()}, ${name}.`}
        lede="tino answers from what you connect: your mail, your calendar, your Slack. nobody else's tino can see them."
        actions={
          <ButtonLink to={`/${slug}/chat`} variant="primary">
            chat with tino
          </ButtonLink>
        }
      />
      {missing.length ? (
        <Notice tone="warn" title="still being set up">
          <p>an admin needs to add {missing.join(" and ")} before tino can reply. you can connect your accounts now.</p>
        </Notice>
      ) : null}
      <Section title="what tino can reach for you">
        <MyConnections overview={org} slug={slug} />
      </Section>
      <Section title="where to find tino">
        <ul className="plain-list">
          <li>in Slack — DM tino, or @mention it in a channel.</li>
          <li>
            here — <Link to={`/${slug}/chat`}>chat in the browser</Link>.
          </li>
          <li>
            curious what it has learned? see <Link to={`/${slug}/knowledge`}>knowledge</Link>.
          </li>
        </ul>
      </Section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} />;
}
