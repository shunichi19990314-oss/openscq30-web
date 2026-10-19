/**
 * Equalizer configuration, volume adjustments and the DRC algorithm.
 *
 * Ported from openscq30-lib `lib/src/devices/soundcore/common/structures/equalizer_configuration.rs`
 * and `structures/volume_adjustments.rs`.
 */

import { ByteReader, clamp, concatBytes } from "../bytes";

/**
 * Volume adjustments are stored in the packet as a single byte per band. The raw value is the
 * adjustment in dB times 10^fractionDigits, offset by `minVolume`.
 *
 * For the common configuration used by the P30i (A3959):
 *   minVolume = -120, maxVolume = 134, fractionDigits = 1
 * so a packet byte of 120 means 0.0 dB and 0xff means "channel not present".
 */
export interface VolumeAdjustmentConfig {
  bands: number;
  minVolume: number;
  maxVolume: number;
  fractionDigits: number;
}

export const COMMON_VOLUME_ADJUSTMENT_CONFIG: VolumeAdjustmentConfig = {
  bands: 10,
  minVolume: -120,
  maxVolume: 134,
  fractionDigits: 1,
};

export interface VolumeAdjustments {
  values: number[];
}

export function clampVolumeAdjustments(
  values: number[],
  config: VolumeAdjustmentConfig,
): number[] {
  return values.map((value) => clamp(Math.round(value), config.minVolume, config.maxVolume));
}

export function volumeAdjustmentsToBytes(
  adjustments: VolumeAdjustments,
  config: VolumeAdjustmentConfig,
): Uint8Array {
  return Uint8Array.from(
    clampVolumeAdjustments(adjustments.values, config),
    (value) => value - config.minVolume,
  );
}

export function volumeAdjustmentsFromBytes(
  bytes: Uint8Array,
  config: VolumeAdjustmentConfig,
): VolumeAdjustments {
  const values = Array.from(bytes, (byte) => byte + config.minVolume);
  return { values: clampVolumeAdjustments(values, config) };
}

/** Reads one channel; `0xff` in the first byte means the channel is not present. */
export function parseOptionalVolumeAdjustments(
  reader: ByteReader,
  config: VolumeAdjustmentConfig,
): VolumeAdjustments | null {
  return reader.withContext("volume adjustment", () => {
    const bytes = reader.take(config.bands);
    if (bytes[0] === 0xff) return null;
    return volumeAdjustmentsFromBytes(bytes, config);
  });
}

export function optionalVolumeAdjustmentsBytes(
  adjustments: VolumeAdjustments | null,
  config: VolumeAdjustmentConfig,
): Uint8Array {
  if (!adjustments) return new Uint8Array(config.bands).fill(0xff);
  return volumeAdjustmentsToBytes(adjustments, config);
}

/* ------------------------------------------------------------------- DRC --- */

const SMALLER_COEFFICIENT = 0.85;
const LARGER_COEFFICIENT = 0.95;

const BAND_COEFFICIENTS: number[][] = [
  // 0
  [
    1.26,
    -0.71 * SMALLER_COEFFICIENT,
    0.177,
    -0.0494,
    0.0345,
    -0.0197,
    0.0075,
    -0.00217,
  ],
  // 1
  [
    -0.71 * SMALLER_COEFFICIENT,
    1.73 * LARGER_COEFFICIENT,
    0.0, // subtraction
    0.204,
    -0.068,
    0.045,
    -0.0235,
    0.0075,
  ],
  // 2
  [
    0.177,
    -0.81 * SMALLER_COEFFICIENT,
    1.73 * LARGER_COEFFICIENT,
    -0.81 * SMALLER_COEFFICIENT,
    0.208,
    -0.07,
    0.045,
    -0.0197,
  ],
  // 3
  [
    -0.0494,
    0.204,
    0.0, // subtraction
    1.73 * LARGER_COEFFICIENT,
    -0.82 * SMALLER_COEFFICIENT,
    0.208,
    -0.068,
    0.0345,
  ],
  // 4
  [
    0.0345,
    -0.068,
    0.208,
    -0.82 * SMALLER_COEFFICIENT,
    1.73 * LARGER_COEFFICIENT,
    0.0, // subtraction
    0.204,
    -0.0494,
  ],
  // 5
  [
    -0.0197,
    0.045,
    -0.07,
    0.208,
    -0.81 * SMALLER_COEFFICIENT,
    1.73 * LARGER_COEFFICIENT,
    -0.81 * SMALLER_COEFFICIENT,
    0.177,
  ],
  // 6
  [
    0.0075,
    -0.0235,
    0.045,
    -0.068,
    0.204,
    0.0, // subtraction
    1.83 * LARGER_COEFFICIENT,
    -0.71 * SMALLER_COEFFICIENT,
  ],
  // 7
  [
    -0.00217,
    0.0075,
    -0.0197,
    0.0345,
    -0.0494,
    0.177,
    -0.71 * SMALLER_COEFFICIENT,
    1.5,
  ],
];

/** Bands beyond the 8 the DRC algorithm knows about are reset to these defaults. */
const BAND_DEFAULTS = [0, 0, 0, 0, 0, 0, 0, 0, 0, -120];

/**
 * `VolumeAdjustments::apply_drc`.
 *
 * Some devices do not use the raw equalizer values as they are: the values sent to the device are
 * the result of this dynamic range compensation. The algorithm only affects the first 8 bands, and
 * bands 9 and beyond are replaced with fixed defaults.
 */
export function applyDrc(
  adjustments: VolumeAdjustments,
  config: VolumeAdjustmentConfig,
): VolumeAdjustments {
  const scale = Math.pow(10, config.fractionDigits);
  const dbValues = adjustments.values.map((value) => value / scale);

  const lowsSubtraction = (dbValues[2] ?? 0) * 0.81 * SMALLER_COEFFICIENT;
  const highsSubtraction = (dbValues[5] ?? 0) * 0.81 * SMALLER_COEFFICIENT;

  const multiplied: number[] = [];
  for (let band = 0; band < 8; band++) {
    const coefficients = BAND_COEFFICIENTS[band];
    let accumulator = 0;
    for (let index = 0; index < 8; index++) {
      const adjustment = dbValues[index] ?? 0;
      // Some special cases where a particular band's adjustment is not factored in.
      if ((band === 1 || band === 3) && index === 2) {
        accumulator -= lowsSubtraction;
      } else if ((band === 4 || band === 6) && index === 5) {
        accumulator -= highsSubtraction;
      } else {
        accumulator += adjustment * coefficients[index];
      }
    }
    multiplied.push(accumulator);
  }

  const newValues: number[] = multiplied.map((value) => {
    const divided = value / 10;
    return Math.round(divided * scale);
  });

  const withAllBands: number[] = [];
  for (let band = 0; band < config.bands; band++) {
    withAllBands.push(newValues[band] ?? BAND_DEFAULTS[band] ?? 0);
  }

  return { values: clampVolumeAdjustments(withAllBands, config) };
}

/* -------------------------------------------------- equalizer configuration --- */

export interface EqualizerConfiguration {
  presetId: number;
  /** One entry per channel; null means the channel is not present in the packet. */
  channels: Array<VolumeAdjustments | null>;
}

export interface EqualizerConfig extends VolumeAdjustmentConfig {
  channels: number;
}

export const A3959_EQUALIZER_CONFIG: EqualizerConfig = {
  channels: 1,
  ...COMMON_VOLUME_ADJUSTMENT_CONFIG,
};

export function parseEqualizerConfiguration(
  reader: ByteReader,
  config: EqualizerConfig,
): EqualizerConfiguration {
  return reader.withContext("equalizer configuration", () => {
    const presetId = reader.u16le();
    const channels: Array<VolumeAdjustments | null> = [];
    for (let channel = 0; channel < config.channels; channel++) {
      channels.push(parseOptionalVolumeAdjustments(reader, config));
    }
    return { presetId, channels };
  });
}

export function equalizerConfigurationBytes(
  configuration: EqualizerConfiguration,
  config: EqualizerConfig,
): Uint8Array {
  const chunks: ArrayLike<number>[] = [
    [configuration.presetId & 0xff, (configuration.presetId >> 8) & 0xff],
  ];
  for (let channel = 0; channel < config.channels; channel++) {
    chunks.push(optionalVolumeAdjustmentsBytes(configuration.channels[channel] ?? null, config));
  }
  return concatBytes(chunks);
}

/** The first present channel, which is what the UI shows. */
export function primaryVolumeAdjustments(
  configuration: EqualizerConfiguration,
): VolumeAdjustments | null {
  return configuration.channels.find((channel) => channel !== null) ?? null;
}

export function equalizerConfigurationsEqual(
  a: EqualizerConfiguration,
  b: EqualizerConfiguration,
): boolean {
  if (a.presetId !== b.presetId) return false;
  if (a.channels.length !== b.channels.length) return false;
  for (let i = 0; i < a.channels.length; i++) {
    const left = a.channels[i];
    const right = b.channels[i];
    if (left === null || right === null) {
      if (left !== right) return false;
      continue;
    }
    if (left.values.length !== right.values.length) return false;
    for (let band = 0; band < left.values.length; band++) {
      if (left.values[band] !== right.values[band]) return false;
    }
  }
  return true;
}
