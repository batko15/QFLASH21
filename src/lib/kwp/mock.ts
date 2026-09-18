/**
 * MockSerialPort – virtuelles DDE4.0-Steuergerät (Bosch EDC15C4).
 *
 * Emuliert die für QFLASH21 relevante Teilmenge der Web-Serial-API
 * und verhält sich wie ein echtes DDE4 an der K-Line:
 *  - 5-Baud-Init per BREAK-Taktung → Schlüsselwörter 0x45 0x05
 *  - K-Line-Echo (Eindraht-Bus) wie beim echten Adapter
 *  - KWP2000-Services: 0x10, 0x1A (Ident), 0x18/0x14 (Fehlerspeicher
 *    normal + Schatten), 0x21 (Live-Daten), 0x27 (Security Access),
 *    0x31 (Routinen), 0x34–0x37 (Flash-Transfer)
 *  - Interne 512-KiB-Fake-Flash-Struktur mit korrekten CR2-Prüfsummen;
 *    Schreibvorgänge sind anschließend per Lesen verifizierbar.
 */

import { buildRequest, parseFrame, kwpChecksum, sleep } from './protocol';
import { KwpError, type QfSerialPort } from './types';
import { DDE4, dde4KeyFromSeed } from './dde4';
import { BANK_SIZE, FULL_SIZE, computeAllChecksums, fixAllChecksums } from './checksum';

interface MockDtc {
  raw: number;
  status: number;
}

const INITIAL_NORMAL_DTCS: MockDtc[] = [
  { raw: 25, status: 0x2f }, // Luftmassenmesser – aktuell + bestätigt
  { raw: 17964, status: 0x28 }, // Ladedruck – sporadisch bestätigt
];

const INITIAL_SHADOW_DTCS: MockDtc[] = [
  { raw: 87, status: 0x4f }, // AGR – sporadisch, nicht aktuell
];

export class MockSerialPort implements QfSerialPort {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  private readableController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private opened = false;
  private closed = false;

  // 5-Baud-Bit-Capture (Flanken mit Zeitstempeln)
  private breakFlanks: { high: boolean; t: number }[] = [];
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initDone = false;
  private expectComplement = false;
  /** Adresse, die zuletzt per 5-Baud-Init dekodiert wurde (0x12 = DDE4) */
  lastInitAddress = 0;

  // Sitzungszustand
  private securityUnlocked = false;
  private normalDtcs: MockDtc[] = INITIAL_NORMAL_DTCS.map((d) => ({ ...d }));
  private shadowDtcs: MockDtc[] = INITIAL_SHADOW_DTCS.map((d) => ({ ...d }));
  private bootTime = Date.now();

  // Flash-Transfer
  private uploadPending: { addr: number; size: number; sent: number; seq: number } | null = null;
  private downloadPending: { addr: number; size: number; buf: Uint8Array; received: number; seq: number } | null = null;

  // Virtuelles Flash
  private flash: Uint8Array;
  private flashDirty = false;

  private receiveQueue: number[] = [];

  constructor() {
    this.flash = MockSerialPort.generateImage();
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readableController = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.handleIncoming(chunk),
    });
  }

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return { usbVendorId: 0x0403, usbProductId: 0x6001 };
  }

  async open(): Promise<void> {
    this.opened = true;
    this.closed = false;
    this.initDone = false;
    this.expectComplement = false;
    this.breakFlanks = [];
    this.securityUnlocked = false;
  }

  async close(): Promise<void> {
    this.opened = false;
    this.closed = true;
    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
  }

  async forget(): Promise<void> {
    /* nichts zu tun */
  }

  async setSignals(signals: { break?: boolean; requestToSend?: boolean; dataTerminalReady?: boolean }): Promise<void> {
    if (!this.opened || this.closed) return;
    if (signals.break === undefined) return;
    const high = signals.break !== true; // BREAK = Leitung Low
    const t = performance.now();
    const last = this.breakFlanks[this.breakFlanks.length - 1];
    if (last && last.high === high) return; // keine Flanke
    this.breakFlanks.push({ high, t });
    this.scheduleInitDecode();
  }

  /**
   * Dekodiert die 5-Baud-Init aus den Flanken-Dauern:
   * Jede Leitungsebene dauert ein ganzzahliges Vielfaches von 200 ms.
   * Start(0) + 8 Datenbits (LSB zuerst) + Stop(1) = 10 Einheiten.
   * Vor dem Stop-Bit müssen es genau 9 Einheiten sein, die mit Low beginnen.
   */
  private scheduleInitDecode(): void {
    if (this.initTimer) clearTimeout(this.initTimer);
    if (this.initDone) return;
    this.initTimer = setTimeout(() => this.tryDecodeInit(), 320);
  }

  private tryDecodeInit(): void {
    if (this.initDone) return;
    const flanks = this.breakFlanks;
    if (flanks.length < 2) return;
    const now = performance.now();
    // Einheitenliste: level je 200-ms-Einheit
    const units: number[] = [];
    for (let i = 0; i < flanks.length; i++) {
      const dur = (i < flanks.length - 1 ? flanks[i + 1].t : now) - flanks[i].t;
      const count = Math.round(dur / 200);
      const isLast = i === flanks.length - 1;
      for (let u = 0; u < (isLast ? 0 : count); u++) units.push(flanks[i].high ? 1 : 0);
    }
    // Validierung: exakt 9 Einheiten vor dem Stop-Bit, Start = Low, letzte Flanke = steigend
    const stopStarted = flanks[flanks.length - 1].high === true;
    const stopDur = now - flanks[flanks.length - 1].t;
    if (units.length !== 9 || units[0] !== 0 || !stopStarted || stopDur < 120) {
      if (flanks.length > 24) this.breakFlanks = [];
      return;
    }
    let addr = 0;
    for (let i = 0; i < 8; i++) {
      if (units[1 + i] === 1) addr |= 1 << i;
    }
    this.lastInitAddress = addr;
    this.breakFlanks = [];
    this.initDone = true;
    this.expectComplement = true;
    void sleep(60).then(() => this.pushBytes(new Uint8Array(DDE4.keywords)));
  }

  private pushBytes(bytes: Uint8Array): void {
    if (this.closed || !this.readableController) return;
    this.readableController.enqueue(bytes.slice());
  }

  private async handleIncoming(chunk: Uint8Array): Promise<void> {
    if (this.closed) return;
    // K-Line-Echo sofort zurückspiegeln (Eindraht)
    this.pushBytes(chunk);

    for (const b of chunk) this.receiveQueue.push(b);

    // Nach Init: 2 Bytes Komplement der Schlüsselwörter erwarten
    if (this.expectComplement) {
      if (this.receiveQueue.length < 2) return;
      const a = this.receiveQueue.shift() as number;
      const b = this.receiveQueue.shift() as number;
      this.expectComplement = false;
      // GUI-seitig wird der Echo-Teil vom Client verworfen; wir akzeptieren direkt.
      if (a === (DDE4.keywords[0] ^ 0xff) && b === (DDE4.keywords[1] ^ 0xff)) {
        // Positiv: Adresse + Komplement quittieren (ISO 14230)
        void sleep(10).then(() => this.pushBytes(new Uint8Array([DDE4.ecuAddress, (DDE4.ecuAddress ^ 0xff) & 0xff])));
      }
      // Rest im Puffer belassen (Echo-Bytes werden clientseitig verworfen)
    }

    // Frames verarbeiten
    for (;;) {
      if (this.receiveQueue.length === 0) return;
      const fmt = this.receiveQueue[0];
      if (!(fmt & 0x80) || fmt === 0x80) {
        this.receiveQueue.shift();
        continue;
      }
      const need = 3 + (fmt & 0x3f) + 1;
      if (this.receiveQueue.length < need) return;
      const frameBytes = new Uint8Array(this.receiveQueue.splice(0, need));
      try {
        const frame = parseFrame(frameBytes);
        await this.dispatch(frame.service, Array.from(frame.data));
      } catch {
        // Prüfsummenfehler – still verwerfen (wie echte ECU)
      }
    }
  }

  private async dispatch(service: number, data: number[]): Promise<void> {
    switch (service) {
      case 0x10: // StartDiagnosticSession
        await sleep(25);
        this.respond(0x50, [0x84]);
        return;

      case 0x1a: { // ReadECUIdentification
        const id = data[0];
        const text = this.identString(id);
        await sleep(30);
        this.respond(0x5a, [id, ...Array.from(new TextEncoder().encode(text))]);
        return;
      }

      case 0x18: { // ReadDTCByStatus (Gruppe: FF00=normal, FD00=Schatten)
        const group = (data[0] << 8) | data[1];
        await sleep(35);
        const list = group === 0xfd00 ? this.shadowDtcs : this.normalDtcs;
        const payload: number[] = [group === 0xfd00 ? 0xfd : 0xff, ...list.flatMap((d) => [d.raw >> 8, d.raw & 0xff, d.status])];
        this.respond(0x58, payload);
        return;
      }

      case 0x14: { // ClearDiagnosticInformation
        const group = (data[0] << 8) | data[1];
        await sleep(120);
        if (group === 0xfd00) this.shadowDtcs = [];
        else {
          this.normalDtcs = [];
          this.shadowDtcs = [];
        }
        this.respond(0x54, [data[0], data[1]]);
        return;
      }

      case 0x21: { // ReadDataByLocalIdentifier
        const id = data[0];
        const vals = this.liveValues(id);
        await sleep(22);
        if (vals) this.respond(0x61, [id, ...vals]);
        else this.respondError(0x21, 0x31);
        return;
      }

      case 0x27: { // SecurityAccess
        if (data[0] === 0x01) {
          await sleep(40);
          this.securitySeed = [0x8a, 0x21];
          this.respond(0x67, [0x01, 0x8a, 0x21]);
        } else if (data[0] === 0x02) {
          await sleep(40);
          const [kHi, kLo] = dde4KeyFromSeed(this.securitySeed[0], this.securitySeed[1]);
          if (data[1] === kHi && data[2] === kLo) {
            this.securityUnlocked = true;
            this.respond(0x67, [0x02]);
          } else {
            this.respondError(0x27, 0x35);
          }
        } else {
          this.respondError(0x27, 0x12);
        }
        return;
      }

      case 0x31: { // RoutineControl
        const routine = (data[1] << 8) | data[2];
        if (routine === 0xff00) {
          // Flash löschen
          await sleep(40);
          this.respondError(0x31, 0x78); // pending
          void sleep(900).then(() => {
            this.flashDirty = false;
            this.respond(0x71, [data[0], 0xff, 0x00, 0x00]);
          });
        } else if (routine === 0xff01) {
          // Prüfsummen verifizieren
          await sleep(60);
          const results = computeAllChecksums(this.flash);
          const ok = results.every((r) => r.ok);
          this.respond(0x71, [data[0], 0xff, 0x01, ok ? 0x00 : 0x01]);
        } else {
          this.respondError(0x31, 0x12);
        }
        return;
      }

      case 0x34: { // RequestDownload (in ECU schreiben)
        if (!this.securityUnlocked) {
          this.respondError(0x34, 0x33);
          return;
        }
        const addr = (data[0] << 16) | (data[1] << 8) | data[2];
        const size = (data[3] << 16) | (data[4] << 8) | data[5];
        this.downloadPending = { addr, size, buf: new Uint8Array(size), received: 0, seq: 0 };
        await sleep(30);
        this.respond(0x74, [DDE4.transferChunk]);
        return;
      }

      case 0x35: { // RequestUpload (aus ECU lesen)
        const addr = (data[0] << 16) | (data[1] << 8) | data[2];
        const size = (data[3] << 16) | (data[4] << 8) | data[5];
        this.uploadPending = { addr, size, sent: 0, seq: 0 };
        await sleep(30);
        this.respond(0x75, [DDE4.transferChunk]);
        return;
      }

      case 0x36: { // TransferData
        if (this.downloadPending) {
          const seq = data[0];
          const chunk = data.slice(1);
          if (seq !== (this.downloadPending.seq & 0xff)) {
            this.respondError(0x36, 0x24);
            return;
          }
          this.downloadPending.buf.set(chunk, this.downloadPending.received);
          this.downloadPending.received += chunk.length;
          this.downloadPending.seq++;
          await sleep(15);
          this.respond(0x76, [seq]);
        } else {
          this.respondError(0x36, 0x24);
        }
        return;
      }

      case 0x76: { // Ack vom Tester (Upload-Richtung): nächstes 0x36 senden
        if (this.uploadPending) {
          const u = this.uploadPending;
          const len = Math.min(DDE4.transferChunk, u.size - u.sent);
          if (len <= 0) {
            this.uploadPending = null;
            return;
          }
          const chunk = this.flash.subarray(u.addr + u.sent, u.addr + u.sent + len);
          this.respond(0x36, [u.seq & 0xff, ...Array.from(chunk)]);
          u.sent += len;
          u.seq++;
        }
        return;
      }

      case 0x37: { // RequestTransferExit
        await sleep(30);
        if (this.downloadPending) {
          const d = this.downloadPending;
          if (d.received >= d.size) {
            this.flash.set(d.buf, d.addr);
            fixAllChecksums(this.flash); // ECU fixt CR2 selbst beim Verlassen
            this.flashDirty = true;
          }
          this.downloadPending = null;
        }
        this.respond(0x77, []);
        return;
      }

      default:
        await sleep(20);
        this.respondError(service, 0x11);
    }
  }

  private securitySeed: [number, number] = [0x8a, 0x21];

  private respond(service: number, data: number[]): void {
    const frame = buildRequest(service, data, { target: 0xf1, source: DDE4.ecuAddress });
    this.pushBytes(frame);
  }

  private respondError(requestedService: number, nrc: number): void {
    this.respond(0x7f, [requestedService, nrc]);
  }

  private identString(id: number): string {
    switch (id) {
      case 0x9b:
        return '0 281 011 056';
      case 0x97:
        return '0 281 011 056';
      case 0x98:
        return 'DDE4.0 V41 7759';
      case 0x99:
        return 'M57D30';
      case 0x90:
        return 'WBAFR31010DB12345';
      case 0x96:
        return 'SN 0042117';
      case 0x9a:
        return 'COD 3047442 WSG 04112 IMP 00000';
      case 0x89:
        return 'IMMO 0412-B021';
      case 0x9f:
        return 'DDE4.0 EDC15C4-6-BMW';
      default:
        return `IDENT ${id.toString(16).toUpperCase()}`;
    }
  }

  private liveValues(id: number): number[] | null {
    const t = (Date.now() - this.bootTime) / 1000;
    const rpm = Math.round((780 + Math.sin(t / 2.3) * 18 + Math.sin(t * 2.1) * 6) * 4);
    switch (id) {
      case 0x03: {
        // Ladedruck IST: ~1050 mbar absolut im Leerlauf, leicht schwankend (1 LSB = 1 mbar)
        const boost = Math.round(1050 + Math.sin(t / 1.7) * 22 + Math.sin(t * 0.9) * 12);
        return [
          (rpm >> 8) & 0xff,
          rpm & 0xff,
          Math.min(88, 62 + Math.floor(t / 10)) + 48,
          38 + 48,
          (boost >> 8) & 0xff,
          boost & 0xff,
        ];
      }
      case 0x13: {
        const maf = Math.round((12.4 + Math.sin(t / 3.1) * 0.9) * 10);
        const inj = Math.round((8.2 + Math.sin(t / 4) * 0.4) * 100);
        const soi = Math.round((3.5 * 100) + 4000);
        return [(maf >> 8) & 0xff, maf & 0xff, (inj >> 8) & 0xff, inj & 0xff, (soi >> 8) & 0xff, soi & 0xff, 128 + 2];
      }
      case 0x07:
        return [
          138, // 13.8 V
          21 + 48, // Außentemperatur
          44 + 48,
          (Math.floor(t / 60) >> 8) & 0xff,
          Math.floor(t / 60) & 0xff,
        ];
      case 0x15:
        return [
          0, // Pedal
          Math.round(4 * 2.55), // AGR
          Math.round(31 * 2.55), // Lader
          0,
        ];
      default:
        return null;
    }
  }

  /** Deterministisches 512-KiB-Image mit korrekten CR2-Prüfsummen erzeugen */
  private static generateImage(): Uint8Array {
    const img = new Uint8Array(FULL_SIZE);
    // Basis-Füllmuster pro Bank
    for (let bank = 0; bank < FULL_SIZE / BANK_SIZE; bank++) {
      const base = bank * BANK_SIZE;
      const pattern = (bank * 37 + 11) & 0xff;
      for (let i = 0; i < BANK_SIZE - 4; i++) {
        img[base + i] = (pattern + ((i * 7) & 0x1f)) & 0xff;
      }
    }
    // Kennung im Head (geschützte Zone)
    const head = new TextEncoder().encode('QFLASH21-MOCK-DDE4.0-EDC15C4');
    img.set(head, 0x10);
    // "Kennfelder" im CAL-Bereich: Rampen
    const calStart = FULL_SIZE - 0xc000;
    for (let i = 0; i < 0xc000 - 4; i++) {
      img[calStart + i] = (Math.floor((i / 64) % 256) + ((i * 13) & 0x0f)) & 0xff;
    }
    // Prüfsummen korrekt eintragen
    for (let bank = 0; bank < FULL_SIZE / BANK_SIZE; bank++) {
      const base = bank * BANK_SIZE;
      const csOffset = base + BANK_SIZE - 4;
      let sum = 0;
      for (let i = base; i < csOffset; i++) sum = (sum + img[i]) & 0xffff;
      img[csOffset] = sum & 0xff;
      img[csOffset + 1] = (sum >> 8) & 0xff;
      img[csOffset + 2] = sum & 0xff;
      img[csOffset + 3] = (sum >> 8) & 0xff;
    }
    return img;
  }

  /** Für Tests: aktuellen virtuellen Flash abrufen */
  getFlashSnapshot(): Uint8Array {
    return this.flash.slice();
  }

  /** Für Unit-Tests: Frame direkt einschleusen */
  injectResponse(bytes: Uint8Array): void {
    this.pushBytes(bytes);
  }

  static checksumByte(bytes: number[]): number {
    return kwpChecksum(bytes);
  }
}

export function isMockPort(port: unknown): port is MockSerialPort {
  return port instanceof MockSerialPort;
}

export { KwpError };
