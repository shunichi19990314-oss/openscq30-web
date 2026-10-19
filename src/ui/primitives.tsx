/** Small animated building blocks shared by the screens. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* --------------------------------------------------------------- segmented --- */

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export function Segmented({
  options,
  value,
  disabled,
  compact,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption[];
  value: string | null;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className={`segmented${compact ? " segmented-compact" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- switch --- */

export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/* ------------------------------------------------------------- collapsible --- */

/**
 * Animated collapsible. The body always stays in the DOM (only its height is animated) so the
 * content remains accessible, searchable and testable while collapsed.
 */
export function Collapsible({
  open,
  onToggle,
  title,
  subtitle,
  icon,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`card category${className ? ` ${className}` : ""}`}
      data-open={open ? "true" : "false"}
    >
      <button type="button" className="category-toggle" aria-expanded={open} onClick={onToggle}>
        {icon ? <span className="category-icon">{icon}</span> : null}
        <span className="category-title">
          <span>{title}</span>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        <ChevronDown />
      </button>
      <div className="category-body">
        <div>
          <div className="category-inner">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ChevronDown() {
  return (
    <svg
      className="category-chevron"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/* -------------------------------------------------------------- battery --- */

export function BatteryRing({
  level,
  maxLevel,
  isCharging,
  side,
}: {
  level: number;
  maxLevel: number;
  isCharging: boolean;
  side: string;
}) {
  const present = level !== 255;
  const ratio = present ? Math.max(0, Math.min(1, level / maxLevel)) : 0;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - ratio);
  const tone = !present
    ? ""
    : ratio <= 0.15
      ? " value-critical"
      : ratio <= 0.3
        ? " value-low"
        : "";
  return (
    <div className="battery" title={`${side}: ${present ? `${level * 10}%` : "—"}${isCharging ? " ⚡" : ""}`}>
      <div className="battery-ring">
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden focusable="false">
          <circle className="track" cx="17" cy="17" r={radius} />
          <circle
            className={`value${tone}`}
            cx="17"
            cy="17"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={present ? offset : circumference}
            opacity={present ? 1 : 0.25}
          />
        </svg>
        <span className="label">{present ? level * 10 : "—"}</span>
      </div>
      <span className="battery-side">
        {side}
        {isCharging && present ? " ⚡" : ""}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- toasts --- */

export interface ToastItem {
  id: number;
  message: string;
  tone: "error" | "ok" | "info";
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span className="toast-message">{toast.message}</span>
          <button type="button" className="btn btn-icon" aria-label="close" onClick={() => onDismiss(toast.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden focusable="false">
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ToastApi {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
  push: (message: string, tone?: ToastItem["tone"]) => void;
}

/**
 * Toasts for transient feedback. `error` (from the session snapshot) is shown automatically and
 * dismisses itself; `push` is available for one-off confirmations.
 */
export function useToasts(error: string | null): ToastApi {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [seen, setSeen] = useState<string | null>(null);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastItem["tone"] = "info") => {
      const id = ++counter.current;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3200);
    },
    [dismiss],
  );

  useEffect(() => {
    if (!error || error === seen) return;
    setSeen(error);
    push(error, "error");
  }, [error, seen, push]);

  useEffect(() => {
    if (error === null) setSeen(null);
  }, [error]);

  return { toasts, dismiss, push };
}
