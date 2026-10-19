/**
 * Soundcore P30i (A3959) device controller.
 *
 * This is the web port of what openscq30-lib builds out of the `soundcore_device!` macro, the
 * setting handlers in `common/modules/*` and the state modifiers. The structure mirrors upstream:
 *
 *   1. a setting handler mutates a *target* copy of the state
 *   2. each state modifier diffs the current state against the target and sends the packets needed
 *      to reach it, updating the current state as each packet is acknowledged
 *
 * The modifiers run in the same order as the `builder.*` calls in
 * `lib/src/devices/soundcore/a3959.rs`.
 */

import { ByteReader } from "../../lib/bytes";
import { commandKey, type Command, type Packet } from "../../lib/packet";
import type { PacketIo } from "../../lib/packetIo";
import {
  SettingError,
  asBool,
  asNumber,
  asNumbers,
  asOptionalString,
  asString,
  asStrings,
  type SettingDescriptor,
  type SettingValue,
} from "../../lib/settings";
import {
  dualFirmwareVersionLeft,
  dualFirmwareVersionRight,
  firmwareVersionToString,
  parseDualConnectionsDevice,
  parseDualFirmwareVersion,
  parseSerialNumber,
  type DualConnectionsDevice,
  type DualFirmwareVersion,
} from "../../lib/structures/common";
import {
  A3959_EQUALIZER_CONFIG,
  clampVolumeAdjustments,
  equalizerConfigurationsEqual,
  primaryVolumeAdjustments,
} from "../../lib/structures/equalizer";
import {
  DISABLED_ACTION_ID,
  actionStatusByte,
  buttonPosition,
  buttonSettingsFor,
  buttonStatusCollectionEqual,
  buttonStatusEqual,
  currentActionIdIgnoringEnabled,
  enabledStatusByte,
  withButtonAction,
  type Button,
} from "../../lib/structures/buttons";
import { A3959_BUTTON_CONFIGURATION } from "./buttons";
import * as packets from "./packets";
import {
  BAND_HZ,
  CUSTOM_PRESET_ID,
  EQUALIZER_PRESETS,
  FRACTION_DIGITS,
  MAX_VOLUME,
  MIN_VOLUME,
  VISIBLE_BANDS,
  findPresetById,
  findPresetByName,
  visibleBandsToVolumeAdjustments,
} from "./presets";
import {
  A3959_NOISE_CANCELING_MODES,
  AMBIENT_SOUND_MODES,
  MULTI_SCENE_OPTIONS,
  parseA3959SoundModes,
  planSoundModesMigration,
  type A3959NoiseCancelingMode,
  type AmbientSoundMode,
  type MultiSceneNoiseCanceling,
} from "./soundModes";
import {
  applyA3959StateUpdate,
  a3959StateFromUpdate,
  parseA3959StateUpdate,
  type A3959State,
  type A3959StateUpdatePacket,
} from "./state";

export type A3959SettingId =
  // sound modes
  | "ambientSoundMode"
  | "noiseCancelingMode"
  | "adaptiveNoiseCanceling"
  | "manualNoiseCanceling"
  | "multiSceneNoiseCanceling"
  | "windNoiseSuppression"
  | "windNoiseDetected"
  | "adaptiveNoiseCancelingSensitivityLevel"
  // equalizer
  | "presetEqualizerProfile"
  | "customEqualizerProfile"
  | "volumeAdjustments"
  | "importCustomEqualizerProfiles"
  | "exportCustomEqualizerProfiles"
  | "exportCustomEqualizerProfilesOutput"
  // buttons
  | "leftSinglePress"
  | "rightSinglePress"
  | "leftDoublePress"
  | "rightDoublePress"
  | "leftTriplePress"
  | "rightTriplePress"
  | "leftLongPress"
  | "rightLongPress"
  | "normalModeInCycle"
  | "transparencyModeInCycle"
  | "noiseCancelingModeInCycle"
  | "resetButtonsToDefault"
  // dual connections
  | "dualConnections"
  | "dualConnectionsDevices"
  // miscellaneous
  | "surroundSound"
  | "autoPowerOff"
  | "touchTone"
  | "lowBatteryPrompt"
  | "gamingMode"
  // device information
  | "twsStatus"
  | "hostDevice"
  | "batteryLevelLeft"
  | "batteryLevelRight"
  | "isChargingLeft"
  | "isChargingRight"
  | "serialNumber"
  | "firmwareVersionLeft"
  | "firmwareVersionRight";

const BUTTON_SETTING_IDS: readonly A3959SettingId[] = [
  "leftSinglePress",
  "rightSinglePress",
  "leftDoublePress",
  "rightDoublePress",
  "leftTriplePress",
  "rightTriplePress",
  "leftLongPress",
  "rightLongPress",
];

/** Auto power off durations offered by this device (`ten_twenty_thirty_sixty`). */
export const AUTO_POWER_OFF_DURATIONS: Array<{ id: string; minutes: number }> = [
  { id: "10m", minutes: 10 },
  { id: "20m", minutes: 20 },
  { id: "30m", minutes: 30 },
  { id: "60m", minutes: 60 },
];

/** `builder.dual_battery(10)` */
export const BATTERY_MAX_LEVEL = 10;

export interface CustomEqualizerProfile {
  name: string;
  volumeAdjustments: number[];
}

/** Persistence for user defined equalizer profiles (openscq30-lib keeps these in sqlite). */
export interface CustomProfileStore {
  list(): CustomEqualizerProfile[];
  upsert(name: string, volumeAdjustments: number[]): void;
  remove(name: string): void;
  subscribe(listener: () => void): () => void;
}

export interface Translate {
  (key: string, params?: Record<string, string | number>): string;
}

export type LogLevel = "debug" | "warn" | "error";

export interface A3959ControllerOptions {
  packetIo: PacketIo;
  profiles: CustomProfileStore;
  t: Translate;
  onLog?: (level: LogLevel, message: string, data?: unknown) => void;
}

export interface ExportedCustomProfile {
  name: string;
  volumeAdjustments: number[];
}

const AMBIENT_SOUND_MODE_KEYS: Record<AmbientSoundMode, string> = {
  noiseCanceling: "noise-canceling",
  transparency: "transparency",
  normal: "normal",
};

const NOISE_CANCELING_MODE_KEYS: Record<A3959NoiseCancelingMode, string> = {
  manual: "manual",
  adaptive: "adaptive",
  multiScene: "multi-scene",
};

const PRESET_LOCALIZATION_KEYS: Record<string, string> = {
  SoundcoreSignature: "soundcore-signature",
  Acoustic: "acoustic",
  BassBooster: "bass-booster",
  BassReducer: "bass-reducer",
  Classical: "classical",
  Podcast: "podcast",
  Dance: "dance",
  Deep: "deep",
  Electronic: "electronic",
  Flat: "flat",
  HipHop: "hip-hop",
  Jazz: "jazz",
  Latin: "latin",
  Lounge: "lounge",
  Piano: "piano",
  Pop: "pop",
  RnB: "rnb",
  Rock: "rock",
  SmallSpeakers: "small-speakers",
  SpokenWord: "spoken-word",
  TrebleBooster: "treble-booster",
  TrebleReducer: "treble-reducer",
};

const BUTTON_ACTION_LOCALIZATION_KEYS: Record<string, string> = {
  VolumeUp: "volume-up",
  VolumeDown: "volume-down",
  PreviousSong: "previous-song",
  NextSong: "next-song",
  AmbientSoundMode: "ambient-sound-mode",
  VoiceAssistant: "voice-assistant",
  PlayPause: "play-pause",
  GamingMode: "gaming-mode",
};

export class A3959Controller {
  private state: A3959State;
  private readonly listeners = new Set<(state: A3959State) => void>();
  private readonly settingsListeners = new Set<() => void>();
  private readonly removeUnsolicitedHandler: () => void;
  private readonly removeProfileSubscription: () => void;
  private exportSelection = new Set<string>();
  private closed = false;

  private constructor(
    state: A3959State,
    private readonly options: A3959ControllerOptions,
  ) {
    this.state = state;
    this.removeUnsolicitedHandler = options.packetIo.onUnsolicitedPacket((packet) => {
      this.handleUnsolicitedPacket(packet).catch((error) =>
        this.log("error", "failed to handle unsolicited packet", error),
      );
    });
    this.removeProfileSubscription = options.profiles.subscribe(() => this.notifySettingsChange());
  }

  /** Requests the state from the device and returns a ready to use controller. */
  static async connect(options: A3959ControllerOptions): Promise<A3959Controller> {
    const response = await options.packetIo.sendWithResponse(packets.requestStatePacket());
    const stateUpdate = parseA3959StateUpdate(response.body);
    const dualConnectionDevices = stateUpdate.dualConnectionsEnabled
      ? await takeDualConnectionDevices(options.packetIo, options.onLog)
      : [];
    return new A3959Controller(a3959StateFromUpdate(stateUpdate, dualConnectionDevices), options);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    this.options.onLog?.(level, message, data);
  }

  getState(): A3959State {
    return this.state;
  }

  subscribe(listener: (state: A3959State) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notified when the list of settings itself changes (custom profiles, firmware features). */
  subscribeToSettingsChange(listener: () => void): () => void {
    this.settingsListeners.add(listener);
    return () => {
      this.settingsListeners.delete(listener);
    };
  }

  private setState(state: A3959State): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private notifySettingsChange(): void {
    for (const listener of this.listeners) listener(this.state);
    for (const listener of this.settingsListeners) listener();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.removeUnsolicitedHandler();
    this.removeProfileSubscription();
    this.listeners.clear();
    this.settingsListeners.clear();
  }

  /* -------------------------------------------------- unsolicited packets --- */

  private async handleUnsolicitedPacket(packet: Packet): Promise<void> {
    const key = commandKey(packet.command);
    try {
      if (key === commandKey(packets.STATE_UPDATE)) {
        this.setState(applyA3959StateUpdate(this.state, parseA3959StateUpdate(packet.body)));
      } else if (key === commandKey(packets.SOUND_MODES_UPDATE)) {
        const reader = new ByteReader(packet.body);
        const soundModes = parseA3959SoundModes(reader);
        reader.assertConsumed("sound modes update");
        this.setState({ ...this.state, soundModes });
      } else if (key === commandKey(packets.TWS_STATUS_UPDATE)) {
        const reader = new ByteReader(packet.body);
        const hostByte = reader.u8();
        const twsStatus = {
          hostDevice: (hostByte === 1 ? "right" : "left") as "left" | "right",
          isConnected: reader.bool(),
        };
        reader.assertConsumed("tws status update");
        this.setState({ ...this.state, twsStatus });
      } else if (key === commandKey(packets.BATTERY_LEVEL_UPDATE)) {
        const reader = new ByteReader(packet.body);
        const left = reader.u8();
        const right = reader.u8();
        this.setState({
          ...this.state,
          dualBattery: {
            left: { ...this.state.dualBattery.left, level: left },
            right: { ...this.state.dualBattery.right, level: right },
          },
        });
      } else if (key === commandKey(packets.BATTERY_CHARGING_UPDATE)) {
        const reader = new ByteReader(packet.body);
        const left = reader.u8() === 1;
        const right = reader.u8() === 1;
        this.setState({
          ...this.state,
          dualBattery: {
            left: { ...this.state.dualBattery.left, isCharging: left },
            right: { ...this.state.dualBattery.right, isCharging: right },
          },
        });
      } else if (key === commandKey(packets.SERIAL_NUMBER_AND_FIRMWARE_UPDATE)) {
        const reader = new ByteReader(packet.body);
        const dualFirmwareVersion = parseDualFirmwareVersion(reader);
        const serialNumber = parseSerialNumber(reader);
        this.setState({ ...this.state, dualFirmwareVersion, serialNumber });
      } else if (key === commandKey(packets.GAMING_MODE_UPDATE)) {
        if (this.state.gamingMode === null) return;
        const reader = new ByteReader(packet.body);
        const gamingMode = reader.bool();
        reader.assertConsumed("gaming mode update");
        this.setState({ ...this.state, gamingMode });
      } else if (key === commandKey(packets.DUAL_CONNECTIONS_DEVICES_UPDATE)) {
        const parsed = parseDualConnectionsDevicePacket(packet.body);
        const devices =
          parsed.currentPacketIndex === 1 ? parsed.devices : [...this.state.dualConnections.devices, ...parsed.devices];
        this.setState({
          ...this.state,
          dualConnections: { ...this.state.dualConnections, devices },
        });
      } else {
        this.log("debug", `ignoring unsolicited packet ${key}`);
      }
    } catch (error) {
      this.log("warn", `failed to handle unsolicited packet ${key}`, error);
    }
  }

  /* ------------------------------------------------------------ settings --- */

  getSettings(): SettingDescriptor[] {
    const t = this.options.t;
    const state = this.state;
    const descriptors: SettingDescriptor[] = [];
    const add = (
      id: A3959SettingId,
      category: SettingDescriptor["category"],
      setting: SettingDescriptor["setting"],
    ): void => {
      descriptors.push({ id, category, setting });
    };

    /* --- sound modes --- */
    add("ambientSoundMode", "soundModes", {
      kind: "select",
      select: {
        options: AMBIENT_SOUND_MODES.map((mode) => ({
          value: mode,
          label: t(AMBIENT_SOUND_MODE_KEYS[mode]),
        })),
        value: state.soundModes.ambientSoundMode,
      },
    });
    add("noiseCancelingMode", "soundModes", {
      kind: "select",
      select: {
        options: A3959_NOISE_CANCELING_MODES.map((mode) => ({
          value: mode,
          label: t(NOISE_CANCELING_MODE_KEYS[mode]),
        })),
        value: state.soundModes.noiseCancelingMode,
      },
    });
    add("adaptiveNoiseCanceling", "soundModes", {
      kind: "information",
      value: `${state.soundModes.adaptiveNoiseCanceling}/5`,
    });
    add("manualNoiseCanceling", "soundModes", {
      kind: "range",
      min: 1,
      max: 5,
      step: 1,
      value: state.soundModes.manualNoiseCanceling,
    });
    add("multiSceneNoiseCanceling", "soundModes", {
      kind: "select",
      select: {
        options: MULTI_SCENE_OPTIONS.map((mode) => ({ value: mode, label: t(mode) })),
        value: state.soundModes.multiSceneAnc,
      },
    });
    add("windNoiseSuppression", "soundModes", {
      kind: "toggle",
      value: state.soundModes.windNoise.isSuppressionEnabled,
    });
    add("windNoiseDetected", "soundModes", {
      kind: "information",
      value: state.soundModes.windNoise.isDetected ? t("yes") : t("no"),
    });
    add("adaptiveNoiseCancelingSensitivityLevel", "soundModes", {
      kind: "range",
      min: 0,
      max: 10,
      step: 1,
      value: state.soundModes.noiseCancelingAdaptiveSensitivityLevel,
    });

    /* --- equalizer --- */
    if (!state.twsStatus.isConnected) {
      add("volumeAdjustments", "equalizer", {
        kind: "information",
        value: t("both-earbuds-must-be-connected"),
      });
    } else {
      const currentPreset = findPresetById(state.equalizerConfiguration.presetId);
      add("presetEqualizerProfile", "equalizer", {
        kind: "select",
        select: {
          options: EQUALIZER_PRESETS.map((preset) => ({
            value: preset.name,
            label: t(PRESET_LOCALIZATION_KEYS[preset.name] ?? preset.name),
          })),
          value: currentPreset?.name ?? null,
        },
      });

      const profiles = this.options.profiles.list();
      const currentAdjustments = primaryVolumeAdjustments(state.equalizerConfiguration);
      const isCustom = state.equalizerConfiguration.presetId === CUSTOM_PRESET_ID;
      const matchingProfile =
        isCustom && currentAdjustments
          ? profiles.find((profile) =>
              arraysEqual(
                profile.volumeAdjustments.slice(0, VISIBLE_BANDS),
                currentAdjustments.values.slice(0, VISIBLE_BANDS),
              ),
            )
          : undefined;
      add("customEqualizerProfile", "equalizer", {
        kind: "modifiableSelect",
        select: {
          options: profiles.map((profile) => ({ value: profile.name, label: profile.name })),
          value: matchingProfile?.name ?? null,
        },
      });

      add("volumeAdjustments", "equalizer", {
        kind: "equalizer",
        bandHz: BAND_HZ,
        min: MIN_VOLUME,
        max: MAX_VOLUME,
        fractionDigits: FRACTION_DIGITS,
        value: (currentAdjustments?.values ?? new Array(VISIBLE_BANDS).fill(0)).slice(
          0,
          VISIBLE_BANDS,
        ),
        readOnly: false,
      });
    }

    /* --- equalizer import / export --- */
    {
      const profiles = this.options.profiles.list();
      add("importCustomEqualizerProfiles", "equalizerImportExport", {
        kind: "importString",
        confirmationMessage: t("import-custom-equalizer-profiles-confirm"),
      });
      add("exportCustomEqualizerProfiles", "equalizerImportExport", {
        kind: "multiSelect",
        select: {
          options: profiles.map((profile) => ({ value: profile.name, label: profile.name })),
          value: null,
        },
        values: profiles
          .map((profile) => profile.name)
          .filter((name) => this.exportSelection.has(name)),
      });
      const exported: ExportedCustomProfile[] = profiles
        .filter((profile) => this.exportSelection.has(profile.name))
        .map((profile) => ({
          name: profile.name,
          volumeAdjustments: profile.volumeAdjustments.map(
            (value) => value / Math.pow(10, FRACTION_DIGITS),
          ),
        }));
      add("exportCustomEqualizerProfilesOutput", "equalizerImportExport", {
        kind: "information",
        value: this.exportSelection.size > 0 ? JSON.stringify(exported) : "",
      });
    }

    /* --- buttons --- */
    for (const id of BUTTON_SETTING_IDS) {
      const button = id as Button;
      const position = buttonPosition(A3959_BUTTON_CONFIGURATION, button);
      const settings = buttonSettingsFor(A3959_BUTTON_CONFIGURATION, button);
      const status = state.buttonConfiguration[position];
      // `ignore_enabled_flag` is true for this device: an action of 0xf means disabled.
      const actionId = currentActionIdIgnoringEnabled(status, state.twsStatus);
      const action =
        actionId === DISABLED_ACTION_ID
          ? undefined
          : settings.availableActions.find((candidate) => candidate.id === actionId);
      add(id, "buttonConfiguration", {
        kind: "optionalSelect",
        select: {
          options: settings.availableActions.map((candidate) => ({
            value: candidate.name,
            label: t(BUTTON_ACTION_LOCALIZATION_KEYS[candidate.name] ?? candidate.name),
          })),
          value: action?.name ?? null,
        },
      });
    }
    add("noiseCancelingModeInCycle", "buttonConfiguration", {
      kind: "toggle",
      value: state.ambientSoundModeCycle.noiseCancelingMode,
    });
    add("transparencyModeInCycle", "buttonConfiguration", {
      kind: "toggle",
      value: state.ambientSoundModeCycle.transparencyMode,
    });
    add("normalModeInCycle", "buttonConfiguration", {
      kind: "toggle",
      value: state.ambientSoundModeCycle.normalMode,
    });
    add("resetButtonsToDefault", "buttonConfiguration", { kind: "action" });

    /* --- dual connections --- */
    add("dualConnections", "dualConnections", {
      kind: "toggle",
      value: state.dualConnections.isEnabled,
    });
    add("dualConnectionsDevices", "dualConnections", {
      kind: "multiSelectWithRemove",
      select: {
        options: state.dualConnections.devices.map((device) => ({
          value: device.macAddress,
          label: device.name || device.macAddress,
        })),
        value: null,
      },
      values: state.dualConnections.devices
        .filter((device) => device.isConnected)
        .map((device) => device.macAddress),
    });

    /* --- miscellaneous --- */
    add("surroundSound", "miscellaneous", { kind: "toggle", value: state.surroundSound });
    add("autoPowerOff", "miscellaneous", {
      kind: "select",
      select: {
        options: [
          { value: "disabled", label: t("disabled") },
          ...AUTO_POWER_OFF_DURATIONS.map((duration) => ({
            value: duration.id,
            label: t("x-minutes", { minutes: duration.minutes }),
          })),
        ],
        value:
          state.autoPowerOff.isEnabled && AUTO_POWER_OFF_DURATIONS[state.autoPowerOff.durationIndex]
            ? AUTO_POWER_OFF_DURATIONS[state.autoPowerOff.durationIndex].id
            : "disabled",
      },
    });
    add("touchTone", "miscellaneous", { kind: "toggle", value: state.touchTone });
    add("lowBatteryPrompt", "miscellaneous", { kind: "toggle", value: state.lowBatteryPrompt });
    if (state.gamingMode !== null) {
      add("gamingMode", "miscellaneous", { kind: "toggle", value: state.gamingMode });
    }

    /* --- device information --- */
    add("twsStatus", "deviceInformation", {
      kind: "information",
      value: state.twsStatus.isConnected ? t("connected") : t("disconnected"),
    });
    add("hostDevice", "deviceInformation", {
      kind: "information",
      value: t(state.twsStatus.hostDevice),
    });
    // A battery level of 255 means that side is not present (TWS disconnected).
    if (state.dualBattery.left.level !== 255) {
      add("batteryLevelLeft", "deviceInformation", {
        kind: "information",
        value: batteryLabel(state.dualBattery.left.level, t),
      });
      add("isChargingLeft", "deviceInformation", {
        kind: "information",
        value: state.dualBattery.left.isCharging ? t("charging") : t("not-charging"),
      });
    }
    if (state.dualBattery.right.level !== 255) {
      add("batteryLevelRight", "deviceInformation", {
        kind: "information",
        value: batteryLabel(state.dualBattery.right.level, t),
      });
      add("isChargingRight", "deviceInformation", {
        kind: "information",
        value: state.dualBattery.right.isCharging ? t("charging") : t("not-charging"),
      });
    }
    add("serialNumber", "deviceInformation", { kind: "information", value: state.serialNumber });
    add("firmwareVersionLeft", "deviceInformation", {
      kind: "information",
      value: firmwareLabel(state.dualFirmwareVersion, "left", t),
    });
    add("firmwareVersionRight", "deviceInformation", {
      kind: "information",
      value: firmwareLabel(state.dualFirmwareVersion, "right", t),
    });

    return descriptors;
  }

  /* ---------------------------------------------------------- set values --- */

  async setValue(id: A3959SettingId, value: SettingValue): Promise<void> {
    await this.setValues([[id, value]]);
  }

  /** Applies several setting changes as one batch, like `set_setting_values`. */
  async setValues(values: Array<[A3959SettingId, SettingValue]>): Promise<void> {
    const target: A3959State = cloneState(this.state);
    for (const [id, value] of values) {
      this.applySettingValue(target, id, value);
    }
    await this.moveToState(target);
  }

  private applySettingValue(target: A3959State, id: A3959SettingId, value: SettingValue): void {
    switch (id) {
      /* --- sound modes --- */
      case "ambientSoundMode":
        target.soundModes.ambientSoundMode = asString(value) as AmbientSoundMode;
        return;
      case "noiseCancelingMode":
        target.soundModes.noiseCancelingMode = asString(value) as A3959NoiseCancelingMode;
        return;
      case "adaptiveNoiseCanceling":
        throw new SettingError("adaptiveNoiseCanceling is read only", "readOnly");
      case "manualNoiseCanceling":
        target.soundModes.manualNoiseCanceling = Math.min(5, Math.max(1, Math.trunc(asNumber(value))));
        return;
      case "multiSceneNoiseCanceling":
        target.soundModes.multiSceneAnc = asString(value) as MultiSceneNoiseCanceling;
        return;
      case "windNoiseSuppression":
        target.soundModes.windNoise.isSuppressionEnabled = asBool(value);
        return;
      case "windNoiseDetected":
        throw new SettingError("windNoiseDetected is read only", "readOnly");
      case "adaptiveNoiseCancelingSensitivityLevel":
        target.soundModes.noiseCancelingAdaptiveSensitivityLevel = Math.min(
          255,
          Math.max(0, Math.trunc(asNumber(value))),
        );
        return;

      /* --- equalizer --- */
      case "presetEqualizerProfile": {
        // The equalizer cannot be modified while TWS is disconnected.
        if (!target.twsStatus.isConnected) return;
        const name = asOptionalString(value);
        const preset = name === null ? undefined : findPresetByName(name);
        if (preset) {
          target.equalizerConfiguration = {
            presetId: preset.id,
            channels: [
              {
                values: clampVolumeAdjustments(preset.volumeAdjustments, A3959_EQUALIZER_CONFIG),
              },
            ],
          };
        } else {
          // Clearing the preset keeps the current values but switches to the custom preset id.
          const current = primaryVolumeAdjustments(target.equalizerConfiguration);
          if (current) {
            target.equalizerConfiguration = {
              presetId: CUSTOM_PRESET_ID,
              channels: [visibleBandsToVolumeAdjustments(current.values)],
            };
          }
        }
        return;
      }
      case "customEqualizerProfile": {
        if (!target.twsStatus.isConnected) return;
        if (value.type === "add") {
          const current = primaryVolumeAdjustments(target.equalizerConfiguration);
          this.options.profiles.upsert(
            value.name,
            (current?.values ?? new Array(VISIBLE_BANDS).fill(0)).slice(0, VISIBLE_BANDS),
          );
          return;
        }
        if (value.type === "remove") {
          this.options.profiles.remove(value.name);
          return;
        }
        const name = asOptionalString(value);
        if (name === null) return;
        const profile = this.options.profiles
          .list()
          .find((candidate) => candidate.name === name);
        if (!profile) return;
        const values: number[] = [];
        for (let band = 0; band < VISIBLE_BANDS; band++) {
          values.push(profile.volumeAdjustments[band] ?? 0);
        }
        target.equalizerConfiguration = {
          presetId: CUSTOM_PRESET_ID,
          channels: [visibleBandsToVolumeAdjustments(values)],
        };
        return;
      }
      case "volumeAdjustments": {
        if (!target.twsStatus.isConnected) return;
        target.equalizerConfiguration = {
          presetId: CUSTOM_PRESET_ID,
          channels: [visibleBandsToVolumeAdjustments(asNumbers(value).slice(0, VISIBLE_BANDS))],
        };
        return;
      }
      case "importCustomEqualizerProfiles":
        importCustomProfiles(asString(value), this.options.profiles);
        return;
      case "exportCustomEqualizerProfiles":
        this.exportSelection = new Set(asStrings(value));
        this.notifySettingsChange();
        return;
      case "exportCustomEqualizerProfilesOutput":
        throw new SettingError("export output is read only", "readOnly");

      /* --- buttons --- */
      case "leftSinglePress":
      case "rightSinglePress":
      case "leftDoublePress":
      case "rightDoublePress":
      case "leftTriplePress":
      case "rightTriplePress":
      case "leftLongPress":
      case "rightLongPress": {
        const button = id as Button;
        const position = buttonPosition(A3959_BUTTON_CONFIGURATION, button);
        const settings = buttonSettingsFor(A3959_BUTTON_CONFIGURATION, button);
        const actionName = asOptionalString(value);
        const action = actionName
          ? settings.availableActions.find((candidate) => candidate.name === actionName)
          : undefined;
        // `ignore_enabled_flag`: disabling a button means setting its action to 0xf.
        target.buttonConfiguration[position] = withButtonAction(
          target.buttonConfiguration[position],
          target.twsStatus,
          action ? action.id : DISABLED_ACTION_ID,
        );
        return;
      }
      case "normalModeInCycle":
        target.ambientSoundModeCycle.normalMode = asBool(value);
        return;
      case "transparencyModeInCycle":
        target.ambientSoundModeCycle.transparencyMode = asBool(value);
        return;
      case "noiseCancelingModeInCycle":
        target.ambientSoundModeCycle.noiseCancelingMode = asBool(value);
        return;
      case "resetButtonsToDefault":
        target.buttonResetPending = true;
        return;

      /* --- dual connections --- */
      case "dualConnections":
        target.dualConnections.isEnabled = asBool(value);
        return;
      case "dualConnectionsDevices": {
        if (value.type === "remove") {
          target.dualConnections.devices = target.dualConnections.devices.filter(
            (device) => device.macAddress !== value.name,
          );
          return;
        }
        const desired = asStrings(value);
        // Dual connections only allows two simultaneous connections.
        if (desired.length > 2) return;
        for (const device of target.dualConnections.devices) {
          device.isConnected = desired.includes(device.macAddress);
        }
        return;
      }

      /* --- miscellaneous --- */
      case "surroundSound":
        target.surroundSound = asBool(value);
        return;
      case "autoPowerOff": {
        const selection = asString(value);
        const index = AUTO_POWER_OFF_DURATIONS.findIndex(
          (duration) => duration.id.toLowerCase() === selection.toLowerCase(),
        );
        target.autoPowerOff =
          index >= 0
            ? { isEnabled: true, durationIndex: index }
            : { ...target.autoPowerOff, isEnabled: false };
        return;
      }
      case "touchTone":
        target.touchTone = asBool(value);
        return;
      case "lowBatteryPrompt":
        target.lowBatteryPrompt = asBool(value);
        return;
      case "gamingMode":
        if (target.gamingMode === null) {
          throw new SettingError("gaming mode is not available on this firmware", "readOnly");
        }
        target.gamingMode = asBool(value);
        return;

      /* --- device information is read only --- */
      default:
        throw new SettingError(`${id} is read only`, "readOnly");
    }
  }

  /* ------------------------------------------------------- state modifiers --- */

  /** Runs each state modifier in the order openscq30-lib registers them. */
  private async moveToState(target: A3959State): Promise<void> {
    await this.modifySoundModes(target);
    await this.modifyEqualizer(target);
    await this.modifyButtonConfiguration(target);
    await this.modifyAmbientSoundModeCycle(target);
    await this.modifyResetButtonConfiguration(target);
    await this.modifyDualConnections(target);
    await this.modifyFlag(
      target.surroundSound,
      packets.SET_SURROUND_SOUND,
      (state) => state.surroundSound,
      (state, value) => {
        state.surroundSound = value;
      },
    );
    await this.modifyAutoPowerOff(target);
    await this.modifyFlag(
      target.touchTone,
      packets.SET_TOUCH_TONE,
      (state) => state.touchTone,
      (state, value) => {
        state.touchTone = value;
      },
    );
    await this.modifyFlag(
      target.lowBatteryPrompt,
      packets.SET_LOW_BATTERY_PROMPT,
      (state) => state.lowBatteryPrompt,
      (state, value) => {
        state.lowBatteryPrompt = value;
      },
    );
    await this.modifyFlag(
      target.gamingMode,
      packets.SET_GAMING_MODE,
      (state) => state.gamingMode,
      (state, value) => {
        state.gamingMode = value;
      },
    );
  }

  private async modifySoundModes(target: A3959State): Promise<void> {
    const path = planSoundModesMigration(this.state.soundModes, target.soundModes);
    for (const step of path) {
      await this.send(packets.setSoundModesPacket(step));
      this.setState({ ...this.state, soundModes: step });
    }
  }

  private async modifyEqualizer(target: A3959State): Promise<void> {
    if (
      equalizerConfigurationsEqual(this.state.equalizerConfiguration, target.equalizerConfiguration)
    ) {
      return;
    }
    await this.send(packets.setEqualizerWithDrcPacket(target.equalizerConfiguration));
    this.setState({ ...this.state, equalizerConfiguration: target.equalizerConfiguration });
  }

  private async modifyButtonConfiguration(target: A3959State): Promise<void> {
    // While a reset is pending, do not immediately put the buttons back as they were.
    if (target.buttonResetPending) return;
    if (buttonStatusCollectionEqual(this.state.buttonConfiguration, target.buttonConfiguration)) {
      return;
    }
    for (let index = 0; index < target.buttonConfiguration.length; index++) {
      const targetStatus = target.buttonConfiguration[index];
      if (buttonStatusEqual(this.state.buttonConfiguration[index], targetStatus)) continue;
      const currentStatus = this.state.buttonConfiguration[index];

      const button = A3959_BUTTON_CONFIGURATION.order[index];
      const settings = buttonSettingsFor(A3959_BUTTON_CONFIGURATION, button);

      if (JSON.stringify(currentStatus.action) !== JSON.stringify(targetStatus.action)) {
        await this.send(
          packets.setButtonActionPacket({
            side: button.startsWith("left") ? "left" : "right",
            buttonId: settings.buttonId,
            actionId: actionStatusByte(targetStatus.action, settings.parseSettings.actionKind),
            commandOverride: A3959_BUTTON_CONFIGURATION.setButtonActionCommandOverride,
          }),
        );
      }
      if (
        JSON.stringify(currentStatus.enabled) !== JSON.stringify(targetStatus.enabled) &&
        targetStatus.enabled !== null
      ) {
        await this.send(
          packets.setButtonEnabledPacket({
            side: button.startsWith("left") ? "left" : "right",
            buttonId: settings.buttonId,
            enabled: enabledStatusByte(
              targetStatus.enabled,
              settings.parseSettings.enabledFlagKind,
            ),
          }),
        );
      }

      const buttonConfiguration = this.state.buttonConfiguration.slice();
      buttonConfiguration[index] = targetStatus;
      this.setState({ ...this.state, buttonConfiguration });
    }
  }

  private async modifyAmbientSoundModeCycle(target: A3959State): Promise<void> {
    if (target.buttonResetPending) return;
    if (
      JSON.stringify(this.state.ambientSoundModeCycle) ===
      JSON.stringify(target.ambientSoundModeCycle)
    ) {
      return;
    }
    await this.send(packets.setAmbientSoundModeCyclePacket(target.ambientSoundModeCycle));
    this.setState({ ...this.state, ambientSoundModeCycle: target.ambientSoundModeCycle });
  }

  private async modifyResetButtonConfiguration(target: A3959State): Promise<void> {
    if (!target.buttonResetPending) return;
    await this.send(packets.resetButtonsToDefaultPacket());
    // Re-read the state so the UI shows the device defaults.
    const response = await this.send(packets.requestStatePacket());
    const update: A3959StateUpdatePacket = parseA3959StateUpdate(response.body);
    // Deviation from openscq30-lib: upstream leaves `button_reset_pending` set after a reset, which
    // stops later button changes from being applied until the device is reconnected. Clearing it
    // here is what a single page app needs.
    this.setState({ ...applyA3959StateUpdate(this.state, update), buttonResetPending: false });
  }

  private async modifyDualConnections(target: A3959State): Promise<void> {
    const targetConnections = target.dualConnections;

    if (this.state.dualConnections.isEnabled !== targetConnections.isEnabled) {
      await this.send(packets.setDualConnectionsEnabledPacket(targetConnections.isEnabled));
      this.setState({
        ...this.state,
        dualConnections: {
          ...this.state.dualConnections,
          isEnabled: targetConnections.isEnabled,
        },
      });
    }

    if (this.state.dualConnections.isEnabled) {
      const forgotten = this.state.dualConnections.devices.filter(
        (device) =>
          !device.isConnected &&
          !targetConnections.devices.some(
            (candidate) => candidate.macAddress === device.macAddress,
          ),
      );
      for (const device of forgotten) {
        await this.send(packets.dualConnectionsForgetPacket(device.macAddress));
        this.setState({
          ...this.state,
          dualConnections: {
            ...this.state.dualConnections,
            devices: this.state.dualConnections.devices.filter(
              (candidate) => candidate.macAddress !== device.macAddress,
            ),
          },
        });
      }
    }

    const connectedCount = targetConnections.devices.filter((device) => device.isConnected).length;
    if (connectedCount > 2) {
      throw new SettingError("connecting to more than 2 devices is not possible");
    }

    const currentDevices = this.state.dualConnections.devices;
    for (const device of currentDevices) {
      const targetDevice = targetConnections.devices.find(
        (candidate) => candidate.macAddress === device.macAddress,
      );
      if (targetDevice && device.isConnected && !targetDevice.isConnected) {
        await this.options.packetIo.sendWithoutResponse(
          packets.dualConnectionsDisconnectPacket(device.macAddress),
        );
      }
    }
    for (const device of currentDevices) {
      const targetDevice = targetConnections.devices.find(
        (candidate) => candidate.macAddress === device.macAddress,
      );
      if (targetDevice && !device.isConnected && targetDevice.isConnected) {
        await this.options.packetIo.sendWithoutResponse(
          packets.dualConnectionsConnectPacket(device.macAddress),
        );
      }
    }
  }

  private async modifyAutoPowerOff(target: A3959State): Promise<void> {
    const current = this.state.autoPowerOff;
    if (
      current.isEnabled === target.autoPowerOff.isEnabled &&
      current.durationIndex === target.autoPowerOff.durationIndex
    ) {
      return;
    }
    await this.send(packets.setAutoPowerOffPacket(target.autoPowerOff));
    this.setState({ ...this.state, autoPowerOff: target.autoPowerOff });
  }

  /** `FlagStateModifier::move_to_state`: skips flags the device does not have (value null). */
  private async modifyFlag(
    targetValue: boolean | null,
    command: Command,
    read: (state: A3959State) => boolean | null,
    assign: (state: A3959State, value: boolean) => void,
  ): Promise<void> {
    if (targetValue === null) return;
    if (read(this.state) === targetValue) return;
    await this.send(packets.setFlagPacket(command, targetValue));
    const state = { ...this.state };
    assign(state, targetValue);
    this.setState(state);
  }

  private async send(packet: Packet): Promise<Packet> {
    return this.options.packetIo.sendWithResponse(packet);
  }

  /** Re-reads the whole state from the device. */
  async refresh(): Promise<void> {
    const response = await this.send(packets.requestStatePacket());
    const update = parseA3959StateUpdate(response.body);
    const devices = update.dualConnectionsEnabled
      ? await takeDualConnectionDevices(this.options.packetIo, this.options.onLog)
      : this.state.dualConnections.devices;
    this.setState(a3959StateFromUpdate(update, devices));
  }
}

/* ---------------------------------------------------------------- helpers --- */

function cloneState(state: A3959State): A3959State {
  return {
    ...state,
    twsStatus: { ...state.twsStatus },
    dualBattery: {
      left: { ...state.dualBattery.left },
      right: { ...state.dualBattery.right },
    },
    equalizerConfiguration: {
      presetId: state.equalizerConfiguration.presetId,
      channels: state.equalizerConfiguration.channels.map((channel) =>
        channel === null ? null : { values: channel.values.slice() },
      ),
    },
    buttonConfiguration: state.buttonConfiguration.map((status) => ({
      enabled: status.enabled === null ? null : { ...status.enabled },
      action: { ...status.action },
    })),
    ambientSoundModeCycle: { ...state.ambientSoundModeCycle },
    soundModes: { ...state.soundModes, windNoise: { ...state.soundModes.windNoise } },
    autoPowerOff: { ...state.autoPowerOff },
    dualConnections: {
      isEnabled: state.dualConnections.isEnabled,
      devices: state.dualConnections.devices.map((device) => ({ ...device })),
    },
  };
}

function parseDualConnectionsDevicePacket(body: Uint8Array): {
  totalPackets: number;
  currentPacketIndex: number;
  devices: DualConnectionsDevice[];
} {
  const reader = new ByteReader(body);
  const totalPackets = reader.u8();
  const currentPacketIndex = reader.u8();
  const devices: DualConnectionsDevice[] = [];
  while (!reader.done) {
    devices.push(parseDualConnectionsDevice(reader));
  }
  return { totalPackets, currentPacketIndex, devices };
}

async function takeDualConnectionDevices(
  packetIo: PacketIo,
  onLog?: (level: LogLevel, message: string, data?: unknown) => void,
): Promise<DualConnectionsDevice[]> {
  const devices: DualConnectionsDevice[] = [];
  await packetIo.sendWithMultiResponse(
    packets.requestDualConnectionsDevicesPacket(),
    (packet) => {
      try {
        const parsed = parseDualConnectionsDevicePacket(packet.body);
        devices.push(...parsed.devices);
        return parsed.currentPacketIndex !== parsed.totalPackets;
      } catch (error) {
        onLog?.("warn", "failed to parse dual connection device packet", error);
        return false;
      }
    },
    20,
  );
  return devices;
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function batteryLabel(level: number, t: Translate): string {
  const percent = Math.floor((level * 100) / BATTERY_MAX_LEVEL);
  return `${level}/${BATTERY_MAX_LEVEL} (${t("percent", { percent })})`;
}

function firmwareLabel(
  version: DualFirmwareVersion,
  side: "left" | "right",
  t: Translate,
): string {
  const resolved =
    side === "left" ? dualFirmwareVersionLeft(version) : dualFirmwareVersionRight(version);
  return resolved ? firmwareVersionToString(resolved) : t("none");
}

/** Matches the JSON format openscq30-lib uses for exporting custom equalizer profiles. */
export function importCustomProfiles(json: string, store: CustomProfileStore): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SettingError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new SettingError("expected a JSON array of profiles");
  }
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      throw new SettingError("each profile must be an object");
    }
    const record = entry as Record<string, unknown>;
    const { name, volumeAdjustments } = record;
    if (typeof name !== "string" || !Array.isArray(volumeAdjustments)) {
      throw new SettingError('each profile needs a "name" and "volumeAdjustments"');
    }
    const values = volumeAdjustments.map((value) => {
      if (typeof value !== "number") {
        throw new SettingError("volumeAdjustments must be numbers");
      }
      return Math.round(value * Math.pow(10, FRACTION_DIGITS));
    });
    store.upsert(name, values);
  }
}
