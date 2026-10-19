/**
 * Touch control (button) configuration for the Soundcore P30i (A3959).
 *
 * Ported from `BUTTON_CONFIGURATION_SETTINGS` in openscq30-lib
 * `lib/src/devices/soundcore/a3959.rs`.
 */

import {
  COMMON_ACTIONS,
  type ButtonConfigurationSettings,
} from "../../lib/structures/buttons";

export const A3959_BUTTON_CONFIGURATION: ButtonConfigurationSettings = {
  supportsSetAllPacket: false,
  ignoreEnabledFlag: true,
  setButtonActionCommandOverride: null,
  order: [
    "leftSinglePress",
    "rightSinglePress",
    "leftDoublePress",
    "rightDoublePress",
    "leftTriplePress",
    "rightTriplePress",
    "leftLongPress",
    "rightLongPress",
  ],
  settings: [
    {
      parseSettings: { enabledFlagKind: "none", actionKind: "twsLowBits" },
      buttonId: 2,
      pressKind: "single",
      availableActions: COMMON_ACTIONS,
      disableMode: "individualDisable",
    },
    {
      parseSettings: { enabledFlagKind: "none", actionKind: "twsLowBits" },
      buttonId: 0,
      pressKind: "double",
      availableActions: COMMON_ACTIONS,
      disableMode: "individualDisable",
    },
    {
      parseSettings: { enabledFlagKind: "none", actionKind: "twsLowBits" },
      buttonId: 5,
      pressKind: "triple",
      availableActions: COMMON_ACTIONS,
      disableMode: "individualDisable",
    },
    {
      parseSettings: { enabledFlagKind: "none", actionKind: "twsLowBits" },
      buttonId: 1,
      pressKind: "long",
      availableActions: COMMON_ACTIONS,
      disableMode: "individualDisable",
    },
  ],
};
