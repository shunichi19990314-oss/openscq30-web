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
import { FakeA3959Device } from "./support/fakeDevice";

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
    await session.connectWith(new FakeA3959Device({ latencyMs: 5 }), "fake");
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
    await session.connectWith(new FakeA3959Device({ latencyMs: 5 }), "fake");
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

describe("redesigned widgets", () => {
  async function renderDevice(language: "ja" | "en" = "ja") {
    const t = createTranslator(language);
    const session = new Session({ profiles: new LocalStorageProfileStore(), t });
    await session.connectWith(new FakeA3959Device({ latencyMs: 5 }), "fake");
    const html = renderToStaticMarkup(
      <AppContext.Provider value={{ session, t, language, setLanguage: () => {} }}>
        <DeviceScreen
          snapshot={session.getSnapshot()}
          session={session}
          presetStore={new QuickPresetStore()}
          onDisconnect={() => {}}
        />
      </AppContext.Provider>,
    );
    return { html, session };
  }

  it("renders the ambient sound mode as a segmented control with the active option pressed", async () => {
    const { html, session } = await renderDevice();
    const group = /<div class="segmented"[^>]*aria-label="環境サウンドモード"[\s\S]*?<\/div>\s*<\/div>/.exec(html);
    expect(group, "segmented control for the ambient sound mode").not.toBeNull();
    const pressed = [...html.matchAll(/aria-pressed="(true|false)"[^>]*title="([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]}`,
    );
    expect(pressed.some((entry) => entry.endsWith(":true"))).toBe(true);
    // The demo device starts in noise canceling mode; the segmented control uses compact labels.
    expect(pressed.find((entry) => entry.endsWith(":true"))).toContain("ノイキャン");
    await session.disconnect();
  });

  it("keeps collapsed category content in the DOM", async () => {
    const { html, session } = await renderDevice();
    // Dual connections is collapsed by default; its settings must still be rendered.
    expect(html).toContain('data-open="false"');
    expect(html).toContain("デュアル接続（マルチポイント）");
    expect(html).toContain("12:34:56:78:9a:bc");
    await session.disconnect();
  });

  it("renders the equalizer curve handles and the accessible sliders", async () => {
    const { html, session } = await renderDevice();
    expect((html.match(/class="curve-handle/g) ?? []).length).toBe(8);
    expect((html.match(/type="range"/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(html).toContain("equalizer-sliders");
    expect(html).toContain("curve-line");
    await session.disconnect();
  });

  it("renders battery rings and the device information grid", async () => {
    const { html, session } = await renderDevice();
    expect((html.match(/class="battery-ring"/g) ?? []).length).toBe(2);
    expect(html).toContain('class="info-grid');
    expect(html).toContain("<dt>シリアル番号</dt>");
    expect(html).toContain("3959DED6692DB6F4");
    await session.disconnect();
  });

  it("groups the touch controls into a left/right matrix", async () => {
    const { html, session } = await renderDevice();
    expect(html).toContain('class="button-grid"');
    expect((html.match(/class="button-grid-row"/g) ?? []).length).toBe(5); // header + 4 gestures
    for (const label of ["左側を1回タップ", "右側を2回タップ", "左側を3回タップ", "右側を長押し"]) {
      expect(html, `missing ${label}`).toContain(label);
    }
    await session.disconnect();
  });
});
