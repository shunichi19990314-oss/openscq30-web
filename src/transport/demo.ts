/**
 * In-browser demo device.
 *
 * openscq30-lib ships a `DemoConnectionRegistry` that answers request state with a canned packet
 * and ACKs everything else. This goes a bit further and actually simulates a Soundcore P30i, so the
 * whole UI can be used (and tested) without hardware: every write is applied to the simulated state
 * and pushed back as a state update, just like a real device does.
 */

import {
  ackPacket,
  commandKey,
  createPacket,
  encodePacket,
  takePacket,
  type Packet,
} from "../lib/packet";
import { ByteReader, concatBytes } from "../lib/bytes";
import type { TransportConnection } from "./transport";
import {
  a3959StateUpdatePacketToInbound,
  defaultA3959StateUpdatePacket,
  parseA3959StateUpdate,
  type A3959StateUpdatePacket,
} from "../devices/a3959/state";
import { A3959_BUTTON_CONFIGURATION } from "../devices/a3959/buttons";
import {
  A3959_EQUALIZER_CONFIG,
  parseEqualizerConfiguration,
} from "../lib/structures/equalizer";
import {
  defaultButtonStatusCollection,
  type ButtonStatusCollection,
} from "../lib/structures/buttons";
import {
  dualConnectionsDeviceBytes,
  type DualConnectionsDevice,
} from "../lib/structures/common";
import { parseA3959SoundModes } from "../devices/a3959/soundModes";
import * as commands from "../devices/a3959/packets";

export interface DemoDeviceOptions {
  /** Initial state. Defaults to a realistic P30i state. */
  state?: Partial<A3959StateUpdatePacket>;
  /** Simulated round trip time in milliseconds. */
  latencyMs?: number;
  /** Dual connection devices to report. */
  dualConnectionDevices?: DualConnectionsDevice[];
  onLog?: (message: string, data?: unknown) => void;
}

const DEFAULT_DEMO_DEVICES: DualConnectionsDevice[] = [
  {
    isConnected: true,
    macAddress: "12:34:56:78:9a:bc",
    name: "Pixel 8 Pro",
  },
  {
    isConnected: false,
    macAddress: "aa:bb:cc:dd:ee:ff",
    name: "Desktop PC",
  },
];

function defaultDemoState(): A3959StateUpdatePacket {
  const base = defaultA3959StateUpdatePacket();
  return {
    ...base,
    twsStatus: { hostDevice: "right", isConnected: true },
    dualBattery: {
      left: { level: 8, isCharging: false },
      right: { level: 7, isCharging: false },
    },
    dualFirmwareVersion: {
      kind: "both",
      left: { major: 1, minor: 64 },
      right: { major: 1, minor: 64 },
    },
    serialNumber: "3959DED6692DB6F4",
    equalizerConfiguration: {
      presetId: 0,
      channels: [{ values: [0, 0, 0, 0, 0, 0, 0, 0, 0, -120] }],
    },
    soundModes: {
      ambientSoundMode: "noiseCanceling",
      noiseCancelingMode: "adaptive",
      adaptiveNoiseCanceling: 3,
      manualNoiseCanceling: 3,
      multiSceneAnc: "outdoor",
      windNoise: { isSuppressionEnabled: true, isDetected: false },
      noiseCancelingAdaptiveSensitivityLevel: 5,
    },
    touchTone: true,
    lowBatteryPrompt: true,
    surroundSound: false,
    gamingMode: false,
    autoPowerOff: { isEnabled: true, durationIndex: 2 },
    dualConnectionsEnabled: true,
    buttonConfiguration: defaultDemoButtons(),
  };
}

function defaultDemoButtons(): ButtonStatusCollection {
  // Left: volume down / play pause / previous song / ambient sound mode
  // Right: volume up / play pause / next song / ambient sound mode
  const statuses = defaultButtonStatusCollection(A3959_BUTTON_CONFIGURATION);
  const actions: Record<string, [number, number]> = {
    // button id: [connected nibble, disconnected nibble]
    "2,left": [1, 0xf],
    "2,right": [0, 0xf],
    "0,left": [6, 6],
    "0,right": [6, 6],
    "5,left": [2, 0xf],
    "5,right": [3, 0xf],
    "1,left": [4, 4],
    "1,right": [4, 4],
  };
  A3959_BUTTON_CONFIGURATION.order.forEach((button, index) => {
    const settings = A3959_BUTTON_CONFIGURATION.settings.find(
      (entry) => entry.pressKind === buttonPressKindOf(button),
    )!;
    const side = button.startsWith("left") ? "left" : "right";
    const [connected, disconnected] = actions[`${settings.buttonId},${side}`] ?? [0xf, 0xf];
    statuses[index] = {
      enabled: null,
      action: { kind: "tws", connected, disconnected },
    };
  });
  return statuses;
}

function buttonPressKindOf(button: string): string {
  if (button.includes("SinglePress")) return "single";
  if (button.includes("DoublePress")) return "double";
  if (button.includes("TriplePress")) return "triple";
  if (button.includes("LongPress")) return "long";
  if (button.includes("SlideUp")) return "slideUp";
  return "slideDown";
}

export class DemoA3959Device implements TransportConnection {
  readonly name = "Soundcore P30i (demo)";
  private state: A3959StateUpdatePacket;
  private dualConnectionDevices: DualConnectionsDevice[];
  private readHandler: ((data: Uint8Array) => void) | null = null;
  private disconnectHandler: ((reason?: unknown) => void) | null = null;
  private closed = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Every packet written by the app, for the debug console. */
  readonly received: Packet[] = [];

  constructor(private readonly options: DemoDeviceOptions = {}) {
    this.state = { ...defaultDemoState(), ...(options.state ?? {}) };
    this.dualConnectionDevices = (options.dualConnectionDevices ?? DEFAULT_DEMO_DEVICES).map(
      (device) => ({ ...device }),
    );
  }

  setReadHandler(handler: (data: Uint8Array) => void): void {
    this.readHandler = handler;
  }

  setDisconnectHandler(handler: (reason?: unknown) => void): void {
    this.disconnectHandler = handler;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("demo device is closed");
    const result = takePacket("outbound", data);
    if (result.kind !== "packet") {
      this.options.onLog?.(`demo device received an unparsable packet (${result.kind})`);
      return;
    }
    this.received.push(result.packet);
    this.handle(result.packet);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Simulates the cable being cut / the earbuds being turned off. */
  disconnect(reason = "demo device disconnected"): void {
    void this.close();
    this.disconnectHandler?.(reason);
  }

  /** Lets the UI or tests poke the simulated device, e.g. to emulate a battery change. */
  mutate(mutator: (state: A3959StateUpdatePacket) => void, pushUpdate = true): void {
    mutator(this.state);
    if (pushUpdate) this.pushState();
  }

  getState(): A3959StateUpdatePacket {
    return this.state;
  }

  private handle(packet: Packet): void {
    const key = commandKey(packet.command);
    const body = packet.body;
    let pushState = true;
    let pushDualConnections = false;

    try {
      if (key === commandKey(commands.REQUEST_STATE)) {
        this.respond(a3959StateUpdatePacketToInbound(this.state));
        return;
      }
      if (key === commandKey(commands.SET_SOUND_MODES)) {
        const reader = new ByteReader(body);
        this.state.soundModes = parseA3959SoundModes(reader);
      } else if (key === commandKey(commands.SET_EQUALIZER_WITH_DRC)) {
        // The first half is the raw configuration, the second half is the same with DRC applied.
        const rawLength = 2 + A3959_EQUALIZER_CONFIG.bands * A3959_EQUALIZER_CONFIG.channels;
        const reader = new ByteReader(body.subarray(0, rawLength));
        this.state.equalizerConfiguration = parseEqualizerConfiguration(
          reader,
          A3959_EQUALIZER_CONFIG,
        );
      } else if (key === commandKey(commands.SET_BUTTON_ACTION)) {
        this.applyButtonAction(body);
      } else if (key === commandKey(commands.RESET_BUTTONS_TO_DEFAULT)) {
        this.state.buttonConfiguration = defaultDemoButtons();
      } else if (key === commandKey(commands.SET_BUTTON_ENABLED)) {
        // This device has no enabled flag; ignore it like the real firmware does.
      } else if (key === commandKey(commands.SET_AMBIENT_SOUND_MODE_CYCLE)) {
        const byte = new ByteReader(body).u8();
        this.state.ambientSoundModeCycle = {
          noiseCancelingMode: (byte & 1) !== 0,
          transparencyMode: (byte & 2) !== 0,
          normalMode: (byte & 4) !== 0,
        };
      } else if (key === commandKey(commands.SET_AUTO_POWER_OFF)) {
        const reader = new ByteReader(body);
        this.state.autoPowerOff = { isEnabled: reader.bool(), durationIndex: reader.u8() };
      } else if (key === commandKey(commands.SET_TOUCH_TONE)) {
        this.state.touchTone = new ByteReader(body).bool();
      } else if (key === commandKey(commands.SET_GAMING_MODE)) {
        this.state.gamingMode = new ByteReader(body).bool();
      } else if (key === commandKey(commands.SET_SURROUND_SOUND)) {
        this.state.surroundSound = new ByteReader(body).bool();
      } else if (key === commandKey(commands.SET_LOW_BATTERY_PROMPT)) {
        this.state.lowBatteryPrompt = new ByteReader(body).bool();
      } else if (key === commandKey(commands.REQUEST_DUAL_CONNECTIONS_DEVICES)) {
        this.respondDualConnections();
        return;
      } else if (key === commandKey(commands.SET_DUAL_CONNECTIONS_ENABLED)) {
        this.state.dualConnectionsEnabled = new ByteReader(body).bool();
      } else if (key === commandKey(commands.DUAL_CONNECTIONS_CONNECT)) {
        this.setDualConnectionState(macAddressFromBody(body), true);
        pushState = false;
        pushDualConnections = true;
      } else if (key === commandKey(commands.DUAL_CONNECTIONS_DISCONNECT)) {
        this.setDualConnectionState(macAddressFromBody(body), false);
        pushState = false;
        pushDualConnections = true;
      } else if (key === commandKey(commands.DUAL_CONNECTIONS_FORGET)) {
        const macAddress = macAddressFromBody(body);
        this.dualConnectionDevices = this.dualConnectionDevices.filter(
          (device) => device.macAddress !== macAddress,
        );
        pushState = false;
        pushDualConnections = true;
      } else {
        this.options.onLog?.(`demo device ignoring command ${key}`);
        pushState = false;
      }
    } catch (error) {
      this.options.onLog?.(`demo device failed to handle command ${key}`, error);
      pushState = false;
      pushDualConnections = false;
    }

    this.respond(ackPacket(packet));
    if (pushState) {
      // Real devices push an updated state after applying a change.
      this.pushState(30);
    }
    if (pushDualConnections) {
      this.respondDualConnections(30);
    }
  }

  private applyButtonAction(body: Uint8Array): void {
    const reader = new ByteReader(body);
    const side = reader.u8() === 0 ? "left" : "right";
    const buttonId = reader.u8();
    const actionId = reader.u8();

    A3959_BUTTON_CONFIGURATION.order.forEach((button, index) => {
      const settings = A3959_BUTTON_CONFIGURATION.settings.find(
        (entry) => entry.pressKind === buttonPressKindOf(button),
      );
      if (!settings || settings.buttonId !== buttonId) return;
      const buttonSide = button.startsWith("left") ? "left" : "right";
      if (buttonSide !== side) return;
      // The app sends the raw byte for this device: low nibble is the action used while TWS is
      // connected, high nibble the one used while it is not.
      this.state.buttonConfiguration[index] = {
        enabled: this.state.buttonConfiguration[index].enabled,
        action:
          settings.parseSettings.actionKind === "single"
            ? { kind: "single", value: actionId }
            : { kind: "tws", connected: actionId & 0xf, disconnected: actionId >> 4 },
      };
    });
  }

  private setDualConnectionState(macAddress: string, isConnected: boolean): void {
    for (const device of this.dualConnectionDevices) {
      if (device.macAddress === macAddress) {
        device.isConnected = isConnected;
      }
    }
    if (isConnected) {
      // Only two simultaneous connections are possible.
      const connected = this.dualConnectionDevices.filter((device) => device.isConnected);
      for (const device of connected.slice(0, Math.max(0, connected.length - 2))) {
        device.isConnected = false;
      }
    }
  }

  private respondDualConnections(delayMs = 0): void {
    const body = concatBytes([
      [1, 1], // one page, page 1
      ...this.dualConnectionDevices.map((device) => dualConnectionsDeviceBytes(device)),
    ]);
    this.respond(createPacket(commands.REQUEST_DUAL_CONNECTIONS_DEVICES, body), delayMs);
  }

  private pushState(delayMs = 0): void {
    this.respond(a3959StateUpdatePacketToInbound(this.state), delayMs);
  }

  private respond(packet: Packet, delayMs = this.options.latencyMs ?? 0): void {
    const bytes = encodePacket("inbound", packet);
    const send = (): void => {
      if (this.closed) return;
      this.readHandler?.(bytes);
    };
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        send();
      }, delayMs);
      this.timers.add(timer);
    } else {
      // Defer to a microtask so the caller can register its response handler first.
      queueMicrotask(send);
    }
  }
}

function macAddressFromBody(body: Uint8Array): string {
  return Array.from(body.subarray(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join(":");
}

/** Parses a state update the demo device produced; handy for tests. */
export function parseDemoState(device: DemoA3959Device): A3959StateUpdatePacket {
  return parseA3959StateUpdate(a3959StateUpdatePacketToInbound(device.getState()).body);
}
