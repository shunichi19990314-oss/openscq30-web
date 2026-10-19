import { useEffect, useState } from "react";

import { useApp } from "./context";
import {
  getGrantedPorts,
  isSecureContext,
  isWebSerialSupported,
  portLabel,
} from "../transport/webSerial";
import { vendorUuidCandidates } from "../session/session";
import {
  AlertIcon,
  BluetoothIcon,
  ChevronIcon,
  HeadphonesArt,
  PlugIcon,
} from "./icons";

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

  const checks = [
    { label: t("browser-check-secure"), ok: secure },
    { label: t("browser-check-serial"), ok: supported },
    { label: t("browser-check-paired"), ok: null },
  ];

  return (
    <div className="screen connect-screen">
      <section className="card">
        <div className="hero">
          <HeadphonesArt className="hero-art" />
          <div>
            <h1>{t("app-title")}</h1>
            <p className="subtitle">{t("app-subtitle")}</p>
            <ul className="checklist">
              {checks.map((check) => (
                <li key={check.label}>
                  <span
                    className={`dot${check.ok === null ? "" : check.ok ? " dot-ok" : " dot-no"}`}
                  />
                  <span>{check.label}</span>
                  {check.ok === null ? <span className="hint">（OS 側で実施）</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {!secure ? (
          <div className="banner banner-warning" role="alert">
            <AlertIcon width={16} height={16} />
            <span>{t("insecure-context")}</span>
          </div>
        ) : null}
        {!supported ? (
          <div className="banner banner-warning" role="alert">
            <AlertIcon width={16} height={16} />
            <span>{t("browser-unsupported")}</span>
          </div>
        ) : null}
        {error ? (
          <div className="banner banner-error" role="alert">
            <AlertIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="cta-stack">
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={connecting || !supported || !secure}
            onClick={onConnectSerial}
          >
            {connecting ? <span className="spinner" /> : <BluetoothIcon width={17} height={17} />}
            {connecting ? t("connecting") : t("connect-real-device")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={connecting}
            onClick={onConnectDemo}
          >
            <PlugIcon width={16} height={16} />
            {t("connect-demo-device")}
          </button>
          <p className="hint">{t("demo-note")}</p>
        </div>

        {supported && ports.length > 0 ? (
          <div className="disclosure-body">
            <h2 className="visually-hidden">{t("granted-ports-title")}</h2>
            <div className="chip-row">
              {ports.map((port, index) => (
                <button
                  key={index}
                  type="button"
                  className="chip"
                  disabled={connecting}
                  onClick={() => onConnectPort(port)}
                >
                  {portLabel(port)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <details className="disclosure">
          <summary>
            <ChevronIcon className="chevron" width={15} height={15} />
            {t("connect-how-to")}
          </summary>
          <div className="disclosure-body">
            <ol className="steps">
              <li>{t("pair-first")}</li>
              <li>「{t("connect-real-device")}」を押す</li>
              <li>{t("chooser-pick-soundcore")}</li>
              <li>{t("do-not-share-connection")}</li>
            </ol>
            <p className="hint">{t("supported-browsers")}</p>
          </div>
        </details>

        <details className="disclosure">
          <summary>
            <ChevronIcon className="chevron" width={15} height={15} />
            {t("advanced")}
          </summary>
          <div className="disclosure-body">
            <label className="field">
              <span>{t("custom-service-uuids")}</span>
              <textarea
                rows={3}
                value={uuidDraft}
                placeholder={vendorUuidCandidates("3959").join("\n")}
                onChange={(event) => setUuidDraft(event.target.value)}
              />
              <small className="hint">{t("custom-service-uuids-hint")}</small>
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-secondary"
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
              {t("default-uuids")}: {vendorUuidCandidates("3959").join(", ")} / SPP
              （00001101-0000-1000-8000-00805f9b34fb）
            </p>
          </div>
        </details>
      </section>

      <section className="card">
        <h2>{t("about")}</h2>
        <p className="hint">{t("about-body")}</p>
        <p className="hint">
          <a href="https://github.com/Oppzippy/OpenSCQ30" target="_blank" rel="noreferrer">
            {t("upstream-link")}
          </a>
        </p>
      </section>
    </div>
  );
}
