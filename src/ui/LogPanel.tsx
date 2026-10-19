import { useEffect, useRef } from "react";

import type { LogEntry } from "../session/session";
import { useApp } from "./context";

export function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const { t } = useApp();
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // scrollIntoView is missing in some environments (jsdom); keep the log usable anyway.
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [logs.length]);

  return (
    <section className="card log-panel">
      <div className="card-header">
        <h2>{t("log-title")}</h2>
        <button type="button" className="ghost" onClick={onClear}>
          {t("clear-log")}
        </button>
      </div>
      <div className="log-entries">
        {logs.length === 0 ? <p className="hint">—</p> : null}
        {logs.map((entry) => (
          <div key={entry.id} className={`log-entry log-${entry.level}`}>
            <time>{new Date(entry.time).toLocaleTimeString()}</time>
            <span className="log-message">{entry.message}</span>
            {entry.detail ? <code className="log-detail">{entry.detail}</code> : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
