/**
 * Soundcore packet framing.
 *
 * Ported from openscq30-lib (`lib/src/devices/soundcore/common/packet.rs` and `packet/checksum.rs`).
 *
 * Layout:
 *   [5 byte direction marker][2 byte command][2 byte little endian total length][body][1 byte checksum]
 *
 * The length field covers the whole packet, including the direction marker, command, length field
 * itself, body and checksum.
 */

import { ByteReader, ParseError, concatBytes } from "./bytes";

export type Direction = "outbound" | "inbound";

export const DIRECTION_BYTES: Record<Direction, readonly number[]> = {
  outbound: [0x08, 0xee, 0x00, 0x00, 0x00],
  inbound: [0x09, 0xff, 0x00, 0x00, 0x01],
};

/** Two byte command, e.g. `[0x01, 0x01]` is "request state". */
export type Command = readonly [number, number];

export function commandKey(command: Command): string {
  return `${command[0]},${command[1]}`;
}

export function parseCommandKey(key: string): Command {
  const [a, b] = key.split(",").map(Number);
  return [a, b];
}

export function commandHex(command: Command): string {
  return `0x${command[0].toString(16).padStart(2, "0")}${command[1]
    .toString(16)
    .padStart(2, "0")}`;
}

/** Most devices append a checksum byte. Some (see `SoundcoreDeviceConfig`) do not. */
export type ChecksumKind = "none" | "suffix";

export interface Packet {
  readonly command: Command;
  readonly body: Uint8Array;
}

export function createPacket(command: Command, body: ArrayLike<number> = []): Packet {
  return { command, body: new Uint8Array(body) };
}

/** `checksum::calculate_checksum`: wrapping sum of all bytes. */
export function calculateChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) {
    sum = (sum + byte) & 0xff;
  }
  return sum;
}

const DIRECTION_LENGTH = 5;
const COMMAND_LENGTH = 2;
const PACKET_SIZE_LENGTH = 2;

/**
 * Upper bound for a plausible packet. Real Soundcore packets are at most a few hundred bytes
 * (the state update is 91); anything larger means the stream is not aligned on a packet boundary.
 */
export const MAX_PACKET_LENGTH = 8192;

/** `Packet::bytes` */
export function encodePacket(
  direction: Direction,
  packet: Packet,
  checksumKind: ChecksumKind = "suffix",
): Uint8Array {
  const hasChecksum = checksumKind === "suffix";
  const body = packet.body;
  const length =
    DIRECTION_LENGTH +
    COMMAND_LENGTH +
    PACKET_SIZE_LENGTH +
    body.length +
    (hasChecksum ? 1 : 0);

  const withoutChecksum = concatBytes([
    DIRECTION_BYTES[direction],
    packet.command,
    [length & 0xff, (length >> 8) & 0xff],
    body,
  ]);
  if (!hasChecksum) {
    return withoutChecksum;
  }
  return concatBytes([withoutChecksum, [calculateChecksum(withoutChecksum)]]);
}

export type TakeResult =
  | { kind: "packet"; packet: Packet; length: number }
  | { kind: "incomplete" }
  | { kind: "error"; error: unknown };

/**
 * `Packet::take`. Uses streaming semantics: returns `incomplete` when the buffer does not yet hold a
 * whole packet, so callers can append more data and try again.
 */
export function takePacket(
  direction: Direction,
  buffer: Uint8Array,
  checksumKind: ChecksumKind = "suffix",
): TakeResult {
  const hasChecksum = checksumKind === "suffix";
  const headerLength = DIRECTION_LENGTH + COMMAND_LENGTH + PACKET_SIZE_LENGTH;
  if (buffer.length < headerLength) {
    return { kind: "incomplete" };
  }

  const expectedDirection = DIRECTION_BYTES[direction];
  for (let i = 0; i < expectedDirection.length; i++) {
    if (buffer[i] !== expectedDirection[i]) {
      return {
        kind: "error",
        error: new ParseError("packet direction mismatch"),
      };
    }
  }

  const reader = new ByteReader(buffer);
  reader.take(DIRECTION_LENGTH);
  const command: Command = [reader.u8(), reader.u8()];
  const declaredLength = reader.u16le();

  // A length outside the plausible range means we are looking at garbage. Reporting `incomplete`
  // here would make the receive buffer grow forever waiting for bytes that never arrive, so fail
  // instead and let the caller resynchronize.
  const minimumLength = headerLength + (hasChecksum ? 1 : 0);
  if (declaredLength < minimumLength || declaredLength > MAX_PACKET_LENGTH) {
    return {
      kind: "error",
      error: new ParseError(`implausible packet length: ${declaredLength}`),
    };
  }
  const bodyLength = declaredLength - minimumLength;

  if (buffer.length < declaredLength) {
    return { kind: "incomplete" };
  }

  const body = reader.take(bodyLength);
  const consumed = headerLength + bodyLength;
  if (hasChecksum) {
    const checksum = reader.u8();
    const calculated = calculateChecksum(buffer.subarray(0, consumed));
    if (checksum !== calculated) {
      return {
        kind: "error",
        error: new ParseError(
          `checksum mismatch: packet says ${checksum}, calculated ${calculated}`,
        ),
      };
    }
  }

  return {
    kind: "packet",
    packet: { command, body: new Uint8Array(body) },
    length: consumed + (hasChecksum ? 1 : 0),
  };
}

/** The ACK a device sends back for a command: same command, empty body, opposite direction. */
export function ackPacket(packet: Packet): Packet {
  return createPacket(packet.command, []);
}
