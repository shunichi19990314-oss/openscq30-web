/**
 * A stub RFCOMM connection used by the tests. Mirrors openscq30-lib's `TestSoundcoreDevice`:
 * it replies to requests with scripted packets and records everything that is written.
 */

import {
  ackPacket,
  commandKey,
  encodePacket,
  takePacket,
  type Command,
  type Packet,
} from "../../src/lib/packet";
import type { TransportConnection } from "../../src/transport/transport";

export interface StubOptions {
  /** Scripted responses per command. Each entry is consumed in order. */
  responses?: Map<string, Packet[]>;
  /** Reply with an empty ACK when there is no scripted response. Default true. */
  ackUnscripted?: boolean;
  /** Deliver bytes one at a time, to exercise packet reassembly. */
  fragmentWrites?: boolean;
  /**
   * Deliver every scripted response for a command on the first write, asynchronously. Needed for
   * multi response requests, where the device sends several packets for a single request.
   */
  deliverAllScriptedAtOnce?: boolean;
}

export class StubConnection implements TransportConnection {
  readonly name = "Stub Device";
  /** Outbound packets written by the code under test, in order. */
  readonly sent: Packet[] = [];
  private readHandler: ((data: Uint8Array) => void) | null = null;
  private disconnectHandler: ((reason?: unknown) => void) | null = null;
  private readonly responses: Map<string, Packet[]>;
  closed = false;

  constructor(private readonly options: StubOptions = {}) {
    this.responses = new Map(options.responses ?? []);
  }

  static responseMap(entries: Array<[Command, Packet[]]>): Map<string, Packet[]> {
    return new Map(entries.map(([command, packets]) => [commandKey(command), packets]));
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("connection closed");
    const result = takePacket("outbound", data);
    if (result.kind !== "packet") {
      throw new Error(`stub connection received an unparsable packet: ${result.kind}`);
    }
    this.sent.push(result.packet);

    const key = commandKey(result.packet.command);
    const scripted = this.responses.get(key);
    if (this.options.deliverAllScriptedAtOnce && scripted && scripted.length > 0) {
      const all = scripted.splice(0, scripted.length);
      for (const reply of all) {
        const bytes = encodePacket("inbound", reply);
        setTimeout(() => this.deliver(bytes), 0);
      }
      return;
    }
    const reply = scripted?.shift();
    if (reply) {
      this.deliver(encodePacket("inbound", reply));
    } else if (this.options.ackUnscripted !== false) {
      this.deliver(encodePacket("inbound", ackPacket(result.packet)));
    }
  }

  /** Pushes an unsolicited packet to the code under test. */
  sendInbound(packet: Packet): void {
    this.deliver(encodePacket("inbound", packet));
  }

  /** Pushes raw bytes, e.g. to simulate a device sending garbage. */
  deliverGarbage(bytes: Uint8Array): void {
    this.readHandler?.(bytes);
  }

  private deliver(bytes: Uint8Array): void {
    if (!this.readHandler) return;
    if (this.options.fragmentWrites) {
      for (const byte of bytes) {
        this.readHandler(Uint8Array.of(byte));
      }
    } else {
      this.readHandler(bytes);
    }
  }

  setReadHandler(handler: (data: Uint8Array) => void): void {
    this.readHandler = handler;
  }

  setDisconnectHandler(handler: (reason?: unknown) => void): void {
    this.disconnectHandler = handler;
  }

  disconnect(reason?: unknown): void {
    this.disconnectHandler?.(reason);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Outbound packets as plain [command, body] pairs, for readable assertions. */
  sentSummary(): Array<{ command: string; body: number[] }> {
    return this.sent.map((packet) => ({
      command: commandKey(packet.command),
      body: Array.from(packet.body),
    }));
  }
}
