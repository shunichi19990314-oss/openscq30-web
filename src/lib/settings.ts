/**
 * Settings model exposed to the UI.
 *
 * Mirrors the `Setting` / `Value` enums of openscq30-lib (`lib/src/api/settings.rs`) so the UI can
 * render any device generically.
 */

export type CategoryId =
  | "soundModes"
  | "equalizer"
  | "equalizerImportExport"
  | "buttonConfiguration"
  | "dualConnections"
  | "miscellaneous"
  | "deviceInformation";

export const CATEGORY_ORDER: CategoryId[] = [
  "soundModes",
  "equalizer",
  "equalizerImportExport",
  "buttonConfiguration",
  "dualConnections",
  "miscellaneous",
  "deviceInformation",
];

export interface SelectOption {
  /** Stable value sent back when the user picks this option. */
  value: string;
  /** Localized label. */
  label: string;
}

export interface SelectSetting {
  options: SelectOption[];
  value: string | null;
}

export type Setting =
  | { kind: "information"; value: string }
  | { kind: "toggle"; value: boolean }
  | { kind: "select"; select: SelectSetting }
  /** A select where "none" is a valid choice (used for disablable buttons). */
  | { kind: "optionalSelect"; select: SelectSetting }
  /** A select whose options the user can add to and remove from (custom equalizer profiles). */
  | { kind: "modifiableSelect"; select: SelectSetting }
  | {
      kind: "range";
      min: number;
      max: number;
      step: number;
      value: number;
      /** Optional unit suffix shown next to the value, e.g. "dB". */
      unit?: string;
    }
  | {
      kind: "equalizer";
      bandHz: number[];
      min: number;
      max: number;
      fractionDigits: number;
      value: number[];
      readOnly: boolean;
    }
  | { kind: "multiSelect"; select: SelectSetting; values: string[] }
  | { kind: "multiSelectWithRemove"; select: SelectSetting; values: string[] }
  | { kind: "importString"; confirmationMessage?: string }
  /** A button that triggers an action rather than holding a value. */
  | { kind: "action" };

/** A value coming back from the UI. */
export type SettingValue =
  | { type: "bool"; value: boolean }
  | { type: "string"; value: string | null }
  | { type: "number"; value: number }
  | { type: "numbers"; value: number[] }
  | { type: "strings"; value: string[] }
  | { type: "action" }
  | { type: "add"; name: string }
  | { type: "remove"; name: string };

export interface SettingDescriptor {
  id: string;
  category: CategoryId;
  setting: Setting;
}

export class SettingError extends Error {
  constructor(
    message: string,
    readonly kind: "readOnly" | "invalidValue" | "missingData" | "device" = "invalidValue",
  ) {
    super(message);
    this.name = "SettingError";
  }
}

export function asBool(value: SettingValue): boolean {
  if (value.type !== "bool") throw new SettingError(`expected bool, got ${value.type}`);
  return value.value;
}

export function asOptionalString(value: SettingValue): string | null {
  if (value.type !== "string") throw new SettingError(`expected string, got ${value.type}`);
  return value.value;
}

export function asString(value: SettingValue): string {
  const result = asOptionalString(value);
  if (result === null) throw new SettingError("expected a string, got null");
  return result;
}

export function asNumber(value: SettingValue): number {
  if (value.type !== "number") throw new SettingError(`expected number, got ${value.type}`);
  return value.value;
}

export function asNumbers(value: SettingValue): number[] {
  if (value.type !== "numbers") throw new SettingError(`expected numbers, got ${value.type}`);
  return value.value;
}

export function asStrings(value: SettingValue): string[] {
  if (value.type !== "strings") throw new SettingError(`expected strings, got ${value.type}`);
  return value.value;
}
