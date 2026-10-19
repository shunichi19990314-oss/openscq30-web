/**
 * Byte level helpers shared by the protocol implementation.
 *
 * Ported from openscq30-lib (`lib/src/devices/soundcore/common/packet/parsing/basics.rs`).
 */

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

export class ParseError extends Error {
  constructor(
    message: string,
    readonly context: string[] = [],
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/** Sequential reader over a byte slice. Mirrors the subset of `nom` used by openscq30-lib. */
export class ByteReader {
  private offset = 0;

  constructor(
    private readonly data: Uint8Array,
    readonly context: string[] = [],
  ) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  get done(): boolean {
    return this.offset >= this.data.length;
  }

  private fail(what: string, needed: number): never {
    throw new ParseError(
      `${what}: expected ${needed} byte(s), ${this.remaining} remaining`,
      [...this.context],
    );
  }

  /** nom's `le_u8` */
  u8(): number {
    if (this.remaining < 1) this.fail("u8", 1);
    return this.data[this.offset++];
  }

  /** nom's `le_u16` (little endian) */
  u16le(): number {
    if (this.remaining < 2) this.fail("u16le", 2);
    const value = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  /** nom's `take(n)` */
  take(length: number): Uint8Array {
    if (this.remaining < length) this.fail("take", length);
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  /** `take_bool`: a byte equal to 1 is true, anything else is false. */
  bool(): boolean {
    return this.u8() === 1;
  }

  /** `take_str(n)`: utf-8 decode exactly n bytes, failing on invalid utf-8. */
  str(length: number): string {
    const bytes = this.take(length);
    try {
      return textDecoder.decode(bytes);
    } catch {
      throw new ParseError("invalid utf-8 string", [...this.context]);
    }
  }

  /** Runs a parser with a named context, for better error messages. */
  withContext<T>(name: string, parser: () => T): T {
    this.context.push(name);
    try {
      return parser();
    } catch (error) {
      if (error instanceof ParseError) {
        throw new ParseError(error.message, [...error.context, name]);
      }
      throw error;
    } finally {
      this.context.pop();
    }
  }

  /** nom's `all_consuming`: the reader must be at the end. */
  assertConsumed(what: string): void {
    if (this.remaining !== 0) {
      throw new ParseError(
        `${what}: ${this.remaining} unexpected trailing byte(s)`,
        [...this.context],
      );
    }
  }
}

export function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export type ByteChunk = number | Uint8Array | ArrayLike<number>;

export function concatBytes(chunks: Iterable<ByteChunk>): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const chunk of chunks) {
    const bytes =
      typeof chunk === "number" ? Uint8Array.of(chunk) : Uint8Array.from(chunk as ArrayLike<number>);
    parts.push(bytes);
    total += bytes.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function toHex(bytes: ArrayLike<number>, separator = " "): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(separator);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
