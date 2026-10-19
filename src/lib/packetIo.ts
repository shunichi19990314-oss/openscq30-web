/**
 * Packet IO controller.
 *
 * Ported from openscq30-lib (`lib/src/devices/soundcore/common/packet/packet_io_controller.rs`).
 *
 * Responsibilities:
 *  - reassemble fragmented packets out of the raw byte stream
 *  - match responses to requests by command, in FIFO order (the device may answer out of order)
 *  - retry a request up to 3 times with an increasing timeout
 *  - forward packets nobody is waiting for (state updates, battery updates, ...) to listeners
 */

import {
  MAX_PACKET_LENGTH,
  type ChecksumKind,
  type Command,
  type Packet,
  commandKey,
  encodePacket,
  takePacket,
} from "./packet";
import type { TransportConnection } from "../transport/transport";

export class DeviceError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "write" | "disconnected" | "other" = "other",
  ) {
    super(message);
    this.name = "DeviceError";
  }
}

interface PendingRequest {
  resolve: (packet: Packet) => void;
  reject: (error: unknown) => void;
}

export interface PacketIoOptions {
  /** Number of write attempts before giving up. Default 3, like openscq30-lib. */
  retries?: number;
  /** Base timeout in ms; attempt i waits `baseTimeoutMs * i`. Default 500. */
  baseTimeoutMs?: number;
  /** Timeout for each packet of a multi response. Default 2000. */
  multiResponseTimeoutMs?: number;
  onLog?: (level: "debug" | "warn" | "error", message: string, data?: unknown) => void;
  /** Called for every packet written or received, for debugging and for the UI log. */
  onPacket?: (direction: "tx" | "rx", bytes: Uint8Array) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PacketIo {
  private buffer = new Uint8Array(0);
  /** command key -> FIFO of waiters */
  private readonly pending = new Map<string, PendingRequest[]>();
  private readonly unsolicitedHandlers = new Set<(packet: Packet) => void>();
  private writeQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly connection: TransportConnection,
    private readonly checksumKind: ChecksumKind = "suffix",
    private readonly options: PacketIoOptions = {},
  ) {
    connection.setReadHandler((data) => this.onData(data));
  }

  private log(level: "debug" | "warn" | "error", message: string, data?: unknown) {
    this.options.onLog?.(level, message, data);
  }

  private onData(chunk: Uint8Array): void {
    this.options.onPacket?.("rx", chunk);
    const buffer = new Uint8Array(this.buffer.length + chunk.length);
    buffer.set(this.buffer, 0);
    buffer.set(chunk, this.buffer.length);
    this.buffer = buffer;

    let offset = 0;
    while (offset < this.buffer.length) {
      const result = takePacket("inbound", this.buffer.subarray(offset), this.checksumKind);
      if (result.kind === "incomplete") {
        // Keep the tail and wait for more bytes, unless the outstanding data is already larger than
        // any real packet could be (a corrupt length field would otherwise stall us forever).
        if (this.buffer.length - offset > MAX_PACKET_LENGTH) {
          this.log("warn", "dropping byte while resynchronizing: oversized pending packet");
          offset += 1;
          continue;
        }
        break;
      }
      if (result.kind === "error") {
        // Resynchronize by skipping one byte and looking for the next packet start.
        //
        // openscq30-lib clears the whole buffer here, which also throws away a valid packet that
        // arrived in the same chunk (for example when a single stray byte precedes it). Skipping
        // one byte at a time recovers without losing anything.
        this.log("warn", `failed to parse packet, resynchronizing: ${String(result.error)}`);
        offset += 1;
        continue;
      }
      offset += result.length;
      this.dispatch(result.packet);
    }
    this.buffer = this.buffer.slice(offset);
  }

  private dispatch(packet: Packet): void {
    const key = commandKey(packet.command);
    const queue = this.pending.get(key);
    const waiter = queue?.shift();
    if (queue && queue.length === 0) {
      this.pending.delete(key);
    }
    if (waiter) {
      waiter.resolve(packet);
      return;
    }
    for (const handler of this.unsolicitedHandlers) {
      try {
        handler(packet);
      } catch (error) {
        this.log("error", "unsolicited packet handler threw", error);
      }
    }
  }

  private waitForResponse(command: Command, timeoutMs: number): Promise<Packet> {
    const key = commandKey(command);
    return new Promise<Packet>((resolve, reject) => {
      const entry: PendingRequest = {
        resolve: (packet: Packet) => {
          clearTimeout(timer);
          resolve(packet);
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        this.removeWaiter(key, entry);
        reject(new DeviceError(`timed out after ${timeoutMs}ms`, "timeout"));
      }, timeoutMs);

      const queue = this.pending.get(key) ?? [];
      queue.push(entry);
      this.pending.set(key, queue);
    });
  }

  private removeWaiter(key: string, entry: PendingRequest): void {
    const queue = this.pending.get(key);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.pending.delete(key);
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    await this.connection.write(bytes);
    this.options.onPacket?.("tx", bytes);
  }

  /** Serializes all writes so the device never sees interleaved packets. */
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * `PacketIOController::send_with_response`: sends a packet and waits for a packet with the same
   * command, retrying up to 3 times with an increasing timeout.
   */
  sendWithResponse(packet: Packet): Promise<Packet> {
    return this.enqueueWrite(async () => {
      if (this.closed) throw new DeviceError("connection closed", "disconnected");
      const retries = this.options.retries ?? 3;
      const baseTimeoutMs = this.options.baseTimeoutMs ?? 500;
      const bytes = encodePacket("outbound", packet, this.checksumKind);

      let lastError: unknown;
      for (let attempt = 1; attempt <= retries; attempt++) {
        if (this.closed) throw new DeviceError("connection closed", "disconnected");
        const timeoutMs = baseTimeoutMs * attempt;
        const response = this.waitForResponse(packet.command, timeoutMs);
        try {
          await this.writeBytes(bytes);
        } catch (error) {
          throw new DeviceError(
            `write error: ${error instanceof Error ? error.message : String(error)}`,
            "write",
          );
        }
        try {
          return await response;
        } catch (error) {
          // A rejection caused by close() must not trigger another write attempt.
          if (this.closed) throw error;
          lastError = error;
          this.log("debug", `no response for attempt ${attempt}`, packet.command);
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new DeviceError("resending packet until ack received timed out", "timeout");
    });
  }

  /**
   * `PacketIOController::send_with_multi_response`: sends a request and collects up to `limit`
   * responses, stopping early when `onReceive` returns false or when a response times out.
   */
  async sendWithMultiResponse(
    packet: Packet,
    onReceive: (packet: Packet) => boolean,
    limit: number,
  ): Promise<void> {
    return this.enqueueWrite(async () => {
      if (this.closed) throw new DeviceError("connection closed", "disconnected");
      const timeoutMs = this.options.multiResponseTimeoutMs ?? 2000;
      const bytes = encodePacket("outbound", packet, this.checksumKind);

      for (let i = 0; i < limit; i++) {
        const response = this.waitForResponse(packet.command, timeoutMs);
        if (i === 0) {
          await this.writeBytes(bytes);
        }
        let received: Packet;
        try {
          received = await response;
        } catch (error) {
          if (this.closed) throw error;
          // Timed out waiting for another packet: that is how the transfer ends.
          return;
        }
        if (!onReceive(received)) return;
      }
      this.log("warn", `multi response limit reached: ${limit}`);
    });
  }

  /** `PacketIOController::send_without_response` */
  async sendWithoutResponse(packet: Packet): Promise<void> {
    return this.enqueueWrite(async () => {
      const bytes = encodePacket("outbound", packet, this.checksumKind);
      await this.writeBytes(bytes);
    });
  }

  /** Registers a listener for packets that are not a response to a pending request. */
  onUnsolicitedPacket(handler: (packet: Packet) => void): () => void {
    this.unsolicitedHandlers.add(handler);
    return () => this.unsolicitedHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    // Reject in-flight requests; otherwise their promises would never settle and the write queue
    // would stay blocked behind them.
    const queues = [...this.pending.values()];
    this.pending.clear();
    for (const queue of queues) {
      for (const waiter of queue) {
        waiter.reject(new DeviceError("connection closed", "disconnected"));
      }
    }
    this.unsolicitedHandlers.clear();
    await this.connection.close();
  }
}

export { delay };
