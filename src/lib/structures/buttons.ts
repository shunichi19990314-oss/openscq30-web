/**
 * Button (touch control) configuration structures.
 *
 * Ported from openscq30-lib `lib/src/devices/soundcore/common/structures/button_configuration.rs`
 * and `modules/button_configuration.rs`.
 */

import { ByteReader, concatBytes } from "../bytes";
import type { Command } from "../packet";
import type { TwsStatus } from "./common";

export type ButtonSide = "left" | "right";

export type ButtonPressKind = "single" | "double" | "triple" | "long" | "slideUp" | "slideDown";

/** Setting ids for individual buttons, matching openscq30-lib's `Button` enum. */
export type Button =
  | "leftSinglePress"
  | "rightSinglePress"
  | "leftDoublePress"
  | "rightDoublePress"
  | "leftTriplePress"
  | "rightTriplePress"
  | "leftLongPress"
  | "rightLongPress"
  | "leftSlideUp"
  | "rightSlideUp"
  | "leftSlideDown"
  | "rightSlideDown";

export function buttonPressKind(button: Button): ButtonPressKind {
  if (button.includes("SinglePress")) return "single";
  if (button.includes("DoublePress")) return "double";
  if (button.includes("TriplePress")) return "triple";
  if (button.includes("LongPress")) return "long";
  if (button.includes("SlideUp")) return "slideUp";
  return "slideDown";
}

export function buttonSide(button: Button): ButtonSide {
  return button.startsWith("left") ? "left" : "right";
}

export type EnabledFlagKind = "none" | "single" | "twsLowBits";
export type ActionKind = "single" | "twsLowBits";

export interface ButtonParseSettings {
  enabledFlagKind: EnabledFlagKind;
  actionKind: ActionKind;
}

export type EnabledStatus =
  | null
  | { kind: "single"; value: boolean }
  | { kind: "tws"; connected: boolean; disconnected: boolean };

export type ActionStatus =
  | { kind: "single"; value: number }
  | { kind: "tws"; connected: number; disconnected: number };

export interface ButtonStatus {
  enabled: EnabledStatus;
  action: ActionStatus;
}

export type ButtonStatusCollection = ButtonStatus[];

export function parseButtonStatus(
  reader: ByteReader,
  parseSettings: ButtonParseSettings,
): ButtonStatus {
  const enabled = parseEnabledStatus(reader, parseSettings.enabledFlagKind);
  const action = parseActionStatus(reader, parseSettings.actionKind);
  return { enabled, action };
}

function parseEnabledStatus(reader: ByteReader, kind: EnabledFlagKind): EnabledStatus {
  switch (kind) {
    case "none":
      return null;
    case "single":
      return { kind: "single", value: reader.bool() };
    case "twsLowBits": {
      const byte = reader.u8();
      return {
        kind: "tws",
        connected: (byte & 0xf) === 1,
        disconnected: byte >> 4 === 1,
      };
    }
  }
}

function parseActionStatus(reader: ByteReader, kind: ActionKind): ActionStatus {
  if (kind === "single") {
    return { kind: "single", value: reader.u8() };
  }
  const byte = reader.u8();
  return { kind: "tws", connected: byte & 0xf, disconnected: byte >> 4 };
}

export function buttonStatusBytes(
  status: ButtonStatus,
  parseSettings: ButtonParseSettings,
): Uint8Array {
  const chunks: number[] = [];
  if (status.enabled) {
    chunks.push(enabledStatusByte(status.enabled, parseSettings.enabledFlagKind));
  }
  chunks.push(actionStatusByte(status.action, parseSettings.actionKind));
  return Uint8Array.from(chunks);
}

export function enabledStatusByte(status: NonNullable<EnabledStatus>, kind: EnabledFlagKind): number {
  switch (status.kind) {
    case "single":
      return status.value ? 1 : 0;
    case "tws":
      if (kind !== "twsLowBits") {
        throw new Error(`cannot serialize tws enabled flag with kind ${kind}`);
      }
      return ((status.disconnected ? 1 : 0) << 4) | (status.connected ? 1 : 0);
  }
}

export function actionStatusByte(status: ActionStatus, kind: ActionKind): number {
  switch (status.kind) {
    case "single":
      if (kind !== "single") throw new Error("cannot serialize single action as tws");
      return status.value;
    case "tws":
      if (kind !== "twsLowBits") throw new Error("cannot serialize tws action as single");
      return ((status.disconnected & 0xf) << 4) | (status.connected & 0xf);
  }
}

export function enabledStatusCurrent(status: NonNullable<EnabledStatus>, tws: TwsStatus): boolean {
  if (status.kind === "single") return status.value;
  return tws.isConnected ? status.connected : status.disconnected;
}

export function actionStatusCurrent(status: ActionStatus, tws: TwsStatus): number {
  if (status.kind === "single") return status.value;
  return tws.isConnected ? status.connected : status.disconnected;
}

function withCurrentEnabled(
  status: NonNullable<EnabledStatus>,
  tws: TwsStatus,
  isEnabled: boolean,
): NonNullable<EnabledStatus> {
  if (status.kind === "single") return { kind: "single", value: isEnabled };
  return tws.isConnected
    ? { kind: "tws", connected: isEnabled, disconnected: status.disconnected }
    : { kind: "tws", connected: status.connected, disconnected: isEnabled };
}

function withCurrentActionId(
  status: ActionStatus,
  tws: TwsStatus,
  actionId: number,
): ActionStatus {
  if (status.kind === "single") return { kind: "single", value: actionId };
  return tws.isConnected
    ? { kind: "tws", connected: actionId, disconnected: status.disconnected }
    : { kind: "tws", connected: status.connected, disconnected: actionId };
}

/** 0xf means "no action", which is how these devices represent a disabled button. */
export const DISABLED_ACTION_ID = 0xf;

export function isButtonEnabled(status: ButtonStatus, tws: TwsStatus): boolean {
  if (status.enabled === null) {
    return actionStatusCurrent(status.action, tws) !== DISABLED_ACTION_ID;
  }
  return enabledStatusCurrent(status.enabled, tws);
}

export function currentActionId(status: ButtonStatus, tws: TwsStatus): number | null {
  return isButtonEnabled(status, tws) ? actionStatusCurrent(status.action, tws) : null;
}

export function currentActionIdIgnoringEnabled(status: ButtonStatus, tws: TwsStatus): number {
  return actionStatusCurrent(status.action, tws);
}

export function withButtonAction(
  status: ButtonStatus,
  tws: TwsStatus,
  actionId: number | null,
): ButtonStatus {
  if (actionId !== null) {
    return {
      enabled:
        status.enabled === null ? null : withCurrentEnabled(status.enabled, tws, true),
      action: withCurrentActionId(status.action, tws, actionId),
    };
  }
  return {
    enabled: status.enabled === null ? null : withCurrentEnabled(status.enabled, tws, false),
    action:
      status.enabled === null
        ? withCurrentActionId(status.action, tws, DISABLED_ACTION_ID)
        : status.action,
  };
}

export function enabledStatusEqual(a: EnabledStatus, b: EnabledStatus): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "single" && b.kind === "single") return a.value === b.value;
  if (a.kind === "tws" && b.kind === "tws") {
    return a.connected === b.connected && a.disconnected === b.disconnected;
  }
  return false;
}

export function actionStatusEqual(a: ActionStatus, b: ActionStatus): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "single" && b.kind === "single") return a.value === b.value;
  if (a.kind === "tws" && b.kind === "tws") {
    return a.connected === b.connected && a.disconnected === b.disconnected;
  }
  return false;
}

export function buttonStatusEqual(a: ButtonStatus, b: ButtonStatus): boolean {
  return enabledStatusEqual(a.enabled, b.enabled) && actionStatusEqual(a.action, b.action);
}

export function buttonStatusCollectionEqual(
  a: ButtonStatusCollection,
  b: ButtonStatusCollection,
): boolean {
  return a.length === b.length && a.every((status, index) => buttonStatusEqual(status, b[index]));
}

/* ------------------------------------------------------ button settings --- */

export interface ButtonAction {
  id: number;
  name: string;
}

/** Everything except gaming mode (openscq30-lib's `COMMON_ACTIONS`). */
export const COMMON_ACTIONS: ButtonAction[] = [
  { id: 0, name: "VolumeUp" },
  { id: 1, name: "VolumeDown" },
  { id: 2, name: "PreviousSong" },
  { id: 3, name: "NextSong" },
  { id: 4, name: "AmbientSoundMode" },
  { id: 5, name: "VoiceAssistant" },
  { id: 6, name: "PlayPause" },
];

export type ButtonDisableMode =
  | "notDisablable"
  | "disablingOneSideDisablesOther"
  | "individualDisable";

export interface ButtonSettings {
  buttonId: number;
  pressKind: ButtonPressKind;
  parseSettings: ButtonParseSettings;
  availableActions: ButtonAction[];
  disableMode: ButtonDisableMode;
}

export interface ButtonConfigurationSettings {
  supportsSetAllPacket: boolean;
  /**
   * Some devices have an enabled flag in their state packet but disable buttons by setting the
   * action to 0xf instead. When true, the enabled flag is ignored.
   */
  ignoreEnabledFlag: boolean;
  setButtonActionCommandOverride: Command | null;
  /** Parse order in the state update packet. */
  order: Button[];
  settings: ButtonSettings[];
}

export function buttonSettingsFor(
  config: ButtonConfigurationSettings,
  button: Button,
): ButtonSettings {
  const pressKind = buttonPressKind(button);
  const settings = config.settings.find((entry) => entry.pressKind === pressKind);
  if (!settings) {
    throw new Error(`no button settings for press kind ${pressKind}`);
  }
  return settings;
}

export function buttonPosition(config: ButtonConfigurationSettings, button: Button): number {
  const position = config.order.indexOf(button);
  if (position < 0) throw new Error(`button ${button} is not part of this device`);
  return position;
}

export function buttonParseSettings(config: ButtonConfigurationSettings): ButtonParseSettings[] {
  return config.order.map((button) => buttonSettingsFor(config, button).parseSettings);
}

export function defaultButtonStatusCollection(
  config: ButtonConfigurationSettings,
): ButtonStatusCollection {
  return config.order.map((button) => {
    const settings = buttonSettingsFor(config, button);
    const enabled: EnabledStatus =
      settings.parseSettings.enabledFlagKind === "none"
        ? null
        : settings.parseSettings.enabledFlagKind === "single"
          ? { kind: "single", value: true }
          : { kind: "tws", connected: true, disconnected: true };
    const defaultActionId = settings.availableActions[0].id;
    const action: ActionStatus =
      settings.parseSettings.actionKind === "single"
        ? { kind: "single", value: defaultActionId }
        : { kind: "tws", connected: defaultActionId, disconnected: defaultActionId };
    return { enabled, action };
  });
}

export function parseButtonStatusCollection(
  reader: ByteReader,
  config: ButtonConfigurationSettings,
): ButtonStatusCollection {
  return config.order.map((button) =>
    parseButtonStatus(reader, buttonSettingsFor(config, button).parseSettings),
  );
}

export function buttonStatusCollectionBytes(
  statuses: ButtonStatusCollection,
  config: ButtonConfigurationSettings,
): Uint8Array {
  const parseSettings = buttonParseSettings(config);
  return concatBytes(
    statuses.map((status, index) => buttonStatusBytes(status, parseSettings[index])),
  );
}
