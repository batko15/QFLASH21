/**
 * QFLASH21 – Web Serial Client für K-Line/KWP2000.
 *
 * Unterstützt FTDI FT232RL (0403:6001, klassische K+DCAN-Kabel),
 * CH340- und CP2102-Klone – damit funktioniert der Zugriff auch über
 * USB-C-OTG-Adapter an Android (Chrome ≥ 89).
 *
 * 5-Baud-Initialisierung: Das Adressbyte wird bitweise über das
 * BREAK-Signal der seriellen Schnittstelle getaktet (200 ms pro Bit,
 * LSB-first, Start-Bit = 0, Stop-Bit = 1). Danach antwortet das
 * Steuergerät mit zwei Schlüsselwörtern bei 10400 Baud.
 */

import { buildRequest, parseFrame, describeNrc, sleep } from './protocol';
import { KwpError, type ParsedFrame, type QfSerialPort, type PortDescriptor, type PortKind } from './types';

export const USB_FILTERS: { usbVendorId: number; usbProductId: number }[] = [
  { usbVendorId: 0x0403, usbProductId: 0x6001 }, // FTDI FT232RL – klassisches K+DCAN-Kabel
  { usbVendorId: 0x0403, usbProductId: 0x6015 }, // FTDI FT231X
  { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
  { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP2102
];

/** Erlaubte Baudraten für KWP2000/DDE4 */
export const BAUD_RATES = [
  { value: 10400, label: '10400 Bd (KWP2000-Standard, K-Line)' },
  { value: 38400, label: '38400 Bd (SLOW-WRITE-Modus, schonend für alte ECUs)' },
  { value: 125000, label: '125000 Bd (Schnellmodus, nur stabile Adapter)' },
] as const;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

export function isSecureContextOk(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

export function portKindFromInfo(info: { usbVendorId?: number; usbProductId?: number }): PortDescriptor {
  const v = info.usbVendorId;
  const p = info.usbProductId;
  let kind: PortKind = 'unknown';
  let label = 'Unbekannter serieller Port';
  if (v === 0x0403 && p === 0x6001) {
    kind = 'ftdi';
    label = 'FTDI FT232RL – K+DCAN-Kabel (empfohlen)';
  } else if (v === 0x0403) {
    kind = 'ftdi-x';
    label = 'FTDI-Adapter';
  } else if (v === 0x1a86) {
    kind = 'ch340';
    label = 'CH340-Adapter (Klon)';
  } else if (v === 0x10c4) {
    kind = 'cp2102';
    label = 'CP2102-Adapter';
  } else if (v != null) {
    label = `USB-Gerät 0x${v.toString(16)}:0x${(p ?? 0).toString(16)}`;
  }
  return { kind, label, vendorId: v, productId: p };
}

export type LogFn = (dir: 'tx' | 'rx' | 'info' | 'error' | 'ok', message: string, bytes?: Uint8Array) => void;

export interface ClientConfig {
  baudRate: number;
  p2TimeoutMs: number;
  ecuAddress: number;
}

export const DEFAULT_CONFIG: ClientConfig = {
  baudRate: 10400,
  p2TimeoutMs: 1500,
  ecuAddress: 0x12,
};

/** Erwartete Schlüsselwörter eines DDE4.0 (Bosch EDC15C-Funktionsbeschreibung B079.CC0, Kap. 10.1.3):
 *  Nach dem Synchronmuster 0x55 sendet das SG KW1=0x6B, KW2=0x8F (7 Datenbits, ungerade Parität).
 *  Danach Datenkommunikation mit fest verankerten 10400 Baud. */
export const DDE4_KEYWORDS: [number, number] = [0x6b, 0x8f];

export class SerialClient {
  private port: QfSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer: number[] = [];
  /** null = noch unbekannt, true/false = adaptiv erkannt */
  private hasEcho: boolean | null = null;
  private logId = 0;
  /** true während/after close() – unterdrückt Spurious-onDisconnect (sauberes Trennen) */
  private closing = false;
  /** Throttle für Prüfsummenfehler-Logs (Resync-Storm-Gegenmittel) */
  private lastCsumErrLog = 0;
  /** Request-Mutex: sendRequest-Aufrufe werden serialisiert (keine kreuzenden Antworten) */
  private requestQueue: Promise<unknown> = Promise.resolve();
  config: ClientConfig = { ...DEFAULT_CONFIG };
  onLog: LogFn = () => {};
  onDisconnect: (() => void) | null = null;

  get isOpen(): boolean {
    return this.port !== null;
  }

  get portInfo(): PortDescriptor {
    if (!this.port) return { kind: 'unknown', label: '–' };
    return portKindFromInfo(this.port.getInfo());
  }

  /** Zugriffsdialog öffnen (muss aus einer User-Geste heraus passieren!) */
  static async requestPort(): Promise<SerialPort> {
    if (!isWebSerialSupported()) throw new KwpError('Web Serial API nicht verfügbar (Android/iOS-App oder alter Browser)');
    return navigator.serial.requestPort({ filters: USB_FILTERS });
  }

  static async listGrantedPorts(): Promise<SerialPort[]> {
    if (!isWebSerialSupported()) return [];
    return navigator.serial.getPorts();
  }

  async connect(port: SerialPort | QfSerialPort): Promise<void> {
    this.port = port as unknown as QfSerialPort;
    this.buffer = [];
    await this.port.open({
      baudRate: this.config.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 8192,
    });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.pump();
  }

  private pump(): void {
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await this.reader!.read();
          if (done) break;
          if (value) for (const b of value) this.buffer.push(b);
        }
      } catch {
        // Port geschlossen oder abgezogen
      }
      // Bewusstes close() darf KEINEN Disconnect-Alarm auslösen
      if (!this.closing && this.onDisconnect) this.onDisconnect();
    })();
  }

  private async waitForBytes(count: number, timeoutMs: number, skipLeadingZeros = false): Promise<number[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (skipLeadingZeros) {
        while (this.buffer.length > 0 && this.buffer[0] === 0x00) this.buffer.shift();
      }
      if (this.buffer.length >= count) return this.buffer.splice(0, count);
      if (Date.now() > deadline) {
        throw new KwpError(
          `Zeitüberschreitung: ${count} Bytes erwartet, ${this.buffer.length} empfangen (SkipZeros=${skipLeadingZeros})`
        );
      }
      await sleep(8);
    }
  }

  /**
   * 5-Baud-Init: Adressbyte bitweise über BREAK taktet (200 ms/Bit).
   * BREAK=true zieht die K-Line auf Low (0), BREAK=false lässt sie auf High (1).
   * Danach kommen die Schlüsselwörter bei konfigurierter Baudrate.
   */
  async fiveBaudInit(address: number = this.config.ecuAddress): Promise<[number, number]> {
    if (!this.port) throw new KwpError('Port nicht geöffnet');
    this.onLog('info', `5-Baud-Init startet – Adresse 0x${address.toString(16).padStart(2, '0').toUpperCase()}`);
    this.buffer = [];
    const bits: number[] = [0]; // Start-Bit
    for (let i = 0; i < 8; i++) bits.push((address >> i) & 1);
    bits.push(1); // Stop-Bit

    let lineHigh = true;
    await this.port.setSignals({ break: false, requestToSend: true, dataTerminalReady: true });
    await sleep(50);
    for (const bit of bits) {
      const wantHigh = bit === 1;
      if (wantHigh !== lineHigh) {
        await this.port.setSignals({ break: !wantHigh, requestToSend: true, dataTerminalReady: true });
        lineHigh = wantHigh;
      }
      await sleep(200);
    }
    if (!lineHigh) {
      await this.port.setSignals({ break: false, requestToSend: true, dataTerminalReady: true });
      lineHigh = true;
    }
    this.onLog('info', 'Wache auf … warte auf Synchronmuster + Schlüsselwörter');
    // Bosch EDC15C: SG sendet 0x55 (Synchronmuster) + KW1 + KW2. Alte/Fremd-Varianten
    // senden evtl. kein Sync – daher 3 Bytes lesen und ggf. 0x55 verwerfen.
    const raw = await this.waitForBytes(3, 2500, true);
    const kw = raw[0] === 0x55 ? [raw[1], raw[2]] : [raw[0], raw[1]];
    if (raw[0] === 0x55) this.onLog('info', 'Synchronmuster 0x55 erkannt (Bosch EDC15C)');
    this.onLog('rx', `Schlüsselwörter: 0x${kw[0].toString(16).toUpperCase()} 0x${kw[1].toString(16).toUpperCase()}`, new Uint8Array(kw));
    return [kw[0], kw[1]];
  }

  /** Komplement senden (Bosch EDC15C-Konvention: NUR invertiertes 2. Keyword, ~KW2).
   *  (Klassisches ISO 14230 würde beide invertieren – EDC15C will nur ~KW2, danach
   *  quittiert das SG mit der invertierten Init-Adresse als Roh-Byte.) */
  async sendKeywordComplement(kw1: number, kw2: number): Promise<void> {
    void kw1;
    const bytes = new Uint8Array([(kw2 ^ 0xff) & 0xff]);
    await this.writeBytes(bytes);
    this.onLog('tx', `Invertiertes Keyword 2 (~0x${kw2.toString(16).toUpperCase().padStart(2, '0')} → 0x${bytes[0].toString(16).toUpperCase().padStart(2, '0')})`, bytes);
    await this.discardEcho(bytes);
  }

  private async writeBytes(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new KwpError('Port nicht geöffnet');
    await this.writer.write(data);
  }

  /** K-Line-Echo der eigenen Übertragung verwerfen (Eindraht-Bus).
   * Adaptiv: Beim ersten Request wird mit langer Frist versucht, das Echo
   * zu matchen; das Ergebnis wird gemerkt (hasEcho). Bytes VOR dem Echo
   * (z. B. verspätete Init-Quittungen) werden übersprungen. */
  private async discardEcho(tx: Uint8Array): Promise<number> {
    if (this.hasEcho === false) return 0;
    const deadline = Date.now() + (this.hasEcho === true ? 80 : 450);
    let matched = 0;
    for (;;) {
      if (this.buffer.length > 0) {
        const b = this.buffer[0];
        if (b === tx[matched]) {
          this.buffer.shift();
          matched++;
          if (matched === tx.length) break;
          continue;
        }
        if (matched === 0) {
          this.buffer.shift(); // Fremdbytes vor dem Echo verwerfen
          continue;
        }
        break; // Abweichung mitten im Echo → Antwort des ECU beginnt
      }
      if (Date.now() > deadline) break;
      await sleep(4);
    }
    if (this.hasEcho === null && tx.length > 0) {
      this.hasEcho = matched === tx.length;
      this.onLog('info', this.hasEcho ? 'K-Line-Echo erkannt (Eindraht-Bus)' : 'Kein K-Line-Echo (Vollduplex-Adapter)');
    }
    if (matched > 0) this.onLog('info', `Echo verworfen (${matched}/${tx.length} Bytes)`);
    return matched;
  }

  /** Ein Frame lesen (mit Resynchronisation bei Prüfsummenfehlern).
   * Akzeptiert nur 0x80-präfixte Frames (KWP2000 mit Adressierungsinfo). */
  private async readFrame(timeoutMs: number): Promise<ParsedFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.buffer.length > 0) {
        const fmt = this.buffer[0];
        if (!(fmt & 0x80) || (fmt & 0x3f) === 0) {
          this.buffer.shift(); // Müll – Byte-weise resynchronisieren
          continue;
        }
        const need = 3 + (fmt & 0x3f) + 1;
        if (this.buffer.length >= need) {
          const chunk = this.buffer.splice(0, need);
          const buf = new Uint8Array(chunk);
          try {
            const frame = parseFrame(buf);
            return frame;
          } catch {
            // Throttle: bei K-Line-Störungen drohen sonst tausende Logs/s (Render-Storm)
            if (Date.now() - this.lastCsumErrLog > 250) {
              this.onLog('error', 'Prüfsummenfehler – Frame verworfen, Resync', buf);
              this.lastCsumErrLog = Date.now();
            }
            this.buffer.unshift(chunk[0]);
            if (Date.now() > deadline) throw new KwpError('Prüfsummenfehler (Timeout während Resync)');
            await sleep(2); // Hot-Loop entschärfen
            continue;
          }
        }
      }
      if (Date.now() > deadline) {
        throw new KwpError(`Antwort-Timeout (Puffer: ${this.buffer.length} Bytes)`);
      }
      await sleep(8);
    }
  }

  /**
   * Anfrage senden und finale Antwort abwarten.
   * Behandelt 0x78 "Response pending", K-Line-Echo und validiert,
   * dass der Antwort-Service zum positiven Erwartungswert passt.
   */
  /** Request serialisieren (Mutex) – verhindert kreuzende Antworten bei parallelen Aufrufern (Live-Poll vs. Job). */
  sendRequest(
    service: number,
    data: number[] = [],
    opts?: { timeoutMs?: number; expectService?: number; pendingTimeoutMs?: number }
  ): Promise<ParsedFrame> {
    const run = this.requestQueue.then(
      () => this.sendRequestExclusive(service, data, opts),
      () => this.sendRequestExclusive(service, data, opts) // auch nach Fehler weiterlaufen
    );
    this.requestQueue = run.catch(() => {}); // Queue nie in rejected state lassen
    return run;
  }

  private async sendRequestExclusive(
    service: number,
    data: number[] = [],
    opts?: { timeoutMs?: number; expectService?: number; pendingTimeoutMs?: number }
  ): Promise<ParsedFrame> {
    if (!this.port) throw new KwpError('Nicht verbunden');
    const frame = buildRequest(service, data, { target: this.config.ecuAddress });
    this.onLog('tx', `Service 0x${service.toString(16).toUpperCase().padStart(2, '0')}`, frame);
    await this.writeBytes(frame);
    await this.discardEcho(frame);
    const timeout = opts?.timeoutMs ?? this.config.p2TimeoutMs;
    let deadline = Date.now() + timeout;
    const expected = opts?.expectService ?? ((service | 0x40) & 0xff);
    for (;;) {
      const f = await this.readFrame(Math.max(80, deadline - Date.now()));
      if (f.service === 0x7f) {
        const nrc = f.data[1] ?? 0xff;
        if (nrc === 0x78) {
          // ISO 14230-3: P2 nach RCRRP neu starten – ECU darf bei Erase/Routinen Sekunden brauchen
          this.onLog('rx', 'Response pending (0x78) – Deadline neu gestartet');
          deadline = Date.now() + (opts?.pendingTimeoutMs ?? 10_000);
          continue;
        }
        this.onLog('error', `Negative Antwort: ${describeNrc(nrc)}`);
        throw new KwpError(`Negative Antwort: ${describeNrc(nrc)}`, nrc, f.data);
      }
      if (f.service !== expected) {
        this.onLog('error', `Unerwarteter Service 0x${f.service.toString(16)} (erwartet 0x${expected.toString(16)}) – Frame verworfen`);
        if (Date.now() > deadline) throw new KwpError('Unerwartete Antwort (Timeout)');
        continue;
      }
      this.onLog('rx', `Antwort 0x${f.service.toString(16).toUpperCase().padStart(2, '0')} (${f.data.length} Bytes)`, f.data);
      return f;
    }
  }

  /** Init-Quittung des ECU verwerfen. Bosch EDC15C: SG sendet die invertierte
   *  Init-Adresse (z. B. ~0x12 = 0xED) als ROHES Byte – kein Frame. Alles innerhalb
   *  der Frist verwerfen (auch klassische Frame-Quittungen alter Varianten). */
  async drainInitAck(timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let n = 0;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const bytes = await this.waitForBytes(1, Math.min(remaining, 120), true);
        n += bytes.length;
      } catch {
        break;
      }
    }
    if (n > 0) this.onLog('info', `Init-Quittung verworfen (${n} Bytes – invertierte Adresse/Reste)`);
    else this.onLog('info', 'Keine Init-Quittung (OK)');
    this.buffer = [];
  }

  async rawWrite(data: Uint8Array): Promise<void> {
    await this.writeBytes(data);
    this.onLog('tx', 'Raw-Write', data);
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignorieren */
    }
    try {
      this.reader?.releaseLock(); // Lock FREIGEBEN – sonst bleibt port.close() hängen (Reconnect tot)
    } catch {
      /* ignorieren */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignorieren */
    }
    try {
      await this.port?.close();
    } catch {
      /* ignorieren */
    }
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buffer = [];
    this.closing = false;
  }
}
