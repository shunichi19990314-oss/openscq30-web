/**
 * Web Serial transport.
 *
 * Soundcore devices are controlled over Bluetooth Classic RFCOMM. Browsers cannot open an RFCOMM
 * channel with Web Bluetooth (that is BLE/GATT only), but the Web Serial API can talk to RFCOMM
 * services of *already paired* Bluetooth Classic devices since Chrome 117 on desktop and Chrome 138
 * on Android. See https://developer.chrome.com/blog/serial-over-bluetooth
 *
 * Requirements:
 *  - Chrome / Edge (desktop) or Chrome / Samsung Internet (Android)
 *  - a secure context (HTTPS or localhost) — Render's `*.onrender.com` domain qualifies
 *  - the headphones must be paired with the operating system first
 */

import type { TransportConnection } from "./transport";

/** Standard Bluetooth Serial Port Profile service. Chrome lists these without an allowlist. */
export const SPP_SERVICE_UUID = "00001101-0000-1000-8000-00805f9b34fb";

/**
 * Soundcore's vendor RFCOMM service. openscq30-lib matches it with the mask
 * `ffffffff-ffff-ffff-ffff-fffffff00000`, i.e. the low 20 bits are device specific. The Motion+
 * (A3116) uses `...d6832e7b3116`, where the trailing digits are the model number, so the same
 * pattern is generated for other models. Web Serial has no wildcard support, so concrete UUIDs have
 * to be listed.
 */
export const SOUNDCORE_VENDOR_SERVICE_PREFIX = "0cf12d31-fac3-4553-bd80-d6832e7";

export function soundcoreVendorServiceUuid(model: string): string {
  return `${SOUNDCORE_VENDOR_SERVICE_PREFIX}b${model}`;
}

/** Service class IDs the P30i (A3959) is known or suspected to expose. */
export const A3959_SERVICE_UUIDS = [soundcoreVendorServiceUuid("3959"), SPP_SERVICE_UUID];

export interface WebSerialConnection extends TransportConnection {
  readonly port: SerialPort;
  readonly info: SerialPortInfo;
}

export interface RequestPortOptions {
  /** Extra non standard Bluetooth service class IDs to allow. */
  allowedBluetoothServiceClassIds?: string[];
  /** Restrict the chooser to these filters. */
  filters?: SerialPortFilter[];
  signal?: AbortSignal;
}

/** Cap on buffered chunks received before a read handler is registered. */
const EARLY_CHUNK_LIMIT = 64;

export class WebSerialUnsupportedError extends Error {
  constructor() {
    super("Web Serial API is not available in this browser");
    this.name = "WebSerialUnsupportedError";
  }
}

function serial(): Serial {
  if (typeof navigator === "undefined" || !("serial" in navigator) || !navigator.serial) {
    throw new WebSerialUnsupportedError();
  }
  return navigator.serial;
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator && Boolean(navigator.serial);
}

export function isSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

/** Opens the browser's port chooser. Must be called from a user gesture. */
export async function requestPort(options: RequestPortOptions = {}): Promise<SerialPort> {
  const allowed = new Set<string>([
    ...A3959_SERVICE_UUIDS,
    ...(options.allowedBluetoothServiceClassIds ?? []),
  ]);
  const port = await serial().requestPort({
    allowedBluetoothServiceClassIds: [...allowed],
    ...(options.filters ? { filters: options.filters } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  } as SerialPortRequestOptions);
  return port;
}

/** Ports the user already granted permission to, which can be reopened without a chooser. */
export async function getGrantedPorts(): Promise<SerialPort[]> {
  return serial().getPorts();
}

export function portLabel(port: SerialPort): string {
  const info = port.getInfo();
  const serviceId = (info as SerialPortInfo & { bluetoothServiceClassId?: string })
    .bluetoothServiceClassId;
  if (serviceId) return `Bluetooth RFCOMM (${serviceId})`;
  if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
    return `USB ${info.usbVendorId}:${info.usbProductId}`;
  }
  return "Serial port";
}

/**
 * Opens an already chosen port and wraps it in a `TransportConnection`.
 *
 * RFCOMM has no baud rate; Chrome requires one anyway and ignores the value for Bluetooth ports.
 */
export async function openPort(port: SerialPort, baudRate = 9600): Promise<WebSerialConnection> {
  await port.open({ baudRate });

  let readHandler: ((data: Uint8Array) => void) | null = null;
  // The read loop starts before the caller can register its handler; hold on to anything that
  // arrives in the meantime instead of dropping it (devices can push updates right after opening).
  const earlyChunks: Uint8Array[] = [];
  let disconnectHandler: ((reason?: unknown) => void) | null = null;
  let closed = false;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const onSerialDisconnect = (event: Event): void => {
    if ((event as Event & { port?: SerialPort }).port === port) {
      handleClosed("the device disconnected");
    }
  };

  const handleClosed = (reason?: unknown): void => {
    if (closed) return;
    closed = true;
    navigator.serial.removeEventListener("disconnect", onSerialDisconnect);
    disconnectHandler?.(reason);
  };

  navigator.serial.addEventListener("disconnect", onSerialDisconnect);

  const readLoop = async (): Promise<void> => {
    if (!port.readable) {
      handleClosed("port has no readable stream");
      return;
    }
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          // Copy: the underlying buffer may be reused by the browser.
          const chunk = new Uint8Array(value);
          if (readHandler) {
            readHandler(chunk);
          } else if (earlyChunks.length < EARLY_CHUNK_LIMIT) {
            earlyChunks.push(chunk);
          }
        }
      }
      // The stream ended cleanly, which means the RFCOMM channel went away (the headphones were
      // powered off, moved out of range, or another app took over). `navigator.serial`'s disconnect
      // event does not always fire in that case, so report it here too.
      handleClosed("the device closed the connection");
    } catch (error) {
      if (!closed) handleClosed(error);
    } finally {
      try {
        reader?.releaseLock();
      } catch {
        // ignore
      }
      reader = null;
    }
  };

  void readLoop();

  const connection: WebSerialConnection = {
    port,
    info: port.getInfo(),
    get name() {
      return portLabel(port);
    },
    async write(data: Uint8Array): Promise<void> {
      if (closed) throw new Error("connection closed");
      if (!port.writable) throw new Error("port has no writable stream");
      if (!writer) writer = port.writable.getWriter();
      await writer.write(data);
    },
    setReadHandler(handler: (data: Uint8Array) => void): void {
      readHandler = handler;
      const pending = earlyChunks.splice(0, earlyChunks.length);
      for (const chunk of pending) handler(chunk);
    },
    setDisconnectHandler(handler: (reason?: unknown) => void): void {
      disconnectHandler = handler;
      if (closed) handler("already disconnected");
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      navigator.serial.removeEventListener("disconnect", onSerialDisconnect);
      try {
        await writer?.close();
      } catch {
        // ignore
      }
      writer?.releaseLock();
      writer = null;
      try {
        await reader?.cancel();
      } catch {
        // ignore
      }
      try {
        await port.close();
      } catch {
        // ignore
      }
    },
  };

  return connection;
}

/** Convenience: chooser + open in one step. */
export async function connectViaChooser(
  options: RequestPortOptions = {},
): Promise<WebSerialConnection> {
  const port = await requestPort(options);
  return openPort(port);
}
