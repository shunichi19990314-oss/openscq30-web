/**
 * Packet commands used by the Soundcore P30i (A3959).
 *
 * Ported from openscq30-lib `common/packet/outbound/`, `common/packet/inbound/` and the a3959
 * module.
 */

import { concatBytes } from "../../lib/bytes";
import { createPacket, type Command, type Packet } from "../../lib/packet";
import {
  macAddressToBytes,
  type AutoPowerOff,
} from "../../lib/structures/common";
import {
  A3959_EQUALIZER_CONFIG,
  applyDrc,
  equalizerConfigurationBytes,
  optionalVolumeAdjustmentsBytes,
  type EqualizerConfig,
  type EqualizerConfiguration,
} from "../../lib/structures/equalizer";
import type { AmbientSoundModeCycle } from "../../lib/structures/common";
import { ambientSoundModeCycleByte } from "../../lib/structures/common";
import type { A3959SoundModes } from "./soundModes";
import { a3959SoundModesBytes } from "./soundModes";

/** Outbound commands. */
export const REQUEST_STATE: Command = [0x01, 0x01];
export const SET_SOUND_MODES: Command = [0x06, 0x81];
export const SET_EQUALIZER_WITH_DRC: Command = [0x02, 0x83];
export const SET_BUTTON_ACTION: Command = [0x04, 0x81];
export const RESET_BUTTONS_TO_DEFAULT: Command = [0x04, 0x82];
export const SET_BUTTON_ENABLED: Command = [0x04, 0x83];
export const SET_ALL_BUTTONS: Command = [0x04, 0x84];
export const SET_AMBIENT_SOUND_MODE_CYCLE: Command = [0x06, 0x82];
export const SET_AUTO_POWER_OFF: Command = [0x01, 0x86];
export const SET_TOUCH_TONE: Command = [0x01, 0x83];
export const SET_GAMING_MODE: Command = [0x01, 0x87];
export const SET_SURROUND_SOUND: Command = [0x02, 0x86];
export const SET_LOW_BATTERY_PROMPT: Command = [0x10, 0x82];
export const REQUEST_DUAL_CONNECTIONS_DEVICES: Command = [0x0b, 0x01];
export const DUAL_CONNECTIONS_DISCONNECT: Command = [0x0b, 0x81];
export const DUAL_CONNECTIONS_CONNECT: Command = [0x0b, 0x82];
export const DUAL_CONNECTIONS_FORGET: Command = [0x0b, 0x83];
export const SET_DUAL_CONNECTIONS_ENABLED: Command = [0x0b, 0x84];

/** Inbound (device initiated) commands. */
export const STATE_UPDATE: Command = [0x01, 0x01];
export const TWS_STATUS_UPDATE: Command = [0x01, 0x02];
export const BATTERY_LEVEL_UPDATE: Command = [0x01, 0x03];
export const BATTERY_CHARGING_UPDATE: Command = [0x01, 0x04];
export const SERIAL_NUMBER_AND_FIRMWARE_UPDATE: Command = [0x01, 0x05];
export const SOUND_MODES_UPDATE: Command = [0x06, 0x01];
export const GAMING_MODE_UPDATE: Command = [0x01, 0x11];
export const DUAL_CONNECTIONS_DEVICES_UPDATE: Command = [0x0b, 0x01];

export function requestStatePacket(): Packet {
  return createPacket(REQUEST_STATE);
}

export function setSoundModesPacket(soundModes: A3959SoundModes): Packet {
  return createPacket(SET_SOUND_MODES, a3959SoundModesBytes(soundModes));
}

/**
 * `packet::outbound::set_equalizer_with_drc`: the raw configuration followed by the same
 * configuration with DRC applied to each channel.
 */
export function setEqualizerWithDrcPacket(
  configuration: EqualizerConfiguration,
  config: EqualizerConfig = A3959_EQUALIZER_CONFIG,
): Packet {
  const rawBytes = equalizerConfigurationBytes(configuration, config);
  const drcBytes = configuration.channels.map((channel) =>
    optionalVolumeAdjustmentsBytes(
      channel === null ? null : applyDrc(channel, config),
      config,
    ),
  );
  return createPacket(SET_EQUALIZER_WITH_DRC, concatBytes([rawBytes, ...drcBytes]));
}

export function setButtonActionPacket(params: {
  side: "left" | "right";
  buttonId: number;
  actionId: number;
  commandOverride?: Command | null;
}): Packet {
  return createPacket(params.commandOverride ?? SET_BUTTON_ACTION, [
    params.side === "left" ? 0 : 1,
    params.buttonId,
    params.actionId,
  ]);
}

export function setButtonEnabledPacket(params: {
  side: "left" | "right";
  buttonId: number;
  enabled: number;
}): Packet {
  return createPacket(SET_BUTTON_ENABLED, [
    params.side === "left" ? 0 : 1,
    params.buttonId,
    params.enabled,
  ]);
}

export function resetButtonsToDefaultPacket(): Packet {
  return createPacket(RESET_BUTTONS_TO_DEFAULT);
}

export function setAmbientSoundModeCyclePacket(cycle: AmbientSoundModeCycle): Packet {
  return createPacket(SET_AMBIENT_SOUND_MODE_CYCLE, [ambientSoundModeCycleByte(cycle)]);
}

export function setAutoPowerOffPacket(autoPowerOff: AutoPowerOff): Packet {
  return createPacket(SET_AUTO_POWER_OFF, [
    autoPowerOff.isEnabled ? 1 : 0,
    autoPowerOff.durationIndex,
  ]);
}

export function setFlagPacket(command: Command, value: boolean): Packet {
  return createPacket(command, [value ? 1 : 0]);
}

export function requestDualConnectionsDevicesPacket(): Packet {
  return createPacket(REQUEST_DUAL_CONNECTIONS_DEVICES);
}

export function setDualConnectionsEnabledPacket(isEnabled: boolean): Packet {
  return createPacket(SET_DUAL_CONNECTIONS_ENABLED, [isEnabled ? 1 : 0]);
}

export function dualConnectionsForgetPacket(macAddress: string): Packet {
  return createPacket(DUAL_CONNECTIONS_FORGET, macAddressToBytes(macAddress));
}

export function dualConnectionsConnectPacket(macAddress: string): Packet {
  return createPacket(DUAL_CONNECTIONS_CONNECT, macAddressToBytes(macAddress));
}

export function dualConnectionsDisconnectPacket(macAddress: string): Packet {
  return createPacket(DUAL_CONNECTIONS_DISCONNECT, macAddressToBytes(macAddress));
}
