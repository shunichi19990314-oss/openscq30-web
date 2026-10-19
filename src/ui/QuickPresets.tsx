import { useState } from "react";

import type { SettingDescriptor, SettingValue } from "../lib/settings";
import type { QuickPresetStore } from "../session/storage";
import { PRESETTABLE_SETTING_IDS, settingToValue } from "../session/session";
import { useApp } from "./context";
import { useQuickPresets } from "./useQuickPresets";
import { PlusIcon } from "./icons";

/**
 * Quick presets: capture the current settings once and re-apply them later. Stored in the browser
 * (openscq30-lib keeps these in sqlite).
 */
export function QuickPresets({
  store,
  descriptors,
  disabled,
  onApply,
}: {
  store: QuickPresetStore;
  descriptors: SettingDescriptor[];
  disabled: boolean;
  onApply: (values: Array<[string, SettingValue]>) => Promise<void>;
}) {
  const { t } = useApp();
  const presets = useQuickPresets(store);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  const capture = (): Array<{ id: string; value: SettingValue }> => {
    const captured: Array<{ id: string; value: SettingValue }> = [];
    for (const descriptor of descriptors) {
      if (!PRESETTABLE_SETTING_IDS.includes(descriptor.id)) continue;
      const value = settingToValue(descriptor);
      if (!value) continue;
      // A null select means "custom" or "disabled"; capturing it would undo the user's intent.
      if (value.type === "string" && value.value === null) continue;
      captured.push({ id: descriptor.id, value });
    }
    return captured;
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t("quick-presets")}</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={() => {
            setCreating((value) => !value);
            setName("");
          }}
        >
          <PlusIcon width={15} height={15} />
          {t("create-quick-preset")}
        </button>
      </div>

      {creating ? (
        <div className="inline-form">
          <input
            className="input"
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
            className="btn"
            disabled={!name.trim() || disabled}
            onClick={() => {
              store.save(name.trim(), capture());
              setCreating(false);
            }}
          >
            {t("save")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
            {t("cancel")}
          </button>
        </div>
      ) : null}

      {presets.length === 0 ? (
        <p className="hint">{t("quick-presets-empty")}</p>
      ) : (
        <ul className="preset-list">
          {presets.map((preset, index) => (
            <li key={preset.id} style={{ ["--i" as string]: index }}>
              <span className="preset-name">{preset.name}</span>
              <span className="preset-count">{t("preset-setting-count", { count: preset.values.length })}</span>
              <button
                type="button"
                className="btn btn-secondary"
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
                {applying === preset.id ? (
                  <>
                    <span className="spinner" />
                    {t("applying-setting")}
                  </>
                ) : (
                  t("apply-quick-preset")
                )}
              </button>
              <button
                type="button"
                className="btn btn-icon"
                disabled={disabled}
                aria-label={t("delete-quick-preset")}
                title={t("delete-quick-preset")}
                onClick={() => store.remove(preset.id)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden focusable="false">
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
