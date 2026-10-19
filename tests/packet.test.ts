import { describe, expect, it } from "vitest";

import {
  ackPacket,
  calculateChecksum,
  createPacket,
  encodePacket,
  takePacket,
} from "../src/lib/packet";
import { PacketIo } from "../src/lib/packetIo";
import { StubConnection } from "./support/stub";

describe("packet framing", () => {
  it("matches the example request state packet from openscq30-lib", () => {
    const expected = [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x01, 0x0a, 0x00, 0x02];
    expect(Array.from(encodePacket("outbound", createPacket([0x01, 0x01])))).toEqual(expected);
  });

  it("round trips a packet with a checksum", () => {
    const packet = createPacket([0x00, 0x01], [0x02]);
    const bytes = encodePacket("outbound", packet, "suffix");
    const result = takePacket("outbound", bytes, "suffix");
    expect(result.kind).toBe("packet");
    if (result.kind !== "packet") return;
    expect(result.length).toBe(bytes.length);
    expect(Array.from(result.packet.body)).toEqual([0x02]);
    expect(result.packet.command).toEqual([0x00, 0x01]);
  });

  it("round trips a packet without a checksum", () => {
    const packet = createPacket([0x00, 0x01], [0x02]);
    const bytes = encodePacket("outbound", packet, "none");
    const result = takePacket("outbound", bytes, "none");
    expect(result.kind).toBe("packet");
    if (result.kind !== "packet") return;
    expect(result.length).toBe(bytes.length);
  });

  it("reports incomplete packets instead of failing", () => {
    const bytes = encodePacket("inbound", createPacket([0x01, 0x01], [1, 2, 3]));
    expect(takePacket("inbound", bytes.subarray(0, 4)).kind).toBe("incomplete");
    expect(takePacket("inbound", bytes.subarray(0, bytes.length - 1)).kind).toBe("incomplete");
    expect(takePacket("inbound", bytes).kind).toBe("packet");
  });

  it("detects a bad checksum", () => {
    const bytes = encodePacket("inbound", createPacket([0x01, 0x01], [1, 2, 3]));
    bytes[bytes.length - 1] ^= 0xff;
    expect(takePacket("inbound", bytes).kind).toBe("error");
  });

  it("detects a direction mismatch", () => {
    const bytes = encodePacket("outbound", createPacket([0x01, 0x01], [1]));
    expect(takePacket("inbound", bytes).kind).toBe("error");
  });

  it("wraps the checksum at 255", () => {
    expect(calculateChecksum(Uint8Array.of(0xff, 0x02))).toBe(0x01);
    expect(calculateChecksum(new Uint8Array(0))).toBe(0);
  });

  it("builds an ack with the same command and an empty body", () => {
    const packet = createPacket([0x06, 0x81], [1, 2, 3]);
    expect(Array.from(ackPacket(packet).body)).toEqual([]);
    expect(ackPacket(packet).command).toEqual([0x06, 0x81]);
  });
});

describe("PacketIo", () => {
  it("matches responses to requests and forwards unsolicited packets", async () => {
    const connection = new StubConnection();
    const io = new PacketIo(connection);
    const unsolicited: number[] = [];
    io.onUnsolicitedPacket((packet) => unsolicited.push(packet.command[1]));

    const response = await io.sendWithResponse(createPacket([0x01, 0x01], [9]));
    expect(response.command).toEqual([0x01, 0x01]);
    expect(Array.from(response.body)).toEqual([]);

    connection.sendInbound(createPacket([0x01, 0x03], [5, 6]));
    expect(unsolicited).toEqual([0x03]);
    await io.close();
  });

  it("reassembles fragmented packets", async () => {
    const connection = new StubConnection({ fragmentWrites: true });
    const io = new PacketIo(connection);
    const response = await io.sendWithResponse(createPacket([0x06, 0x81], [1]));
    expect(response.command).toEqual([0x06, 0x81]);
    await io.close();
  });

  it("recovers from garbage data", async () => {
    const connection = new StubConnection();
    const io = new PacketIo(connection);
    const pending = io.sendWithResponse(createPacket([0x06, 0x81], [1]));
    connection.deliverGarbage(new Uint8Array(100));
    connection.sendInbound(ackPacket(createPacket([0x06, 0x81])));
    const response = await pending;
    expect(response.command).toEqual([0x06, 0x81]);
    await io.close();
  });

  it("retries until a response arrives and then times out", async () => {
    const connection = new StubConnection({ ackUnscripted: false });
    const io = new PacketIo(connection, "suffix", { baseTimeoutMs: 5 });
    await expect(io.sendWithResponse(createPacket([0x01, 0x86], [1]))).rejects.toThrow(/timed out/);
    // three attempts
    expect(connection.sent).toHaveLength(3);
    await io.close();
  });

  it("collects multi responses until the callback stops it", async () => {
    const devicePacket = (total: number, index: number): ReturnType<typeof createPacket> =>
      createPacket([0x0b, 0x01], [total, index]);
    const connection = new StubConnection({
      deliverAllScriptedAtOnce: true,
      responses: StubConnection.responseMap([
        [
          [0x0b, 0x01],
          [devicePacket(2, 1), devicePacket(2, 2)],
        ],
      ]),
    });
    const io = new PacketIo(connection);
    const received: number[] = [];
    await io.sendWithMultiResponse(
      createPacket([0x0b, 0x01]),
      (packet) => {
        received.push(packet.body[1]);
        return packet.body[1] !== packet.body[0];
      },
      20,
    );
    expect(received).toEqual([1, 2]);
    await io.close();
  });
});
