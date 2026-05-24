import { type JSX, useEffect, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import type { TaskItem } from "../lib/api.js";
import { cancelTask, getTasks } from "../lib/api.js";
import { TabPanel, Tabs } from "../components/Tabs.js";

const TABS = [
  { id: "tasks", label: "Tasks" },
  { id: "scheduled", label: "Scheduled" },
];

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "pending", cls: "status-dim" },
  running: { label: "running", cls: "status-warn" },
  completed: { label: "completed", cls: "status-ok" },
  failed: { label: "failed", cls: "status-err" },
  cancelled: { label: "cancelled", cls: "status-dim" },
};

export function Work(): JSX.Element {
  const toast = useToast();
  const [tab, setTab] = useState("tasks");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getTasks();
        setTasks(data);
      } catch { /* ignore */ }
      finally { setLoaded(true); }
    })();
  }, []);

  const onCancel = async (id: string): Promise<void> => {
    try {
      await cancelTask(id);
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "cancelled" as const } : t));
      toast.show("Task cancelled", "ok");
    } catch (err) {
      toast.show(`Cancel failed: ${(err as Error).message}`, "err");
    }
  };

  const activeTasks = tasks.filter((t) => t.status === "pending" || t.status === "running");
  const historyTasks = tasks.filter((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled");
  const scheduled = tasks.filter((t) => t.status === "pending").sort((a, b) => a.scheduledAt - b.scheduledAt);

  return (
    <div>
      <h2 className="section-label" style={{ marginTop: 0 }}>Work</h2>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel active={tab} id="tasks">
        {!loaded ? (
          <p className="empty">loading…</p>
        ) : activeTasks.length === 0 && historyTasks.length === 0 ? (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            No tasks yet. Tino creates tasks when asked to schedule work via Slack.
          </p>
        ) : (
          <>
            {activeTasks.length > 0 && (
              <div className="task-list">
                {activeTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onCancel={onCancel} />
                ))}
              </div>
            )}

            {activeTasks.length === 0 && historyTasks.length > 0 && (
              <p className="empty" style={{ color: "var(--text-dim)", padding: "12px 0" }}>
                No active tasks.
              </p>
            )}

            {historyTasks.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: 0, fontSize: "0.786rem" }}
                  onClick={() => setShowHistory((v) => !v)}
                >
                  {showHistory ? "hide" : "show"} history ({historyTasks.length})
                </button>
                {showHistory && (
                  <div className="task-list" style={{ marginTop: 8 }}>
                    {historyTasks.map((t) => (
                      <TaskRow key={t.id} task={t} onCancel={onCancel} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </TabPanel>

      <TabPanel active={tab} id="scheduled">
        {!loaded ? (
          <p className="empty">loading…</p>
        ) : scheduled.length === 0 ? (
          <p className="empty" style={{ color: "var(--text-dim)" }}>
            No upcoming scheduled tasks.
          </p>
        ) : (
          <div className="task-list">
            {scheduled.map((t) => (
              <TaskRow key={t.id} task={t} onCancel={onCancel} showSchedule />
            ))}
          </div>
        )}
      </TabPanel>
    </div>
  );
}

function TaskRow({
  task,
  onCancel,
  showSchedule,
}: {
  task: TaskItem;
  onCancel: (id: string) => Promise<void>;
  showSchedule?: boolean;
}): JSX.Element {
  const st = STATUS_LABELS[task.status] ?? { label: task.status, cls: "status-dim" };

  return (
    <div className="task-row">
      <div className="task-row-main">
        <span className="task-desc">{task.description}</span>
        <span className={`status-badge ${st.cls}`}>{st.label}</span>
      </div>
      <div className="task-row-meta">
        {showSchedule && (
          <span className="task-time">
            scheduled {formatDate(task.scheduledAt)}
          </span>
        )}
        {!showSchedule && (
          <span className="task-time">
            {formatDate(task.createdAt)}
          </span>
        )}
        {task.status === "pending" && (
          <button
            type="button"
            className="btn-ghost"
            style={{ color: "var(--err)", padding: 0, fontSize: "0.714rem" }}
            onClick={() => void onCancel(task.id)}
          >
            cancel
          </button>
        )}
      </div>
      {task.result && (
        <div className="task-result">{task.result}</div>
      )}
    </div>
  );
}

function formatDate(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 0) {
    const mins = Math.ceil(-diffMs / 60_000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.ceil(mins / 60);
    if (hours < 24) return `in ${hours}h`;
    return d.toLocaleDateString();
  }

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}
