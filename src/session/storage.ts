/**
 * Browser storage.
 *
 * openscq30-lib keeps custom equalizer profiles and quick presets in a sqlite database. The web
 * port keeps them in localStorage, scoped per device model, and uses the same JSON shape as
 * upstream's import/export so profiles can be moved between the desktop app and this one.
 */

import type { CustomEqualizerProfile, CustomProfileStore } from "../devices/a3959/controller";
import type { SettingValue } from "../lib/settings";

const PREFIX = "openscq30-web";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, quota); the app keeps working in memory.
  }
}

export class LocalStorageProfileStore implements CustomProfileStore {
  private profiles: CustomEqualizerProfile[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly key = `${PREFIX}:equalizer-profiles:soundcore-a3959`) {
    this.profiles = read<CustomEqualizerProfile[]>(key, []);
  }

  /**
   * Returns a stable reference so it can be used as a `useSyncExternalStore` snapshot. Mutations
   * replace the array.
   */
  list(): CustomEqualizerProfile[] {
    return this.profiles;
  }

  upsert(name: string, volumeAdjustments: number[]): void {
    const existing = this.profiles.find((profile) => profile.name === name);
    if (existing) {
      this.profiles = this.profiles.map((profile) =>
        profile.name === name ? { name, volumeAdjustments: volumeAdjustments.slice() } : profile,
      );
    } else {
      this.profiles = [...this.profiles, { name, volumeAdjustments: volumeAdjustments.slice() }];
    }
    this.persist();
  }

  remove(name: string): void {
    this.profiles = this.profiles.filter((profile) => profile.name !== name);
    this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(): void {
    write(this.key, this.profiles);
    for (const listener of this.listeners) listener();
  }
}

export interface QuickPreset {
  id: string;
  name: string;
  values: Array<{ id: string; value: SettingValue }>;
  createdAt: number;
}

export class QuickPresetStore {
  private presets: QuickPreset[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly key = `${PREFIX}:quick-presets:soundcore-a3959`) {
    this.presets = read<QuickPreset[]>(key, []);
  }

  /** Stable reference, see `LocalStorageProfileStore.list`. */
  list(): QuickPreset[] {
    return this.presets;
  }

  save(name: string, values: Array<{ id: string; value: SettingValue }>): QuickPreset {
    const preset: QuickPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      values,
      createdAt: Date.now(),
    };
    this.presets = [...this.presets, preset];
    this.persist();
    return preset;
  }

  remove(id: string): void {
    this.presets = this.presets.filter((preset) => preset.id !== id);
    this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(): void {
    write(this.key, this.presets);
    for (const listener of this.listeners) listener();
  }
}

/* --------------------------------------------------------- app settings --- */

export interface AppSettings {
  language: "ja" | "en";
  /** Extra Bluetooth service class IDs to allow in the port chooser. */
  customServiceUuids: string[];
  /** Also offer devices that only expose the standard SPP service in the chooser. */
  includeSpp: boolean;
}

const APP_SETTINGS_KEY = `${PREFIX}:settings`;

export const defaultAppSettings: AppSettings = {
  language: "ja",
  customServiceUuids: [],
  includeSpp: false,
};

export function loadAppSettings(): AppSettings {
  return { ...defaultAppSettings, ...read<Partial<AppSettings>>(APP_SETTINGS_KEY, {}) };
}

export function saveAppSettings(settings: AppSettings): void {
  write(APP_SETTINGS_KEY, settings);
}
