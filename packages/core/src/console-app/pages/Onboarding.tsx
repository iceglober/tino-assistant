import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveButton, useSaveState } from "../components/SaveButton.js";
import { useToast } from "../hooks/useToast.js";
import type {
  PrivacyContact,
  PrivacyConversation,
  PrivacyLabel,
  ScanProgress,
  ScanResult,
  Session,
} from "../lib/api.js";
import {
  getPrivacyCalendarVisibility,
  getPrivacyContacts,
  getPrivacyDMs,
  getPrivacyLabels,
  getPrivacyStatus,
  savePrivacySection,
  startPrivacyScan,
} from "../lib/api.js";

interface CheckableLabel extends PrivacyLabel { selected: boolean; scanReason?: string; scanConfidence?: string }
interface CheckableContact extends PrivacyContact { selected: boolean; scanReason?: string; scanConfidence?: string }
interface CheckableConversation extends PrivacyConversation { selected: boolean; scanReason?: string; scanConfidence?: string }

const INITIAL_VISIBLE = 50;

export function Onboarding({
  onComplete,
}: {
  session: Session;
  onComplete: () => void;
}): JSX.Element {
  const toast = useToast();

  const [connected, setConnected] = useState<string[]>([]);
  const [statusLoaded, setStatusLoaded] = useState(false);

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

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanDone, setScanDone] = useState(false);
  const scanAbortRef = useRef<AbortController | null>(null);
  const save = useSaveState();

  const applyScanResult = useCallback((result: ScanResult) => {
    const sortByConfidence = <T extends { scanConfidence?: string }>(a: T, b: T): number => {
      if (a.scanConfidence === "high" && b.scanConfidence !== "high") return -1;
      if (a.scanConfidence !== "high" && b.scanConfidence === "high") return 1;
      return 0;
    };
    if (result.email?.labels) {
      const sugMap = new Map(result.email.labels.map((s) => [s.id, s]));
      setLabels((prev) => prev.map((l) => {
        const s = sugMap.get(l.name);
        return s ? { ...l, selected: s.sensitive, scanReason: s.reason, scanConfidence: s.confidence } : l;
      }).sort(sortByConfidence));
    }
    if (result.email?.contacts) {
      const sugMap = new Map(result.email.contacts.map((s) => [s.id, s]));
      setContacts((prev) => prev.map((c) => {
        const s = sugMap.get(c.address);
        return s ? { ...c, selected: s.sensitive, scanReason: s.reason, scanConfidence: s.confidence } : c;
      }).sort(sortByConfidence));
    }
    if (result.messaging?.conversations) {
      const sugMap = new Map(result.messaging.conversations.map((s) => [s.id, s]));
      setConversations((prev) => prev.map((d) => {
        const s = sugMap.get(d.id);
        return s ? { ...d, selected: s.sensitive, scanReason: s.reason, scanConfidence: s.confidence } : d;
      }).sort(sortByConfidence));
    }
  }, []);

  const triggerScan = useCallback(() => {
    if (scanning) return;
    setScanning(true);
    setScanProgress(null);
    setScanDone(false);
    const controller = startPrivacyScan(
      (p) => setScanProgress(p),
      (result) => { applyScanResult(result); setScanDone(true); setScanning(false); setScanProgress(null); },
      (err) => { toast.show(`Scan failed: ${err.message}`, "err"); setScanning(false); setScanProgress(null); },
    );
    scanAbortRef.current = controller;
  }, [scanning, applyScanResult, toast]);

  useEffect(() => { return () => { scanAbortRef.current?.abort(); }; }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await getPrivacyStatus();
        setConnected(s.connectedCapabilities);
      } catch (err) {
        toast.show(`Failed to load: ${(err as Error).message}`, "err");
      } finally {
        setStatusLoaded(true);
      }
    })();

    void getPrivacyLabels()
      .then((lb) => setLabels(lb.labels.map((l) => ({ ...l, selected: l.preChecked }))))
      .catch(() => {});
    void getPrivacyContacts()
      .then((ct) => setContacts(ct.contacts.map((c) => ({ ...c, selected: c.preChecked }))))
      .catch(() => {});
    void getPrivacyDMs()
      .then((dm) => setConversations(dm.conversations.map((d) => ({ ...d, selected: d.preChecked }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoScanned = useRef(false);
  useEffect(() => {
    if (!statusLoaded || connected.length === 0 || autoScanned.current) return;
    autoScanned.current = true;
    triggerScan();
  }, [statusLoaded, connected, triggerScan]);

  const hasEmail = connected.includes("gmail") || connected.includes("calendar");
  const hasMessaging = connected.includes("slack-personal");
  const hasCal = connected.includes("gmail") || connected.includes("calendar");

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

  const onSaveAll = async (): Promise<void> => {
    const ok = await save.run(async () => {
      const saves: Promise<unknown>[] = [];
      if (hasEmail) {
        saves.push(savePrivacySection("email", {
          email: {
            privateFolders: labels.filter((l) => l.selected).map((l) => l.name),
            denyListedAddresses: contacts.filter((c) => c.selected).map((c) => c.address),
          },
        }));
      }
      if (hasMessaging) {
        saves.push(savePrivacySection("messaging", {
          messaging: {
            denyListedConversationIds: conversations.filter((d) => d.selected).map((d) => d.id),
            denyListedUserIds: conversations.filter((d) => d.selected && d.participantId).map((d) => d.participantId!),
          },
        }));
      }
      if (hasCal) {
        saves.push(savePrivacySection("calendar", {
          calendar: { defaultVisibility: calVisibility, gateAllByDefault: calGateAll },
        }));
      }
      await Promise.all(saves);
    });
    if (ok) {
      toast.show("Privacy settings saved", "ok");
      setTimeout(() => onComplete(), 600);
    } else {
      toast.show("Could not save", "err");
    }
  };

  if (!statusLoaded) {
    return (
      <div className="onboarding-page">
        <div className="onboarding-container">
          <img src="/assets/tino-logo.png" alt="tino" className="onboarding-logo" />
          <p className="empty">loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        <img src="/assets/tino-logo.png" alt="tino" className="onboarding-logo" />

        {scanning && !scanDone ? (
          <div className="onboarding-scan">
            <h1 className="setup-heading">learning about your data…</h1>
            <p className="setup-lead">
              tino is scanning your email, calendar, and messages to suggest what should stay private.
            </p>
            {scanProgress && (
              <div className="scan-progress" style={{ justifyContent: "center" }}>
                <div className="scan-progress-bar" style={{ maxWidth: 400 }}>
                  <div className="scan-progress-fill" style={{ width: `${scanProgress.pct}%` }} />
                </div>
                <span className="scan-progress-label">{scanProgress.message}</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <h1 className="setup-heading">
              {labels.length === 0 && contacts.length === 0 && conversations.length === 0
                ? "privacy settings"
                : "here's what tino found"}
            </h1>

            <div className="onboarding-explainer">
              <p>
                when tino <strong>remembers</strong> something, it stores a summary in its database
                so it can reference it later — across conversations, across days.
              </p>
              <p>
                items you mark as <strong>private</strong> are never stored. tino reads them
                in the moment to help you, then forgets immediately.
              </p>
              {labels.length === 0 && contacts.length === 0 && conversations.length === 0 && (
                <p style={{ marginTop: 8, color: "var(--text-dim)" }}>
                  no email or messaging data was found — you can configure privacy later from each capability's settings.
                </p>
              )}
            </div>

            {hasEmail && labels.length > 0 && (
              <div className="onboarding-section">
                <div className="section-label" style={{ marginTop: 0 }}>email folders</div>
                <p className="section-hint">checked folders are private — tino won't remember their content.</p>
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

            {hasEmail && contacts.length > 0 && (
              <div className="onboarding-section">
                <div className="section-label" style={{ marginTop: 0 }}>email contacts</div>
                <p className="section-hint">checked contacts are private — emails from them won't be remembered.</p>
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

            {hasMessaging && conversations.length > 0 && (
              <div className="onboarding-section">
                <div className="section-label" style={{ marginTop: 0 }}>slack conversations</div>
                <p className="section-hint">checked conversations are private — tino won't remember their content.</p>
                <SearchBar value={dmSearch} onChange={setDmSearch} placeholder="search conversations…" />
                <BulkActions
                  items={filteredDms}
                  onSelectAll={() => setConversations((prev) => { const ids = new Set(filteredDms.map((d) => d.id)); return prev.map((x) => ids.has(x.id) ? { ...x, selected: true } : x); })}
                  onDeselectAll={() => setConversations((prev) => { const ids = new Set(filteredDms.map((d) => d.id)); return prev.map((x) => ids.has(x.id) ? { ...x, selected: false } : x); })}
                />
                <div className="checklist">
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
              </div>
            )}

            {hasCal && (
              <div className="onboarding-section">
                <div className="section-label" style={{ marginTop: 0 }}>calendar</div>
                <div className="toggle-wrap" style={{ marginBottom: 12 }}>
                  <label className="toggle" aria-label="Gate all events">
                    <input type="checkbox" checked={calGateAll} onChange={(e) => setCalGateAll(e.target.checked)} />
                    <div className="toggle-track" />
                    <div className="toggle-thumb" />
                  </label>
                  <div>
                    <span className="fw-label">treat all events as private</span>
                    <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                      tino sees event times but won't remember titles, attendees, or descriptions.
                    </div>
                  </div>
                </div>
                {!calGateAll && (
                  <div className="field-group" style={{ marginBottom: 0 }}>
                    <label className="field-label" htmlFor="onb-cal-vis">default visibility</label>
                    <select
                      id="onb-cal-vis"
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
              </div>
            )}

            <div className="onboarding-save">
              <SaveButton
                state={save.state}
                idleLabel="save and continue"
                savingLabel="saving…"
                savedLabel="done"
                size="large"
                onClick={onSaveAll}
              />
              <p style={{ fontSize: "0.786rem", color: "var(--text-dim)", marginTop: 8 }}>
                you can always change these later from each capability's settings.
              </p>
            </div>
          </>
        )}
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
        {selectedCount} of {items.length} marked private
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
