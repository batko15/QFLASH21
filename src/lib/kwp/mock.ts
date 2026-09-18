/**
 * MockSerialPort – virtuelles DDE4.0-Steuergerät (Bosch EDC15C4).
 *
 * Emuliert die für QFLASH21 relevante Teilmenge der Web-Serial-API
 * und verhält sich wie ein echtes DDE4 an der K-Line:
 *  - 5-Baud-Init per BREAK-Taktung → Sync 0x55 + Schlüsselwörter 0x6B 0x8F (Bosch EDC15C)
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

  // Job-Side-Effects (Aktuatorik-Tests, Leerlaufanhebung)
  private sessionDown = false;
  private idleBoostUntil = 0;
  private egrOverrideUntil = 0;
  private egrOverrideValue = 0;
  /** EWS-Status (RLI 0x06): 0x00 = bereit, 0x02 = noch kein Startwert (jungfräulich) */
  private ewsStatus = 0x02;
  /** Zähler für Live-Synthese im LID-Scan (0x20–0x2F) */
  private heartbeats = 0;
  private n75OverrideUntil = 0;
  private n75OverrideValue = 0;
  private glowUntil = 0;

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
    // Bosch EDC15C: Synchronmuster 0x55 + Keywords (KW1=0x6B, KW2=0x8F)
    void sleep(60).then(() => this.pushBytes(new Uint8Array([0x55, ...DDE4.keywords])));
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

    // Nach Init: 1 Byte invertiertes 2. Keyword (~KW2) erwarten (Bosch EDC15C-Konvention)
    if (this.expectComplement) {
      if (this.receiveQueue.length < 1) return;
      const a = this.receiveQueue.shift() as number;
      this.expectComplement = false;
      // GUI-seitig wird der Echo-Teil vom Client verworfen; wir akzeptieren direkt.
      if (a === (DDE4.keywords[1] ^ 0xff)) {
        // Positiv: invertierte Init-Adresse als ROHES Byte quittieren (Bosch: ~0x12 = 0xED)
        void sleep(10).then(() => this.pushBytes(new Uint8Array([(DDE4.ecuAddress ^ 0xff) & 0xff])));
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
    // Nach ECU-Reset (0x11) ist die Diagnose-Session weg – keine Antworten mehr,
    // nur ein neuer 5-Baud-Init baut sie wieder auf (wie beim echten DDE4).
    if (this.sessionDown) return;
    switch (service) {
      case 0x10: // StartDiagnosticSession
        await sleep(25);
        this.respond(0x50, [0x84]);
        return;

      case 0x11: { // ECUReset – Session danach weg
        await sleep(90);
        this.respond(0x51, [data[0] ?? 0x00]);
        void sleep(150).then(() => {
          this.sessionDown = true;
          this.initDone = false;
          this.expectComplement = false;
          this.breakFlanks = [];
          this.securityUnlocked = false;
        });
        return;
      }

      case 0x30: { // InputOutputControlByLocalIdentifier (Aktuatorik-Tests)
        const localId = data[0] ?? 0;
        const value = data[1] ?? 0;
        await sleep(45);
        const now = Date.now();
        if (localId === 0x01 && value) this.glowUntil = now + 5000;
        if (localId === 0x03) {
          this.egrOverrideValue = value;
          this.egrOverrideUntil = now + (value ? 3000 : 0);
        }
        if (localId === 0x04) {
          this.n75OverrideValue = value;
          this.n75OverrideUntil = now + (value ? 3000 : 0);
        }
        // Positive Response 0x70 (SID 0x30 + 0x40): localId + aktueller Kontrollstatus
        this.respond(0x70, [localId, value]);
        return;
      }

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
        // Bosch EDC15C: RLI 0x06 = EWS-Status
        if (id === 0x06) {
          await sleep(22);
          this.respond(0x61, [0x06, this.ewsStatus]);
          return;
        }
        // Bosch EDC15C: LID 0x20–0x2F = 16 applizierbare Blöcke à 10 Messwert-Wörter.
        // Antwort bricht bei undefinierter Position ab – hier: alle 10 Wörter definiert.
        if (id >= 0x20 && id <= 0x2f) {
          this.heartbeats++;
          const words: number[] = [];
          for (let i = 0; i < 10; i++) {
            const w = (id * 1013 + i * 997 + this.heartbeats * 13) & 0xffff;
            words.push((w >> 8) & 0xff, w & 0xff);
          }
          await sleep(22);
          this.respond(0x61, [id, ...words]);
          return;
        }
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
        } else if (routine === 0xe101) {
          // Glühkerzen-Funktionstest: Widerstandswerte je Zylinder (0,12 Ω → Raw 12)
          await sleep(320);
          this.respond(0x71, [data[0], 0xe1, 0x01, 0x00, 0x0c, 0x0d, 0x0c, 0x0e, 0x0c, 0x0d]);
        } else if (routine === 0xe102) {
          // Laufunruhe/Glättung je Zylinder (128 = neutral)
          await sleep(260);
          this.respond(0x71, [data[0], 0xe1, 0x02, 0x00, 0x80, 0x82, 0x7f, 0x81]);
        } else if (routine === 0xe103) {
          // AGR-Funktionstest – Ventil bewegt sich (im Live-Block 0x15 sichtbar)
          await sleep(240);
          this.egrOverrideValue = 0x66; // 40 %
          this.egrOverrideUntil = Date.now() + 3000;
          this.respond(0x71, [data[0], 0xe1, 0x03, 0x00]);
        } else if (routine === 0xe104) {
          // Adaptionswerte zurücksetzen
          await sleep(200);
          this.respond(0x71, [data[0], 0xe1, 0x04, 0x00]);
        } else if (routine === 0xe105) {
          // Test-Leerlauf +250 1/min für 20 s (im Live-Block 0x03 sichtbar)
          await sleep(160);
          this.idleBoostUntil = Date.now() + 20000;
          this.respond(0x71, [data[0], 0xe1, 0x05, 0x00, 0x00, 0xfa]);
        } else if (routine === 0x0083) {
          // EWS-Startwertinitialisierung (Bosch EDC15C Kap. 10.1.2.30)
          // REYO: data[3] = 00 jungfräulich / 01 gebraucht · Antwort: Verifybyte
          await sleep(240);
          const reyo = data[3] ?? 0x00;
          if (reyo === 0x00) {
            // Jungfräuliches SG programmieren → danach bereit
            this.ewsStatus = 0x00;
            this.respond(0x71, [data[0], 0x00, 0x83, 0x00]);
          } else if (reyo === 0x01) {
            // Gebrauchtes SG zurücksetzen: 1× „schon gespeichert", danach bereit
            this.ewsStatus = 0x00;
            this.respond(0x71, [data[0], 0x00, 0x83, 0x01]);
          } else {
            this.respondError(0x31, 0x12); // unplausible Anforderung
          }
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
          // Bounds-Check: Überlauf (chunk größer als Rest) → RequestSequenceError statt RangeError
          if (this.downloadPending.received + chunk.length > this.downloadPending.size) {
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
          this.downloadPending = null;
          if (d.received !== d.size) {
            // Unvollständiger Transfer ist KEIN Erfolg – sonst meldet der Simulator
            // „geschrieben & verifiziert" für einen gar nicht übernommenen Zustand
            this.respondError(0x37, 0x24);
            return;
          }
          if (d.addr + d.size > this.flash.length) {
            this.respondError(0x37, 0x31); // RequestOutOfRange
            return;
          }
          this.flash.set(d.buf, d.addr);
          fixAllChecksums(this.flash); // ECU fixt CR2 selbst beim Verlassen
          this.flashDirty = true;
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
    let rpm = Math.round((780 + Math.sin(t / 2.3) * 18 + Math.sin(t * 2.1) * 6) * 4);
    if (Date.now() < this.idleBoostUntil) rpm += 250 * 4; // Test-Leerlauf +250 1/min
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
      case 0x15: {
        const now = Date.now();
        const egr = now < this.egrOverrideUntil ? this.egrOverrideValue : Math.round(4 * 2.55);
        const n75 = now < this.n75OverrideUntil ? this.n75OverrideValue : Math.round(31 * 2.55);
        const glowRest = now < this.glowUntil ? 5 : 0;
        return [
          0, // Pedal
          egr,
          n75,
          glowRest,
        ];
      }
      case 0x17: {
        // Öltemperatur, Abgastemperatur AT1/AT2, Ölstand (EDC15C4-Zusatzsensoren)
        const oil = Math.round(Math.min(102, 84 + t / 30) + 48);
        const at1 = Math.round((42 + Math.sin(t / 5) * 3 + 40) * 10);
        const at2 = Math.round((38 + Math.sin(t / 6) * 2 + 40) * 10);
        return [oil, (at1 >> 8) & 0xff, at1 & 0xff, (at2 >> 8) & 0xff, at2 & 0xff, Math.round(92 * 2.55)];
      }
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
