/**
 * Soundcore P30i (A3959) sound modes.
 *
 * Ported from openscq30-lib `lib/src/devices/soundcore/a3959/structures/sound_modes.rs`.
 */

import { ByteReader } from "../../lib/bytes";
import {
  MigrationPlanner,
  migrationValue,
  type MigrationValue,
} from "../../lib/migration";
import {
  clampAdaptiveNoiseCanceling,
  clampManualNoiseCanceling,
  manualAdaptiveNoiseCancelingByte,
  parseManualAdaptiveNoiseCanceling,
  parseWindNoise,
  windNoiseByte,
  type WindNoise,
} from "../../lib/structures/common";

/** `common::structures::AmbientSoundMode` */
export type AmbientSoundMode = "noiseCanceling" | "transparency" | "normal";

const AMBIENT_SOUND_MODE_BY_BYTE: Record<number, AmbientSoundMode> = {
  0: "noiseCanceling",
  1: "transparency",
  2: "normal",
};

export const AMBIENT_SOUND_MODE_BYTE: Record<AmbientSoundMode, number> = {
  noiseCanceling: 0,
  transparency: 1,
  normal: 2,
};

export const AMBIENT_SOUND_MODES: AmbientSoundMode[] = ["noiseCanceling", "transparency", "normal"];

/** `a3959::structures::NoiseCancelingMode` (the ANC "automation" mode) */
export type A3959NoiseCancelingMode = "manual" | "adaptive" | "multiScene";

const A3959_NOISE_CANCELING_MODE_BY_BYTE: Record<number, A3959NoiseCancelingMode> = {
  0: "manual",
  1: "adaptive",
  2: "multiScene",
};

export const A3959_NOISE_CANCELING_MODE_BYTE: Record<A3959NoiseCancelingMode, number> = {
  manual: 0,
  adaptive: 1,
  multiScene: 2,
};

export const A3959_NOISE_CANCELING_MODES: A3959NoiseCancelingMode[] = [
  "manual",
  "adaptive",
  "multiScene",
];

/** `common::structures::NoiseCancelingMode`, used here for the multi scene ANC selection. */
export type MultiSceneNoiseCanceling = "transport" | "outdoor" | "indoor" | "custom";

const MULTI_SCENE_BY_BYTE: Record<number, MultiSceneNoiseCanceling> = {
  0: "transport",
  1: "outdoor",
  2: "indoor",
  3: "custom",
};

export const MULTI_SCENE_BYTE: Record<MultiSceneNoiseCanceling, number> = {
  transport: 0,
  outdoor: 1,
  indoor: 2,
  custom: 3,
};

/** The options the official app shows for multi scene ANC. */
export const MULTI_SCENE_OPTIONS: MultiSceneNoiseCanceling[] = ["transport", "outdoor", "indoor"];

export interface A3959SoundModes {
  ambientSoundMode: AmbientSoundMode;
  noiseCancelingMode: A3959NoiseCancelingMode;
  /** 1-5 */
  adaptiveNoiseCanceling: number;
  /** 1-5 */
  manualNoiseCanceling: number;
  multiSceneAnc: MultiSceneNoiseCanceling;
  windNoise: WindNoise;
  noiseCancelingAdaptiveSensitivityLevel: number;
}

export function defaultA3959SoundModes(): A3959SoundModes {
  return {
    ambientSoundMode: "noiseCanceling",
    noiseCancelingMode: "manual",
    adaptiveNoiseCanceling: 1,
    manualNoiseCanceling: 1,
    multiSceneAnc: "transport",
    windNoise: { isSuppressionEnabled: false, isDetected: false },
    noiseCancelingAdaptiveSensitivityLevel: 0,
  };
}

export function parseA3959SoundModes(reader: ByteReader): A3959SoundModes {
  return reader.withContext("a3959 sound modes", () => {
    const ambientSoundMode = AMBIENT_SOUND_MODE_BY_BYTE[reader.u8()] ?? "noiseCanceling";
    const manualAdaptive = parseManualAdaptiveNoiseCanceling(reader.u8());
    // The ambient sound mode is repeated; openscq30-lib ignores the second copy.
    reader.u8();
    const noiseCancelingMode = A3959_NOISE_CANCELING_MODE_BY_BYTE[reader.u8()] ?? "manual";
    const windNoise = parseWindNoise(reader);
    const noiseCancelingAdaptiveSensitivityLevel = reader.u8();
    const multiSceneAnc = MULTI_SCENE_BY_BYTE[reader.u8()] ?? "transport";
    return {
      ambientSoundMode,
      noiseCancelingMode,
      adaptiveNoiseCanceling: manualAdaptive.adaptive,
      manualNoiseCanceling: manualAdaptive.manual,
      multiSceneAnc,
      windNoise,
      noiseCancelingAdaptiveSensitivityLevel,
    };
  });
}

/** Seven bytes, sent with command `[0x06, 0x81]`. */
export function a3959SoundModesBytes(soundModes: A3959SoundModes): Uint8Array {
  const ambientByte = AMBIENT_SOUND_MODE_BYTE[soundModes.ambientSoundMode];
  return Uint8Array.of(
    ambientByte,
    manualAdaptiveNoiseCancelingByte(
      soundModes.manualNoiseCanceling,
      soundModes.adaptiveNoiseCanceling,
    ),
    ambientByte,
    A3959_NOISE_CANCELING_MODE_BYTE[soundModes.noiseCancelingMode],
    windNoiseByte(soundModes.windNoise),
    soundModes.noiseCancelingAdaptiveSensitivityLevel & 0xff,
    MULTI_SCENE_BYTE[soundModes.multiSceneAnc],
  );
}

export function a3959SoundModesEqual(a: A3959SoundModes, b: A3959SoundModes): boolean {
  return (
    a.ambientSoundMode === b.ambientSoundMode &&
    a.noiseCancelingMode === b.noiseCancelingMode &&
    a.adaptiveNoiseCanceling === b.adaptiveNoiseCanceling &&
    a.manualNoiseCanceling === b.manualNoiseCanceling &&
    a.multiSceneAnc === b.multiSceneAnc &&
    a.windNoise.isSuppressionEnabled === b.windNoise.isSuppressionEnabled &&
    a.windNoise.isDetected === b.windNoise.isDetected &&
    a.noiseCancelingAdaptiveSensitivityLevel === b.noiseCancelingAdaptiveSensitivityLevel
  );
}

/* ------------------------------------------------------------ migration --- */

/**
 * Field order matters: it is the order of the fields in the Rust struct, and the migration
 * requirements refer to parents by index.
 *
 * 0 ambientSoundMode                          (root)
 * 1 noiseCancelingMode                        requires ambientSoundMode == NoiseCanceling
 * 2 adaptiveNoiseCanceling                    requires noiseCancelingMode == Adaptive
 * 3 manualNoiseCanceling                      requires noiseCancelingMode == Manual
 * 4 multiSceneAnc                             requires noiseCancelingMode == MultiScene
 * 5 windNoise                                 requires ambientSoundMode in [NoiseCanceling, Transparency]
 * 6 noiseCancelingAdaptiveSensitivityLevel    (root)
 */
export const SOUND_MODES_FIELD_AMBIENT = 0;
export const SOUND_MODES_FIELD_NC_MODE = 1;
export const SOUND_MODES_FIELD_ADAPTIVE = 2;
export const SOUND_MODES_FIELD_MANUAL = 3;
export const SOUND_MODES_FIELD_MULTI_SCENE = 4;
export const SOUND_MODES_FIELD_WIND_NOISE = 5;
export const SOUND_MODES_FIELD_SENSITIVITY = 6;

/** Wind noise is a struct of two bools; only the suppression flag is user settable. */
function windNoiseMigrationValue(windNoise: WindNoise): unknown {
  return [windNoise.isSuppressionEnabled, windNoise.isDetected];
}

export function soundModesToMigrationState(soundModes: A3959SoundModes): MigrationValue[] {
  return [
    migrationValue(SOUND_MODES_FIELD_AMBIENT, soundModes.ambientSoundMode),
    migrationValue(SOUND_MODES_FIELD_NC_MODE, soundModes.noiseCancelingMode),
    migrationValue(SOUND_MODES_FIELD_ADAPTIVE, soundModes.adaptiveNoiseCanceling),
    migrationValue(SOUND_MODES_FIELD_MANUAL, soundModes.manualNoiseCanceling),
    migrationValue(SOUND_MODES_FIELD_MULTI_SCENE, soundModes.multiSceneAnc),
    migrationValue(SOUND_MODES_FIELD_WIND_NOISE, windNoiseMigrationValue(soundModes.windNoise)),
    migrationValue(
      SOUND_MODES_FIELD_SENSITIVITY,
      soundModes.noiseCancelingAdaptiveSensitivityLevel,
    ),
  ];
}

export function soundModesFromMigrationState(state: MigrationValue[]): A3959SoundModes {
  const [isSuppressionEnabled, isDetected] = state[SOUND_MODES_FIELD_WIND_NOISE].value as [
    boolean,
    boolean,
  ];
  return {
    ambientSoundMode: state[SOUND_MODES_FIELD_AMBIENT].value as AmbientSoundMode,
    noiseCancelingMode: state[SOUND_MODES_FIELD_NC_MODE].value as A3959NoiseCancelingMode,
    adaptiveNoiseCanceling: clampAdaptiveNoiseCanceling(
      state[SOUND_MODES_FIELD_ADAPTIVE].value as number,
    ),
    manualNoiseCanceling: clampManualNoiseCanceling(
      state[SOUND_MODES_FIELD_MANUAL].value as number,
    ),
    multiSceneAnc: state[SOUND_MODES_FIELD_MULTI_SCENE].value as MultiSceneNoiseCanceling,
    windNoise: { isSuppressionEnabled, isDetected },
    noiseCancelingAdaptiveSensitivityLevel: state[SOUND_MODES_FIELD_SENSITIVITY].value as number,
  };
}

/**
 * Requirements generated by the `MigrationSteps` derive macro for the Rust struct. Each entry
 * names the parent field index and the parent values that allow the field to be changed.
 */
export const a3959SoundModesMigrationPlanner = new MigrationPlanner([
  // ambientSoundMode: root
  null,
  // noiseCancelingMode: only while ambient sound mode is noise canceling
  {
    index: SOUND_MODES_FIELD_AMBIENT,
    values: [migrationValue(SOUND_MODES_FIELD_AMBIENT, "noiseCanceling")],
  },
  // adaptiveNoiseCanceling: only while the ANC mode is adaptive
  {
    index: SOUND_MODES_FIELD_NC_MODE,
    values: [migrationValue(SOUND_MODES_FIELD_NC_MODE, "adaptive")],
  },
  // manualNoiseCanceling: only while the ANC mode is manual
  {
    index: SOUND_MODES_FIELD_NC_MODE,
    values: [migrationValue(SOUND_MODES_FIELD_NC_MODE, "manual")],
  },
  // multiSceneAnc: only while the ANC mode is multi scene
  {
    index: SOUND_MODES_FIELD_NC_MODE,
    values: [migrationValue(SOUND_MODES_FIELD_NC_MODE, "multiScene")],
  },
  // windNoise: only while ambient sound mode is noise canceling or transparency
  {
    index: SOUND_MODES_FIELD_AMBIENT,
    values: [
      migrationValue(SOUND_MODES_FIELD_AMBIENT, "noiseCanceling"),
      migrationValue(SOUND_MODES_FIELD_AMBIENT, "transparency"),
    ],
  },
  // noiseCancelingAdaptiveSensitivityLevel: root
  null,
]);

/**
 * Plans the sound mode transition as a list of intermediate states, each of which is sent to the
 * device as its own `[0x06, 0x81]` packet.
 */
export function planSoundModesMigration(
  from: A3959SoundModes,
  to: A3959SoundModes,
): A3959SoundModes[] {
  const path = a3959SoundModesMigrationPlanner.migrate(
    soundModesToMigrationState(from),
    soundModesToMigrationState(to),
  );
  return path.map(soundModesFromMigrationState);
}
