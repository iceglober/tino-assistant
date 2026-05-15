import { useEffect, useState, type JSX } from 'react';
import { getCompliance } from '../lib/api.js';

interface ComplianceData {
  hipaa?: {
    encryption?: Record<string, string>;
    auditLogging?: { enabled: boolean; entryCount: number; lastEntryAt: string | null; retentionDays: number };
    dataRetention?: { ttlEnabled: boolean; historyRetentionDays: number; auditRetentionDays: number };
    baaStatus?: Record<string, string>;
    accessControl?: { userCount: number; adminCount: number };
  };
}

type Status = 'ok' | 'warn' | 'err' | 'dim';

interface Row {
  service: string;
  status: Status;
  detail: string;
}

/**
 * "compliance status" collapsible section.
 *
 * Mirror: `html.ts:1406-1422` (markup) + the `loadCompliance` helper at
 * `html.ts:1794-1830`. The Hono `/api/compliance` route returns the
 * `hipaa` shape (see `routes/compliance.ts`); we flatten it into a small
 * table row per service so the UI stays close to the legacy shape.
 */
export function ComplianceSection(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || rows.length > 0 || loading) return;
    setLoading(true);
    void (async () => {
      try {
        const data = (await getCompliance()) as ComplianceData;
        setRows(deriveRows(data));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, rows.length, loading]);

  return (
    <div className={`compliance-section${open ? ' open' : ''}`}>
      <button
        className="compliance-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="compliance-body-wrap"
      >
        <svg className="compliance-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        compliance status
      </button>
      <div className="compliance-body-wrap" id="compliance-body-wrap">
        <div className="compliance-body-inner">
          <div style={{ paddingTop: 12 }}>
            {loading ? (
              <p className="compliance-loading">loading…</p>
            ) : error ? (
              <p className="compliance-loading">error: {error}</p>
            ) : rows.length === 0 ? (
              <p className="compliance-loading">no compliance data available</p>
            ) : (
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>service</th>
                    <th>status</th>
                    <th>detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.service}>
                      <td>{r.service}</td>
                      <td>
                        <span className={`status-badge status-${r.status}`}>{r.status}</span>
                      </td>
                      <td>{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function deriveRows(data: ComplianceData): Row[] {
  const h = data.hipaa;
  if (!h) return [];
  const rows: Row[] = [];

  // Audit logging
  if (h.auditLogging) {
    rows.push({
      service: 'audit logging',
      status: h.auditLogging.enabled ? 'ok' : 'warn',
      detail: h.auditLogging.enabled
        ? `${h.auditLogging.entryCount} entries, ${h.auditLogging.retentionDays}d retention`
        : 'disabled',
    });
  }

  // Data retention
  if (h.dataRetention) {
    rows.push({
      service: 'data retention',
      status: h.dataRetention.ttlEnabled ? 'ok' : 'warn',
      detail: `history ${h.dataRetention.historyRetentionDays}d, audit ${h.dataRetention.auditRetentionDays}d`,
    });
  }

  // Encryption
  if (h.encryption) {
    for (const [svc, state] of Object.entries(h.encryption)) {
      rows.push({
        service: `encryption · ${svc}`,
        status: state === 'enabled' ? 'ok' : state === 'disabled' ? 'err' : 'dim',
        detail: state,
      });
    }
  }

  // BAA status
  if (h.baaStatus) {
    for (const [svc, state] of Object.entries(h.baaStatus)) {
      const status: Status = state === 'signed' ? 'ok' : state === 'no-baa' ? 'err' : 'dim';
      rows.push({ service: `BAA · ${svc}`, status, detail: state });
    }
  }

  // Access control
  if (h.accessControl) {
    rows.push({
      service: 'access control',
      status: 'ok',
      detail: `${h.accessControl.userCount} user(s), ${h.accessControl.adminCount} admin(s)`,
    });
  }

  return rows;
}
