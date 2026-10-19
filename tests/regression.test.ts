/**
 * Regression tests for behaviour that is easy to break silently: translations, preset round trips,
 * concurrent writes and disconnecting while a write is in flight.
 */

import { describe, expect, it } from "vitest";

import { PacketIo } from "../src/lib/packetIo";
import {
  A3959Controller,
  importCustomProfiles,
  type CustomProfileStore,
} from "../src/devices/a3959/controller";
import { FakeA3959Device } from "./support/fakeDevice";
import { StubConnection } from "./support/stub";
import { Session, settingToValue, PRESETTABLE_SETTING_IDS } from "../src/session/session";
import { LocalStorageProfileStore, QuickPresetStore } from "../src/session/storage";
import { SETTING_LABEL_KEYS, createTranslator } from "../src/i18n";
import { planSoundModesMigration } from "../src/devices/a3959/soundModes";
import type { A3959SoundModes } from "../src/devices/a3959/soundModes";
import { a3959StateUpdateBytes } from "../src/devices/a3959/state";
import { createPacket } from "../src/lib/packet";

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function memoryProfileStore(): CustomProfileStore {
  let profiles: Array<{ name: string; volumeAdjustments: number[] }> = [];
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  return {
    list: () => profiles,
    upsert: (name, volumeAdjustments) => {
      const existing = profiles.find((profile) => profile.name === name);
      profiles = existing
        ? profiles.map((profile) =>
            profile.name === name ? { name, volumeAdjustments } : profile,
          )
        : [...profiles, { name, volumeAdjustments }];
      notify();
    },
    remove: (name) => {
      profiles = profiles.filter((profile) => profile.name !== name);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function connectDemo(latencyMs = 5) {
  const device = new FakeA3959Device({ latencyMs });
  const packetIo = new PacketIo(device);
  const profiles = memoryProfileStore();
  const controller = await A3959Controller.connect({
    packetIo,
    profiles,
    t: createTranslator("ja"),
  });
  return { device, packetIo, controller, profiles };
}

describe("migration planner edge cases", () => {
  const base: A3959SoundModes = {
    ambientSoundMode: "noiseCanceling",
    noiseCancelingMode: "manual",
    adaptiveNoiseCanceling: 3,
    manualNoiseCanceling: 3,
    multiSceneAnc: "outdoor",
    windNoise: { isSuppressionEnabled: true, isDetected: false },
    noiseCancelingAdaptiveSensitivityLevel: 5,
  };

  it("routes through noise canceling to change wind noise while in normal mode", () => {
    const from: A3959SoundModes = { ...base, ambientSoundMode: "normal" };
    const to: A3959SoundModes = {
      ...from,
      windNoise: { isSuppressionEnabled: false, isDetected: false },
    };
    const path = planSoundModesMigration(from, to);
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[path.length - 1]).toEqual(to);
    // The intermediate step must leave normal mode, otherwise the device would reject the change.
    expect(path[0].ambientSoundMode).not.toBe("normal");
  });

  it("changes the sensitivity level without touching other fields", () => {
    const path = planSoundModesMigration(base, {
      ...base,
      noiseCancelingAdaptiveSensitivityLevel: 9,
    });
    expect(path).toHaveLength(1);
    expect(path[0].noiseCancelingAdaptiveSensitivityLevel).toBe(9);
    expect(path[0].ambientSoundMode).toBe("noiseCanceling");
  });
});

describe("i18n coverage", () => {
  it("translates every setting label and option in both languages", async () => {
    const { controller } = await connectDemo();
    for (const language of ["ja", "en"] as const) {
      const t = createTranslator(language);
      for (const descriptor of controller.getSettings()) {
        const key = SETTING_LABEL_KEYS[descriptor.id];
        expect(key, `no label key for ${descriptor.id}`).toBeDefined();
        const label = t(key);
        expect(label, `${language}: ${key} was not translated`).not.toBe(key);
        expect(label.length).toBeGreaterThan(0);

        const setting = descriptor.setting;
        const isUserNamed =
          descriptor.id === "customEqualizerProfile" || descriptor.id === "dualConnectionsDevices";
        if (!isUserNamed && "select" in setting) {
          for (const option of setting.select.options) {
            expect(option.label, `${language}: option ${option.value}`).not.toBe(option.value);
            expect(option.label.length).toBeGreaterThan(0);
          }
        }
      }
    }
    await controller.close();
  });

  it("has a category label for every category the controller emits", async () => {
    const { controller } = await connectDemo();
    const categories = new Set(controller.getSettings().map((descriptor) => descriptor.category));
    for (const language of ["ja", "en"] as const) {
      const t = createTranslator(language);
      for (const category of categories) {
        const key = `category-${category}`;
        expect(t(key), `${language}: ${key}`).not.toBe(key);
      }
    }
    await controller.close();
  });
});

describe("custom equalizer profiles", () => {
  it("round trips through the upstream export format", () => {
    const store = memoryProfileStore();
    store.upsert("My EQ", [-60, 60, 23, 120, 22, -120, -4, 16]);
    const exported = JSON.stringify([
      {
        name: "My EQ",
        volumeAdjustments: [-6, 6, 2.3, 12, 2.2, -12, -0.4, 1.6],
      },
    ]);
    const target = memoryProfileStore();
    importCustomProfiles(exported, target);
    expect(target.list()).toEqual([
      { name: "My EQ", volumeAdjustments: [-60, 60, 23, 120, 22, -120, -4, 16] },
    ]);
  });

  it("rejects malformed json with a clear error", () => {
    const store = memoryProfileStore();
    expect(() => importCustomProfiles("not json", store)).toThrow(/invalid JSON/);
    expect(() => importCustomProfiles('{"name":"x"}', store)).toThrow(/array/);
    expect(() => importCustomProfiles('[{"name":1,"volumeAdjustments":[]}]', store)).toThrow(
      /name/,
    );
    expect(store.list()).toEqual([]);
  });

  it("saves the current equalizer as a profile and applies it back", async () => {
    const { controller, profiles } = await connectDemo();
    await controller.setValue("volumeAdjustments", {
      type: "numbers",
      value: [11, -12, 13, -14, 15, -16, 17, -18],
    });
    await controller.setValue("customEqualizerProfile", { type: "add", name: "Saved" });
    expect(profiles.list()).toEqual([
      { name: "Saved", volumeAdjustments: [11, -12, 13, -14, 15, -16, 17, -18] },
    ]);

    // Move somewhere else, then apply the saved profile again.
    await controller.setValue("presetEqualizerProfile", { type: "string", value: "Rock" });
    await controller.setValue("customEqualizerProfile", { type: "string", value: "Saved" });
    await settle();
    const state = controller.getState();
    expect(state.equalizerConfiguration.presetId).toBe(0xfefe);
    expect(state.equalizerConfiguration.channels[0]?.values.slice(0, 8)).toEqual([
      11, -12, 13, -14, 15, -16, 17, -18,
    ]);
    await controller.close();
  });
});

describe("quick presets", () => {
  it("captures the current settings and restores them", async () => {
    const { controller } = await connectDemo();
    await controller.setValue("ambientSoundMode", { type: "string", value: "transparency" });
    await controller.setValue("touchTone", { type: "bool", value: false });
    await settle();

    const descriptors = controller.getSettings();
    const captured = descriptors
      .filter((descriptor) => PRESETTABLE_SETTING_IDS.includes(descriptor.id))
      .map((descriptor) => ({ id: descriptor.id, value: settingToValue(descriptor)! }))
      .filter((entry) => entry.value !== null);
    expect(captured.length).toBeGreaterThan(10);

    // Change a few things, then restore from the capture.
    await controller.setValue("ambientSoundMode", { type: "string", value: "normal" });
    await controller.setValue("touchTone", { type: "bool", value: true });
    await settle();
    expect(controller.getState().soundModes.ambientSoundMode).toBe("normal");

    await controller.setValues(
      captured
        .filter((entry) => entry.value.type !== "string" || entry.value.value !== null)
        .map((entry) => [entry.id, entry.value] as [never, never]),
    );
    await settle();
    expect(controller.getState().soundModes.ambientSoundMode).toBe("transparency");
    expect(controller.getState().touchTone).toBe(false);
    await controller.close();
  });

  it("persists quick presets and profiles in the stores", () => {
    // localStorage is unavailable in Node; the stores must fall back to memory instead of throwing.
    const presets = new QuickPresetStore();
    const saved = presets.save("Night", [{ id: "touchTone", value: { type: "bool", value: false } }]);
    expect(presets.list()).toHaveLength(1);
    presets.remove(saved.id);
    expect(presets.list()).toHaveLength(0);

    const profiles = new LocalStorageProfileStore();
    profiles.upsert("A", [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(profiles.list()).toEqual([{ name: "A", volumeAdjustments: [1, 2, 3, 4, 5, 6, 7, 8] }]);
    profiles.remove("A");
    expect(profiles.list()).toEqual([]);
  });
});

describe("concurrency and disconnection", () => {
  it("serializes concurrent setting changes", async () => {
    const { controller, device } = await connectDemo(20);
    await Promise.all([
      controller.setValue("touchTone", { type: "bool", value: false }),
      controller.setValue("surroundSound", { type: "bool", value: true }),
      controller.setValue("autoPowerOff", { type: "string", value: "20m" }),
    ]);
    await settle();
    expect(device.getState().touchTone).toBe(false);
    expect(device.getState().surroundSound).toBe(true);
    expect(device.getState().autoPowerOff).toEqual({ isEnabled: true, durationIndex: 1 });
    expect(controller.getState().touchTone).toBe(false);
    expect(controller.getState().surroundSound).toBe(true);
    await controller.close();
  });

  it("rejects an in-flight change when the connection closes instead of hanging", async () => {
    // A device that answers the initial state request and then goes quiet, so the write below is
    // still pending when the connection is closed.
    const stateBody = a3959StateUpdateBytes(new FakeA3959Device().getState());
    const connection = new StubConnection({
      ackUnscripted: false,
      responses: StubConnection.responseMap([
        [[0x01, 0x01], [createPacket([0x01, 0x01], stateBody)]],
        [[0x0b, 0x01], [createPacket([0x0b, 0x01], [1, 1])]],
      ]),
    });
    const packetIo = new PacketIo(connection, "suffix", { baseTimeoutMs: 30000 });
    const controller = await A3959Controller.connect({
      packetIo,
      profiles: memoryProfileStore(),
      t: createTranslator("ja"),
    });

    // The simulated default is `true`, so this is a real change that needs a round trip.
    expect(controller.getState().touchTone).toBe(true);
    const pending = controller.setValue("touchTone", { type: "bool", value: false });
    await settle(10);
    await packetIo.close();
    await expect(pending).rejects.toThrow(/closed/i);
    await controller.close();
  });
});

describe("session lifecycle", () => {
  it("connects through an injected transport and reflects its updates", async () => {
    const t = createTranslator("ja");
    const session = new Session({ profiles: memoryProfileStore(), t });
    const fake = new FakeA3959Device({ latencyMs: 5 });
    await session.connectWith(fake, "fake");
    expect(session.getSnapshot().status).toBe("connected");
    expect(session.getSnapshot().connectionKind).toBe("serial");
    expect(session.getSnapshot().state?.serialNumber).toBe("3959DED6692DB6F4");

    fake.mutate((state) => {
      state.dualBattery.left.level = 3;
    });
    await settle();
    expect(session.getSnapshot().state?.dualBattery.left.level).toBe(3);

    fake.mutate((state) => {
      state.twsStatus = { hostDevice: "left", isConnected: false };
      state.dualBattery.right.level = 255;
    });
    await settle();
    const snapshot = session.getSnapshot();
    expect(snapshot.state?.twsStatus.isConnected).toBe(false);
    // With TWS disconnected the equalizer settings disappear.
    expect(snapshot.settings.some((descriptor) => descriptor.id === "presetEqualizerProfile")).toBe(
      false,
    );

    await session.disconnect();
    expect(session.getSnapshot().status).toBe("idle");
    expect(session.getSnapshot().state).toBeNull();
  });

  it("rejects a connection that never answers and reports the error", async () => {
    const t = createTranslator("ja");
    const session = new Session({ profiles: memoryProfileStore(), t });
    const connection = new StubConnection({ ackUnscripted: false });
    await expect(session.connectWith(connection, "fake")).rejects.toThrow(/timed out/);
    expect(session.getSnapshot().status).toBe("error");
    expect(session.getSnapshot().state).toBeNull();
    await session.disconnect();
    expect(session.getSnapshot().status).toBe("idle");
  });
});
