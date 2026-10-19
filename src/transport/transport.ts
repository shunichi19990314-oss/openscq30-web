/**
 * Transport abstraction.
 *
 * `openscq30-lib` talks to Soundcore devices over Bluetooth Classic RFCOMM. In the browser the only
 * way to reach an RFCOMM service is the Web Serial API (Chrome/Edge 117+ on desktop, Chrome 138+ on
 * Android), which exposes paired Bluetooth Classic serial services as serial ports.
 *
 * Everything above this layer only sees a byte stream, so the same device code works against a real
 * device (`WebSerialTransport`) and against the in-browser simulator (`DemoTransport`).
 */

export type ConnectionStatus = "connected" | "disconnected";

export interface TransportConnection {
  /** Human readable name shown in the UI. */
  readonly name: string;
  /** Sends `data`. Should be sent as a single write when possible. */
  write(data: Uint8Array): Promise<void>;
  /** Registers the handler for incoming bytes. Called with raw chunks, may be fragmented. */
  setReadHandler(handler: (data: Uint8Array) => void): void;
  /** Registers the handler called when the connection drops. */
  setDisconnectHandler(handler: (reason?: unknown) => void): void;
  close(): Promise<void>;
}
