import { useState, type ReactNode, type JSX } from 'react';
import { putCapability } from '../lib/api.js';
import { useToast } from '../hooks/useToast.js';
import { useSaveState, SaveButton } from './SaveButton.js';

interface CapField {
  key: string;
  label?: string;
  value?: string;
  placeholder?: string;
  secret?: boolean;
}

export interface CapabilityShape {
  id: string;
  enabled?: boolean;
  fields?: CapField[];
  /** Anything else from the underlying config — preserved on save. */
  [key: string]: unknown;
}

const CAP_META: Record<string, { icon: string; name: string; desc: string }> = {
  github: { icon: '🐙', name: 'GitHub', desc: 'repos, issues, PRs' },
  calendar: { icon: '📅', name: 'Calendar', desc: 'Google Calendar events' },
  gmail: { icon: '✉️', name: 'Gmail', desc: 'read and send email' },
  linear: { icon: '📐', name: 'Linear', desc: 'issues and projects' },
  cloudwatch: { icon: '☁️', name: 'CloudWatch', desc: 'AWS logs and metrics' },
  slack: { icon: '💬', name: 'Slack read', desc: 'read channel history' },
};

/**
 * One capability card — collapsible header + enable toggle + fields.
 *
 * Mirror: `html.ts:1226-1230` + the `loadCapabilities`/`buildCapFields`/
 * `toggleCapability`/`saveCapability` block at `html.ts:1866-1995`.
 *
 * Each card represents `capability.<id>` in the config store. Whatever
 * shape the store has is preserved on save (we shallow-merge edits over
 * the original).
 */
export function CapabilityCard({
  cap,
  onChanged,
}: {
  cap: CapabilityShape;
  onChanged?: () => void | Promise<void>;
}): JSX.Element {
  const meta = CAP_META[cap.id] ?? { icon: '⚙️', name: cap.id, desc: '' };
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(cap.enabled !== false);
  const initialFields: Record<string, string> = {};
  for (const f of cap.fields ?? []) initialFields[f.key] = f.value ?? '';
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialFields);
  const toast = useToast();
  const { state, run } = useSaveState();

  const stateClass = enabled ? 'state-ok' : 'state-disabled';

  const onToggle = async (next: boolean): Promise<void> => {
    setEnabled(next);
    try {
      await putCapability(cap.id, { ...cap, enabled: next });
      if (onChanged) await onChanged();
    } catch (err) {
      toast.show(`Could not update capability: ${(err as Error).message}`, 'err');
      setEnabled(!next);
    }
  };

  const onSave = async (): Promise<void> => {
    const ok = await run(async () => {
      // Preserve the original shape; overlay enabled + fields edits.
      const fields = (cap.fields ?? []).map((f) => ({
        ...f,
        value: fieldValues[f.key] ?? f.value ?? '',
      }));
      await putCapability(cap.id, { ...cap, enabled, fields });
    });
    if (ok && onChanged) await onChanged();
    if (!ok) toast.show('Could not save', 'err');
  };

  const fields: ReactNode = (cap.fields ?? []).map((f) => (
    <div key={f.key} className="detail-section">
      <div className="detail-label">{f.label ?? f.key}</div>
      <div className="field-group" style={{ marginBottom: 4 }}>
        <input
          className="field-input"
          type={f.secret ? 'password' : 'text'}
          value={fieldValues[f.key] ?? ''}
          onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          placeholder={f.placeholder ?? ''}
          autoComplete="off"
          aria-label={f.label ?? f.key}
        />
      </div>
    </div>
  ));

  return (
    <div className={`cap-card ${stateClass}${open ? ' open' : ''}`}>
      <div
        className="cap-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="cap-card-icon">{meta.icon}</span>
        <div className="cap-card-meta">
          <div className="cap-card-name">{meta.name}</div>
          <div className="cap-card-desc">{meta.desc}</div>
        </div>
        <div className="cap-card-status">
          {enabled ? (
            <span className="status-connected">● on</span>
          ) : (
            <span style={{ fontSize: '0.714rem', color: 'var(--text-dim)' }}>off</span>
          )}
        </div>
        <svg className="cap-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="cap-detail-wrap">
        <div className="cap-detail-inner">
          <div className="cap-detail">
            <div className="detail-section">
              <div className="toggle-wrap">
                <label className="toggle" aria-label={`Enable ${meta.name}`}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => void onToggle(e.target.checked)}
                  />
                  <div className="toggle-track" />
                  <div className="toggle-thumb" />
                </label>
                <span className="fw-label">enabled</span>
              </div>
            </div>
            {fields}
            <div className="btn-row">
              <SaveButton
                state={state}
                idleLabel="save"
                size="setup"
                onClick={onSave}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
