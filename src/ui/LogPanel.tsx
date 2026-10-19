import { useEffect, useMemo, useState } from "react";

import type { LogEntry, LogLevel } from "../session/session";
import { useApp } from "./context";

const FILTERS: Array<{ id: LogLevel | "all"; labelKey: string }> = [
  { id: "all", labelKey: "log-filter-all" },
  { id: "tx", labelKey: "log-filter-tx" },
  { id: "rx", labelKey: "log-filter-rx" },
  { id: "warn", labelKey: "log-filter-warn" },
  { id: "error", labelKey: "log-filter-error" },
];

/** Bottom drawer with the raw packet traffic, for debugging real devices. */
export function LogDrawer({
  logs,
  onClear,
  onClose,
}: {
  logs: LogEntry[];
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const [filter, setFilter] = useState<LogLevel | "all">("all");

  const visible = useMemo(
    () =>
      filter === "all"
        ? logs
        : logs.filter((entry) =>
            filter === "warn" ? entry.level === "warn" || entry.level === "error" : entry.level === filter,
          ),
    [logs, filter],
  );

  useEffect(() => {
    const node = document.getElementById("log-end");
    // scrollIntoView is missing in some environments (jsdom); the log stays usable regardless.
    node?.scrollIntoView?.({ block: "end" });
  }, [visible.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="log-panel" role="dialog" aria-label={t("log-title")}>
      <div className="log-head">
        <h2>{t("log-title")}</h2>
        <div className="log-filters">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="chip"
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          {t("clear-log")}
        </button>
        <button type="button" className="btn btn-icon" aria-label={t("close")} onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden focusable="false">
            <path d="M6 6 18 18M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="log-entries">
        {visible.length === 0 ? <p className="hint">—</p> : null}
        {visible.map((entry) => (
          <div key={entry.id} className={`log-entry log-${entry.level}`}>
            <time>{new Date(entry.time).toLocaleTimeString()}</time>
            <span className="log-level">{entry.level}</span>
            <span className="log-message">{entry.message}</span>
            {entry.detail ? <code className="log-detail">{entry.detail}</code> : null}
          </div>
        ))}
        <div id="log-end" />
      </div>
    </div>
  );
}
