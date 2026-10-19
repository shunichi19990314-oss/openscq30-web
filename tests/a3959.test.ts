/**
 * End to end tests for the A3959 (Soundcore P30i) port.
 *
 * The state update packets below are the real packets from openscq30-lib's
 * `lib/src/devices/soundcore/a3959.rs` tests (originally from GitHub issue #149), and the expected
 * values are the ones that file asserts.
 */

import { describe, expect, it } from "vitest";

import { PacketIo } from "../src/lib/packetIo";
import { createPacket } from "../src/lib/packet";
import {
  A3959Controller,
  type CustomEqualizerProfile,
  type CustomProfileStore,
} from "../src/devices/a3959/controller";
import { a3959StateUpdateBytes, parseA3959StateUpdate } from "../src/devices/a3959/state";
import { StubConnection } from "./support/stub";
import type { SettingDescriptor } from "../src/lib/settings";

const STATE_PACKET_BODY = [
  1, 1, 5, 6, 255, 255, 48, 49, 46, 54, 52, 48, 49, 46, 54, 52, 51, 57, 53, 57, 68, 69, 68, 54,
  54, 57, 50, 68, 66, 54, 70, 52, 254, 254, 101, 120, 161, 171, 171, 152, 144, 179, 120, 120, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 241, 240, 102, 102, 242, 243, 68, 68, 51, 0, 85, 0, 0, 1, 255, 1,
  49, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Same packet with TWS marked as disconnected. */
const STATE_PACKET_BODY_TWS_DISCONNECTED = STATE_PACKET_BODY.map((byte, index) =>
  index === 1 ? 0 : byte,
);

/** Same packet with firmware 01.59, which predates gaming mode. */
const STATE_PACKET_BODY_OLD_FIRMWARE = [
  1, 1, 5, 6, 255, 255, 48, 49, 46, 53, 57, 48, 49, 46, 53, 57, 51, 57, 53, 57, 68, 69, 68, 54,
  54, 57, 50, 68, 66, 54, 70, 52, 254, 254, 101, 120, 161, 171, 171, 152, 144, 179, 120, 120, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 241, 240, 102, 102, 242, 243, 68, 68, 51, 0, 85, 0, 0, 1, 255, 1,
  49, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Variant used by the equalizer test upstream: band 7 is 60 and band 8 is 179 -> 60. */
const STATE_PACKET_BODY_FOR_EQUALIZER = STATE_PACKET_BODY.map((byte, index) =>
  index === 41 ? 60 : byte,
);

function memoryProfileStore(): CustomProfileStore & { profiles: CustomEqualizerProfile[] } {
  const profiles: CustomEqualizerProfile[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    profiles,
    list: () => profiles.slice(),
    upsert: (name, volumeAdjustments) => {
      const existing = profiles.find((profile) => profile.name === name);
      if (existing) {
        existing.volumeAdjustments = volumeAdjustments;
      } else {
        profiles.push({ name, volumeAdjustments });
      }
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

const translate = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

async function connectDevice(body: number[]): Promise<{
  controller: A3959Controller;
  connection: StubConnection;
  store: ReturnType<typeof memoryProfileStore>;
}> {
  const stateResponse = () => createPacket([0x01, 0x01], body);
  const connection = new StubConnection({
    responses: StubConnection.responseMap([
      // the reset flow re-reads the state, so script a few copies
      [
        [0x01, 0x01],
        [stateResponse(), stateResponse(), stateResponse()],
      ],
      // one page, no devices
      [[0x0b, 0x01], [createPacket([0x0b, 0x01], [1, 1])]],
    ]),
  });
  const packetIo = new PacketIo(connection);
  const store = memoryProfileStore();
  const controller = await A3959Controller.connect({ packetIo, profiles: store, t: translate });
  return { controller, connection, store };
}

function settingById(descriptors: SettingDescriptor[], id: string): SettingDescriptor {
  const descriptor = descriptors.find((candidate) => candidate.id === id);
  if (!descriptor) throw new Error(`setting ${id} was not found`);
  return descriptor;
}

function selectValue(descriptor: SettingDescriptor): string | null {
  const setting = descriptor.setting;
  if (setting.kind !== "select" && setting.kind !== "optionalSelect") {
    throw new Error(`setting ${descriptor.id} is not a select`);
  }
  return setting.select.value;
}

function toggleValue(descriptor: SettingDescriptor): boolean {
  if (descriptor.setting.kind !== "toggle") {
    throw new Error(`setting ${descriptor.id} is not a toggle`);
  }
  return descriptor.setting.value;
}

function informationValue(descriptor: SettingDescriptor): string {
  if (descriptor.setting.kind !== "information") {
    throw new Error(`setting ${descriptor.id} is not information`);
  }
  return descriptor.setting.value;
}

describe("parsing the state update packet", () => {
  it("parses the packet from github issue 149", () => {
    const parsed = parseA3959StateUpdate(Uint8Array.from(STATE_PACKET_BODY));
    expect(parsed.twsStatus).toEqual({ hostDevice: "right", isConnected: true });
    expect(parsed.dualBattery.left).toEqual({ level: 5, isCharging: false });
    expect(parsed.dualBattery.right).toEqual({ level: 6, isCharging: false });
    expect(parsed.serialNumber).toBe("3959DED6692DB6F4");
    expect(parsed.equalizerConfiguration.presetId).toBe(0xfefe);
    expect(parsed.equalizerConfiguration.channels[0]?.values).toEqual([
      -19, 0, 41, 51, 51, 32, 24, 59, 0, 0,
    ]);
    expect(parsed.soundModes.ambientSoundMode).toBe("noiseCanceling");
    expect(parsed.soundModes.noiseCancelingMode).toBe("manual");
    expect(parsed.soundModes.manualNoiseCanceling).toBe(5);
    expect(parsed.soundModes.adaptiveNoiseCanceling).toBe(5);
    expect(parsed.soundModes.multiSceneAnc).toBe("outdoor");
    expect(parsed.soundModes.windNoise.isSuppressionEnabled).toBe(true);
    expect(parsed.soundModes.noiseCancelingAdaptiveSensitivityLevel).toBe(255);
    expect(parsed.touchTone).toBe(true);
    expect(parsed.dualConnectionsEnabled).toBe(true);
    expect(parsed.surroundSound).toBe(false);
    expect(parsed.autoPowerOff).toEqual({ isEnabled: true, durationIndex: 0 });
    expect(parsed.lowBatteryPrompt).toBe(true);
    expect(parsed.gamingMode).toBe(false);
  });

  it("round trips the modeled fields through the serializer", () => {
    // Unknown/reserved bytes are not kept, exactly like openscq30-lib's `ToPacket` implementation,
    // so the check is that serializing is stable and that the modeled fields keep their offsets.
    const parsed = parseA3959StateUpdate(Uint8Array.from(STATE_PACKET_BODY));
    const first = Array.from(a3959StateUpdateBytes(parsed));
    const second = Array.from(a3959StateUpdateBytes(parseA3959StateUpdate(Uint8Array.from(first))));
    expect(second).toEqual(first);
    expect(first).toHaveLength(STATE_PACKET_BODY.length);
    // tws status, battery levels
    expect(first.slice(0, 4)).toEqual([1, 1, 5, 6]);
    // equalizer preset id and adjustments
    expect(first.slice(32, 44)).toEqual(STATE_PACKET_BODY.slice(32, 44));
    // button configuration
    expect(first.slice(55, 63)).toEqual(STATE_PACKET_BODY.slice(55, 63));
    // sound modes
    expect(first.slice(64, 71)).toEqual(STATE_PACKET_BODY.slice(64, 71));
    // touch tone, dual connections, surround sound, auto power off, low battery prompt, gaming mode
    expect(first.slice(72, 79)).toEqual(STATE_PACKET_BODY.slice(72, 79));
  });

  it("hides gaming mode on firmware older than 01.60", () => {
    const parsed = parseA3959StateUpdate(Uint8Array.from(STATE_PACKET_BODY_OLD_FIRMWARE));
    expect(parsed.gamingMode).toBeNull();
  });
});

describe("A3959Controller settings", () => {
  it("exposes the values openscq30-lib asserts for this packet", async () => {
    const { controller } = await connectDevice(STATE_PACKET_BODY);
    const descriptors = controller.getSettings();

    expect(informationValue(settingById(descriptors, "batteryLevelLeft"))).toContain("5/10");
    expect(informationValue(settingById(descriptors, "batteryLevelRight"))).toContain("6/10");
    expect(informationValue(settingById(descriptors, "isChargingLeft"))).toBe("not-charging");
    expect(informationValue(settingById(descriptors, "isChargingRight"))).toBe("not-charging");
    expect(selectValue(settingById(descriptors, "ambientSoundMode"))).toBe("noiseCanceling");
    expect(informationValue(settingById(descriptors, "adaptiveNoiseCanceling"))).toBe("5/5");
    expect(settingById(descriptors, "manualNoiseCanceling").setting).toMatchObject({
      kind: "range",
      value: 5,
    });
    expect(selectValue(settingById(descriptors, "multiSceneNoiseCanceling"))).toBe("outdoor");
    expect(toggleValue(settingById(descriptors, "windNoiseSuppression"))).toBe(true);
    expect(selectValue(settingById(descriptors, "leftSinglePress"))).toBe("VolumeDown");
    expect(selectValue(settingById(descriptors, "leftDoublePress"))).toBe("PlayPause");
    expect(selectValue(settingById(descriptors, "leftTriplePress"))).toBe("PreviousSong");
    expect(selectValue(settingById(descriptors, "leftLongPress"))).toBe("AmbientSoundMode");
    expect(selectValue(settingById(descriptors, "rightSinglePress"))).toBe("VolumeUp");
    expect(selectValue(settingById(descriptors, "rightDoublePress"))).toBe("PlayPause");
    expect(selectValue(settingById(descriptors, "rightTriplePress"))).toBe("NextSong");
    expect(selectValue(settingById(descriptors, "rightLongPress"))).toBe("AmbientSoundMode");
    expect(toggleValue(settingById(descriptors, "touchTone"))).toBe(true);
    expect(selectValue(settingById(descriptors, "autoPowerOff"))).toBe("10m");
    expect(toggleValue(settingById(descriptors, "surroundSound"))).toBe(false);
    expect(toggleValue(settingById(descriptors, "dualConnections"))).toBe(true);
    expect(toggleValue(settingById(descriptors, "gamingMode"))).toBe(false);
    expect(informationValue(settingById(descriptors, "serialNumber"))).toBe("3959DED6692DB6F4");
    expect(informationValue(settingById(descriptors, "firmwareVersionLeft"))).toBe("01.64");
    await controller.close();
  });

  it("reports buttons as unset for the side that is not connected", async () => {
    const { controller } = await connectDevice(STATE_PACKET_BODY_TWS_DISCONNECTED);
    const descriptors = controller.getSettings();
    expect(selectValue(settingById(descriptors, "leftSinglePress"))).toBeNull();
    expect(selectValue(settingById(descriptors, "leftDoublePress"))).toBe("PlayPause");
    expect(selectValue(settingById(descriptors, "leftTriplePress"))).toBeNull();
    expect(selectValue(settingById(descriptors, "leftLongPress"))).toBe("AmbientSoundMode");
    expect(selectValue(settingById(descriptors, "rightSinglePress"))).toBeNull();
    expect(selectValue(settingById(descriptors, "rightDoublePress"))).toBe("PlayPause");
    expect(selectValue(settingById(descriptors, "rightTriplePress"))).toBeNull();
    expect(selectValue(settingById(descriptors, "rightLongPress"))).toBe("AmbientSoundMode");
    // The equalizer is unavailable while TWS is disconnected.
    expect(settingById(descriptors, "volumeAdjustments").setting).toMatchObject({
      kind: "information",
    });
    await controller.close();
  });

  it("does not offer gaming mode on old firmware", async () => {
    const { controller } = await connectDevice(STATE_PACKET_BODY_OLD_FIRMWARE);
    const descriptors = controller.getSettings();
    expect(descriptors.some((descriptor) => descriptor.id === "gamingMode")).toBe(false);
    await controller.close();
  });
});

describe("A3959Controller writes", () => {
  it("sends the surround sound packet", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValue("surroundSound", { type: "bool", value: true });
    expect(connection.sentSummary()).toContainEqual({ command: "2,134", body: [1] });
    expect(toggleValue(settingById(controller.getSettings(), "surroundSound"))).toBe(true);
    await controller.close();
  });

  it("sends the manual noise canceling packet", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValue("manualNoiseCanceling", { type: "number", value: 2 });
    expect(connection.sentSummary()).toContainEqual({
      command: "6,129",
      body: [0, 37, 0, 0, 1, 255, 1],
    });
    await controller.close();
  });

  it("sends one packet per changed button", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValues([
      ["leftSinglePress", { type: "string", value: "VolumeUp" }],
      ["rightSinglePress", { type: "string", value: "VolumeDown" }],
    ]);
    const buttonPackets = connection
      .sentSummary()
      .filter((packet) => packet.command === "4,129")
      .map((packet) => packet.body);
    expect(buttonPackets).toEqual(
      expect.arrayContaining([
        [0, 2, 0xf0],
        [1, 2, 0xf1],
      ]),
    );
    expect(buttonPackets).toHaveLength(2);
    await controller.close();
  });

  it("disables a button by writing action 0xf", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValue("leftSinglePress", { type: "string", value: null });
    expect(connection.sentSummary()).toContainEqual({ command: "4,129", body: [0, 2, 0xff] });
    await controller.close();
  });

  it("sends the equalizer with drc", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY_FOR_EQUALIZER);
    await controller.setValue("volumeAdjustments", {
      type: "numbers",
      value: [-19, 0, 41, 51, 51, 32, 13, -35],
    });
    expect(connection.sentSummary()).toContainEqual({
      command: "2,131",
      body: [
        254, 254, 101, 120, 161, 171, 171, 152, 133, 85, 120, 120, 118, 119, 124, 123, 124, 121,
        123, 114, 120, 0,
      ],
    });
    await controller.close();
  });

  it("applies a preset equalizer profile", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValue("presetEqualizerProfile", { type: "string", value: "BassBooster" });
    const packet = connection.sentSummary().find((entry) => entry.command === "2,131");
    expect(packet?.body.slice(0, 12)).toEqual([2, 0, 160, 150, 130, 120, 120, 120, 120, 120, 120, 0]);
    await controller.close();
  });

  it("resets the buttons to default and refreshes the state", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValue("resetButtonsToDefault", { type: "action" });
    const commands = connection.sent.map((packet) => `${packet.command[0]},${packet.command[1]}`);
    expect(commands).toContain("4,130");
    expect(commands.filter((command) => command === "1,1").length).toBeGreaterThanOrEqual(2);
    // After the reset, button changes are applied again (the pending flag is cleared).
    connection.sent.length = 0;
    await controller.setValue("leftSinglePress", { type: "string", value: "VolumeUp" });
    expect(connection.sentSummary()).toContainEqual({ command: "4,129", body: [0, 2, 0xf0] });
    await controller.close();
  });

  it("sends the auto power off packet", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    await controller.setValue("autoPowerOff", { type: "string", value: "30m" });
    expect(connection.sentSummary()).toContainEqual({ command: "1,134", body: [1, 2] });
    await controller.setValue("autoPowerOff", { type: "string", value: "disabled" });
    expect(connection.sentSummary()).toContainEqual({ command: "1,134", body: [0, 2] });
    await controller.close();
  });

  it("migrates sound modes through intermediate states", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    // Current: ambient=noiseCanceling, ncMode=manual. Changing the multi scene ANC requires
    // switching the nc mode to multiScene first, which the planner does as a single step here.
    await controller.setValue("multiSceneNoiseCanceling", { type: "string", value: "indoor" });
    const soundModePackets = connection
      .sentSummary()
      .filter((packet) => packet.command === "6,129");
    // The multi scene value can only be written while the ANC mode is multiScene, so the planner
    // switches the mode first, writes the value, then returns to the requested ANC mode.
    expect(soundModePackets.map((packet) => packet.body[3])).toEqual([2, 2, 0]);
    expect(soundModePackets.map((packet) => packet.body[6])).toEqual([1, 2, 2]);
    expect(controller.getState().soundModes.multiSceneAnc).toBe("indoor");
    expect(controller.getState().soundModes.noiseCancelingMode).toBe("manual");
    await controller.close();
  });

  it("handles unsolicited state updates", async () => {
    const { controller, connection } = await connectDevice(STATE_PACKET_BODY);
    connection.sendInbound(createPacket([0x01, 0x03], [7, 8]));
    expect(controller.getState().dualBattery.left.level).toBe(7);
    expect(controller.getState().dualBattery.right.level).toBe(8);

    connection.sendInbound(createPacket([0x01, 0x02], [0, 0]));
    expect(controller.getState().twsStatus).toEqual({ hostDevice: "left", isConnected: false });

    connection.sendInbound(createPacket([0x06, 0x01], [2, 0x21, 2, 0, 0, 0, 0]));
    expect(controller.getState().soundModes.ambientSoundMode).toBe("normal");

    connection.sendInbound(createPacket([0x01, 0x11], [1]));
    expect(controller.getState().gamingMode).toBe(true);
    await controller.close();
  });
});
