/**
 * Grouped controls: several related settings rendered as one compact widget instead of a stack of
 * full width rows.
 */

import type { SettingDescriptor, SettingValue } from "../lib/settings";
import type { Translator } from "../i18n";
import { Switch } from "./primitives";

function selectOptions(descriptor: SettingDescriptor): Array<{ value: string; label: string }> {
  const setting = descriptor.setting;
  if (setting.kind !== "select" && setting.kind !== "optionalSelect") return [];
  return setting.select.options;
}

function selectValue(descriptor: SettingDescriptor): string | null {
  const setting = descriptor.setting;
  if (setting.kind !== "select" && setting.kind !== "optionalSelect") return null;
  return setting.select.value;
}

/* ---------------------------------------------------------- button grid --- */

const PRESS_KINDS = [
  { id: "single", labelKey: "press-single" },
  { id: "double", labelKey: "press-double" },
  { id: "triple", labelKey: "press-triple" },
  { id: "long", labelKey: "press-long" },
] as const;

/**
 * Touch controls as a left/right matrix. Each cell is an optional select: "—" disables the gesture,
 * which on this device means writing action 0xf.
 */
export function ButtonGrid({
  descriptors,
  labels,
  disabled,
  t,
  onChange,
}: {
  descriptors: SettingDescriptor[];
  labels: Record<string, string>;
  disabled: boolean;
  t: Translator;
  onChange: (id: string, value: SettingValue) => void;
}) {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  return (
    <div className="button-grid" role="group" aria-label={t("button-configuration")}>
      <div className="button-grid-row">
        <span />
        <span className="button-grid-head">{t("left")}</span>
        <span className="button-grid-head">{t("right")}</span>
      </div>
      {PRESS_KINDS.map((kind) => {
        const left = byId.get(`left${capitalize(kind.id)}Press`);
        const right = byId.get(`right${capitalize(kind.id)}Press`);
        if (!left || !right) return null;
        const options = selectOptions(left);
        return (
          <div className="button-grid-row" key={kind.id}>
            <span className="button-grid-label">{t(kind.labelKey)}</span>
            <ActionSelect
              descriptor={left}
              options={options}
              disabled={disabled}
              label={labels[left.id] ?? left.id}
              onChange={onChange}
            />
            <ActionSelect
              descriptor={right}
              options={options}
              disabled={disabled}
              label={labels[right.id] ?? right.id}
              onChange={onChange}
            />
          </div>
        );
      })}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ActionSelect({
  descriptor,
  options,
  disabled,
  label,
  onChange,
}: {
  descriptor: SettingDescriptor;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  label: string;
  onChange: (id: string, value: SettingValue) => void;
}) {
  const value = selectValue(descriptor);
  const current = options.find((option) => option.value === value);
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) =>
        onChange(descriptor.id, {
          type: "string",
          value: event.target.value === "" ? null : event.target.value,
        })
      }
    >
      <option value="">{current ? current.label : "—"}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------- info grid --- */

/** Device information as a compact definition list instead of one row per fact. */
export function InfoGrid({
  descriptors,
  labels,
}: {
  descriptors: SettingDescriptor[];
  labels: Record<string, string>;
}) {
  const items = descriptors.filter((descriptor) => descriptor.setting.kind === "information");
  return (
    <dl className="info-grid stagger">
      {items.map((descriptor, index) => (
        <div
          className="info-item"
          key={descriptor.id}
          style={{ ["--i" as string]: index }}
        >
          <dt>{labels[descriptor.id] ?? descriptor.id}</dt>
          <dd>
            {descriptor.setting.kind === "information" && descriptor.setting.value
              ? descriptor.setting.value
              : "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------- switch cards --- */

/** A row of labelled switches, used for the ambient sound mode cycle toggles. */
export function SwitchCardList({
  descriptors,
  labels,
  disabled,
  onChange,
}: {
  descriptors: SettingDescriptor[];
  labels: Record<string, string>;
  disabled: boolean;
  onChange: (id: string, value: SettingValue) => void;
}) {
  return (
    <div className="multi-select">
      {descriptors.map((descriptor) => {
        if (descriptor.setting.kind !== "toggle") return null;
        const checked = descriptor.setting.value;
        return (
          <label
            key={descriptor.id}
            className={`checkbox-card${checked ? " checkbox-card-checked" : ""}`}
          >
            <Switch
              checked={checked}
              disabled={disabled}
              label={labels[descriptor.id] ?? descriptor.id}
              onChange={(next) => onChange(descriptor.id, { type: "bool", value: next })}
            />
            <span className="name">{labels[descriptor.id] ?? descriptor.id}</span>
          </label>
        );
      })}
    </div>
  );
}
