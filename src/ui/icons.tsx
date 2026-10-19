/**
 * Inline SVG icon set. Everything is inline so the bundle stays self contained and works without
 * network access (and inside sandboxed previews).
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function HeadphonesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h2.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-3a1 1 0 0 1 1-1Z" />
      <path d="M20 14h-2.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1H19a2 2 0 0 0 2-2v-3a1 1 0 0 0-1-1Z" />
    </svg>
  );
}

/** Large mark used on the connect screen. */
export function HeadphonesArt(props: IconProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden focusable="false" {...props}>
      <defs>
        <linearGradient id="hpGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <path
        d="M22 74V58a38 38 0 0 1 76 0v16"
        stroke="url(#hpGradient)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="12" y="66" width="24" height="38" rx="11" fill="url(#hpGradient)" opacity="0.92" />
      <rect x="84" y="66" width="24" height="38" rx="11" fill="url(#hpGradient)" opacity="0.92" />
      <path d="M60 18v-6M40 24l-4-5M80 24l4-5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

export function NoiseCancelingIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12h3l2-5 3 12 3-16 3 13 2-4h2" />
      <path d="M2 2l20 20" strokeWidth="2" />
    </svg>
  );
}

export function TransparencyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12a8 8 0 0 1 8-8" />
      <path d="M7 12a5 5 0 0 1 5-5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M17 12a5 5 0 0 1-5 5" />
      <path d="M20 12a8 8 0 0 1-8 8" />
    </svg>
  );
}

export function NormalModeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h16" />
      <path d="M8 8h8M8 16h8" opacity="0.5" />
    </svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 21V14M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" />
      <path d="M2.5 14h5M9.5 12h5M16.5 16h5" />
    </svg>
  );
}

export function TapIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 11V9.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a5 5 0 0 1-3.8-1.8L4 15.4a1.6 1.6 0 0 1 2.4-2.1L9 15.5V11" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.1" />
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.4 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.2Z" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function PlugIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" />
      <path d="M12 17v5" />
    </svg>
  );
}

export function BluetoothIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m7 7 10 10-5 4V3l5 4L7 17" />
    </svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="m7 10 2.5 2L7 14M12.5 15H17" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
      <path d="M12 9.5v4.5M12 17h.01" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}

export function PowerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v9" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </svg>
  );
}
