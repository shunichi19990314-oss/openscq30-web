/**
 * Byte level structures shared by Soundcore devices.
 *
 * Ported from openscq30-lib `lib/src/devices/soundcore/common/structures/`.
 */

import { ByteReader, ParseError, clamp, concatBytes, encodeUtf8 } from "../bytes";

/* ------------------------------------------------------------------ TWS --- */

export type HostDevice = "left" | "right";

export interface TwsStatus {
  hostDevice: HostDevice;
  isConnected: boolean;
}

export function parseTwsStatus(reader: ByteReader): TwsStatus {
  return reader.withContext("tws status", () => {
    const hostByte = reader.u8();
    const hostDevice: HostDevice = hostByte === 1 ? "right" : "left";
    const isConnected = reader.bool();
    return { hostDevice, isConnected };
  });
}

export function twsStatusBytes(status: TwsStatus): Uint8Array {
  return Uint8Array.of(status.hostDevice === "right" ? 1 : 0, status.isConnected ? 1 : 0);
}

/* -------------------------------------------------------------- battery --- */

export type IsBatteryCharging = boolean;

export interface SingleBattery {
  level: number;
  isCharging: IsBatteryCharging;
}

export interface DualBattery {
  left: SingleBattery;
  right: SingleBattery;
}

export const defaultDualBattery = (): DualBattery => ({
  left: { level: 0, isCharging: false },
  right: { level: 0, isCharging: false },
});

export function parseDualBattery(reader: ByteReader): DualBattery {
  return reader.withContext("dual battery", () => {
    const leftLevel = reader.u8();
    const rightLevel = reader.u8();
    const leftCharging = reader.u8() === 1;
    const rightCharging = reader.u8() === 1;
    return {
      left: { level: leftLevel, isCharging: leftCharging },
      right: { level: rightLevel, isCharging: rightCharging },
    };
  });
}

export function dualBatteryBytes(battery: DualBattery): Uint8Array {
  return Uint8Array.of(
    battery.left.level,
    battery.right.level,
    battery.left.isCharging ? 1 : 0,
    battery.right.isCharging ? 1 : 0,
  );
}

export function parseBatteryLevel(reader: ByteReader): number {
  return reader.withContext("battery level", () => reader.u8());
}

/* ------------------------------------------------------ firmware version --- */

export interface FirmwareVersion {
  major: number;
  minor: number;
}

export function firmwareVersionToString(version: FirmwareVersion): string {
  return `${String(version.major).padStart(2, "0")}.${String(version.minor).padStart(2, "0")}`;
}

export function compareFirmwareVersion(a: FirmwareVersion, b: FirmwareVersion): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}

export function parseFirmwareVersion(reader: ByteReader): FirmwareVersion {
  return reader.withContext("firmware version", () => {
    const bytes = reader.take(5);
    const text = String.fromCharCode(...bytes);
    const match = /^(\d{2})\.(\d{2})$/.exec(text);
    if (!match) {
      throw new ParseError(`invalid firmware version: ${JSON.stringify(text)}`);
    }
    return { major: Number(match[1]), minor: Number(match[2]) };
  });
}

export function firmwareVersionBytes(version: FirmwareVersion): Uint8Array {
  return encodeUtf8(firmwareVersionToString(version));
}

/**
 * Two 5 byte firmware versions. A group of all 0x00 or all 0xff means "absent".
 *
 * openscq30-lib fails to parse when both sides are absent; the web port is lenient instead and
 * reports both as unknown, so a device with a weird state packet still connects.
 */
export type DualFirmwareVersion =
  | { kind: "both"; left: FirmwareVersion; right: FirmwareVersion }
  | { kind: "leftOnly"; left: FirmwareVersion }
  | { kind: "rightOnly"; right: FirmwareVersion }
  | { kind: "none" };

export function dualFirmwareVersionLeft(value: DualFirmwareVersion): FirmwareVersion | null {
  return value.kind === "both" || value.kind === "leftOnly" ? value.left : null;
}

export function dualFirmwareVersionRight(value: DualFirmwareVersion): FirmwareVersion | null {
  return value.kind === "both" || value.kind === "rightOnly" ? value.right : null;
}

/** The oldest of the two firmware versions, or null when unknown. */
export function dualFirmwareVersionMin(value: DualFirmwareVersion): FirmwareVersion | null {
  const left = dualFirmwareVersionLeft(value);
  const right = dualFirmwareVersionRight(value);
  if (left && right) return compareFirmwareVersion(left, right) <= 0 ? left : right;
  return left ?? right ?? null;
}

function isAbsentFirmwareBytes(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0) || bytes.every((byte) => byte === 0xff);
}

export function parseDualFirmwareVersion(reader: ByteReader): DualFirmwareVersion {
  return reader.withContext("dual firmware version", () => {
    const leftBytes = reader.take(5);
    const rightBytes = reader.take(5);
    const left = isAbsentFirmwareBytes(leftBytes) ? null : parseBytesAsFirmware(leftBytes);
    const right = isAbsentFirmwareBytes(rightBytes) ? null : parseBytesAsFirmware(rightBytes);
    if (left && right) return { kind: "both", left, right };
    if (left) return { kind: "leftOnly", left };
    if (right) return { kind: "rightOnly", right };
    return { kind: "none" };
  });
}

function parseBytesAsFirmware(bytes: Uint8Array): FirmwareVersion {
  const reader = new ByteReader(bytes);
  return parseFirmwareVersion(reader);
}

export function dualFirmwareVersionBytes(value: DualFirmwareVersion): Uint8Array {
  const absent = new Uint8Array(5);
  switch (value.kind) {
    case "both":
      return concatBytes([firmwareVersionBytes(value.left), firmwareVersionBytes(value.right)]);
    case "leftOnly":
      return concatBytes([firmwareVersionBytes(value.left), absent]);
    case "rightOnly":
      return concatBytes([absent, firmwareVersionBytes(value.right)]);
    case "none":
      return concatBytes([absent, absent]);
  }
}

export const defaultDualFirmwareVersion = (): DualFirmwareVersion => ({
  kind: "both",
  left: { major: 0, minor: 0 },
  right: { major: 0, minor: 0 },
});

/* --------------------------------------------------------- serial number --- */

export const SERIAL_NUMBER_LENGTH = 16;

export function parseSerialNumber(reader: ByteReader): string {
  return reader.withContext("serial number", () => {
    const text = reader.str(SERIAL_NUMBER_LENGTH);
    if (!/^[0-9A-Za-z]+$/.test(text)) {
      throw new ParseError(`serial number is not alphanumeric: ${JSON.stringify(text)}`);
    }
    return text;
  });
}

export function serialNumberBytes(serialNumber: string): Uint8Array {
  return encodeUtf8(serialNumber);
}

export const defaultSerialNumber = "0000000000000000";

/* --------------------------------------------------------- auto power off --- */

export interface AutoPowerOff {
  isEnabled: boolean;
  durationIndex: number;
}

export function parseAutoPowerOff(reader: ByteReader): AutoPowerOff {
  return reader.withContext("auto power off", () => ({
    isEnabled: reader.bool(),
    durationIndex: reader.u8(),
  }));
}

export function autoPowerOffBytes(value: AutoPowerOff): Uint8Array {
  return Uint8Array.of(value.isEnabled ? 1 : 0, value.durationIndex);
}

export const defaultAutoPowerOff = (): AutoPowerOff => ({ isEnabled: false, durationIndex: 0 });

/* ------------------------------------------- ambient sound mode cycle --- */

export interface AmbientSoundModeCycle {
  noiseCancelingMode: boolean;
  transparencyMode: boolean;
  normalMode: boolean;
}

const CYCLE_NOISE_CANCELING = 1 << 0;
const CYCLE_TRANSPARENCY = 1 << 1;
const CYCLE_NORMAL = 1 << 2;

export function parseAmbientSoundModeCycle(reader: ByteReader): AmbientSoundModeCycle {
  return ambientSoundModeCycleFromByte(reader.u8());
}

export function ambientSoundModeCycleFromByte(byte: number): AmbientSoundModeCycle {
  return {
    noiseCancelingMode: (byte & CYCLE_NOISE_CANCELING) !== 0,
    transparencyMode: (byte & CYCLE_TRANSPARENCY) !== 0,
    normalMode: (byte & CYCLE_NORMAL) !== 0,
  };
}

export function ambientSoundModeCycleByte(cycle: AmbientSoundModeCycle): number {
  let byte = 0;
  if (cycle.noiseCancelingMode) byte |= CYCLE_NOISE_CANCELING;
  if (cycle.transparencyMode) byte |= CYCLE_TRANSPARENCY;
  if (cycle.normalMode) byte |= CYCLE_NORMAL;
  return byte;
}

export const defaultAmbientSoundModeCycle = (): AmbientSoundModeCycle => ({
  noiseCancelingMode: true,
  transparencyMode: true,
  normalMode: true,
});

/* ----------------------------------------------------------- wind noise --- */

export interface WindNoise {
  isSuppressionEnabled: boolean;
  isDetected: boolean;
}

export function parseWindNoise(reader: ByteReader): WindNoise {
  const byte = reader.u8();
  return {
    isSuppressionEnabled: (byte & 1) !== 0,
    isDetected: (byte & 2) !== 0,
  };
}

export function windNoiseByte(windNoise: WindNoise): number {
  return (windNoise.isSuppressionEnabled ? 1 : 0) | (windNoise.isDetected ? 2 : 0);
}

/* ---------------------------------- manual / adaptive noise canceling --- */

/** 1-5, clamped. */
export function clampManualNoiseCanceling(value: number): number {
  return clamp(Math.trunc(value), 1, 5);
}

/** 1-5, clamped. */
export function clampAdaptiveNoiseCanceling(value: number): number {
  return clamp(Math.trunc(value), 1, 5);
}

/** High nibble is the manual level, low nibble the adaptive level. */
export function parseManualAdaptiveNoiseCanceling(byte: number): {
  manual: number;
  adaptive: number;
} {
  return {
    manual: clampManualNoiseCanceling((byte & 0xf0) >> 4),
    adaptive: clampAdaptiveNoiseCanceling(byte & 0x0f),
  };
}

export function manualAdaptiveNoiseCancelingByte(manual: number, adaptive: number): number {
  return (
    ((clampManualNoiseCanceling(manual) & 0x0f) << 4) |
    (clampAdaptiveNoiseCanceling(adaptive) & 0x0f)
  );
}

/* ---------------------------------------------------------------- flags --- */

export type Flag = boolean;

export function parseFlag(reader: ByteReader): Flag {
  return reader.bool();
}

export function flagBytes(value: Flag): Uint8Array {
  return Uint8Array.of(value ? 1 : 0);
}

/* ------------------------------------------------------- dual connections --- */

export interface DualConnectionsDevice {
  isConnected: boolean;
  macAddress: string;
  name: string;
}

export interface DualConnections {
  isEnabled: boolean;
  devices: DualConnectionsDevice[];
}

export function macAddressFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(":");
}

export function macAddressToBytes(macAddress: string): Uint8Array {
  const parts = macAddress.split(":").map((part) => Number.parseInt(part, 16));
  if (parts.length !== 6 || parts.some((part) => Number.isNaN(part))) {
    throw new ParseError(`invalid mac address: ${macAddress}`);
  }
  return Uint8Array.from(parts);
}

/**
 * A dual connections device entry: a length byte, a connected flag, 6 mac address bytes and a
 * null padded name.
 */
export function parseDualConnectionsDevice(reader: ByteReader): DualConnectionsDevice {
  return reader.withContext("dual connection device", () => {
    const length = reader.u8();
    const isConnected = reader.bool();
    const macAddress = macAddressFromBytes(reader.take(6));
    // The name is whatever is left of the declared length. Real devices have been observed sending
    // short trailing entries, so clamp to what is actually available.
    const declaredNameLength = Math.max(0, length - 8);
    const nameLength = Math.min(declaredNameLength, reader.remaining);
    const nameBytes = reader.take(nameLength);
    const nulIndex = nameBytes.indexOf(0);
    const trimmed = nulIndex >= 0 ? nameBytes.subarray(0, nulIndex) : nameBytes;
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(trimmed);
    } catch {
      name = "";
    }
    return { isConnected, macAddress, name };
  });
}

export function dualConnectionsDeviceBytes(device: DualConnectionsDevice): Uint8Array {
  const nameBytes = encodeUtf8(device.name).subarray(0, 32);
  const padding = new Uint8Array(Math.max(0, 32 - nameBytes.length));
  return concatBytes([
    [0x28],
    [device.isConnected ? 1 : 0],
    macAddressToBytes(device.macAddress),
    nameBytes,
    padding,
  ]);
}
