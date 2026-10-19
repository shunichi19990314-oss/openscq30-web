/**
 * Web Serial transport tests, using a fake SerialPort. `navigator.serial` is stubbed so the module
 * can be exercised in Node.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openPort, portLabel, soundcoreVendorServiceUuid } from "../src/transport/webSerial";
import { PacketIo } from "../src/lib/packetIo";
import { createPacket, encodePacket } from "../src/lib/packet";

class FakeSerialPort {
  readonly written: Uint8Array[] = [];
  opened = false;
  closed = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  constructor(private readonly info: Record<string, unknown> = {}) {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(new Uint8Array(chunk));
      },
    });
  }

  getInfo(): Record<string, unknown> {
    return this.info;
  }

  async open(): Promise<void> {
    if (this.opened) throw new Error("already open");
    this.opened = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async forget(): Promise<void> {
    // not used
  }

  /** Emits bytes as if the device had sent them. */
  emit(bytes: Uint8Array): void {
    this.controller?.enqueue(bytes);
  }

  getSignals(): unknown {
    return null;
  }
}

let originalNavigator: unknown;

beforeAll(() => {
  originalNavigator = (globalThis as Record<string, unknown>).navigator;
  const listeners: Array<(event: unknown) => void> = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      serial: {
        addEventListener: (_type: string, listener: (event: unknown) => void) => {
          listeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (event: unknown) => void) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
        getPorts: async () => [],
      },
    },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: originalNavigator,
  });
});

const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("openPort", () => {
  it("does not drop bytes that arrive before the read handler is registered", async () => {
    const port = new FakeSerialPort();
    const connection = await openPort(port as unknown as SerialPort);

    // Devices can push data as soon as the RFCOMM channel opens, which happens before PacketIo
    // gets a chance to register its handler.
    port.emit(Uint8Array.from([1, 2, 3]));
    await settle();

    const received: number[][] = [];
    connection.setReadHandler((data) => received.push(Array.from(data)));
    expect(received).toEqual([[1, 2, 3]]);

    port.emit(Uint8Array.from([4, 5]));
    await settle();
    expect(received).toEqual([[1, 2, 3], [4, 5]]);

    await connection.close();
    expect(port.closed).toBe(true);
  });

  it("feeds a reassembled packet to the packet io", async () => {
    const port = new FakeSerialPort();
    const connection = await openPort(port as unknown as SerialPort);
    const io = new PacketIo(connection);
    const unsolicited: string[] = [];
    io.onUnsolicitedPacket((packet) => unsolicited.push(packet.command.join(",")));

    const request = io.sendWithResponse(createPacket([0x01, 0x01]));
    await settle();
    expect(port.written).toHaveLength(1);

    // The device replies with the answer split across two chunks.
    const ack = encodePacket("inbound", createPacket([0x01, 0x01]));
    port.emit(ack.subarray(0, 4));
    await settle();
    port.emit(ack.subarray(4));
    const response = await request;
    expect(response.command).toEqual([0x01, 0x01]);

    await io.close();
  });

  it("reports a disconnection", async () => {
    const port = new FakeSerialPort();
    const connection = await openPort(port as unknown as SerialPort);
    let reason: unknown = "not called";
    connection.setDisconnectHandler((value) => {
      reason = value;
    });
    // The read loop ends when the stream is closed by the device.
    (port as unknown as { controller: ReadableStreamDefaultController<Uint8Array> }).controller.close();
    await settle();
    expect(reason).not.toBe("not called");
    await connection.close();
  });

  it("labels bluetooth and usb ports", () => {
    const bluetooth = new FakeSerialPort({
      bluetoothServiceClassId: "0cf12d31-fac3-4553-bd80-d6832e7b3959",
    });
    const usb = new FakeSerialPort({ usbVendorId: 0x1234, usbProductId: 0x5678 });
    expect(portLabel(bluetooth as unknown as SerialPort)).toContain("0cf12d31");
    expect(portLabel(usb as unknown as SerialPort)).toContain("4660:22136");
  });

  it("derives the vendor uuid for a model number", () => {
    expect(soundcoreVendorServiceUuid("3959")).toBe(
      "0cf12d31-fac3-4553-bd80-d6832e7b3959",
    );
  });
});
