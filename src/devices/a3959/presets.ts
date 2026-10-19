/**
 * Equalizer presets for the Soundcore P30i (A3959).
 *
 * Ported from openscq30-lib `modules::equalizer::common_settings_type_2`.
 */

import type { VolumeAdjustments } from "../../lib/structures/equalizer";

export interface EqualizerPreset {
  id: number;
  /** Stable identifier, matches openscq30-lib's preset names. */
  name: string;
  /** 10 bands; the last two are not visible in the UI. */
  volumeAdjustments: number[];
}

/** Bands shown to the user. The device has 10, but only 8 are exposed. */
export const VISIBLE_BANDS = 8;
export const PRESET_BANDS = 10;
export const BAND_HZ = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
export const PRESET_MIN_VOLUME = -60;
export const PRESET_MAX_VOLUME = 60;
export const MIN_VOLUME = -120;
export const MAX_VOLUME = 134;
export const FRACTION_DIGITS = 1;
export const CUSTOM_PRESET_ID = 0xfefe;
/** Fixed values written to the two invisible bands when the user edits the visible bands. */
export const INVISIBLE_BAND_VALUES = [0, 0];

function preset(id: number, name: string, volumeAdjustments: number[]): EqualizerPreset {
  return { id, name, volumeAdjustments };
}

export const EQUALIZER_PRESETS: EqualizerPreset[] = [
  preset(0, "SoundcoreSignature", [0, 0, 0, 0, 0, 0, 0, 0, 0, -120]),
  preset(1, "Acoustic", [40, 10, 20, 20, 40, 40, 40, 20, 0, -120]),
  preset(2, "BassBooster", [40, 30, 10, 0, 0, 0, 0, 0, 0, -120]),
  preset(3, "BassReducer", [-40, -30, -10, 0, 0, 0, 0, 0, 0, -120]),
  preset(4, "Classical", [30, 30, -20, -20, 0, 20, 30, 40, 0, -120]),
  preset(5, "Podcast", [-30, 20, 40, 40, 30, 20, 0, -20, 0, -120]),
  preset(6, "Dance", [20, -30, -10, 10, 20, 20, 10, -30, 0, -120]),
  preset(7, "Deep", [20, 10, 30, 30, 20, -20, -40, -50, 0, -120]),
  preset(8, "Electronic", [30, 20, -20, 20, 10, 20, 30, 30, 0, -120]),
  preset(9, "Flat", [-20, -20, -10, 0, 0, 0, -20, -20, 0, -120]),
  preset(10, "HipHop", [20, 30, -10, -10, 20, -10, 20, 30, 0, -120]),
  preset(11, "Jazz", [20, 20, -20, -20, 0, 20, 30, 40, 0, -120]),
  preset(12, "Latin", [0, 0, -20, -20, -20, 0, 30, 50, 0, -120]),
  preset(13, "Lounge", [-10, 20, 40, 30, 0, -20, 20, 10, 0, -120]),
  preset(14, "Piano", [0, 30, 30, 20, 40, 50, 30, 40, 0, -120]),
  preset(15, "Pop", [-10, 10, 30, 30, 10, -10, -20, -30, 0, -120]),
  preset(16, "RnB", [60, 20, -20, -20, 20, 30, 30, 40, 0, -120]),
  preset(17, "Rock", [30, 20, -10, -10, 10, 30, 40, 50, 0, -120]),
  preset(18, "SmallSpeakers", [40, 30, 10, 0, -20, -30, -40, -40, 0, -120]),
  preset(19, "SpokenWord", [-30, -20, 10, 20, 20, 10, 0, -30, 0, -120]),
  preset(20, "TrebleBooster", [-20, -20, -20, -10, 10, 20, 20, 40, 0, -120]),
  preset(21, "TrebleReducer", [0, 0, 0, -20, -30, -40, -40, -60, 0, -120]),
];

export function findPresetById(id: number): EqualizerPreset | undefined {
  return EQUALIZER_PRESETS.find((preset) => preset.id === id);
}

export function findPresetByName(name: string): EqualizerPreset | undefined {
  return EQUALIZER_PRESETS.find((preset) => preset.name === name);
}

/**
 * Combines the visible band values with the fixed invisible band values, matching
 * `values_to_volume_adjustments` with `InvisibleBandsMode::Fixed`.
 */
export function visibleBandsToVolumeAdjustments(values: number[]): VolumeAdjustments {
  const all: number[] = [];
  for (let band = 0; band < PRESET_BANDS; band++) {
    all.push(
      values[band] ?? INVISIBLE_BAND_VALUES[band - VISIBLE_BANDS] ?? 0,
    );
  }
  return { values: all };
}

/** The visible part of a preset, for the equalizer preview in the UI. */
export function presetVisibleValues(preset: EqualizerPreset): number[] {
  return preset.volumeAdjustments.slice(0, VISIBLE_BANDS);
}
