/**
 * Soundcore P30i (A3959) device state and its state update packet.
 *
 * Ported from openscq30-lib `lib/src/devices/soundcore/a3959/`.
 */

import { ByteReader, concatBytes } from "../../lib/bytes";
import { createPacket, type Packet } from "../../lib/packet";
import {
  ambientSoundModeCycleByte,
  autoPowerOffBytes,
  defaultAutoPowerOff,
  defaultDualBattery,
  defaultDualFirmwareVersion,
  defaultSerialNumber,
  dualBatteryBytes,
  dualFirmwareVersionBytes,
  dualFirmwareVersionMin,
  compareFirmwareVersion,
  parseAmbientSoundModeCycle,
  parseAutoPowerOff,
  parseDualBattery,
  parseDualFirmwareVersion,
  parseSerialNumber,
  parseTwsStatus,
  serialNumberBytes,
  twsStatusBytes,
  type AmbientSoundModeCycle,
  type AutoPowerOff,
  type DualBattery,
  type DualConnections,
  type DualConnectionsDevice,
  type DualFirmwareVersion,
  type TwsStatus,
} from "../../lib/structures/common";
import {
  A3959_EQUALIZER_CONFIG,
  equalizerConfigurationBytes,
  parseEqualizerConfiguration,
  type EqualizerConfiguration,
} from "../../lib/structures/equalizer";
import {
  buttonStatusCollectionBytes,
  defaultButtonStatusCollection,
  parseButtonStatusCollection,
  type ButtonStatusCollection,
} from "../../lib/structures/buttons";
import { A3959_BUTTON_CONFIGURATION } from "./buttons";
import {
  a3959SoundModesBytes,
  defaultA3959SoundModes,
  parseA3959SoundModes,
  type A3959SoundModes,
} from "./soundModes";

/** Gaming mode is only exposed from firmware 01.60 onwards. */
export const GAMING_MODE_MIN_FIRMWARE = { major: 1, minor: 60 };

export interface A3959State {
  twsStatus: TwsStatus;
  dualBattery: DualBattery;
  dualFirmwareVersion: DualFirmwareVersion;
  serialNumber: string;
  equalizerConfiguration: EqualizerConfiguration;
  buttonConfiguration: ButtonStatusCollection;
  ambientSoundModeCycle: AmbientSoundModeCycle;
  soundModes: A3959SoundModes;
  autoPowerOff: AutoPowerOff;
  touchTone: boolean;
  lowBatteryPrompt: boolean;
  surroundSound: boolean;
  /** null when the firmware is too old to support it. */
  gamingMode: boolean | null;
  dualConnections: DualConnections;
  /** Set while a "reset buttons to default" request is in flight. */
  buttonResetPending: boolean;
}

export interface A3959StateUpdatePacket {
  twsStatus: TwsStatus;
  dualBattery: DualBattery;
  dualFirmwareVersion: DualFirmwareVersion;
  serialNumber: string;
  equalizerConfiguration: EqualizerConfiguration;
  buttonConfiguration: ButtonStatusCollection;
  ambientSoundModeCycle: AmbientSoundModeCycle;
  soundModes: A3959SoundModes;
  touchTone: boolean;
  autoPowerOff: AutoPowerOff;
  lowBatteryPrompt: boolean;
  surroundSound: boolean;
  gamingMode: boolean | null;
  dualConnectionsEnabled: boolean;
}

export function defaultA3959StateUpdatePacket(): A3959StateUpdatePacket {
  return {
    twsStatus: { hostDevice: "left", isConnected: true },
    dualBattery: defaultDualBattery(),
    dualFirmwareVersion: defaultDualFirmwareVersion(),
    serialNumber: defaultSerialNumber,
    equalizerConfiguration: {
      presetId: 0,
      channels: [{ values: new Array(A3959_EQUALIZER_CONFIG.bands).fill(0) }],
    },
    buttonConfiguration: defaultButtonStatusCollection(A3959_BUTTON_CONFIGURATION),
    ambientSoundModeCycle: {
      noiseCancelingMode: true,
      transparencyMode: true,
      normalMode: true,
    },
    soundModes: defaultA3959SoundModes(),
    touchTone: false,
    autoPowerOff: defaultAutoPowerOff(),
    lowBatteryPrompt: false,
    surroundSound: false,
    gamingMode: null,
    dualConnectionsEnabled: false,
  };
}

/**
 * Parses the body of a `[0x01, 0x01]` state update packet.
 *
 * Field order and unknown padding come from `A3959StateUpdatePacket::take`.
 */
export function parseA3959StateUpdate(body: Uint8Array): A3959StateUpdatePacket {
  const reader = new ByteReader(body);
  const packet = reader.withContext("a3959 state update packet", () => {
    const twsStatus = parseTwsStatus(reader);
    const dualBattery = parseDualBattery(reader);
    const dualFirmwareVersion = parseDualFirmwareVersion(reader);
    const serialNumber = parseSerialNumber(reader);
    const equalizerConfiguration = parseEqualizerConfiguration(reader, A3959_EQUALIZER_CONFIG);
    reader.take(10); // unknown1
    reader.take(1); // unknown2
    const buttonConfiguration = parseButtonStatusCollection(reader, A3959_BUTTON_CONFIGURATION);
    const ambientSoundModeCycle = parseAmbientSoundModeCycle(reader);
    const soundModes = parseA3959SoundModes(reader);
    reader.take(1); // unknown3
    const touchTone = reader.bool();
    const dualConnectionsEnabled = reader.bool();
    const surroundSound = reader.bool();
    const autoPowerOff = parseAutoPowerOff(reader);
    const lowBatteryPrompt = reader.bool();
    // Requires firmware >= 01.60, but it is parsed unconditionally and checked afterwards.
    const gamingMode = reader.bool();
    reader.take(12); // unknown5

    const minFirmware = dualFirmwareVersionMin(dualFirmwareVersion);
    const supportsGamingMode =
      minFirmware !== null && compareFirmwareVersion(minFirmware, GAMING_MODE_MIN_FIRMWARE) >= 0;

    return {
      twsStatus,
      dualBattery,
      dualFirmwareVersion,
      serialNumber,
      equalizerConfiguration,
      buttonConfiguration,
      ambientSoundModeCycle,
      soundModes,
      touchTone,
      autoPowerOff,
      lowBatteryPrompt,
      surroundSound,
      dualConnectionsEnabled,
      gamingMode: supportsGamingMode ? gamingMode : null,
    } satisfies A3959StateUpdatePacket;
  });
  reader.assertConsumed("a3959 state update packet");
  return packet;
}

/** Serializes a state update packet body. Used by the in-browser demo device. */
export function a3959StateUpdateBytes(packet: A3959StateUpdatePacket): Uint8Array {
  return concatBytes([
    twsStatusBytes(packet.twsStatus),
    dualBatteryBytes(packet.dualBattery),
    dualFirmwareVersionBytes(packet.dualFirmwareVersion),
    serialNumberBytes(packet.serialNumber),
    equalizerConfigurationBytes(packet.equalizerConfiguration, A3959_EQUALIZER_CONFIG),
    new Uint8Array(10),
    new Uint8Array(1),
    buttonStatusCollectionBytes(packet.buttonConfiguration, A3959_BUTTON_CONFIGURATION),
    Uint8Array.of(ambientSoundModeCycleByte(packet.ambientSoundModeCycle)),
    a3959SoundModesBytes(packet.soundModes),
    new Uint8Array(1),
    Uint8Array.of(packet.touchTone ? 1 : 0),
    Uint8Array.of(packet.dualConnectionsEnabled ? 1 : 0),
    Uint8Array.of(packet.surroundSound ? 1 : 0),
    autoPowerOffBytes(packet.autoPowerOff),
    Uint8Array.of(packet.lowBatteryPrompt ? 1 : 0),
    Uint8Array.of(packet.gamingMode ? 1 : 0),
    new Uint8Array(12),
  ]);
}

export function a3959StateUpdatePacketToInbound(packet: A3959StateUpdatePacket): Packet {
  return createPacket([0x01, 0x01], a3959StateUpdateBytes(packet));
}

export function a3959StateFromUpdate(
  packet: A3959StateUpdatePacket,
  dualConnectionDevices: DualConnectionsDevice[],
): A3959State {
  return {
    twsStatus: packet.twsStatus,
    dualBattery: packet.dualBattery,
    dualFirmwareVersion: packet.dualFirmwareVersion,
    serialNumber: packet.serialNumber,
    equalizerConfiguration: packet.equalizerConfiguration,
    buttonConfiguration: packet.buttonConfiguration,
    ambientSoundModeCycle: packet.ambientSoundModeCycle,
    soundModes: packet.soundModes,
    autoPowerOff: packet.autoPowerOff,
    touchTone: packet.touchTone,
    lowBatteryPrompt: packet.lowBatteryPrompt,
    surroundSound: packet.surroundSound,
    gamingMode: packet.gamingMode,
    dualConnections: {
      isEnabled: packet.dualConnectionsEnabled,
      devices: dualConnectionDevices,
    },
    buttonResetPending: false,
  };
}

/** `impl Update<A3959StateUpdatePacket> for A3959State` */
export function applyA3959StateUpdate(
  state: A3959State,
  packet: A3959StateUpdatePacket,
): A3959State {
  return {
    ...state,
    twsStatus: packet.twsStatus,
    dualBattery: packet.dualBattery,
    dualFirmwareVersion: packet.dualFirmwareVersion,
    serialNumber: packet.serialNumber,
    equalizerConfiguration: packet.equalizerConfiguration,
    buttonConfiguration: packet.buttonConfiguration,
    ambientSoundModeCycle: packet.ambientSoundModeCycle,
    soundModes: packet.soundModes,
    touchTone: packet.touchTone,
    autoPowerOff: packet.autoPowerOff,
    lowBatteryPrompt: packet.lowBatteryPrompt,
    surroundSound: packet.surroundSound,
    gamingMode: packet.gamingMode,
    dualConnections: { ...state.dualConnections, isEnabled: packet.dualConnectionsEnabled },
  };
}
