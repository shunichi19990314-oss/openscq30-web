/**
 * Generic setting controls. They render whatever the device controller reports, so adding another
 * device model later only means adding a controller.
 */

import { useEffect, useMemo, useState } from "react";

import type { SettingDescriptor, SettingValue } from "../lib/settings";
import type { Translator } from "../i18n";

export interface ControlProps {
  descriptor: SettingDescriptor;
  label: string;
  disabled: boolean;
  t: Translator;
  onChange: (value: SettingValue) => void;
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function InformationControl({ descriptor, label }: ControlProps) {
  if (descriptor.setting.kind !== "information") return null;
  return (
    <SettingRow label={label}>
      <span className="information-value">{descriptor.setting.value || "—"}</span>
    </SettingRow>
  );
}

export function ToggleControl({ descriptor, label, disabled, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "toggle") return null;
  const { value } = descriptor.setting;
  return (
    <SettingRow label={label}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`switch${value ? " switch-on" : ""}`}
        disabled={disabled}
        onClick={() => onChange({ type: "bool", value: !value })}
      >
        <span className="switch-knob" />
      </button>
    </SettingRow>
  );
}

export function SelectControl({ descriptor, label, disabled, t, onChange }: ControlProps) {
  const setting = descriptor.setting;
  if (setting.kind !== "select" && setting.kind !== "optionalSelect") return null;
  const optional = setting.kind === "optionalSelect";
  const currentValue = setting.select.value;
  const hasListedOption =
    currentValue !== null &&
    setting.select.options.some((option) => option.value === currentValue);
  return (
    <SettingRow label={label}>
      <select
        value={setting.select.value ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange({ type: "string", value: event.target.value === "" ? null : event.target.value })
        }
      >
        {/* For an optional select, "none" is a real choice (a disabled button). Otherwise the
            placeholder only represents a value that is not in the list, so it is not selectable. */}
        {optional ? <option value="">—</option> : null}
        {!optional && !hasListedOption ? (
          <option value="" disabled>
            {setting.select.value ? t(setting.select.value) : t("custom")}
          </option>
        ) : null}
        {setting.select.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

export function RangeControl({ descriptor, label, disabled, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "range") return null;
  const { min, max, step, value } = descriptor.setting;
  // Devices can report values outside the documented range (the adaptive sensitivity level has
  // been seen as 255). Clamp the slider but keep showing the real value.
  const clamped = Math.min(max, Math.max(min, value));
  return (
    <SettingRow label={label} hint={clamped === value ? undefined : `${min}–${max}`} >
      <div className="range-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          disabled={disabled}
          onChange={(event) => onChange({ type: "number", value: Number(event.target.value) })}
        />
        <output>{value}</output>
      </div>
    </SettingRow>
  );
}

export function ActionControl({ descriptor, label, disabled, t, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "action") return null;
  const [confirming, setConfirming] = useState(false);
  return (
    <SettingRow label={label}>
      {confirming ? (
        <span className="confirm-group">
          <button
            type="button"
            className="danger"
            disabled={disabled}
            onClick={() => {
              setConfirming(false);
              onChange({ type: "action" });
            }}
          >
            {t("reset-buttons-to-default")}
          </button>
          <button type="button" className="ghost" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </button>
        </span>
      ) : (
        <button type="button" className="danger" disabled={disabled} onClick={() => setConfirming(true)}>
          {t("reset-buttons-to-default")}
        </button>
      )}
    </SettingRow>
  );
}

export function ModifiableSelectControl({
  descriptor,
  label,
  disabled,
  t,
  onChange,
}: ControlProps) {
  const setting = descriptor.setting;
  if (setting.kind !== "modifiableSelect") return null;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  return (
    <SettingRow label={label}>
      <div className="modifiable-select">
        <select
          value={setting.select.value ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({ type: "string", value: event.target.value === "" ? null : event.target.value })
          }
        >
          <option value="">—</option>
          {setting.select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ghost"
          disabled={disabled}
          onClick={() => {
            setAdding(true);
            setName("");
          }}
        >
          {t("add-profile")}
        </button>
        {setting.select.value ? (
          <button
            type="button"
            className="ghost danger-text"
            disabled={disabled}
            onClick={() => onChange({ type: "remove", name: setting.select.value! })}
          >
            {t("delete")}
          </button>
        ) : null}
        {adding ? (
          <div className="inline-form">
            <input
              autoFocus
              value={name}
              placeholder={t("profile-name")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) {
                  onChange({ type: "add", name: name.trim() });
                  setAdding(false);
                }
                if (event.key === "Escape") setAdding(false);
              }}
            />
            <button
              type="button"
              disabled={!name.trim() || disabled}
              onClick={() => {
                onChange({ type: "add", name: name.trim() });
                setAdding(false);
              }}
            >
              {t("save")}
            </button>
            <button type="button" className="ghost" onClick={() => setAdding(false)}>
              {t("cancel")}
            </button>
          </div>
        ) : null}
      </div>
    </SettingRow>
  );
}

export function MultiSelectControl({ descriptor, label, disabled, t, onChange }: ControlProps) {
  const setting = descriptor.setting;
  if (setting.kind !== "multiSelect" && setting.kind !== "multiSelectWithRemove") return null;
  const removable = setting.kind === "multiSelectWithRemove";
  const selected = new Set(setting.values);
  const toggle = (value: string): void => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange({ type: "strings", value: [...next] });
  };
  return (
    <SettingRow label={label}>
      <div className="multi-select">
        {removable ? <small className="hint">{t("dual-connections-limit")}</small> : null}
        {setting.select.options.length === 0 ? <em>—</em> : null}
        {setting.select.options.map((option) => (
          <label key={option.value} className="checkbox">
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              disabled={disabled}
              onChange={() => toggle(option.value)}
            />
            <span>{option.label}</span>
            <code>{option.value}</code>
            {removable ? (
              <button
                type="button"
                className="ghost danger-text"
                disabled={disabled}
                onClick={(event) => {
                  event.preventDefault();
                  onChange({ type: "remove", name: option.value });
                }}
              >
                ✕
              </button>
            ) : null}
          </label>
        ))}
      </div>
    </SettingRow>
  );
}

export function ImportStringControl({ descriptor, label, disabled, t, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "importString") return null;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingRow label={label} hint={descriptor.setting.confirmationMessage}>
      <div className="import-string">
        <textarea
          rows={3}
          value={text}
          placeholder='[{"name":"My EQ","volumeAdjustments":[0,0,0,0,0,0,0,0]}]'
          onChange={(event) => setText(event.target.value)}
        />
        <div className="row-actions">
          <button
            type="button"
            disabled={disabled || text.trim().length === 0}
            onClick={() => {
              // Validate before handing the value over: `onChange` is applied asynchronously, so a
              // failure there would not reach this catch block and the input would be lost.
              const problem = validateProfileJson(text);
              if (problem) {
                setError(problem);
                return;
              }
              onChange({ type: "string", value: text });
              setError(null);
              setText("");
            }}
          >
            {t("import-profiles")}
          </button>
          {error ? <span className="error-text">{error}</span> : null}
        </div>
      </div>
    </SettingRow>
  );
}

/** Local, synchronous version of the import validation, so the UI can show the error inline. */
function validateProfileJson(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!Array.isArray(parsed)) return "expected a JSON array of profiles";
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return "each profile must be an object";
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || !Array.isArray(record.volumeAdjustments)) {
      return 'each profile needs a "name" and "volumeAdjustments"';
    }
    if (record.volumeAdjustments.some((value) => typeof value !== "number")) {
      return "volumeAdjustments must be numbers";
    }
  }
  return null;
}

export function ExportOutputControl({ descriptor, label, t }: ControlProps) {
  if (descriptor.setting.kind !== "information") return null;
  const [copied, setCopied] = useState(false);
  const value = descriptor.setting.value;
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <SettingRow label={label}>
      <div className="export-output">
        <textarea rows={3} readOnly value={value} onFocus={(event) => event.target.select()} />
        <button
          type="button"
          className="ghost"
          disabled={!value}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              // clipboard may be unavailable; the textarea is selectable anyway
            }
          }}
        >
          {copied ? t("copied") : t("copy-to-clipboard")}
        </button>
      </div>
    </SettingRow>
  );
}

/** Renders the control that matches a setting descriptor. */
export function SettingControl(props: ControlProps): React.ReactElement | null {
  const kind = props.descriptor.setting.kind;
  switch (kind) {
    case "information":
      return props.descriptor.id === "exportCustomEqualizerProfilesOutput" ? (
        <ExportOutputControl {...props} />
      ) : (
        <InformationControl {...props} />
      );
    case "toggle":
      return <ToggleControl {...props} />;
    case "select":
    case "optionalSelect":
      return <SelectControl {...props} />;
    case "modifiableSelect":
      return <ModifiableSelectControl {...props} />;
    case "range":
      return <RangeControl {...props} />;
    case "multiSelect":
    case "multiSelectWithRemove":
      return <MultiSelectControl {...props} />;
    case "importString":
      return <ImportStringControl {...props} />;
    case "action":
      return <ActionControl {...props} />;
    case "equalizer":
      return <EqualizerControl {...props} />;
    default:
      return null;
  }
}

/* -------------------------------------------------------------- equalizer --- */

/** How long the equalizer keeps showing unconfirmed values before falling back to the device. */
const PENDING_CONFIRM_TIMEOUT_MS = 4000;

interface EqualizerSetting {
  kind: "equalizer";
  bandHz: number[];
  min: number;
  max: number;
  fractionDigits: number;
  value: number[];
  readOnly: boolean;
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function formatDb(raw: number, fractionDigits: number): string {
  const db = raw / Math.pow(10, fractionDigits);
  return `${db > 0 ? "+" : ""}${db.toFixed(fractionDigits)}`;
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}kHz` : `${hz}Hz`;
}

export function EqualizerControl({ descriptor, label, disabled, t, onChange }: ControlProps) {
  const setting = descriptor.setting as EqualizerSetting;
  // `pending` is what was sent to the device but not confirmed yet. Keeping it avoids the sliders
  // snapping back to the old values for the round trip duration.
  const [draft, setDraft] = useState<number[] | null>(null);
  const [pending, setPending] = useState<number[] | null>(null);
  const values = useMemo(() => draft ?? pending ?? setting.value, [draft, pending, setting.value]);

  useEffect(() => {
    if (!pending) return;
    if (arraysEqual(pending, setting.value)) {
      setPending(null);
      return;
    }
    // The write may have failed or the device may not echo the value back; do not keep showing an
    // unconfirmed value forever.
    const timer = setTimeout(() => setPending(null), PENDING_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending, setting.value]);

  const scale = Math.pow(10, setting.fractionDigits);
  const commit = (next: number[]): void => {
    setDraft(null);
    setPending(next);
    onChange({ type: "numbers", value: next });
  };

  if (setting.readOnly) {
    return (
      <SettingRow label={label}>
        <span className="information-value">{values.map((value) => formatDb(value, setting.fractionDigits)).join(" / ")}</span>
      </SettingRow>
    );
  }

  return (
    <div className="equalizer-setting">
      <div className="setting-label">
        <span>{label}</span>
        <small>
          {setting.min / scale} dB 〜 {setting.max / scale} dB
        </small>
      </div>
      <EqualizerCurve
        bandHz={setting.bandHz}
        values={values}
        min={setting.min}
        max={setting.max}
        fractionDigits={setting.fractionDigits}
      />
      <div className="equalizer-bands">
        {setting.bandHz.map((hz, index) => (
          <div className="band" key={hz}>
            <input
              type="range"
              aria-label={`${formatHz(hz)}`}
              min={setting.min}
              max={setting.max}
              step={1}
              value={values[index] ?? 0}
              disabled={disabled}
              onChange={(event) => {
                const next = values.slice();
                next[index] = Number(event.target.value);
                setDraft(next);
              }}
              onPointerUp={() => commit(values)}
              onKeyUp={() => commit(values)}
              onBlur={() => {
                if (draft) commit(values);
              }}
            />
            <output>{formatDb(values[index] ?? 0, setting.fractionDigits)}</output>
            <span className="band-hz">{formatHz(hz)}</span>
          </div>
        ))}
      </div>
      {draft ? (
        <div className="row-actions">
          <button type="button" disabled={disabled} onClick={() => commit(draft)}>
            {t("apply-quick-preset")}
          </button>
          <button type="button" className="ghost" onClick={() => setDraft(null)}>
            {t("cancel")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EqualizerCurve({
  bandHz,
  values,
  min,
  max,
  fractionDigits,
}: {
  bandHz: number[];
  values: number[];
  min: number;
  max: number;
  fractionDigits: number;
}) {
  const width = 320;
  const height = 96;
  const padding = 8;
  const xFor = (index: number): number =>
    padding + (index * (width - padding * 2)) / Math.max(1, bandHz.length - 1);
  const yFor = (value: number): number => {
    const ratio = (value - min) / (max - min);
    return height - padding - ratio * (height - padding * 2);
  };
  const points = bandHz.map((_, index) => `${xFor(index)},${yFor(values[index] ?? 0)}`);
  const zeroY = yFor(0);
  return (
    <svg
      className="equalizer-curve"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`equalizer curve, ${values
        .map((value, index) => `${formatHz(bandHz[index])} ${formatDb(value, fractionDigits)}dB`)
        .join(", ")}`}
    >
      <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} className="curve-zero" />
      <polyline points={points.join(" ")} className="curve-line" />
      {bandHz.map((hz, index) => (
        <circle
          key={hz}
          cx={xFor(index)}
          cy={yFor(values[index] ?? 0)}
          r={3}
          className="curve-point"
        />
      ))}
    </svg>
  );
}
