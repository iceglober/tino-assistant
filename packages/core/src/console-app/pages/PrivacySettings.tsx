import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import {
  getPrivacyCalendarVisibility,
  getPrivacyContacts,
  getPrivacyDMs,
  getPrivacyLabels,
  getPrivacyStatus,
  type PrivacyConfig,
  type PrivacyContact,
  type PrivacyConversation,
  type PrivacyLabel,
  type ScanProgress,
  type ScanResult,
  type ScanSuggestion,
  savePrivacySection,
  startPrivacyScan,
} from "../lib/api.js";

interface CheckableLabel extends PrivacyLabel { selected: boolean; scanReason?: string; scanConfidence?: string }
interface CheckableContact extends PrivacyContact { selected: boolean; scanReason?: string; scanConfidence?: string }
interface CheckableConversation extends PrivacyConversation { selected: boolean; scanReason?: string; scanConfidence?: string }

const INITIAL_VISIBLE = 50;

export function PrivacySettings(): JSX.Element {
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const toast = useToast();
  const navigate = useNavigate();
  const status: "ok" | "degraded" | "unreachable" | "checking" = !health ? "checking" : health.ok ? "ok" : "degraded";

  const [config, setConfig] = useState<PrivacyConfig | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const isFirstTime = config == null;

  const [labels, setLabels] = useState<CheckableLabel[]>([]);
  const [contacts, setContacts] = useState<CheckableContact[]>([]);
  const [conversations, setConversations] = useState<CheckableConversation[]>([]);
  const [calGateAll, setCalGateAll] = useState(true);
  const [calVisibility, setCalVisibility] = useState("private");

  const [emailSearch, setEmailSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [dmSearch, setDmSearch] = useState("");

  const [showAllLabels, setShowAllLabels] = useState(false);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [showAllDms, setShowAllDms] = useState(false);

  const [emailOpen, setEmailOpen] = useState(false);
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanDone, setScanDone] = useState(false);
  const scanAbortRef = useRef<AbortController | null>(null);

  const emailSave = useSaveState();
  const messagingSave = useSaveState();
  const calSave = useSaveState();
  const [saved, setSaved] = useState(false);

  const applyScanResult = useCallback((result: ScanResult) => {
    if (result.email?.labels) {
      const sugMap = new Map(result.email.labels.map((s) => [s.id, s]));
      setLabels((prev) => prev.map((l) => {
        const s = sugMap.get(l.name);
        if (!s) return l;
        return { ...l, selected: s.sensitive, scanReason: s.reason, scanConfidence: s.confidence };
      }).sort((a, b) => {
        if (a.scanConfidence === "high" && b.scanConfidence !== "high") return -1;
        if (a.scanConfidence !== "high" && b.scanConfidence === "high") return 1;
        return 0;
      }));
    }
    if (result.email?.contacts) {
      const sugMap = new Map(result.email.contacts.map((s) => [s.id, s]));
      setContacts((prev) => prev.map((c) => {
        const s = sugMap.get(c.address);
        if (!s) return c;
        return { ...c, selected: s.sensitive, scanReason: s.reason, scanConfidence: s.confidence };
      }).sort((a, b) => {
        if (a.scanConfidence === "high" && b.scanConfidence !== "high") return -1;
        if (a.scanConfidence !== "high" && b.scanConfidence === "high") return 1;
        return 0;
      }));
    }
    if (result.messaging?.conversations) {
      const sugMap = new Map(result.messaging.conversations.map((s) => [s.id, s]));
      setConversations((prev) => prev.map((d) => {
        const s = sugMap.get(d.id);
        if (!s) return d;
        return { ...d, selected: s.sensitive, scanReason: s.reason, scanConfidence: s.confidence };
      }).sort((a, b) => {
        if (a.scanConfidence === "high" && b.scanConfidence !== "high") return -1;
        if (a.scanConfidence !== "high" && b.scanConfidence === "high") return 1;
        return 0;
      }));
    }
  }, []);

  const triggerScan = useCallback(() => {
    if (scanning) return;
    setScanning(true);
    setScanProgress(null);
    setScanDone(false);

    const controller = startPrivacyScan(
      (p) => setScanProgress(p),
      (result) => {
        applyScanResult(result);
        setScanDone(true);
        setScanning(false);
        setScanProgress(null);
      },
      (err) => {
        toast.show(`Scan failed: ${err.message}`, "err");
        setScanning(false);
        setScanProgress(null);
      },
    );
    scanAbortRef.current = controller;
  }, [scanning, applyScanResult, toast]);

  useEffect(() => {
    return () => { scanAbortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await getPrivacyStatus();
        setConfig(s.existingConfig);
        setConnected(s.connectedCapabilities);

        if (s.existingConfig?.calendar) {
          setCalGateAll(s.existingConfig.calendar.gateAllByDefault);
          setCalVisibility(s.existingConfig.calendar.defaultVisibility);
        }

        const [lb, ct, dm] = await Promise.all([
          getPrivacyLabels().catch(() => ({ labels: [] as PrivacyLabel[] })),
          getPrivacyContacts().catch(() => ({ contacts: [] as PrivacyContact[] })),
          getPrivacyDMs().catch(() => ({ conversations: [] as PrivacyConversation[] })),
        ]);

        const existingFolders = new Set(s.existingConfig?.email?.privateFolders?.map((l) => l.toLowerCase()) ?? []);
        const existingAddrs = new Set(s.existingConfig?.email?.denyListedAddresses?.map((a) => a.toLowerCase()) ?? []);
        const existingDmIds = new Set(s.existingConfig?.messaging?.denyListedConversationIds ?? []);
        const hasExisting = s.existingConfig != null;

        setLabels(lb.labels.map((l) => ({ ...l, selected: hasExisting ? existingFolders.has(l.name.toLowerCase()) || l.preChecked : true })));
        setContacts(ct.contacts.map((c) => ({ ...c, selected: hasExisting ? existingAddrs.has(c.address.toLowerCase()) || c.preChecked : true })));
        setConversations(dm.conversations.map((d) => ({ ...d, selected: hasExisting ? existingDmIds.has(d.id) || d.preChecked : true })));

        if (!hasExisting) {
          setEmailOpen(true);
          setMessagingOpen(true);
          setCalOpen(true);
        }
      } catch (err) {
        toast.show(`Failed to load: ${(err as Error).message}`, "err");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoScanned = useRef(false);
  useEffect(() => {
    if (!loading && isFirstTime && connected.length > 0 && !autoScanned.current) {
      autoScanned.current = true;
      triggerScan();
    }
  }, [loading, isFirstTime, connected, triggerScan]);

  const hasEmail = connected.includes("gmail") || connected.includes("calendar");
  const hasMessaging = connected.includes("slack-personal");
  const hasCal = connected.includes("gmail") || connected.includes("calendar");
  const hasAnyCap = hasEmail || hasMessaging || hasCal;

  const filteredLabels = useMemo(() => {
    if (!emailSearch) return labels;
    const q = emailSearch.toLowerCase();
    return labels.filter((l) => l.name.toLowerCase().includes(q));
  }, [labels, emailSearch]);

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

  const onSaveEmail = async (): Promise<void> => {
    const ok = await emailSave.run(async () => {
      await savePrivacySection("email", {
        email: {
          privateFolders: labels.filter((l) => l.selected).map((l) => l.name),
          denyListedAddresses: contacts.filter((c) => c.selected).map((c) => c.address),
        },
      });
    });
    if (ok) {
      toast.show("Email privacy updated", "ok");
      setSaved(true);
    } else toast.show("Could not save", "err");
  };

  const onSaveMessaging = async (): Promise<void> => {
    const ok = await messagingSave.run(async () => {
      await savePrivacySection("messaging", {
        messaging: {
          denyListedConversationIds: conversations.filter((d) => d.selected).map((d) => d.id),
          denyListedUserIds: conversations.filter((d) => d.selected && d.participantId).map((d) => d.participantId!),
        },
      });
    });
    if (ok) {
      toast.show("Messaging privacy updated", "ok");
      setSaved(true);
    } else toast.show("Could not save", "err");
  };

  const onSaveCalendar = async (): Promise<void> => {
    const ok = await calSave.run(async () => {
      await savePrivacySection("calendar", {
        calendar: { defaultVisibility: calVisibility, gateAllByDefault: calGateAll },
      });
    });
    if (ok) {
      toast.show("Calendar privacy updated", "ok");
      setSaved(true);
    } else toast.show("Could not save", "err");
  };

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />

      <button type="button" className="back-link" onClick={() => navigate("/")}>
        ← back to home
      </button>

      <div className="section-label">privacy settings</div>
      <p className="section-hint">
        control what tino stores in the database. data marked as private is ephemeral — tino sees it to answer your question, then forgets.
      </p>

      {isFirstTime && hasAnyCap && (
        <div className="privacy-intro">
          <strong>first time here?</strong> tino is scanning your data to suggest what should be private. review and adjust, then save.
        </div>
      )}

      {!isFirstTime && hasAnyCap && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
          {!config && (
            <p className="section-hint" style={{ color: "var(--accent)", margin: 0 }}>
              no privacy config saved yet — all items are deny-listed by default.
            </p>
          )}
          <button
            type="button"
            className="scan-btn"
            disabled={scanning}
            onClick={triggerScan}
          >
            {scanning ? "scanning..." : scanDone ? "re-scan" : "scan my data"}
          </button>
        </div>
      )}

      {scanning && scanProgress && (
        <div className="scan-progress">
          <div className="scan-progress-bar">
            <div className="scan-progress-fill" style={{ width: `${scanProgress.pct}%` }} />
          </div>
          <span className="scan-progress-label">{scanProgress.message}</span>
        </div>
      )}

      {scanDone && !scanning && (
        <p className="section-hint" style={{ color: "var(--ok)", marginTop: 4 }}>
          scan complete — items flagged as sensitive are pre-selected. review and save your preferences.
        </p>
      )}

      {loading ? (
        <p className="empty">loading…</p>
      ) : !hasAnyCap ? (
        <p className="empty" style={{ color: "var(--text-dim)" }}>
          no personal capabilities connected yet. connect Gmail, Calendar, or Slack from the dashboard to configure privacy.
        </p>
      ) : (
        <div className="cap-grid" style={{ marginTop: 16 }}>
          {hasEmail && (
            <SettingsCard title="Email" icon="✉️" open={emailOpen} onToggle={() => setEmailOpen((v) => !v)}>
              {labels.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="detail-label">private folders</div>
                  <p className="section-hint" style={{ margin: "4px 0 8px" }}>checked folders are deny-listed — tino won't store their content.</p>
                  <SearchBar value={emailSearch} onChange={setEmailSearch} placeholder="search labels…" />
                  <BulkActions
                    items={filteredLabels}
                    onSelectAll={() => setLabels((prev) => { const ids = new Set(filteredLabels.map((l) => l.name)); return prev.map((x) => ids.has(x.name) ? { ...x, selected: true } : x); })}
                    onDeselectAll={() => setLabels((prev) => { const ids = new Set(filteredLabels.map((l) => l.name)); return prev.map((x) => ids.has(x.name) ? { ...x, selected: false } : x); })}
                  />
                  <div className="checklist">
                    {visibleLabels.map((l) => (
                      <CheckItem
                        key={l.name}
                        label={l.name}
                        sublabel={`${l.itemCount} messages`}
                        reason={l.scanReason}
                        confidence={l.scanConfidence}
                        examples={l.examples}
                        checked={l.selected}
                        onChange={(v) => setLabels((prev) => prev.map((x) => (x.name === l.name ? { ...x, selected: v } : x)))}
                      />
                    ))}
                  </div>
                  {filteredLabels.length > INITIAL_VISIBLE && !showAllLabels && (
                    <button type="button" className="show-more-btn" onClick={() => setShowAllLabels(true)}>
                      show all {filteredLabels.length} labels
                    </button>
                  )}
                </div>
              )}
              {contacts.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="detail-label">deny-listed contacts</div>
                  <p className="section-hint" style={{ margin: "4px 0 8px" }}>checked contacts are deny-listed — emails from them won't be stored.</p>
                  <SearchBar value={contactSearch} onChange={setContactSearch} placeholder="search contacts…" />
                  <BulkActions
                    items={filteredContacts}
                    onSelectAll={() => setContacts((prev) => { const ids = new Set(filteredContacts.map((c) => c.address)); return prev.map((x) => ids.has(x.address) ? { ...x, selected: true } : x); })}
                    onDeselectAll={() => setContacts((prev) => { const ids = new Set(filteredContacts.map((c) => c.address)); return prev.map((x) => ids.has(x.address) ? { ...x, selected: false } : x); })}
                  />
                  <div className="checklist">
                    {visibleContacts.map((c) => (
                      <CheckItem
                        key={c.address}
                        label={c.displayName ?? c.address}
                        sublabel={c.displayName ? c.address : undefined}
                        reason={c.scanReason}
                        confidence={c.scanConfidence}
                        examples={c.examples}
                        checked={c.selected}
                        onChange={(v) => setContacts((prev) => prev.map((x) => (x.address === c.address ? { ...x, selected: v } : x)))}
                      />
                    ))}
                  </div>
                  {filteredContacts.length > INITIAL_VISIBLE && !showAllContacts && (
                    <button type="button" className="show-more-btn" onClick={() => setShowAllContacts(true)}>
                      show all {filteredContacts.length} contacts
                    </button>
                  )}
                </div>
              )}
              <div className="btn-row">
                <SaveButton state={emailSave.state} idleLabel="save" size="setup" onClick={onSaveEmail} />
              </div>
            </SettingsCard>
          )}

          {hasMessaging && (
            <SettingsCard title="Messaging" icon="🔒" open={messagingOpen} onToggle={() => setMessagingOpen((v) => !v)}>
              {conversations.length > 0 ? (
                <>
                  <p className="section-hint" style={{ margin: "0 0 8px" }}>checked conversations are deny-listed — tino won't store their content.</p>
                  <SearchBar value={dmSearch} onChange={setDmSearch} placeholder="search conversations…" />
                  <BulkActions
                    items={filteredDms}
                    onSelectAll={() => setConversations((prev) => { const ids = new Set(filteredDms.map((d) => d.id)); return prev.map((x) => ids.has(x.id) ? { ...x, selected: true } : x); })}
                    onDeselectAll={() => setConversations((prev) => { const ids = new Set(filteredDms.map((d) => d.id)); return prev.map((x) => ids.has(x.id) ? { ...x, selected: false } : x); })}
                  />
                  <div className="checklist" style={{ marginBottom: 16 }}>
                    {visibleDms.map((d) => (
                      <CheckItem
                        key={d.id}
                        label={d.participantName ?? d.participantId ?? d.id}
                        reason={d.scanReason}
                        confidence={d.scanConfidence}
                        examples={d.examples}
                        checked={d.selected}
                        onChange={(v) => setConversations((prev) => prev.map((x) => (x.id === d.id ? { ...x, selected: v } : x)))}
                      />
                    ))}
                  </div>
                  {filteredDms.length > INITIAL_VISIBLE && !showAllDms && (
                    <button type="button" className="show-more-btn" onClick={() => setShowAllDms(true)}>
                      show all {filteredDms.length} conversations
                    </button>
                  )}
                </>
              ) : (
                <p className="empty">no DM conversations found.</p>
              )}
              <div className="btn-row">
                <SaveButton state={messagingSave.state} idleLabel="save" size="setup" onClick={onSaveMessaging} />
              </div>
            </SettingsCard>
          )}

          {hasCal && (
            <SettingsCard title="Calendar" icon="📅" open={calOpen} onToggle={() => setCalOpen((v) => !v)}>
              <div className="toggle-wrap" style={{ marginBottom: 12 }}>
                <label className="toggle" aria-label="Gate all events">
                  <input type="checkbox" checked={calGateAll} onChange={(e) => setCalGateAll(e.target.checked)} />
                  <div className="toggle-track" />
                  <div className="toggle-thumb" />
                </label>
                <div>
                  <span className="fw-label">treat all events as private</span>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                    tino sees event times but won't store titles, attendees, or descriptions.
                  </div>
                </div>
              </div>
              {!calGateAll && (
                <div className="field-group" style={{ marginBottom: 12 }}>
                  <label className="field-label" htmlFor="privacy-cal-vis">default visibility</label>
                  <select
                    id="privacy-cal-vis"
                    className="field-input"
                    value={calVisibility}
                    onChange={(e) => setCalVisibility(e.target.value)}
                    style={{ maxWidth: 240 }}
                  >
                    <option value="private">private</option>
                    <option value="default">default</option>
                    <option value="public">public</option>
                  </select>
                </div>
              )}
              <div className="btn-row">
                <SaveButton state={calSave.state} idleLabel="save" size="setup" onClick={onSaveCalendar} />
              </div>
            </SettingsCard>
          )}
        </div>
      )}

      {saved && (
        <div className="privacy-saved-cta">
          <span>privacy settings saved.</span>
          <button type="button" className="btn btn-primary btn-setup" onClick={() => navigate("/")}>
            return to home
          </button>
        </div>
      )}

      <HealthFooter health={health} />
    </div>
  );
}

function SettingsCard({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`cap-card${open ? " open" : ""}`}>
      {/* biome-ignore lint/a11y/useSemanticElements: card header click target */}
      <div
        className="cap-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <span className="cap-card-icon">{icon}</span>
        <div className="cap-card-meta">
          <div className="cap-card-name">{title}</div>
          <div className="cap-card-desc">privacy rules</div>
        </div>
        <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="cap-detail-wrap">
        <div className="cap-detail-inner">
          <div className="cap-detail">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): JSX.Element {
  return (
    <input
      type="search"
      className="field-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ marginBottom: 8, maxWidth: 320 }}
    />
  );
}

function BulkActions({ items, onSelectAll, onDeselectAll }: { items: Array<{ selected: boolean }>; onSelectAll: () => void; onDeselectAll: () => void }): JSX.Element {
  const selectedCount = items.filter((i) => i.selected).length;
  return (
    <div className="bulk-actions">
      <button type="button" className="btn-ghost" onClick={onSelectAll}>select all</button>
      <button type="button" className="btn-ghost" onClick={onDeselectAll}>deselect all</button>
      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
        {selectedCount} of {items.length} deny-listed
      </span>
    </div>
  );
}

function CheckItem({
  label,
  sublabel,
  reason,
  confidence,
  examples,
  checked,
  onChange,
}: {
  label: string;
  sublabel?: string;
  reason?: string;
  confidence?: string;
  examples?: string[];
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  const [showExamples, setShowExamples] = useState(false);
  const hasExamples = examples && examples.length > 0;

  return (
    <div className="check-item-wrap">
      <label className="check-item">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className="check-item-text">
          <span className="check-item-label">
            {label}
            {confidence === "high" && <span className="confidence-dot confidence-high" />}
            {confidence === "medium" && <span className="confidence-dot confidence-medium" />}
          </span>
          {sublabel ? <span className="check-item-sub">{sublabel}</span> : null}
          {reason ? <span className="check-item-reason">{reason}</span> : null}
        </div>
        {hasExamples && (
          <button
            type="button"
            className="examples-toggle"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowExamples((v) => !v); }}
          >
            {showExamples ? "hide" : "examples"}
          </button>
        )}
      </label>
      {showExamples && hasExamples && (
        <ul className="check-item-examples">
          {examples.map((ex, i) => (
            <li key={i}>{ex}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
