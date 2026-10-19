import { useEffect, useState } from "react";

import { useApp } from "./context";
import {
  getGrantedPorts,
  isSecureContext,
  isWebSerialSupported,
  portLabel,
} from "../transport/webSerial";
import { vendorUuidCandidates } from "../session/session";

export interface ConnectScreenProps {
  connecting: boolean;
  error: string | null;
  customUuids: string[];
  onSaveCustomUuids: (uuids: string[]) => void;
  onConnectSerial: () => void;
  onConnectDemo: () => void;
  onConnectPort: (port: SerialPort) => void;
}

export function ConnectScreen({
  connecting,
  error,
  customUuids,
  onSaveCustomUuids,
  onConnectSerial,
  onConnectDemo,
  onConnectPort,
}: ConnectScreenProps) {
  const { t } = useApp();
  const supported = isWebSerialSupported();
  const secure = isSecureContext();
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uuidDraft, setUuidDraft] = useState(customUuids.join("\n"));

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void getGrantedPorts()
      .then((granted) => {
        if (!cancelled) setPorts(granted);
      })
      .catch(() => {
        if (!cancelled) setPorts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [supported, connecting]);

  return (
    <div className="screen connect-screen">
      <section className="card">
        <h1>{t("app-title")}</h1>
        <p className="subtitle">{t("app-subtitle")}</p>

        {!secure ? <div className="banner warning">{t("insecure-context")}</div> : null}
        {!supported ? <div className="banner warning">{t("browser-unsupported")}</div> : null}
        {error ? <div className="banner error">{error}</div> : null}

        <div className="button-stack">
          <button
            type="button"
            className="primary"
            disabled={connecting || !supported || !secure}
            onClick={onConnectSerial}
          >
            {connecting ? t("connecting") : t("connect-real-device")}
          </button>
          <button type="button" className="secondary" disabled={connecting} onClick={onConnectDemo}>
            {t("connect-demo-device")}
          </button>
        </div>

        <details className="instructions">
          <summary>{t("pair-first")}</summary>
          <ol>
            <li>OS の Bluetooth 設定で P30i をペアリングしておく</li>
            <li>
              このページで「{t("connect-real-device")}」を押す
            </li>
            <li>
              一覧から Soundcore の項目（Bluetooth RFCOMM）を選ぶ。表示されない場合は下の「
              {t("advanced")}」でサービス UUID を追加する
            </li>
            <li>デスクトップ版 OpenSCQ30 や公式アプリとは同時に接続しない</li>
          </ol>
          <p className="hint">
            対応ブラウザ: Chrome / Edge 117 以降（Windows・macOS・Linux・ChromeOS）、Chrome 138
            以降（Android）。Safari / Firefox / iOS では Web Serial が使えないため実機接続はできません
            （デモモードは動作します）。
          </p>
        </details>

        {supported && ports.length > 0 ? (
          <div className="granted-ports">
            <h2>{t("reconnect-granted")}</h2>
            <ul>
              {ports.map((port, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className="ghost"
                    disabled={connecting}
                    onClick={() => onConnectPort(port)}
                  >
                    {portLabel(port)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="advanced-toggle">
          <button type="button" className="ghost" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? "▾" : "▸"} {t("advanced")}
          </button>
        </div>
        {showAdvanced ? (
          <div className="advanced">
            <label className="stacked">
              <span>{t("custom-service-uuids")}</span>
              <small>{t("custom-service-uuids-hint")}</small>
              <textarea
                rows={3}
                value={uuidDraft}
                placeholder={vendorUuidCandidates("3959").join("\n")}
                onChange={(event) => setUuidDraft(event.target.value)}
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                onClick={() =>
                  onSaveCustomUuids(
                    uuidDraft
                      .split(/[\s,]+/)
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0),
                  )
                }
              >
                {t("save")}
              </button>
            </div>
            <p className="hint">
              既定で許可される UUID: {vendorUuidCandidates("3959").join(", ")} および標準 SPP
              （00001101-0000-1000-8000-00805f9b34fb）。
            </p>
          </div>
        ) : null}
      </section>

      <section className="card about">
        <h2>{t("about")}</h2>
        <p>{t("about-body")}</p>
        <p>
          <a href="https://github.com/Oppzippy/OpenSCQ30" target="_blank" rel="noreferrer">
            {t("upstream-link")}
          </a>
        </p>
      </section>
    </div>
  );
}
