import { useCallback, useMemo, useRef, useState } from "react";

import { CATEGORY_ORDER, type CategoryId, type SettingDescriptor, type SettingValue } from "../lib/settings";
import { SETTING_LABEL_KEYS, categoryLabelKey } from "../i18n";
import type { Session, SessionSnapshot } from "../session/session";
import type { QuickPresetStore } from "../session/storage";
import type { A3959SettingId } from "../devices/a3959/controller";
import { BATTERY_MAX_LEVEL } from "../devices/a3959/controller";
import { dualFirmwareVersionLeft, firmwareVersionToString } from "../lib/structures/common";
import { useApp } from "./context";
import { SettingControl } from "./controls";
import { ButtonGrid, InfoGrid, SwitchCardList } from "./groups";
import { QuickPresets } from "./QuickPresets";
import { LogDrawer } from "./LogPanel";
import { BatteryRing, Collapsible, useToasts, ToastStack } from "./primitives";
import {
  BluetoothIcon,
  GearIcon,
  InfoIcon,
  LinkIcon,
  NoiseCancelingIcon,
  RefreshIcon,
  SlidersIcon,
  TapIcon,
  TerminalIcon,
  PowerIcon,
  CopyIcon,
} from "./icons";

const BUTTON_IDS = new Set([
  "leftSinglePress",
  "rightSinglePress",
  "leftDoublePress",
  "rightDoublePress",
  "leftTriplePress",
  "rightTriplePress",
  "leftLongPress",
  "rightLongPress",
]);

const CYCLE_IDS = new Set([
  "noiseCancelingModeInCycle",
  "transparencyModeInCycle",
  "normalModeInCycle",
]);

const CATEGORY_ICONS: Record<CategoryId, React.ReactNode> = {
  soundModes: <NoiseCancelingIcon />,
  equalizer: <SlidersIcon />,
  equalizerImportExport: <CopyIcon />,
  buttonConfiguration: <TapIcon />,
  dualConnections: <LinkIcon />,
  miscellaneous: <GearIcon />,
  deviceInformation: <InfoIcon />,
};

const DEFAULT_OPEN: Record<CategoryId, boolean> = {
  soundModes: true,
  equalizer: true,
  equalizerImportExport: false,
  buttonConfiguration: true,
  dualConnections: false,
  miscellaneous: false,
  deviceInformation: false,
};

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
  const toasts = useToasts(snapshot.error, snapshot.notice);
  const logToggleRef = useRef<HTMLButtonElement | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ ...DEFAULT_OPEN });

  const toggleCategory = useCallback((category: string) => {
    setOpen((current) => ({ ...current, [category]: !current[category] }));
  }, []);

  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const descriptor of snapshot.settings) {
      map[descriptor.id] = t(SETTING_LABEL_KEYS[descriptor.id] ?? descriptor.id);
    }
    return map;
  }, [snapshot.settings, t]);

  const grouped = useMemo(() => {
    const byCategory = new Map<CategoryId, SettingDescriptor[]>();
    for (const descriptor of snapshot.settings) {
      const list = byCategory.get(descriptor.category) ?? [];
      list.push(descriptor);
      byCategory.set(descriptor.category, list);
    }
    return CATEGORY_ORDER.map((category) => ({ category, descriptors: byCategory.get(category) ?? [] })).filter(
      (group) => group.descriptors.length > 0,
    );
  }, [snapshot.settings]);

  const apply = useCallback(
    async (id: string, value: SettingValue): Promise<void> => {
      try {
        await session.applySetting(id as A3959SettingId, value);
      } catch {
        // The session already surfaced this as a toast.
      }
    },
    [session],
  );

  if (!state) return null;

  const firmware = dualFirmwareVersionLeft(state.dualFirmwareVersion);
  const disabled = snapshot.busy || snapshot.status !== "connected";
  const connectedDevices = state.dualConnections.devices.filter((device) => device.isConnected).length;

  return (
    <main id="main" className="screen device-screen" aria-busy={snapshot.busy}>
      <header className="card device-header">
        <div className="device-title">
          <span className={`status-dot${state.twsStatus.isConnected ? "" : " status-dot-off"}`} />
          <h1>Soundcore P30i</h1>
          <span className="chip">A3959</span>
          <span className="chip">
            <BluetoothIcon width={12} height={12} />
            {t("connection-serial")}
          </span>
        </div>

        <div className="device-meta">
          <BatteryRing
            level={state.dualBattery.left.level}
            maxLevel={BATTERY_MAX_LEVEL}
            isCharging={state.dualBattery.left.isCharging}
            side={t("left")}
          />
          <BatteryRing
            level={state.dualBattery.right.level}
            maxLevel={BATTERY_MAX_LEVEL}
            isCharging={state.dualBattery.right.isCharging}
            side={t("right")}
          />
          <span className="meta-text">
            <strong>{t("tws-status")}</strong>
            {state.twsStatus.isConnected ? t("connected") : t("disconnected")}
          </span>
          <span className="meta-text">
            <strong>{t("header-firmware-left")}</strong>
            {firmware ? firmwareVersionToString(firmware) : "—"}
          </span>
          <span className="meta-text">
            <strong>{t("header-serial")}</strong>
            {state.serialNumber}
          </span>
          <div className="device-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={snapshot.busy}
              onClick={() => void session.refresh().catch(() => undefined)}
            >
              <RefreshIcon width={15} height={15} />
              {t("refresh-state")}
            </button>
            <button
              ref={logToggleRef}
              type="button"
              className="btn btn-ghost"
              aria-pressed={logOpen}
              onClick={() => setLogOpen((value) => !value)}
            >
              <TerminalIcon width={15} height={15} />
              {t("log-title")}
            </button>
            <button type="button" className="btn btn-danger" onClick={onDisconnect}>
              <PowerIcon width={15} height={15} />
              {t("disconnect")}
            </button>
          </div>
        </div>

      </header>

      <QuickPresets
        store={presetStore}
        descriptors={snapshot.settings}
        disabled={disabled}
        onApply={async (values) => {
          try {
            await session.applyBatch(values as Array<[A3959SettingId, SettingValue]>);
            toasts.push(t("quick-preset-applied"), "ok");
          } catch {
            // surfaced by the session
          }
        }}
      />

      <div className="stagger">
        {grouped.map((group, index) => {
          const descriptors = group.descriptors;
          const isButtons = group.category === "buttonConfiguration";
          const isInfo = group.category === "deviceInformation";
          const buttonDescriptors = isButtons ? descriptors.filter((d) => BUTTON_IDS.has(d.id)) : [];
          const cycleDescriptors = isButtons ? descriptors.filter((d) => CYCLE_IDS.has(d.id)) : [];
          const rest = descriptors.filter(
            (descriptor) =>
              !(isButtons && (BUTTON_IDS.has(descriptor.id) || CYCLE_IDS.has(descriptor.id))) &&
              !(isInfo && descriptor.setting.kind === "information"),
          );

          return (
            <div key={group.category} style={{ ["--i" as string]: index, marginBottom: 16 }}>
              <Collapsible
                open={open[group.category] ?? false}
                onToggle={() => toggleCategory(group.category)}
                title={t(categoryLabelKey(group.category))}
                subtitle={categorySummary(group.category, descriptors, t, connectedDevices)}
                icon={CATEGORY_ICONS[group.category]}
              >
                {isButtons && buttonDescriptors.length > 0 ? (
                  <ButtonGrid
                    descriptors={buttonDescriptors}
                    labels={labels}
                    disabled={disabled}
                    t={t}
                    onChange={(id, value) => void apply(id, value)}
                  />
                ) : null}
                {isButtons && cycleDescriptors.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <SwitchCardList
                      descriptors={cycleDescriptors}
                      labels={labels}
                      disabled={disabled}
                      onChange={(id, value) => void apply(id, value)}
                    />
                  </div>
                ) : null}
                {isInfo ? <InfoGrid descriptors={descriptors} labels={labels} /> : null}
                {rest.map((descriptor) => (
                  <SettingControl
                    key={descriptor.id}
                    descriptor={descriptor}
                    label={labels[descriptor.id] ?? descriptor.id}
                    disabled={disabled}
                    t={t}
                    onChange={(value) => void apply(descriptor.id, value)}
                  />
                ))}
              </Collapsible>
            </div>
          );
        })}
      </div>

      {logOpen ? (
        <LogDrawer
          logs={snapshot.logs}
          onClear={() => session.clearLog()}
          onClose={() => {
            setLogOpen(false);
            logToggleRef.current?.focus();
          }}
        />
      ) : null}
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </main>
  );
}

/** One line summary shown in the collapsed header, so state is visible without opening a card. */
function categorySummary(
  category: CategoryId,
  descriptors: SettingDescriptor[],
  t: (key: string, params?: Record<string, string | number>) => string,
  connectedDevices: number,
): string | undefined {
  const labelOf = (id: string): string | undefined => {
    const descriptor = descriptors.find((entry) => entry.id === id);
    const setting = descriptor?.setting;
    if (!setting) return undefined;
    if (setting.kind === "select" || setting.kind === "optionalSelect") {
      const value = setting.select.value;
      const option = setting.select.options.find((entry) => entry.value === value);
      return option?.label ?? (value ? t(value) : undefined);
    }
    if (setting.kind === "toggle") return setting.value ? t("yes") : t("no");
    if (setting.kind === "information") return setting.value;
    return undefined;
  };

  switch (category) {
    case "soundModes":
      return labelOf("ambientSoundMode");
    case "equalizer":
      return labelOf("presetEqualizerProfile") ?? t("custom");
    case "equalizerImportExport":
      return undefined;
    case "buttonConfiguration": {
      const assigned = descriptors.filter((descriptor) => {
        if (!BUTTON_IDS.has(descriptor.id)) return false;
        const setting = descriptor.setting;
        return setting.kind === "optionalSelect" && setting.select.value !== null;
      }).length;
      return t("buttons-assigned", { assigned, total: BUTTON_IDS.size });
    }
    case "dualConnections":
      return t("dual-connections-summary", { count: connectedDevices });
    case "miscellaneous": {
      const on = descriptors.filter(
        (descriptor) => descriptor.setting.kind === "toggle" && descriptor.setting.value,
      ).length;
      const total = descriptors.filter((descriptor) => descriptor.setting.kind === "toggle").length;
      return t("toggles-on", { on, total });
    }
    case "deviceInformation":
      return labelOf("firmwareVersionLeft");
    default:
      return undefined;
  }
}
