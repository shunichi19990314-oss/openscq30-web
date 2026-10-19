import { useSyncExternalStore } from "react";

import type { QuickPreset, QuickPresetStore } from "../session/storage";

/** Subscribes to the quick preset store. `list()` returns a stable reference by design. */
export function useQuickPresets(store: QuickPresetStore): QuickPreset[] {
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.list(),
    () => store.list(),
  );
}
