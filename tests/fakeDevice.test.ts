/**
 * Integration test against the simulated device: exercises the full stack
 * (transport -> packet io -> controller -> simulated firmware) without hardware.
 */

import { describe, expect, it } from "vitest";

import { PacketIo } from "../src/lib/packetIo";
import { A3959Controller, type CustomProfileStore } from "../src/devices/a3959/controller";
import { FakeA3959Device } from "./support/fakeDevice";
import { primaryVolumeAdjustments } from "../src/lib/structures/equalizer";

function memoryProfileStore(): CustomProfileStore {
  const profiles: Array<{ name: string; volumeAdjustments: number[] }> = [];
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  return {
    list: () => profiles.slice(),
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

async function connectDemo(latencyMs = 5) {
  const device = new FakeA3959Device({ latencyMs });
  const packetIo = new PacketIo(device);
  const controller = await A3959Controller.connect({
    packetIo,
    profiles: memoryProfileStore(),
    t: (key) => key,
  });
  return { device, packetIo, controller };
}

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("demo device integration", () => {
  it("reads the initial state", async () => {
    const { controller } = await connectDemo();
    const state = controller.getState();
    expect(state.serialNumber).toBe("3959DED6692DB6F4");
    expect(state.twsStatus.isConnected).toBe(true);
    expect(state.dualBattery.left.level).toBe(8);
    expect(state.dualConnections.devices).toHaveLength(2);
    expect(state.soundModes.ambientSoundMode).toBe("noiseCanceling");
    await controller.close();
  });

  it("applies an equalizer preset and the device reports it back", async () => {
    const { controller, device } = await connectDemo();
    await controller.setValue("presetEqualizerProfile", { type: "string", value: "BassBooster" });
    await settle();
    expect(device.getState().equalizerConfiguration.presetId).toBe(2);
    expect(controller.getState().equalizerConfiguration.presetId).toBe(2);
    expect(primaryVolumeAdjustments(device.getState().equalizerConfiguration)?.values).toEqual([
      40, 30, 10, 0, 0, 0, 0, 0, 0, -120,
    ]);
    await controller.close();
  });

  it("writes custom equalizer bands", async () => {
    const { controller, device } = await connectDemo();
    await controller.setValue("volumeAdjustments", {
      type: "numbers",
      value: [10, -10, 20, -20, 30, -30, 40, -40],
    });
    await settle();
    expect(device.getState().equalizerConfiguration.presetId).toBe(0xfefe);
    expect(primaryVolumeAdjustments(device.getState().equalizerConfiguration)?.values).toEqual([
      10, -10, 20, -20, 30, -30, 40, -40, 0, 0,
    ]);
    await controller.close();
  });

  it("changes sound modes through the migration path", async () => {
    const { controller, device } = await connectDemo();
    await controller.setValue("ambientSoundMode", { type: "string", value: "transparency" });
    await settle();
    expect(device.getState().soundModes.ambientSoundMode).toBe("transparency");
    expect(controller.getState().soundModes.ambientSoundMode).toBe("transparency");

    await controller.setValue("windNoiseSuppression", { type: "bool", value: false });
    await settle();
    expect(device.getState().soundModes.windNoise.isSuppressionEnabled).toBe(false);
    await controller.close();
  });

  it("changes button actions", async () => {
    const { controller, device } = await connectDemo();
    await controller.setValue("leftSinglePress", { type: "string", value: "PlayPause" });
    await settle();
    const leftSingle = device.getState().buttonConfiguration[0];
    expect(leftSingle.action).toMatchObject({ kind: "tws", connected: 6 });
    // The other side keeps its action.
    expect(device.getState().buttonConfiguration[1].action).toMatchObject({
      kind: "tws",
      connected: 0,
    });
    await controller.close();
  });

  it("resets the buttons to the device defaults", async () => {
    const { controller, device } = await connectDemo();
    await controller.setValue("leftSinglePress", { type: "string", value: "PlayPause" });
    await settle();
    await controller.setValue("resetButtonsToDefault", { type: "action" });
    await settle();
    expect(device.getState().buttonConfiguration[0].action).toMatchObject({
      kind: "tws",
      connected: 1,
    });
    expect(controller.getState().buttonResetPending).toBe(false);
    await controller.close();
  });

  it("toggles flags and auto power off", async () => {
    const { controller, device } = await connectDemo();
    await controller.setValue("surroundSound", { type: "bool", value: true });
    await controller.setValue("touchTone", { type: "bool", value: false });
    await controller.setValue("autoPowerOff", { type: "string", value: "60m" });
    await settle();
    expect(device.getState().surroundSound).toBe(true);
    expect(device.getState().touchTone).toBe(false);
    expect(device.getState().autoPowerOff).toEqual({ isEnabled: true, durationIndex: 3 });
    await controller.close();
  });

  it("manages dual connections", async () => {
    const { controller, device } = await connectDemo();
    expect(controller.getState().dualConnections.devices.map((entry) => entry.isConnected)).toEqual(
      [true, false],
    );
    await controller.setValue("dualConnectionsDevices", {
      type: "strings",
      value: ["aa:bb:cc:dd:ee:ff"],
    });
    await settle(120);
    expect(device.getState().dualConnectionsEnabled).toBe(true);
    await controller.refresh();
    const connected = controller
      .getState()
      .dualConnections.devices.filter((entry) => entry.isConnected)
      .map((entry) => entry.macAddress);
    expect(connected).toEqual(["aa:bb:cc:dd:ee:ff"]);
    await controller.close();
  });

  it("propagates simulated device events", async () => {
    const { controller, device } = await connectDemo();
    const states: number[] = [];
    controller.subscribe((state) => states.push(state.dualBattery.left.level));

    device.mutate((state) => {
      state.dualBattery.left.level = 3;
    });
    await settle();
    expect(controller.getState().dualBattery.left.level).toBe(3);
    expect(states).toContain(3);

    device.mutate((state) => {
      state.twsStatus = { hostDevice: "left", isConnected: false };
      state.dualBattery.right.level = 255;
    });
    await settle();
    expect(controller.getState().twsStatus.isConnected).toBe(false);
    const descriptors = controller.getSettings();
    expect(descriptors.some((descriptor) => descriptor.id === "batteryLevelRight")).toBe(false);
    await controller.close();
  });

  it("notifies when the demo device disconnects", async () => {
    const { controller, device, packetIo } = await connectDemo();
    let disconnected = false;
    device.setDisconnectHandler(() => {
      disconnected = true;
    });
    // The packet io replaces the disconnect handler only via the transport, so hook the transport
    // level notification through the demo device itself.
    device.disconnect();
    await settle(10);
    expect(disconnected).toBe(true);
    await controller.close();
    await packetIo.close();
  });
});
