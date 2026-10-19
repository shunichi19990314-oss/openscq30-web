import { useMemo, useState } from "react";

import { CATEGORY_ORDER, type CategoryId, type SettingValue } from "../lib/settings";
import { SETTING_LABEL_KEYS, categoryLabelKey } from "../i18n";
import type { SessionSnapshot } from "../session/session";
import type { Session } from "../session/session";
import type { QuickPresetStore } from "../session/storage";
import type { A3959SettingId } from "../devices/a3959/controller";
import { dualFirmwareVersionLeft, firmwareVersionToString } from "../lib/structures/common";
import { useApp } from "./context";
import { SettingControl } from "./controls";
import { QuickPresets } from "./QuickPresets";
import { LogPanel } from "./LogPanel";
import { useQuickPresets } from "./useQuickPresets";

export function DeviceScreen({
  snapshot,
  session,
  presetStore,
  onDisconnect,
}: {
  snapshot: SessionSnapshot;
  session: Session;
  presetStore: QuickPresetStore;
  onDisconnect: () => void;
}) {
  const { t } = useApp();
  const state = snapshot.state;
  const [showLog, setShowLog] = useState(false);
  const presets = useQuickPresets(presetStore);

  const grouped = useMemo(() => {
    const byCategory = new Map<CategoryId, typeof snapshot.settings>();
    for (const descriptor of snapshot.settings) {
      const list = byCategory.get(descriptor.category) ?? [];
      list.push(descriptor);
      byCategory.set(descriptor.category, list);
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      descriptors: byCategory.get(category) ?? [],
    })).filter((group) => group.descriptors.length > 0);
  }, [snapshot.settings]);

  if (!state) return null;

  const firmware = dualFirmwareVersionLeft(state.dualFirmwareVersion);
  const batteryLeft = state.dualBattery.left.level;
  const batteryRight = state.dualBattery.right.level;

  const apply = async (id: string, value: SettingValue): Promise<void> => {
    try {
      await session.applySetting(id as A3959SettingId, value);
    } catch {
      // the session already surfaced the error in the log and banner
    }
  };

  return (
    <div className="screen device-screen">
      <header className="card device-header">
        <div className="device-title">
          <h1>Soundcore P30i</h1>
          <span className="badge">A3959</span>
          <span className="badge ghost-badge">
            {snapshot.connectionKind === "demo" ? t("demo-mode") : t("connection-serial")}
          </span>
        </div>

        <div className="device-meta">
          <span className="meta-item">
            <strong>{t("battery-level-left")}</strong>
            {batteryLeft === 255 ? "—" : `${batteryLeft * 10}%`}
            {state.dualBattery.left.isCharging ? " ⚡" : ""}
          </span>
          <span className="meta-item">
            <strong>{t("battery-level-right")}</strong>
            {batteryRight === 255 ? "—" : `${batteryRight * 10}%`}
            {state.dualBattery.right.isCharging ? " ⚡" : ""}
          </span>
          <span className="meta-item">
            <strong>{t("tws-status")}</strong>
            {state.twsStatus.isConnected ? t("connected") : t("disconnected")}
          </span>
          <span className="meta-item">
            <strong>{t("firmware-version-left")}</strong>
            {firmware ? firmwareVersionToString(firmware) : "—"}
          </span>
        </div>

        <div className="device-actions">
          <button type="button" className="ghost" disabled={snapshot.busy} onClick={() => void session.refresh()}>
            {t("refresh-state")}
          </button>
          <button type="button" className="ghost" onClick={() => setShowLog((value) => !value)}>
            {showLog ? "▾" : "▸"} {t("log-title")}
          </button>
          <button type="button" className="danger" onClick={onDisconnect}>
            {t("disconnect")}
          </button>
        </div>

        {snapshot.connectionKind === "demo" ? (
          <div className="demo-controls">
            <span className="demo-label">{t("demo-mode-hint")}</span>
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => session.simulateTwsDisconnect()}>
                {t("simulate-tws-disconnect")}
              </button>
              <button type="button" className="ghost" onClick={() => session.simulateTwsConnect()}>
                {t("simulate-tws-connect")}
              </button>
              <button type="button" className="ghost" onClick={() => session.simulateBatteryDrain()}>
                {t("simulate-battery-drain")}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {snapshot.error ? (
        <div className="banner error" role="alert">
          {snapshot.error}
        </div>
      ) : null}

      <QuickPresets
        store={presetStore}
        presets={presets}
        descriptors={snapshot.settings}
        disabled={snapshot.busy || snapshot.status !== "connected"}
        onApply={async (values) => {
          try {
            await session.applyBatch(values as Array<[A3959SettingId, SettingValue]>);
          } catch {
            // surfaced by the session
          }
        }}
      />

      {snapshot.busy ? <div className="busy-indicator">{t("applying-setting")}</div> : null}

      {grouped.map((group) => (
        <section className="card category" key={group.category}>
          <h2>{t(categoryLabelKey(group.category))}</h2>
          {group.descriptors.map((descriptor) => (
            <SettingControl
              key={descriptor.id}
              descriptor={descriptor}
              label={t(SETTING_LABEL_KEYS[descriptor.id] ?? descriptor.id)}
              disabled={snapshot.busy || snapshot.status !== "connected"}
              t={t}
              onChange={(value) => void apply(descriptor.id, value)}
            />
          ))}
        </section>
      ))}

      {showLog ? <LogPanel logs={snapshot.logs} onClear={() => session.clearLog()} /> : null}
    </div>
  );
}
