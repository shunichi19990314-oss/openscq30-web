import { describe, expect, it } from "vitest";

import {
  A3959_EQUALIZER_CONFIG,
  applyDrc,
  volumeAdjustmentsFromBytes,
  volumeAdjustmentsToBytes,
} from "../src/lib/structures/equalizer";
import { setEqualizerWithDrcPacket } from "../src/devices/a3959/packets";
import { encodePacket, createPacket } from "../src/lib/packet";
import { visibleBandsToVolumeAdjustments } from "../src/devices/a3959/presets";

const config = { ...A3959_EQUALIZER_CONFIG, bands: 8 };

describe("volume adjustments", () => {
  it("converts adjustments to packet bytes and back", () => {
    const bytes = [0, 80, 100, 120, 140, 160, 180, 240];
    const adjustments = [-120, -40, -20, 0, 20, 40, 60, 120];
    expect(
      Array.from(volumeAdjustmentsToBytes({ values: adjustments }, config)),
    ).toEqual(bytes);
    expect(volumeAdjustmentsFromBytes(Uint8Array.from(bytes), config).values).toEqual(adjustments);
  });

  it("clamps values outside the supported range", () => {
    const clamped = volumeAdjustmentsToBytes(
      { values: [-32768, 32767, 0, 0, 0, 0, 0, 0] },
      config,
    );
    expect(clamped[0]).toBe(0); // min volume
    expect(clamped[1]).toBe(254); // max volume (134 + 120)
  });
});

describe("DRC", () => {
  const examples: Array<[number[], number[]]> = [
    [
      [-60, 60, 23, 120, 22, -120, -4, 16],
      [-1.1060872, 1.367825, -0.842687, 1.571185, 0.321646, -1.79549, 0.61513, 0.083543].map(
        (value) => Math.round(value * 10),
      ),
    ],
    [
      [120, 120, 120, 120, 120, 120, 120, 120],
      [0.96507597, 0.6198, 0.72816, 0.70452, 0.70452, 0.72816, 0.7338, 1.253076].map((value) =>
        Math.round(value * 10),
      ),
    ],
    [
      [-120, -120, -120, -120, -120, -120, -120, -120],
      [-0.96507597, -0.6198, -0.72816, -0.70452, -0.70452, -0.72816, -0.7338, -1.253076].map(
        (value) => Math.round(value * 10),
      ),
    ],
    [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
  ];

  it.each(examples)("matches the expected DRC output", (input, expected) => {
    const actual = applyDrc({ values: input }, config);
    expect(actual.values).toEqual(expected);
  });

  it("resets bands 9 and 10 to their defaults", () => {
    const actual = applyDrc(
      { values: [-60, 60, 23, 120, 22, -120, -4, 16, 50, 60] },
      A3959_EQUALIZER_CONFIG,
    );
    expect(actual.values[8]).toBe(0);
    expect(actual.values[9]).toBe(-120);
  });
});

describe("set equalizer with drc packet", () => {
  it("matches the manually crafted packet from openscq30-lib", () => {
    const expected = [
      0x08, 0xee, 0x00, 0x00, 0x00, 0x02, 0x83, 0x1c, 0x00, 0xfe, 0xfe, 0x3c, 0xb4, 0x8f, 0xf0,
      0x8e, 0x00, 0x74, 0x88, 0x6d, 0x86, 0x70, 0x88, 0x7b, 0x66, 0x7e, 0x79, 0x4f,
    ];
    const configuration = {
      presetId: 0xfefe,
      channels: [{ values: [-60, 60, 23, 120, 22, -120, -4, 16] }],
    };
    const packet = setEqualizerWithDrcPacket(configuration, {
      ...A3959_EQUALIZER_CONFIG,
      bands: 8,
    });
    expect(Array.from(encodePacket("outbound", packet))).toEqual(expected);
    // The 8 band configuration above is what the packet builder produces; also verify the
    // generic path with the same command and body length.
    expect(packet.command).toEqual([0x02, 0x83]);
    expect(createPacket([0x02, 0x83]).command).toEqual(packet.command);
  });

  it("pads the two invisible bands with the fixed values", () => {
    const adjustments = visibleBandsToVolumeAdjustments([-19, 0, 41, 51, 51, 32, 13, -35]);
    expect(adjustments.values).toEqual([-19, 0, 41, 51, 51, 32, 13, -35, 0, 0]);
  });
});
