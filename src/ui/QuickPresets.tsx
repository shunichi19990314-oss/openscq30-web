import { useState } from "react";

import type { SettingDescriptor, SettingValue } from "../lib/settings";
import type { QuickPreset, QuickPresetStore } from "../session/storage";
import { PRESETTABLE_SETTING_IDS, settingToValue } from "../session/session";
import { useApp } from "./context";

export function QuickPresets({
  store,
  presets,
  descriptors,
  disabled,
  onApply,
}: {
  store: QuickPresetStore;
  presets: QuickPreset[];
  descriptors: SettingDescriptor[];
  disabled: boolean;
  onApply: (values: Array<[string, SettingValue]>) => Promise<void>;
}) {
  const { t } = useApp();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  const capture = (): Array<{ id: string; value: SettingValue }> => {
    const captured: Array<{ id: string; value: SettingValue }> = [];
    for (const descriptor of descriptors) {
      if (!PRESETTABLE_SETTING_IDS.includes(descriptor.id)) continue;
      const value = settingToValue(descriptor);
      if (!value) continue;
      if (value.type === "string" && value.value === null) continue;
      captured.push({ id: descriptor.id, value });
    }
    return captured;
  };

  return (
    <section className="card quick-presets">
      <div className="card-header">
        <h2>{t("quick-presets")}</h2>
        <button
          type="button"
          className="ghost"
          disabled={disabled}
          onClick={() => {
            setCreating((value) => !value);
            setName("");
          }}
        >
          {t("create-quick-preset")}
        </button>
      </div>

      {creating ? (
        <div className="inline-form">
          <input
            autoFocus
            value={name}
            placeholder={t("quick-preset-name")}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) {
                store.save(name.trim(), capture());
                setCreating(false);
              }
              if (event.key === "Escape") setCreating(false);
            }}
          />
          <button
            type="button"
            disabled={!name.trim() || disabled}
            onClick={() => {
              store.save(name.trim(), capture());
              setCreating(false);
            }}
          >
            {t("save")}
          </button>
          <button type="button" className="ghost" onClick={() => setCreating(false)}>
            {t("cancel")}
          </button>
        </div>
      ) : null}

      {presets.length === 0 ? (
        <p className="hint">
          {t("create-quick-preset")}: {t("quick-presets")}
        </p>
      ) : (
        <ul className="preset-list">
          {presets.map((preset) => (
            <li key={preset.id}>
              <span className="preset-name">{preset.name}</span>
              <span className="preset-count">{preset.values.length}</span>
              <button
                type="button"
                disabled={disabled || applying !== null}
                onClick={async () => {
                  setApplying(preset.id);
                  try {
                    await onApply(
                      preset.values.map((entry) => [entry.id, entry.value] as [string, SettingValue]),
                    );
                  } finally {
                    setApplying(null);
                  }
                }}
              >
                {applying === preset.id ? t("applying-setting") : t("apply-quick-preset")}
              </button>
              <button
                type="button"
                className="ghost danger-text"
                disabled={disabled}
                title={t("delete-quick-preset")}
                onClick={() => store.remove(preset.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
