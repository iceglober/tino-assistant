import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CapabilityShape } from "../components/CapabilityCard.js";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import type {
  PrivacyContact,
  PrivacyConversation,
  PrivacyLabel,
  Session,
} from "../lib/api.js";
import {
  deleteUserCapability,
  getPrivacyContacts,
  getPrivacyDMs,
  getPrivacyLabels,
  getPrivacyStatus,
  getUserCapabilities,
  reloadCapabilities,
  savePrivacySection,
} from "../lib/api.js";

const CAP_META: Record<string, { icon: string; name: string; desc: string }> = {
  github: { icon: "🐙", name: "GitHub", desc: "repos, issues, PRs" },
  calendar: { icon: "📅", name: "Calendar", desc: "Google Calendar events" },
  gmail: { icon: "✉️", name: "Gmail", desc: "search and read email" },
  linear: { icon: "📐", name: "Linear", desc: "issues and projects" },
  cloudwatch: { icon: "☁️", name: "CloudWatch", desc: "AWS logs and metrics" },
  slack: { icon: "💬", name: "Slack", desc: "public channels and content" },
  "slack-personal": { icon: "🔒", name: "Slack (personal)", desc: "DMs, search, and private messages" },
};

interface CheckableLabel extends PrivacyLabel { selected: boolean }
interface CheckableContact extends PrivacyContact { selected: boolean }
interface CheckableConversation extends PrivacyConversation { selected: boolean }

const INITIAL_VISIBLE = 30;

export function Dashboard({
  session,
  signOut,
  onRecheck,
}: {
  session: Session;
  signOut: () => Promise<void>;
  onRecheck: () => void;
}): JSX.Element {
  const { health } = useHealth();
  const toast = useToast();
  const navigate = useNavigate();
  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";

  const status: "ok" | "degraded" | "unreachable" | "checking" = !health
    ? "checking"
    : health.ok
      ? "ok"
      : "degraded";

  const [userCaps, setUserCaps] = useState<CapabilityShape[]>([]);
  const [capsLoaded, setCapsLoaded] = useState(false);

  const loadUserCaps = useCallback(async () => {
    try {
      const data = await getUserCapabilities(userId);
      setUserCaps(data as unknown as CapabilityShape[]);
    } catch { /* ignore */ }
    finally { setCapsLoaded(true); }
  }, [userId]);

  useEffect(() => { void loadUserCaps(); }, [loadUserCaps]);

  // OAuth callback handling
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (!oauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (oauth === "success") {
      toast.show("Google account connected", "ok");
      void reloadCapabilities().then(async () => {
        await loadUserCaps();
        onRecheck();
      });
    } else if (oauth === "denied") {
      toast.show("Google OAuth consent was denied", "err");
    } else if (oauth === "no_refresh_token") {
      toast.show("Google did not return a refresh token — revoke access at myaccount.google.com/permissions and try again", "err");
    } else if (oauth === "expired" || oauth === "mismatch") {
      toast.show("OAuth session expired — try again", "err");
    } else if (oauth === "error") {
      toast.show("Google OAuth failed — check server logs", "err");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDeleteCap = async (capId: string): Promise<void> => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Disconnect ${capId}?`);
      if (!ok) return;
    }
    try {
      await deleteUserCapability(userId, capId);
      toast.show("Capability removed", "ok");
      await reloadCapabilities();
      await loadUserCaps();
    } catch (err) {
      toast.show(`Could not delete: ${(err as Error).message}`, "err");
    }
  };

  const enabledCaps = userCaps.filter((c) => c.enabled);
  const hasGoogleCap = enabledCaps.some((c) => c.id === "gmail" || c.id === "calendar");

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />

      <div className="section-label">capabilities</div>
      <p className="section-hint">
        your connected integrations. expand any capability to view its settings and privacy rules.
      </p>

      <div className="cap-grid">
        {!capsLoaded ? (
          <p className="empty">loading capabilities…</p>
        ) : enabledCaps.length === 0 ? (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            no capabilities connected yet.
          </p>
        ) : (
          enabledCaps.map((cap) => (
            <DashboardCard
              key={cap.id}
              cap={cap}
              userId={userId}
              onDisconnect={() => void onDeleteCap(cap.id)}
            />
          ))
        )}

        {!hasGoogleCap && capsLoaded && (
          <a
            href="/api/oauth/google/authorize"
            className="cap-card add-cap-card"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="cap-card-header">
              <span className="cap-card-icon" style={{ opacity: 0.5 }}>+</span>
              <div className="cap-card-meta">
                <div className="cap-card-name" style={{ color: "var(--accent)" }}>connect Google</div>
                <div className="cap-card-desc">Gmail, Calendar — read-only access</div>
              </div>
            </div>
          </a>
        )}
      </div>

      {isAdmin && (
        <div style={{ marginTop: 28 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ color: "var(--accent)", padding: 0, fontSize: "0.857rem" }}
            onClick={() => navigate("/admin")}
          >
            global settings →
          </button>
          <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 4 }}>
            Slack tokens, model config, shared capabilities, users
          </p>
        </div>
      )}

      <HealthFooter health={health} />
    </div>
  );
}

function DashboardCard({
  cap,
  userId,
  onDisconnect,
}: {
  cap: CapabilityShape;
  userId: string;
  onDisconnect: () => void;
}): JSX.Element {
  const meta = CAP_META[cap.id] ?? { icon: "⚙️", name: cap.displayName ?? cap.id, desc: "" };
  const [open, setOpen] = useState(false);

  return (
    <div className={`cap-card${open ? " open" : ""}`}>
      <div
        className="cap-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
      >
        <span className="cap-card-icon">{meta.icon}</span>
        <div className="cap-card-meta">
          <div className="cap-card-name">{meta.name}</div>
          <div className="cap-card-desc">{meta.desc}</div>
        </div>
        <div className="cap-card-status">
          <span className="status-connected" style={{ color: "var(--ok)" }}>● on</span>
        </div>
        <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="cap-detail-wrap">
        <div className="cap-detail-inner">
          <div className="cap-detail">
            {open && <CapabilityPrivacy capId={cap.id} userId={userId} />}
            <div style={{ borderTop: "1px solid var(--border-sub)", paddingTop: 12, marginTop: 12 }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ color: "var(--err)", padding: 0, fontSize: "0.786rem" }}
                onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
              >
                disconnect
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilityPrivacy({ capId }: { capId: string; userId: string }): JSX.Element {
  const toast = useToast();
  const save = useSaveState();

  const [loaded, setLoaded] = useState(false);
  const [labels, setLabels] = useState<CheckableLabel[]>([]);
  const [contacts, setContacts] = useState<CheckableContact[]>([]);
  const [conversations, setConversations] = useState<CheckableConversation[]>([]);
  const [calGateAll, setCalGateAll] = useState(true);
  const [calVisibility, setCalVisibility] = useState("private");

  const [labelSearch, setLabelSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [dmSearch, setDmSearch] = useState("");
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [showAllDms, setShowAllDms] = useState(false);

  const isEmail = capId === "gmail";
  const isCal = capId === "calendar";
  const isMessaging = capId === "slack-personal";

  useEffect(() => {
    void (async () => {
      try {
        const status = await getPrivacyStatus();
        const existing = status.existingConfig;

        if (isEmail) {
          const [lb, ct] = await Promise.all([
            getPrivacyLabels().catch(() => ({ labels: [] as PrivacyLabel[] })),
            getPrivacyContacts().catch(() => ({ contacts: [] as PrivacyContact[] })),
          ]);
          const existFolders = new Set(existing?.email?.privateFolders?.map((f) => f.toLowerCase()) ?? []);
          const existAddrs = new Set(existing?.email?.denyListedAddresses?.map((a) => a.toLowerCase()) ?? []);
          const hasExisting = existing != null;
          setLabels(lb.labels.map((l) => ({ ...l, selected: hasExisting ? existFolders.has(l.name.toLowerCase()) || l.preChecked : l.preChecked })));
          setContacts(ct.contacts.map((c) => ({ ...c, selected: hasExisting ? existAddrs.has(c.address.toLowerCase()) || c.preChecked : c.preChecked })));
        } else if (isMessaging) {
          const dm = await getPrivacyDMs().catch(() => ({ conversations: [] as PrivacyConversation[] }));
          const existIds = new Set(existing?.messaging?.denyListedConversationIds ?? []);
          const hasExisting = existing != null;
          setConversations(dm.conversations.map((d) => ({ ...d, selected: hasExisting ? existIds.has(d.id) || d.preChecked : d.preChecked })));
        } else if (isCal) {
          if (existing?.calendar) {
            setCalGateAll(existing.calendar.gateAllByDefault);
            setCalVisibility(existing.calendar.defaultVisibility);
          }
        }
      } catch (err) {
        toast.show(`Failed to load privacy data: ${(err as Error).message}`, "err");
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capId]);

  const filteredLabels = useMemo(() => {
    if (!labelSearch) return labels;
    const q = labelSearch.toLowerCase();
    return labels.filter((l) => l.name.toLowerCase().includes(q));
  }, [labels, labelSearch]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter((c) => c.address.toLowerCase().includes(q) || (c.displayName?.toLowerCase().includes(q) ?? false));
  }, [contacts, contactSearch]);

  const filteredDms = useMemo(() => {
    if (!dmSearch) return conversations;
    const q = dmSearch.toLowerCase();
    return conversations.filter((d) => (d.participantName?.toLowerCase().includes(q) ?? false) || d.id.toLowerCase().includes(q));
  }, [conversations, dmSearch]);

  const visibleLabels = showAllLabels ? filteredLabels : filteredLabels.slice(0, INITIAL_VISIBLE);
  const visibleContacts = showAllContacts ? filteredContacts : filteredContacts.slice(0, INITIAL_VISIBLE);
  const visibleDms = showAllDms ? filteredDms : filteredDms.slice(0, INITIAL_VISIBLE);

  const onSave = async (): Promise<void> => {
    const ok = await save.run(async () => {
      if (isEmail) {
        await savePrivacySection("email", {
          email: {
            privateFolders: labels.filter((l) => l.selected).map((l) => l.name),
            denyListedAddresses: contacts.filter((c) => c.selected).map((c) => c.address),
          },
        });
      } else if (isMessaging) {
        await savePrivacySection("messaging", {
          messaging: {
            denyListedConversationIds: conversations.filter((d) => d.selected).map((d) => d.id),
            denyListedUserIds: conversations.filter((d) => d.selected && d.participantId).map((d) => d.participantId!),
          },
        });
      } else if (isCal) {
        await savePrivacySection("calendar", {
          calendar: { defaultVisibility: calVisibility, gateAllByDefault: calGateAll },
        });
      }
    });
    if (ok) toast.show("Privacy updated", "ok");
    else toast.show("Could not save", "err");
  };

  if (!loaded) return <p className="empty" style={{ padding: "8px 0" }}>loading privacy settings…</p>;

  return (
    <div>
      <div className="detail-label" style={{ marginBottom: 8 }}>privacy</div>
      <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginBottom: 12 }}>
        items marked private are never stored — tino reads them in the moment, then forgets.
      </p>

      {isEmail && (
        <>
          {labels.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="detail-label">private folders</div>
              <input type="search" className="field-input" value={labelSearch} onChange={(e) => setLabelSearch(e.target.value)} placeholder="search…" style={{ marginBottom: 6, marginTop: 4, maxWidth: 280 }} />
              <div className="checklist">
                {visibleLabels.map((l) => (
                  <MiniCheck key={l.name} label={l.name} sub={`${l.itemCount}`} checked={l.selected} onChange={(v) => setLabels((p) => p.map((x) => (x.name === l.name ? { ...x, selected: v } : x)))} />
                ))}
              </div>
              {filteredLabels.length > INITIAL_VISIBLE && !showAllLabels && (
                <button type="button" className="show-more-btn" onClick={() => setShowAllLabels(true)}>show all {filteredLabels.length}</button>
              )}
            </div>
          )}
          {contacts.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="detail-label">private contacts</div>
              <input type="search" className="field-input" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="search…" style={{ marginBottom: 6, marginTop: 4, maxWidth: 280 }} />
              <div className="checklist">
                {visibleContacts.map((c) => (
                  <MiniCheck key={c.address} label={c.displayName ?? c.address} sub={c.displayName ? c.address : undefined} checked={c.selected} onChange={(v) => setContacts((p) => p.map((x) => (x.address === c.address ? { ...x, selected: v } : x)))} />
                ))}
              </div>
              {filteredContacts.length > INITIAL_VISIBLE && !showAllContacts && (
                <button type="button" className="show-more-btn" onClick={() => setShowAllContacts(true)}>show all {filteredContacts.length}</button>
              )}
            </div>
          )}
        </>
      )}

      {isMessaging && conversations.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="detail-label">private conversations</div>
          <input type="search" className="field-input" value={dmSearch} onChange={(e) => setDmSearch(e.target.value)} placeholder="search…" style={{ marginBottom: 6, marginTop: 4, maxWidth: 280 }} />
          <div className="checklist">
            {visibleDms.map((d) => (
              <MiniCheck key={d.id} label={d.participantName ?? d.id} checked={d.selected} onChange={(v) => setConversations((p) => p.map((x) => (x.id === d.id ? { ...x, selected: v } : x)))} />
            ))}
          </div>
          {filteredDms.length > INITIAL_VISIBLE && !showAllDms && (
            <button type="button" className="show-more-btn" onClick={() => setShowAllDms(true)}>show all {filteredDms.length}</button>
          )}
        </div>
      )}

      {isCal && (
        <div style={{ marginBottom: 12 }}>
          <div className="toggle-wrap">
            <label className="toggle" aria-label="Gate all events">
              <input type="checkbox" checked={calGateAll} onChange={(e) => setCalGateAll(e.target.checked)} />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
            <div>
              <span className="fw-label">treat all events as private</span>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                tino sees times but won't remember titles, attendees, or descriptions.
              </div>
            </div>
          </div>
          {!calGateAll && (
            <div className="field-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="field-label" htmlFor={`cap-cal-vis-${capId}`}>default visibility</label>
              <select id={`cap-cal-vis-${capId}`} className="field-input" value={calVisibility} onChange={(e) => setCalVisibility(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="private">private</option>
                <option value="default">default</option>
                <option value="public">public</option>
              </select>
            </div>
          )}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <SaveButton state={save.state} idleLabel="save" size="setup" onClick={onSave} />
      </div>
    </div>
  );
}

function MiniCheck({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="check-item" style={{ minHeight: 36, padding: "4px 8px" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div className="check-item-text">
        <span className="check-item-label">{label}</span>
        {sub ? <span className="check-item-sub">{sub}</span> : null}
      </div>
    </label>
  );
}
