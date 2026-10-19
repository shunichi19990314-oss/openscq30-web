/**
 * Generic setting controls. They render whatever the device controller reports, so adding another
 * device model later only means adding a controller.
 *
 * A few well known settings get a richer control (segmented mode picker, draggable equalizer); the
 * rest fall back to the compact row renderers below.
 */

import { useEffect, useState } from "react";

import type { SettingDescriptor, SettingValue } from "../lib/settings";
import type { Translator } from "../i18n";
import { Switch } from "./primitives";
import { Segmented, type SegmentedOption } from "./primitives";
import { EqualizerControl } from "./Equalizer";
import {
  NoiseCancelingIcon,
  NormalModeIcon,
  TransparencyIcon,
} from "./icons";

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

/* --------------------------------------------------------------- renderers --- */

function Information({ descriptor, label }: ControlProps) {
  if (descriptor.setting.kind !== "information") return null;
  return (
    <SettingRow label={label}>
      <span className="information-value">{descriptor.setting.value || "—"}</span>
    </SettingRow>
  );
}

function Toggle({ descriptor, label, disabled, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "toggle") return null;
  return (
    <SettingRow label={label}>
      <Switch
        checked={descriptor.setting.value}
        disabled={disabled}
        label={label}
        onChange={(value) => onChange({ type: "bool", value })}
      />
    </SettingRow>
  );
}

/** Segmented picker used for the mode style settings. */
function SegmentedRow({
  descriptor,
  label,
  disabled,
  icons,
  onChange,
}: ControlProps & { icons?: Record<string, React.ReactNode> }) {
  const setting = descriptor.setting;
  if (setting.kind !== "select" && setting.kind !== "optionalSelect") return null;
  const options: SegmentedOption[] = setting.select.options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(icons?.[option.value] ? { icon: icons[option.value] } : {}),
  }));
  return (
    <SettingRow label={label}>
      <Segmented
        options={options}
        value={setting.select.value}
        disabled={disabled}
        compact={!icons}
        ariaLabel={label}
        onChange={(value) => onChange({ type: "string", value })}
      />
    </SettingRow>
  );
}

function Select({ descriptor, label, disabled, t, onChange }: ControlProps) {
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
        aria-label={label}
        value={currentValue ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange({ type: "string", value: event.target.value === "" ? null : event.target.value })
        }
      >
        {/* For an optional select, "none" is a real choice (a disabled button). Otherwise the
            placeholder only stands in for a value that is not in the list. */}
        {optional ? <option value="">—</option> : null}
        {!optional && !hasListedOption ? (
          <option value="" disabled>
            {currentValue ? t(currentValue) : t("custom")}
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

function Range({ descriptor, label, disabled, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "range") return null;
  const { min, max, step, value } = descriptor.setting;
  // Devices can report values outside the documented range (the adaptive sensitivity level has
  // been seen as 255): clamp the slider but keep showing the real number.
  const clamped = Math.min(max, Math.max(min, value));
  const fill = ((clamped - min) / (max - min)) * 100;
  return (
    <SettingRow label={label} hint={clamped === value ? undefined : `${min}–${max}`}>
      <div className="range-control">
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={clamped}
          disabled={disabled}
          style={{ ["--fill" as string]: `${fill}%` }}
          onChange={(event) => onChange({ type: "number", value: Number(event.target.value) })}
        />
        <output>{value}</output>
      </div>
    </SettingRow>
  );
}

function Action({ descriptor, label, disabled, t, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "action") return null;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);
  return (
    <SettingRow label={label}>
      {confirming ? (
        <span className="row-actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={disabled}
            onClick={() => {
              setConfirming(false);
              onChange({ type: "action" });
            }}
          >
            {t("confirm")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </button>
        </span>
      ) : (
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setConfirming(true)}>
          {t("reset-buttons-to-default")}
        </button>
      )}
    </SettingRow>
  );
}

function ModifiableSelect({ descriptor, label, disabled, t, onChange }: ControlProps) {
  const setting = descriptor.setting;
  if (setting.kind !== "modifiableSelect") return null;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  return (
    <SettingRow label={label}>
      <div className="modifiable-select">
        <select
          aria-label={label}
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
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => {
              setAdding((value) => !value);
              setName("");
            }}
          >
            {t("add-profile")}
          </button>
          {setting.select.value ? (
            <button
              type="button"
              className="btn btn-ghost btn-danger-text"
              disabled={disabled}
              onClick={() => onChange({ type: "remove", name: setting.select.value as string })}
            >
              {t("delete")}
            </button>
          ) : null}
        </div>
        {adding ? (
          <div className="inline-form">
            <input
              className="input"
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
              className="btn"
              disabled={!name.trim() || disabled}
              onClick={() => {
                onChange({ type: "add", name: name.trim() });
                setAdding(false);
              }}
            >
              {t("save")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              {t("cancel")}
            </button>
          </div>
        ) : null}
      </div>
    </SettingRow>
  );
}

function MultiSelect({ descriptor, label, disabled, t, onChange }: ControlProps) {
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
    <SettingRow label={label} hint={removable ? t("dual-connections-limit") : undefined}>
      <div className="multi-select">
        {setting.select.options.length === 0 ? <p className="hint">{t("none")}</p> : null}
        {setting.select.options.map((option) => {
          const checked = selected.has(option.value);
          return (
            <label
              key={option.value}
              className={`checkbox-card${checked ? " checkbox-card-checked" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(option.value)}
              />
              <span className="name">{option.label}</span>
              <code>{option.value}</code>
              {removable ? (
                <button
                  type="button"
                  className="btn btn-icon"
                  aria-label={t("delete")}
                  disabled={disabled}
                  onClick={(event) => {
                    event.preventDefault();
                    onChange({ type: "remove", name: option.value });
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden focusable="false">
                    <path d="M6 6 18 18M18 6 6 18" />
                  </svg>
                </button>
              ) : null}
            </label>
          );
        })}
      </div>
    </SettingRow>
  );
}

/** Local, synchronous validation so a failure does not silently discard the pasted JSON. */
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

function ImportString({ descriptor, label, disabled, t, onChange }: ControlProps) {
  if (descriptor.setting.kind !== "importString") return null;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingRow label={label} hint={descriptor.setting.confirmationMessage}>
      <div className="import-string">
        <textarea
          rows={3}
          aria-label={label}
          value={text}
          placeholder='[{"name":"My EQ","volumeAdjustments":[0,0,0,0,0,0,0,0]}]'
          onChange={(event) => setText(event.target.value)}
        />
        <div className="row-actions">
          <button
            type="button"
            className="btn"
            disabled={disabled || text.trim().length === 0}
            onClick={() => {
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

function ExportOutput({ descriptor, label, t }: ControlProps) {
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
          className="btn btn-ghost"
          disabled={!value}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              // The clipboard may be unavailable; the textarea is selectable anyway.
            }
          }}
        >
          {copied ? t("copied") : t("copy-to-clipboard")}
        </button>
      </div>
    </SettingRow>
  );
}

/* --------------------------------------------------------------- dispatch --- */

const AMBIENT_MODE_ICONS: Record<string, React.ReactNode> = {
  noiseCanceling: <NoiseCancelingIcon />,
  transparency: <TransparencyIcon />,
  normal: <NormalModeIcon />,
};

/** Compact labels so the segmented control never wraps to two lines. */
const AMBIENT_MODE_SHORT_KEYS: Record<string, string> = {
  noiseCanceling: "ambient-short-noiseCanceling",
  transparency: "ambient-short-transparency",
  normal: "ambient-short-normal",
};

export function SettingControl(props: ControlProps): React.ReactElement | null {
  const { descriptor } = props;
  const kind = descriptor.setting.kind;

  switch (descriptor.id) {
    case "ambientSoundMode": {
      const setting = descriptor.setting;
      const shortened =
        setting.kind === "select" || setting.kind === "optionalSelect"
          ? {
              ...descriptor,
              setting: {
                ...setting,
                select: {
                  ...setting.select,
                  options: setting.select.options.map((option) => ({
                    ...option,
                    label:
                      AMBIENT_MODE_SHORT_KEYS[option.value] ?
                        props.t(AMBIENT_MODE_SHORT_KEYS[option.value]) :
                        option.label,
                  })),
                },
              },
            }
          : descriptor;
      return <SegmentedRow {...props} descriptor={shortened} icons={AMBIENT_MODE_ICONS} />;
    }
    case "noiseCancelingMode":
    case "multiSceneNoiseCanceling":
      return <SegmentedRow {...props} />;
    default:
      break;
  }

  switch (kind) {
    case "information":
      return descriptor.id === "exportCustomEqualizerProfilesOutput" ? (
        <ExportOutput {...props} />
      ) : (
        <Information {...props} />
      );
    case "toggle":
      return <Toggle {...props} />;
    case "select":
    case "optionalSelect":
      return <Select {...props} />;
    case "modifiableSelect":
      return <ModifiableSelect {...props} />;
    case "range":
      return <Range {...props} />;
    case "multiSelect":
    case "multiSelectWithRemove":
      return <MultiSelect {...props} />;
    case "importString":
      return <ImportString {...props} />;
    case "action":
      return <Action {...props} />;
    case "equalizer":
      return (
        <EqualizerControl
          setting={descriptor.setting}
          label={props.label}
          disabled={props.disabled}
          t={props.t}
          onChange={(values) => props.onChange({ type: "numbers", value: values })}
        />
      );
    default:
      return null;
  }
}
