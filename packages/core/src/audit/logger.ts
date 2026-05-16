/**
 * Audit logging interface and types.
 *
 * Every tool call, config change, login, and data access is logged here.
 * This is the HIPAA audit trail.
 *
 * Design:
 * - AuditEntry captures WHO did WHAT, WHEN, and whether it succeeded.
 * - inputKeys records parameter KEYS only — never values (which may contain PII/secrets).
 * - AuditLogger is an interface; implementations are MemoryAuditLogger (local dev)
 *   and DynamoAuditLogger (AWS).
 */

export interface AuditEntry {
  timestamp: number;
  userId: string;
  action:
    | 'tool_call'
    | 'config_change'
    | 'login'
    | 'capability_toggle'
    | 'task_scheduled'
    | 'task_executed'
    | 'injection_suspected'
    | 'user_deprovisioned'
    | 'admin_restart';
  toolName?: string;
  capabilityInstanceId?: string;
  /** Parameter KEYS only — never values (values may contain PII or secrets). */
  inputKeys?: string[];
  durationMs?: number;
  status: 'success' | 'error' | 'denied';
  errorMessage?: string;
}

export interface AuditQueryOptions {
  userId?: string;
  action?: string;
  since?: number;
  limit?: number;
}

export interface AuditLogger {
  log(entry: Omit<AuditEntry, 'timestamp'>): Promise<void>;
  query(opts: AuditQueryOptions): Promise<AuditEntry[]>;
  /** Total number of entries stored. */
  count(): Promise<number>;
  /** Timestamp of the most recent entry, or undefined if empty. */
  lastEntryAt(): Promise<number | undefined>;
}
