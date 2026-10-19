/**
 * Connection lifecycle: transport selection, controller wiring and logging.
 */

import { PacketIo } from "../lib/packetIo";
import { toHex } from "../lib/bytes";
import type { SettingDescriptor, SettingValue } from "../lib/settings";
import {
  A3959Controller,
  type A3959SettingId,
  type CustomProfileStore,
} from "../devices/a3959/controller";
import type { A3959State } from "../devices/a3959/state";
import { DemoA3959Device } from "../transport/demo";
import type { TransportConnection } from "../transport/transport";
import { openPort, requestPort, soundcoreVendorServiceUuid } from "../transport/webSerial";
import type { Translator } from "../i18n";

export type LogLevel = "debug" | "info" | "warn" | "error" | "tx" | "rx";

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
  detail?: string;
}

export type SessionStatus = "idle" | "connecting" | "connected" | "error";

export interface SessionSnapshot {
  status: SessionStatus;
  error: string | null;
  connectionKind: "serial" | "demo" | null;
  connectionLabel: string | null;
  state: A3959State | null;
  settings: SettingDescriptor[];
  logs: LogEntry[];
  busy: boolean;
}

export interface ConnectSerialOptions {
  allowedBluetoothServiceClassIds?: string[];
}

/** Settings that can be captured into a quick preset. */
export const PRESETTABLE_SETTING_IDS: readonly string[] = [
  "ambientSoundMode",
  "noiseCancelingMode",
  "manualNoiseCanceling",
  "multiSceneNoiseCanceling",
  "windNoiseSuppression",
  "adaptiveNoiseCancelingSensitivityLevel",
  "presetEqualizerProfile",
  "customEqualizerProfile",
  "volumeAdjustments",
  "leftSinglePress",
  "rightSinglePress",
  "leftDoublePress",
  "rightDoublePress",
  "leftTriplePress",
  "rightTriplePress",
  "leftLongPress",
  "rightLongPress",
  "normalModeInCycle",
  "transparencyModeInCycle",
  "noiseCancelingModeInCycle",
  "surroundSound",
  "autoPowerOff",
  "touchTone",
  "lowBatteryPrompt",
  "gamingMode",
];

/** Converts a rendered setting back into a value that can be applied later. */
export function settingToValue(descriptor: SettingDescriptor): SettingValue | null {
  switch (descriptor.setting.kind) {
    case "toggle":
      return { type: "bool", value: descriptor.setting.value };
    case "select":
    case "optionalSelect":
    case "modifiableSelect":
      return { type: "string", value: descriptor.setting.select.value };
    case "range":
      return { type: "number", value: descriptor.setting.value };
    case "equalizer":
      return { type: "numbers", value: descriptor.setting.value };
    default:
      return null;
  }
}

export interface SessionOptions {
  profiles: CustomProfileStore;
  t: Translator;
  maxLogs?: number;
}

export class Session {
  private snapshot: SessionSnapshot = {
    status: "idle",
    error: null,
    connectionKind: null,
    connectionLabel: null,
    state: null,
    settings: [],
    logs: [],
    busy: false,
  };
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private controller: A3959Controller | null = null;
  private packetIo: PacketIo | null = null;
  private connection: TransportConnection | null = null;
  private demoDevice: DemoA3959Device | null = null;
  private logCounter = 0;
  private unsubscribeController: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;

  constructor(private readonly options: SessionOptions) {}

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  log(level: LogLevel, message: string, detail?: string): void {
    const maxLogs = this.options.maxLogs ?? 300;
    const entry: LogEntry = { id: this.logCounter++, time: Date.now(), level, message, detail };
    const logs = [...this.snapshot.logs, entry];
    this.update({ logs: logs.length > maxLogs ? logs.slice(logs.length - maxLogs) : logs });
  }

  clearLog(): void {
    this.update({ logs: [] });
  }

  /** Re-renders setting labels, e.g. after a language change. */
  refreshLabels(): void {
    if (!this.controller) return;
    this.update({ settings: this.controller.getSettings(), state: this.controller.getState() });
  }

  /** Opens the browser's port chooser and connects. Must be called from a user gesture. */
  async connectSerial(options: ConnectSerialOptions = {}): Promise<void> {
    const port = await requestPort({
      allowedBluetoothServiceClassIds: options.allowedBluetoothServiceClassIds,
    });
    const connection = await openPort(port);
    await this.start(connection, "serial", connection.name);
  }

  /** Connects to an already granted port (no chooser). */
  async connectToPort(port: SerialPort): Promise<void> {
    const connection = await openPort(port);
    await this.start(connection, "serial", connection.name);
  }

  /** Connects to the simulated device. */
  async connectDemo(): Promise<void> {
    const demo = new DemoA3959Device({
      latencyMs: 40,
      onLog: (message, data) =>
        this.log("debug", `[demo] ${message}`, data === undefined ? undefined : String(data)),
    });
    this.demoDevice = demo;
    await this.start(demo, "demo", this.options.t("connection-demo"));
  }

  private async start(
    connection: TransportConnection,
    kind: "serial" | "demo",
    label: string,
  ): Promise<void> {
    await this.disconnect();
    this.update({ status: "connecting", error: null, connectionKind: kind, connectionLabel: label });
    this.log("info", `${this.options.t("connecting")} (${label})`);

    connection.setDisconnectHandler((reason) => {
      this.log("warn", `disconnected: ${reason instanceof Error ? reason.message : String(reason ?? "")}`);
      void this.teardown();
      this.update({ status: "idle", connectionKind: null, connectionLabel: null, state: null, settings: [] });
    });

    const packetIo = new PacketIo(connection, "suffix", {
      onLog: (level, message, data) =>
        this.log(level, message, data === undefined ? undefined : formatLogData(data)),
      onPacket: (direction, bytes) => this.log(direction, describePacket(direction, bytes), toHex(bytes)),
    });
    this.packetIo = packetIo;
    this.connection = connection;

    try {
      const controller = await A3959Controller.connect({
        packetIo,
        profiles: this.options.profiles,
        t: this.options.t,
        onLog: (level, message, data) =>
          this.log(level, message, data === undefined ? undefined : formatLogData(data)),
      });
      this.controller = controller;
      this.unsubscribeController = controller.subscribe((state) => {
        this.update({ state, settings: controller.getSettings() });
      });
      this.unsubscribeSettings = controller.subscribeToSettingsChange(() => {
        this.update({ settings: controller.getSettings() });
      });
      this.update({
        status: "connected",
        state: controller.getState(),
        settings: controller.getSettings(),
        error: null,
      });
      this.log("info", this.options.t("state-updated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", message);
      await packetIo.close();
      this.packetIo = null;
      this.connection = null;
      this.update({
        status: "error",
        error: this.options.t("error-connect", { message }),
        state: null,
        settings: [],
      });
      throw error;
    }
  }

  private async teardown(): Promise<void> {
    this.unsubscribeController?.();
    this.unsubscribeSettings?.();
    this.unsubscribeController = null;
    this.unsubscribeSettings = null;
    await this.controller?.close();
    this.controller = null;
    await this.packetIo?.close();
    this.packetIo = null;
    this.connection = null;
    this.demoDevice = null;
  }

  async disconnect(): Promise<void> {
    if (!this.controller && !this.packetIo && !this.connection) {
      this.update({ status: "idle", connectionKind: null, connectionLabel: null });
      return;
    }
    await this.teardown();
    this.update({
      status: "idle",
      connectionKind: null,
      connectionLabel: null,
      state: null,
      settings: [],
      error: null,
    });
  }

  private requireController(): A3959Controller {
    if (!this.controller) throw new Error("not connected");
    return this.controller;
  }

  async applySetting(id: A3959SettingId, value: SettingValue): Promise<void> {
    const controller = this.requireController();
    this.update({ busy: true });
    this.log("debug", `set ${id}`, formatSettingValue(value));
    try {
      await controller.setValue(id, value);
      this.update({ state: controller.getState(), settings: controller.getSettings(), error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", message);
      this.update({ error: this.options.t("error-setting", { message }) });
      throw error;
    } finally {
      this.update({ busy: false });
    }
  }

  async applyBatch(values: Array<[A3959SettingId, SettingValue]>): Promise<void> {
    const controller = this.requireController();
    this.update({ busy: true });
    this.log("debug", `set ${values.length} setting(s)`);
    try {
      await controller.setValues(values);
      this.update({ state: controller.getState(), settings: controller.getSettings(), error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log("error", message);
      this.update({ error: this.options.t("error-setting", { message }) });
      throw error;
    } finally {
      this.update({ busy: false });
    }
  }

  async refresh(): Promise<void> {
    const controller = this.requireController();
    this.update({ busy: true });
    try {
      await controller.refresh();
      this.update({ state: controller.getState(), settings: controller.getSettings() });
    } finally {
      this.update({ busy: false });
    }
  }

  /* --------------------------------------------------- demo device extras --- */

  get demo(): DemoA3959Device | null {
    return this.demoDevice;
  }

  simulateTwsDisconnect(): void {
    this.demoDevice?.mutate((state) => {
      state.twsStatus = { hostDevice: "left", isConnected: false };
      state.dualBattery.right.level = 255;
    });
  }

  simulateTwsConnect(): void {
    this.demoDevice?.mutate((state) => {
      state.twsStatus = { hostDevice: "right", isConnected: true };
      state.dualBattery.right.level = 7;
    });
  }

  simulateBatteryDrain(): void {
    this.demoDevice?.mutate((state) => {
      state.dualBattery.left.level = Math.max(0, state.dualBattery.left.level - 1);
      state.dualBattery.right.level = Math.max(0, state.dualBattery.right.level - 1);
    });
  }
}

function describePacket(direction: "tx" | "rx", bytes: Uint8Array): string {
  if (bytes.length < 7) return `${direction} (${bytes.length} bytes)`;
  const command = `${bytes[5].toString(16).padStart(2, "0")} ${bytes[6].toString(16).padStart(2, "0")}`;
  return `${direction} command 0x${command} (${bytes.length} bytes)`;
}

function formatLogData(data: unknown): string {
  if (data instanceof Uint8Array) return toHex(data);
  if (Array.isArray(data)) return data.join(", ");
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function formatSettingValue(value: SettingValue): string {
  switch (value.type) {
    case "bool":
      return String(value.value);
    case "string":
      return value.value ?? "none";
    case "number":
      return String(value.value);
    case "numbers":
      return `[${value.value.join(", ")}]`;
    case "strings":
      return `[${value.value.join(", ")}]`;
    case "action":
      return "action";
    case "add":
      return `add ${value.name}`;
    case "remove":
      return `remove ${value.name}`;
  }
}

/**
 * Soundcore's vendor RFCOMM service UUID has a device specific suffix: the Motion+ (A3116) uses
 * `...d6832e7b3116`, i.e. `b` followed by the model number. The same pattern is assumed for other
 * models, and users can add UUIDs by hand when a device turns out to use something else.
 */
export function vendorUuidCandidates(model: string): string[] {
  return [soundcoreVendorServiceUuid(model)];
}
