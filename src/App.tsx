import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { LANGUAGES, createTranslator, detectLanguage, type Language } from "./i18n";
import { HeadphonesIcon } from "./ui/icons";
import { AppContext } from "./ui/context";
import { ConnectScreen } from "./ui/ConnectScreen";
import { DeviceScreen } from "./ui/DeviceScreen";
import { LocalStorageProfileStore, QuickPresetStore, loadAppSettings, saveAppSettings, type AppSettings } from "./session/storage";
import { Session } from "./session/session";

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = loadAppSettings();
    return { ...stored, language: (stored.language ?? detectLanguage()) as Language };
  });
  const language = settings.language;

  const translatorRef = useRef(createTranslator(language));
  translatorRef.current = createTranslator(language);
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translatorRef.current(key, params),
    [],
  );

  const profiles = useMemo(() => new LocalStorageProfileStore(), []);
  const presetStore = useMemo(() => new QuickPresetStore(), []);
  const session = useMemo(() => new Session({ profiles, t }), [profiles, t]);

  const snapshot = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );

  // Re-render setting labels when the language changes.
  useEffect(() => {
    session.refreshLabels();
  }, [language, session]);

  useEffect(() => {
    saveAppSettings(settings);
    try {
      localStorage.setItem("openscq30-web:language", language);
    } catch {
      // storage may be unavailable (private mode); the choice still applies for this session
    }
  }, [settings, language]);

  const setLanguage = useCallback(
    (next: Language) => setSettings((current) => ({ ...current, language: next })),
    [],
  );

  const connectSerial = useCallback(async () => {
    try {
      await session.connectSerial({
        allowedBluetoothServiceClassIds: settings.customServiceUuids,
      });
    } catch {
      // the session records the error in its snapshot
    }
  }, [session, settings.customServiceUuids]);

  const connectPort = useCallback(
    async (port: SerialPort) => {
      try {
        await session.connectToPort(port);
      } catch {
        // ignored, see above
      }
    },
    [session],
  );

  const disconnect = useCallback(async () => {
    await session.disconnect();
  }, [session]);

  const contextValue = useMemo(
    () => ({ session, t, language, setLanguage }),
    [session, t, language, setLanguage],
  );

  const connected = snapshot.status === "connected" && snapshot.state !== null;

  return (
    <AppContext.Provider value={contextValue}>
      <div className="app">
        {snapshot.busy ? <div className="top-progress" role="progressbar" aria-label={t("applying-setting")} /> : null}
        <div className="top-bar">
          <span className="brand">
            <HeadphonesIcon className="brand-mark" width={22} height={22} />
            OpenSCQ30 Web
          </span>
          <label className="language-picker">
            <span className="visually-hidden">{t("language")}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              {LANGUAGES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {connected ? (
          <DeviceScreen
            snapshot={snapshot}
            session={session}
            presetStore={presetStore}
            onDisconnect={() => void disconnect()}
          />
        ) : (
          <ConnectScreen
            connecting={snapshot.status === "connecting"}
            error={snapshot.error}
            customUuids={settings.customServiceUuids}
            onSaveCustomUuids={(uuids) =>
              setSettings((current) => ({ ...current, customServiceUuids: uuids }))
            }
            onConnectSerial={() => void connectSerial()}
            onConnectPort={(port) => void connectPort(port)}
          />
        )}

        <footer className="footer">
          <span>GPL-3.0-or-later · OpenSCQ30 Web</span>
          <a href="https://github.com/Oppzippy/OpenSCQ30" target="_blank" rel="noreferrer">
            upstream
          </a>
        </footer>
      </div>
    </AppContext.Provider>
  );
}
