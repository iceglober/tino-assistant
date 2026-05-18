import { type JSX, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CapabilityCard, type CapabilityShape } from "../components/CapabilityCard.js";
import { Header } from "../components/Header.js";
import { HealthFooter } from "../components/HealthFooter.js";
import { useAuth } from "../hooks/useAuth.js";
import { useHealth } from "../hooks/useHealth.js";
import { useToast } from "../hooks/useToast.js";
import { deleteUserCapability, getUserCapabilities } from "../lib/api.js";

/**
 * My Capabilities page — user's personal capability configuration.
 *
 * Like Console.tsx but scoped to a single user's per-user capabilities.
 * Stored under `user.<userId>.capability.<id>` keys in the config store.
 *
 * Sections:
 *   1. Header (logo, status dot, signed-in user, sign out)
 *   2. Capability cards (only user's configured capabilities)
 *   3. Health footer
 */
export function MyCapabilities(): JSX.Element {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { health } = useHealth();
  const toast = useToast();

  const status: "ok" | "degraded" | "unreachable" | "checking" = !health ? "checking" : health.ok ? "ok" : "degraded";

  // ── Load user's personal capabilities ────────────────────────────────
  const [caps, setCaps] = useState<CapabilityShape[]>([]);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadCaps = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const data = await getUserCapabilities(session.user.id);
      setCaps(data as unknown as CapabilityShape[]);
      setCapsError(null);
    } catch (err) {
      setCapsError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount
  useEffect(() => {
    void loadCaps();
  }, []);

  if (!session?.user.id) {
    navigate("/");
    return <div className="page">loading…</div>;
  }

  const onCapabilityDelete = async (capabilityId: string): Promise<void> => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Remove ${capabilityId} from your personal capabilities?`);
      if (!ok) return;
    }
    try {
      await deleteUserCapability(session.user.id, capabilityId);
      toast.show("Capability removed", "ok");
      await loadCaps();
    } catch (err) {
      toast.show(`Could not delete: ${(err as Error).message}`, "err");
    }
  };

  return (
    <div className="page">
      <Header status={status} session={session} onSignOut={() => void signOut()} />

      <div className="section-label">my capabilities</div>
      <div className="cap-grid">
        {isLoading ? (
          <p className="empty">loading…</p>
        ) : capsError ? (
          <p className="empty">error loading capabilities: {capsError}</p>
        ) : caps.length === 0 ? (
          <p className="empty">no personal capabilities configured</p>
        ) : (
          caps.map((cap) => (
            <div key={cap.id} style={{ position: "relative" }}>
              <CapabilityCard cap={cap} onChanged={loadCaps} />
              <DeleteButton
                capabilityId={cap.id}
                displayName={cap.displayName || cap.id}
                onDelete={() => onCapabilityDelete(cap.id)}
              />
            </div>
          ))
        )}
      </div>

      <HealthFooter health={health} />
    </div>
  );
}

/**
 * Delete button overlay for personal capabilities.
 */
function DeleteButton({
  displayName,
  onDelete,
}: {
  capabilityId: string;
  displayName: string;
  onDelete: () => void | Promise<void>;
}): JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <button
        type="button"
        className="cap-delete-btn"
        aria-label={`Remove ${displayName}`}
        onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "var(--err)",
          color: "white",
          border: "none",
          borderRadius: 4,
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          opacity: 0.8,
          transition: "opacity 0.2s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.8";
        }}
      >
        remove
      </button>
      {showDeleteConfirm ? (
        <div
          style={{
            position: "absolute",
            top: 50,
            right: 16,
            background: "var(--bg)",
            border: "1px solid var(--err)",
            borderRadius: 6,
            padding: 12,
            fontSize: 13,
            zIndex: 10,
            minWidth: 200,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ marginBottom: 12, color: "var(--text)" }}>
            This will permanently remove this capability. Are you sure?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                void onDelete();
                setShowDeleteConfirm(false);
              }}
              style={{
                flex: 1,
                background: "var(--err)",
                color: "white",
                border: "none",
                borderRadius: 4,
                padding: "6px 8px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              delete
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              style={{
                flex: 1,
                background: "var(--bg-hover)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "6px 8px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
