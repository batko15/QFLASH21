/**
 * QFLASH21 – Native-App-Bridge (Android WebView addJavascriptInterface).
 *
 * Die QFLASH21-Android-App v2.3.0 (STANDALONE, Interceptor-Architektur + Selbstreparatur) exponiert die Android USB-Host-API als
 * `window.QfSerialBridge` (Klasse SerialBridge in der APK). Über diese Bridge
 * laufen FTDI FT232R/FT231X, CH340 und CP2102 NATIV – ohne Chrome, ohne
 * Web Serial, ohne WebUSB und ohne TWA-Verifikation. Das K+DCAN-Kabel
 * funktioniert damit auf JEDEM Android-Gerät ab 7.0 per USB-OTG.
 *
 * Der Adapter implementiert exakt das QfSerialPort-Interface, sodass der
 * komplette KWP2000-Stack (SerialClient, 5-Baud-Init über BREAK, Echo-Handling)
 * unverändert funktioniert – dritte Ebene der Verbindungskette:
 *   1. Native Bridge (in der Android-App)   ← schnellster & zuverlässigster Weg
 *   2. Web Serial (Chrome ≥ 148 für USB)
 *   3. WebUSB (jedes Android-Chrome ≥ 61)
 */

import type { QfSerialPort } from './types';

/* ---------------------------- Bridge-Typen ---------------------------- */

/** JSON-Struktur von SerialBridge.listDevices() */
export interface QfNativeDeviceInfo {
  vendorId: number;
  productId: number;
  name: string;
  driver: 'ftdi' | 'ch340' | 'cp2102' | string;
  hasPermission?: boolean;
}

/** JSON-Struktur von SerialBridge.requestAndOpen() / write() / setBreak() */
interface BridgeResult {
  ok: boolean;
  error?: string;
  vendorId?: number;
  productId?: number;
  driver?: string;
  name?: string;
  written?: number;
  break?: boolean;
}

/** Java-Seite (SerialBridge.java) – Methoden sind alle synchron, String-basiert. */
interface QfNativeBridgeRaw {
  listDevices(): string;
  requestAndOpen(vendorId: number, productId: number, baud: number): string;
  write(base64: string): string;
  /** Nicht-blockierend: liefert sofort verfügbare Bytes (0..maxBytes) als Base64 oder ''. */
  read(maxBytes: number): string;
  setBreak(on: boolean): string;
  close(): void;
  isOpen(): boolean;
  deviceInfo(): string;
}

declare global {
  interface Window {
    QfSerialBridge?: QfNativeBridgeRaw;
  }
}

/* ---------------------------- Erkennung ---------------------------- */

export function isNativeBridge(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.QfSerialBridge?.requestAndOpen === 'function' &&
    typeof window.QfSerialBridge?.read === 'function'
  );
}

function bridge(): QfNativeBridgeRaw {
  if (!isNativeBridge()) {
    throw new Error('Native-App-Bridge nicht verfügbar (nur in der QFLASH21-Android-App).');
  }
  return window.QfSerialBridge!;
}

function jsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* ---------------------------- Geräte-Liste ---------------------------- */

export async function listNativeDevices(): Promise<QfNativeDeviceInfo[]> {
  if (!isNativeBridge()) return [];
  return jsonParse<QfNativeDeviceInfo[]>(bridge().listDevices(), []);
}

/**
 * Wählt den K+DCAN-Adapter (bevorzugt FTDI). Wirft eine verständliche deutsche
 * Fehlermeldung, wenn nichts angeschlossen ist.
 */
export async function requestNativeDevice(): Promise<QfNativeDeviceInfo> {
  const list = await listNativeDevices();
  if (list.length === 0) {
    throw new Error(
      'Kein kompatibler USB-Adapter gefunden (FTDI/CH340/CP2102). K+DCAN-Kabel per USB-OTG anschließen und erneut versuchen.'
    );
  }
  return list.find((d) => d.driver === 'ftdi') ?? list[0];
}

/* ---------------------------- Base64-Helper ---------------------------- */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------------------- QfSerialPort-Adapter ---------------------------- */

/** Aktiver Port (für USB-Detach-Event der App) */
let activePort: NativeBridgeSerialPort | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('qf-usb-detach', () => {
    const p = activePort;
    activePort = null;
    if (p) p.onExternalDetach();
  });
}

export class NativeBridgeSerialPort implements QfSerialPort {
  private readonly device: QfNativeDeviceInfo;
  private readonly raw: QfNativeBridgeRaw;
  private openOk = false;
  private cancelled = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(device: QfNativeDeviceInfo) {
    this.device = device;
    this.raw = bridge();

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        void this.readLoop();
      },
      cancel: () => {
        this.cancelled = true;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await this.rawWrite(chunk);
      },
    });
  }

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
  }

  get label(): string {
    return `${this.device.name} · native USB (${this.device.driver})`;
  }

  async open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }): Promise<void> {
    const res = jsonParse<BridgeResult>(
      this.raw.requestAndOpen(this.device.vendorId, this.device.productId, options.baudRate),
      { ok: false, error: 'Bridge-Antwort unlesbar' }
    );
    if (!res.ok) throw new Error(res.error ?? 'Adapter konnte nicht geöffnet werden.');
    this.openOk = true;
    this.cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Modulweite Registry des aktiven Ports (USB-Detach)
    activePort = this;
  }

  async close(): Promise<void> {
    this.cancelled = true;
    this.controller = null;
    if (activePort === this) activePort = null;
    if (this.openOk) {
      try {
        this.raw.close();
      } catch {
        /* egal */
      }
      this.openOk = false;
    }
  }

  async setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
  }): Promise<void> {
    if (signals.break !== undefined) {
      const res = jsonParse<BridgeResult>(this.raw.setBreak(signals.break), { ok: false });
      if (!res.ok) throw new Error(res.error ?? 'BREAK konnte nicht gesetzt werden.');
    }
    // DTR/RTS setzt die App beim Öffnen dauerhaft (K-Line ohne Flusssteuerung)
  }

  forget(): Promise<void> {
    return Promise.resolve();
  }

  /** Von 'qf-usb-detach' (App-Event bei Kabel-Abzug) aufgerufen. */
  onExternalDetach(): void {
    this.cancelled = true;
    const ctrl = this.controller;
    this.controller = null;
    this.openOk = false;
    if (ctrl) {
      try {
        ctrl.error(new Error('USB-Adapter wurde abgezogen.'));
      } catch {
        /* Stream bereits geschlossen */
      }
    }
  }

  private async rawWrite(chunk: Uint8Array): Promise<void> {
    const res = jsonParse<BridgeResult>(this.raw.write(bytesToBase64(chunk)), {
      ok: false,
      error: 'Bridge-Antwort unlesbar',
    });
    if (!res.ok) throw new Error(res.error ?? 'USB-Schreiben fehlgeschlagen.');
  }

  /** RX-Pump: non-blocking read() im Polling (4 ms) – KWP-Puffer akkumuliert. */
  private async readLoop(): Promise<void> {
    const ctrl = this.controller;
    if (!ctrl) return;
    try {
      while (!this.cancelled && this.openOk) {
        const b64 = this.raw.read(512);
        if (this.cancelled) return;
        if (b64 && b64.length > 0) {
          const bytes = base64ToBytes(b64);
          if (bytes.length > 0) ctrl.enqueue(bytes);
        } else {
          await new Promise((r) => setTimeout(r, 4));
        }
      }
    } catch (e) {
      if (!this.cancelled) {
        try {
          ctrl.error(e instanceof Error ? e : new Error('Native-Bridge-Lesefehler'));
        } catch {
          /* Stream bereits geschlossen */
        }
      }
    }
  }
}
