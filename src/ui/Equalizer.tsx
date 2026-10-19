/**
 * Equalizer control: a draggable response curve plus accessible per-band sliders.
 *
 * The sliders stay in the DOM (inside an animated collapse) so the control is usable with a
 * keyboard and screen reader, and so the curve is not the only way in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Translator } from "../i18n";

export interface EqualizerSettingValue {
  bandHz: number[];
  min: number;
  max: number;
  fractionDigits: number;
  value: number[];
  readOnly: boolean;
}

const WIDTH = 320;
const HEIGHT = 150;
const PAD_LEFT = 16;
const PAD_RIGHT = 16;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;
const HANDLE_RADIUS = 5.5;

/** How long unconfirmed values are kept before falling back to what the device reports. */
const PENDING_TIMEOUT_MS = 4000;

export function formatDb(raw: number, fractionDigits: number): string {
  const db = raw / Math.pow(10, fractionDigits);
  return `${db > 0 ? "+" : ""}${db.toFixed(fractionDigits)}`;
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${hz}`;
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Catmull-Rom through the band points, converted to a cubic bezier path. */
function curvePath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  if (points.length < 3) {
    return `M ${points.map(([x, y]) => `${x} ${y}`).join(" L ")}`;
  }
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return path;
}

export function EqualizerControl({
  setting,
  label,
  disabled,
  t,
  onChange,
}: {
  setting: EqualizerSettingValue;
  label: string;
  disabled: boolean;
  t: Translator;
  onChange: (values: number[]) => void;
}) {
  const [draft, setDraft] = useState<number[] | null>(null);
  const [pending, setPending] = useState<number[] | null>(null);
  const [activeBand, setActiveBand] = useState<number | null>(null);
  const [slidersOpen, setSlidersOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const values = useMemo(() => draft ?? pending ?? setting.value, [draft, pending, setting.value]);

  // Drop the optimistic value once the device confirms it, and give up after a while so a failed
  // write does not leave the curve showing something the device never received.
  useEffect(() => {
    if (!pending) return;
    if (arraysEqual(pending, setting.value)) {
      setPending(null);
      return;
    }
    const timer = setTimeout(() => setPending(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending, setting.value]);

  const { min, max, fractionDigits, bandHz } = setting;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xFor = useCallback(
    (index: number) => PAD_LEFT + (index * plotWidth) / Math.max(1, bandHz.length - 1),
    [bandHz.length, plotWidth],
  );
  const yFor = useCallback(
    (value: number) => PAD_TOP + ((max - value) / (max - min)) * plotHeight,
    [max, min, plotHeight],
  );
  const valueForY = useCallback(
    (y: number) => {
      const ratio = (y - PAD_TOP) / plotHeight;
      return Math.round(Math.min(max, Math.max(min, max - ratio * (max - min))));
    },
    [max, min, plotHeight],
  );

  const points = bandHz.map((_, index) => [xFor(index), yFor(values[index] ?? 0)] as [number, number]);
  const line = curvePath(points);
  const area = `${line} L ${points[points.length - 1]?.[0] ?? 0} ${HEIGHT - PAD_BOTTOM} L ${
    points[0]?.[0] ?? 0
  } ${HEIGHT - PAD_BOTTOM} Z`;
  const zeroY = yFor(0);

  const commit = (next: number[]): void => {
    setDraft(null);
    setPending(next);
    onChange(next);
  };

  const dragTo = (index: number, clientY: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.height === 0) return;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    const next = (draft ?? values).slice();
    next[index] = valueForY(y);
    setDraft(next);
  };

  if (setting.readOnly) {
    return (
      <div className="setting-row">
        <div className="setting-label">
          <span>{label}</span>
        </div>
        <div className="setting-control">
          <span className="information-value">
            {values.map((value) => formatDb(value, fractionDigits)).join(" / ")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="equalizer-setting">
      <div className="equalizer-head">
        <div className="setting-label">
          <span>{label}</span>
          <small>
            {min / Math.pow(10, fractionDigits)} dB 〜 {max / Math.pow(10, fractionDigits)} dB ·{" "}
            {t("equalizer-drag-hint")}
          </small>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => commit(bandHz.map(() => 0))}
          >
            {t("equalizer-flat")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={slidersOpen}
            onClick={() => setSlidersOpen((open) => !open)}
          >
            {t("equalizer-sliders")}
          </button>
        </div>
      </div>

      <div className="equalizer-canvas">
        <svg
          ref={svgRef}
          className="equalizer-curve"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}: ${bandHz
            .map((hz, index) => `${formatHz(hz)}Hz ${formatDb(values[index] ?? 0, fractionDigits)}dB`)
            .join(", ")}`}
        >
          <defs>
            <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* grid */}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              className="curve-grid"
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={PAD_TOP + plotHeight * ratio}
              y2={PAD_TOP + plotHeight * ratio}
            />
          ))}
          <line className="curve-zero" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={zeroY} y2={zeroY} />

          <path className="curve-area" d={area} />
          <path className="curve-line" d={line} />

          {bandHz.map((hz, index) => (
            <g key={hz}>
              <text className="curve-label" x={xFor(index)} y={HEIGHT - 8} textAnchor="middle">
                {formatHz(hz)}
              </text>
              <circle
                className={`curve-handle${activeBand === index ? " curve-handle-active" : ""}`}
                cx={xFor(index)}
                cy={yFor(values[index] ?? 0)}
                r={HANDLE_RADIUS}
                role="slider"
                tabIndex={-1}
                aria-label={`${formatHz(hz)} Hz`}
                aria-valuenow={values[index] ?? 0}
                aria-valuemin={min}
                aria-valuemax={max}
                style={{ pointerEvents: disabled ? "none" : "auto" }}
                onPointerDown={(event) => {
                  if (disabled) return;
                  event.preventDefault();
                  (event.target as Element).setPointerCapture?.(event.pointerId);
                  setActiveBand(index);
                  dragTo(index, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (activeBand !== index) return;
                  dragTo(index, event.clientY);
                }}
                onPointerUp={() => {
                  if (activeBand !== index) return;
                  setActiveBand(null);
                  if (draft) commit(draft);
                }}
                onPointerCancel={() => {
                  setActiveBand(null);
                  setDraft(null);
                }}
              />
              {activeBand === index ? (
                <text
                  className="curve-value"
                  x={xFor(index)}
                  y={Math.max(PAD_TOP - 4, yFor(values[index] ?? 0) - 12)}
                  textAnchor="middle"
                >
                  {formatDb(values[index] ?? 0, fractionDigits)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>

      <div className="equalizer-sliders" data-open={slidersOpen ? "true" : "false"}>
        <div>
          <div className="equalizer-bands">
            {bandHz.map((hz, index) => {
              const value = values[index] ?? 0;
              const fill = ((value - min) / (max - min)) * 100;
              return (
                <div className="band" key={hz}>
                  <input
                    type="range"
                    aria-label={`${formatHz(hz)} Hz`}
                    min={min}
                    max={max}
                    step={1}
                    value={value}
                    disabled={disabled}
                    style={{ ["--fill" as string]: `${fill}%` }}
                    onChange={(event) => {
                      const next = values.slice();
                      next[index] = Number(event.target.value);
                      setDraft(next);
                    }}
                    onPointerUp={() => {
                      if (draft) commit(draft);
                    }}
                    onKeyUp={() => {
                      if (draft) commit(draft);
                    }}
                    onBlur={() => {
                      if (draft) commit(draft);
                    }}
                  />
                  <output>{formatDb(value, fractionDigits)}</output>
                  <span className="band-hz">{formatHz(hz)}Hz</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {draft ? (
        <div className="row-actions">
          <button type="button" className="btn" disabled={disabled} onClick={() => commit(draft)}>
            {t("apply")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
            {t("cancel")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
