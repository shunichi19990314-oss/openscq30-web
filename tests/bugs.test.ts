/**
 * Regression tests for bugs found while reviewing the port.
 */

import { describe, expect, it } from "vitest";

import { PacketIo } from "../src/lib/packetIo";
import { createPacket, encodePacket, takePacket } from "../src/lib/packet";
import { StubConnection } from "./support/stub";
import { A3959Controller, type CustomProfileStore } from "../src/devices/a3959/controller";
import { FakeA3959Device } from "./support/fakeDevice";
import { migrationValue } from "../src/lib/migration";
import {
  planSoundModesMigration,
  soundModesToMigrationState,
  type A3959SoundModes,
} from "../src/devices/a3959/soundModes";

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: still pending after ${ms}ms`)), ms)),
  ]);
}

function memoryProfileStore(): CustomProfileStore {
  const profiles: Array<{ name: string; volumeAdjustments: number[] }> = [];
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  return {
    list: () => profiles,
    upsert: (name, volumeAdjustments) => {
      const existing = profiles.find((profile) => profile.name === name);
      if (existing) existing.volumeAdjustments = volumeAdjustments;
      else profiles.push({ name, volumeAdjustments });
      notify();
    },
    remove: (name) => {
      const index = profiles.findIndex((profile) => profile.name === name);
      if (index >= 0) profiles.splice(index, 1);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

describe("PacketIo.close", () => {
  it("rejects in-flight requests instead of hanging forever", async () => {
    const connection = new StubConnection({ ackUnscripted: false });
    const io = new PacketIo(connection, "suffix", { baseTimeoutMs: 5000 });
    const pending = io.sendWithResponse(createPacket([0x01, 0x01]));
    await settle(10);
    await io.close();
    await expect(withTimeout(pending, 500, "in-flight request")).rejects.toThrow(/closed/i);
  });

  it("lets later operations fail fast rather than queueing behind a dead request", async () => {
    const connection = new StubConnection({ ackUnscripted: false });
    const io = new PacketIo(connection, "suffix", { baseTimeoutMs: 5000 });
    const first = io.sendWithResponse(createPacket([0x01, 0x01]));
    await settle(10);
    await io.close();
    await expect(first).rejects.toBeDefined();
    await expect(
      withTimeout(io.sendWithResponse(createPacket([0x01, 0x02])), 500, "second request"),
    ).rejects.toThrow(/closed/i);
  });
});

describe("packet length sanity", () => {
  it("rejects an absurd declared length instead of buffering forever", () => {
    // A header claiming a 65535 byte body would otherwise make the receive buffer grow without
    // bound when a device sends garbage.
    const garbage = Uint8Array.from([
      0x09, 0xff, 0x00, 0x00, 0x01, // direction
      0x01, 0x01, // command
      0xff, 0xff, // length = 65535
      0x00,
    ]);
    expect(takePacket("inbound", garbage).kind).toBe("error");
  });

  it("still accepts a packet of realistic size", () => {
    const packet = createPacket([0x01, 0x01], new Uint8Array(200));
    expect(takePacket("inbound", encodePacket("inbound", packet)).kind).toBe("packet");
  });
});

describe("parser robustness", () => {
  it("survives a flood of random garbage and still recovers", async () => {
    const connection = new StubConnection({ ackUnscripted: false });
    const io = new PacketIo(connection);
    let unsolicited = 0;
    io.onUnsolicitedPacket(() => {
      unsolicited += 1;
    });

    const pending = io.sendWithResponse(createPacket([0x01, 0x01]));
    // Let the request be written and its response waiter registered first.
    await settle(0);

    // Deterministic pseudo random bytes, sent one at a time like a fragmented stream.
    let seed = 12345;
    const nextByte = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 0xff;
    };
    for (let i = 0; i < 5000; i++) {
      connection.deliverGarbage(Uint8Array.of(nextByte()));
    }

    connection.sendInbound(createPacket([0x01, 0x01]));
    const response = await withTimeout(pending, 1000, "recovery after garbage");
    expect(response.command).toEqual([0x01, 0x01]);
    expect(unsolicited).toBeGreaterThanOrEqual(0);
    await io.close();
  });

  it("does not grow the buffer when a huge length is declared", () => {
    const partial = Uint8Array.from([0x09, 0xff, 0x00, 0x00, 0x01, 0x01, 0x01, 0xff, 0xff]);
    expect(takePacket("inbound", partial).kind).toBe("error");
  });
});

describe("sound mode migration planner", () => {
  const base: A3959SoundModes = {
    ambientSoundMode: "noiseCanceling",
    noiseCancelingMode: "manual",
    adaptiveNoiseCanceling: 3,
    manualNoiseCanceling: 3,
    multiSceneAnc: "outdoor",
    windNoise: { isSuppressionEnabled: true, isDetected: false },
    noiseCancelingAdaptiveSensitivityLevel: 5,
  };

  const cases: Array<[string, Partial<A3959SoundModes>]> = [
    ["manual level while in manual mode", { manualNoiseCanceling: 5 }],
    ["manual level while in adaptive mode", { noiseCancelingMode: "adaptive", manualNoiseCanceling: 1 }],
    ["multi scene while in manual mode", { multiSceneAnc: "indoor" }],
    ["adaptive level", { noiseCancelingMode: "adaptive", adaptiveNoiseCanceling: 5 }],
    ["to normal mode", { ambientSoundMode: "normal" }],
    ["to transparency", { ambientSoundMode: "transparency" }],
    ["wind noise in normal mode", { ambientSoundMode: "normal", windNoise: { isSuppressionEnabled: false, isDetected: false } }],
    ["everything at once", {
      ambientSoundMode: "transparency",
      noiseCancelingMode: "multiScene",
      manualNoiseCanceling: 2,
      adaptiveNoiseCanceling: 4,
      multiSceneAnc: "transport",
      windNoise: { isSuppressionEnabled: false, isDetected: false },
      noiseCancelingAdaptiveSensitivityLevel: 9,
    }],
  ];

  it.each(cases)("%s produces a valid path", (_name, changes) => {
    const target = { ...base, ...changes };
    const path = planSoundModesMigration(base, target);
    expect(path.length).toBeGreaterThan(0);

    let current = soundModesToMigrationState(base);
    for (const step of path) {
      const next = soundModesToMigrationState(step);
      const changedIndices = next
        .map((_, index) => index)
        .filter((index) => JSON.stringify(next[index]) !== JSON.stringify(current[index]));

      // Each step changes exactly one field...
      expect(changedIndices, `step changes ${changedIndices.length} fields`).toHaveLength(1);
      // ...and that field is allowed to change given the previous state, i.e. its parent
      // requirement is satisfied. Values may legitimately differ from the target: the planner
      // routes through intermediate parent values to unlock other fields.
      const index = changedIndices[0];
      const requirement = requirements()[index];
      if (requirement) {
        const parentValue = current[requirement.index];
        expect(
          requirement.values.some(
            (value) => JSON.stringify(value) === JSON.stringify(parentValue),
          ),
          `field ${index} changed while its parent requirement was not met`,
        ).toBe(true);
      }
      current = next;
    }
    expect(JSON.stringify(current)).toBe(JSON.stringify(soundModesToMigrationState(target)));
  });

  it("returns an empty path when nothing changes", () => {
    expect(planSoundModesMigration(base, { ...base })).toEqual([]);
  });
});

/** The planner requirements, duplicated here so the checks do not reuse planner internals. */
function requirements(): Array<{ index: number; values: ReturnType<typeof migrationValue>[] } | null> {
  return [
    null,
    { index: 0, values: [migrationValue(0, "noiseCanceling")] },
    { index: 1, values: [migrationValue(1, "adaptive")] },
    { index: 1, values: [migrationValue(1, "manual")] },
    { index: 1, values: [migrationValue(1, "multiScene")] },
    {
      index: 0,
      values: [migrationValue(0, "noiseCanceling"), migrationValue(0, "transparency")],
    },
    null,
  ];
}

describe("controller parity", () => {
  it("does not send equalizer packets while TWS is disconnected", async () => {
    const device = new FakeA3959Device({ latencyMs: 5 });
    device.mutate((state) => {
      state.twsStatus = { hostDevice: "left", isConnected: false };
    }, false);
    const io = new PacketIo(device);
    const controller = await A3959Controller.connect({
      packetIo: io,
      profiles: memoryProfileStore(),
      t: (key) => key,
    });
    device.received.length = 0;
    await controller.setValue("volumeAdjustments", {
      type: "numbers",
      value: [10, 10, 10, 10, 10, 10, 10, 10],
    });
    await settle();
    expect(device.received.filter((packet) => packet.command[1] === 0x83)).toHaveLength(0);
    await controller.close();
    await io.close();
  });

  it("clears the dual connection device list when dual connections is disabled", async () => {
    const device = new FakeA3959Device({ latencyMs: 5 });
    const io = new PacketIo(device);
    const controller = await A3959Controller.connect({
      packetIo: io,
      profiles: memoryProfileStore(),
      t: (key) => key,
    });
    expect(controller.getState().dualConnections.devices.length).toBeGreaterThan(0);

    // The device turns dual connections off and reports a state update with no devices.
    device.mutate((state) => {
      state.dualConnectionsEnabled = false;
    });
    await settle();
    await controller.refresh();
    expect(controller.getState().dualConnections.devices).toEqual([]);
    await controller.close();
    await io.close();
  });
});
