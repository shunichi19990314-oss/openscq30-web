/**
 * Rendering smoke tests: they catch JSX/runtime mistakes without a browser.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../src/App";
import { AppContext } from "../src/ui/context";
import { DeviceScreen } from "../src/ui/DeviceScreen";
import { Session } from "../src/session/session";
import { LocalStorageProfileStore, QuickPresetStore } from "../src/session/storage";
import { createTranslator } from "../src/i18n";

describe("connect screen", () => {
  it("renders the app shell", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("OpenSCQ30 Web");
    expect(html).toContain("A3959");
    // The browser cannot talk to the headphones in Node, so a warning is expected.
    expect(html).toContain("Web Serial");
  });
});

describe("device screen", () => {
  it("renders every category of the simulated device", async () => {
    const t = createTranslator("ja");
    const profiles = new LocalStorageProfileStore();
    const presetStore = new QuickPresetStore();
    const session = new Session({ profiles, t });
    await session.connectDemo();
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe("connected");

    const html = renderToStaticMarkup(
      <AppContext.Provider value={{ session, t, language: "ja", setLanguage: () => {} }}>
        <DeviceScreen
          snapshot={snapshot}
          session={session}
          presetStore={presetStore}
          onDisconnect={() => {}}
        />
      </AppContext.Provider>,
    );

    for (const label of [
      "サウンドモード",
      "イコライザー",
      "コントロール",
      "デュアル接続",
      "その他",
      "デバイス情報",
      "環境サウンドモード",
      "ノイズキャンセリングモード",
      "風切り音の低減",
      "左側を1回タップ",
      "オートパワーオフ",
      "ゲームモード",
      "シリアル番号",
    ]) {
      expect(html, `missing ${label}`).toContain(label);
    }
    // equalizer sliders for the eight visible bands
    expect((html.match(/type="range"/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html).toContain("3959DED6692DB6F4");

    await session.disconnect();
  });

  it("renders in English too", async () => {
    const t = createTranslator("en");
    const session = new Session({ profiles: new LocalStorageProfileStore(), t });
    await session.connectDemo();
    const html = renderToStaticMarkup(
      <AppContext.Provider value={{ session, t, language: "en", setLanguage: () => {} }}>
        <DeviceScreen
          snapshot={session.getSnapshot()}
          session={session}
          presetStore={new QuickPresetStore()}
          onDisconnect={() => {}}
        />
      </AppContext.Provider>,
    );
    expect(html).toContain("Sound Modes");
    expect(html).toContain("Wind Noise Suppression");
    await session.disconnect();
  });
});
