/**
 * Development-only preview harness.
 *
 * The production app talks to real headphones over Web Serial; this harness mounts the same
 * DeviceScreen against the test double in `tests/support/fakeDevice.ts` so the settings UI can be
 * designed and screenshotted without hardware. It is built by `vite.preview.config.ts` into
 * `dist-preview/`, which is gitignored and never published. `npm run build` (the deploy command)
 * does not include any of it.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { AppContext } from "../ui/context";
import { DeviceScreen } from "../ui/DeviceScreen";
import { Session } from "../session/session";
import { LocalStorageProfileStore, QuickPresetStore } from "../session/storage";
import { createTranslator } from "../i18n";
import { FakeA3959Device } from "../../tests/support/fakeDevice";
import "../ui/styles.css";

function Preview() {
  const t = useMemo(() => createTranslator("ja"), []);
  const session = useMemo(
    () => new Session({ profiles: new LocalStorageProfileStore(), t }),
    [t],
  );
  const presetStore = useMemo(() => new QuickPresetStore(), []);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const snapshot = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );

  useEffect(() => {
    let cancelled = false;
    session
      .connectWith(new FakeA3959Device({ latencyMs: 30 }), "preview")
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      void session.disconnect();
    };
  }, [session]);

  if (failed) return <p style={{ padding: 24 }}>preview failed: {failed}</p>;
  if (!ready || !snapshot.state) {
    return <p style={{ padding: 24 }}>connecting…</p>;
  }

  return (
    <AppContext.Provider value={{ session, t, language: "ja", setLanguage: () => {} }}>
      <div className="app">
        <div className="top-bar">
          <span className="brand">OpenSCQ30 Web — preview</span>
        </div>
        <DeviceScreen
          snapshot={snapshot}
          session={session}
          presetStore={presetStore}
          onDisconnect={() => {}}
        />
      </div>
    </AppContext.Provider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");
createRoot(container).render(<Preview />);
