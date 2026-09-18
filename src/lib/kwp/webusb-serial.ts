/**
 * QFLASH21 – WebUSB-Serial-Fallback (FTDI FT232R/FT231X, CH340/CH341, CP2102)
 *
 * Warum: `navigator.serial` (Web Serial) unterstützt USB-Geräte auf Android-Chrome
 * erst ab Version 148 (davor nur Bluetooth-RFCOMM). `navigator.usb` (WebUSB)
 * funktioniert dagegen auf Android-Chrome seit Version 61 – damit läuft das
 * K+DCAN-Kabel auch an älterem Android-Chrome direkt per USB-C-OTG.
 *
 * Dieser Adapter implementiert exakt dasselbe QfSerialPort-Interface wie Web-Serials
 * SerialPort, sodass der komplette KWP2000-Stack (SerialClient, 5-Baud-Init mit
 * BREAK, Echo-Erkennung) unverändert funktioniert.
 *
 * Protokolle bit-genau aus dem Linux-Kernel übernommen (Algorithmen):
 *  - drivers/usb/serial/ftdi_sio.c  (FTDI-BM/R-Divisor {0,3,2,4,1,5,6,7}, SIO-Requests)
 *  - drivers/usb/serial/ch341.c     (CH341-Prescaler ps/fact, LCR-Register, BREAK)
 *  - drivers/usb/serial/cp210x.c    (SET_BAUDRATE u32-LE, LINE_CTL, SET_BREAK 0x16)
 *
 * Achtung Android: Android-Kernel laden i. d. R. KEINE usb-serial-Treiber automatisch,
 * daher ist die Schnittstelle für WebUSB frei (Desktop-Linux müsste ftdi_sio erst entladen).
 */

import type { QfSerialPort } from './types';

/* ------------------------------------------------------------------ */
/* Minimale WebUSB-Typen (unabhängig von TS-lib-Version)              */
/* ------------------------------------------------------------------ */

export interface QfUsbSetup {
  requestType: 'standard' | 'class' | 'vendor';
  recipient: 'device' | 'interface' | 'endpoint' | 'other';
  request: number;
  value: number;
  index: number;
}

export interface QfUsbTransferResult {
  status: 'ok' | 'stall' | 'babble';
  data?: DataView;
  bytesWritten?: number;
}

export interface QfUsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  selectAlternateInterface(iface: number, alt: number): Promise<void>;
  controlTransferIn(setup: QfUsbSetup, length: number): Promise<QfUsbTransferResult>;
  controlTransferOut(setup: QfUsbSetup, data?: BufferSource): Promise<QfUsbTransferResult>;
  transferIn(endpoint: number, length: number): Promise<QfUsbTransferResult>;
  transferOut(endpoint: number, data: BufferSource): Promise<QfUsbTransferResult>;
}

interface QfUsbEndpoint {
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous' | 'control';
  endpointNumber: number;
  packetSize: number;
}

interface QfUsb {
  getDevices(): Promise<QfUsbDevice[]>;
  requestDevice(options: { filters: { vendorId?: number; productId?: number }[] }): Promise<QfUsbDevice>;
}

interface QfUsbDeviceInternals extends QfUsbDevice {
  configuration?: {
    interfaces?: { alternate?: { endpoints?: QfUsbEndpoint[] } }[];
  };
}

function usb(): QfUsb | null {
  if (typeof navigator === 'undefined') return null;
  const u = (navigator as unknown as { usb?: QfUsb }).usb;
  return u ?? null;
}

export function isWebUsbSupported(): boolean {
  return usb() !== null;
}

/* ------------------------------------------------------------------ */
/* Adapter-Kennung                                                    */
/* ------------------------------------------------------------------ */

export type WebUsbDriverKind = 'ftdi' | 'ch340' | 'cp2102';

export const WEBUSB_FILTERS: { vendorId: number; productId: number }[] = [
  { vendorId: 0x0403, productId: 0x6001 }, // FTDI FT232RL – klassisches K+DCAN-Kabel
  { vendorId: 0x0403, productId: 0x6015 }, // FTDI FT231X
  { vendorId: 0x1a86, productId: 0x7523 }, // CH340/CH341 (Klon-Kabel)
  { vendorId: 0x10c4, productId: 0xea60 }, // CP2102
];

export function driverForDevice(vendorId: number, productId: number): WebUsbDriverKind | null {
  if (vendorId === 0x0403 && (productId === 0x6001 || productId === 0x6015)) return 'ftdi';
  if (vendorId === 0x1a86 && productId === 0x7523) return 'ch340';
  if (vendorId === 0x10c4 && productId === 0xea60) return 'cp2102';
  return null;
}

export function driverLabel(kind: WebUsbDriverKind): string {
  switch (kind) {
    case 'ftdi':
      return 'FTDI FT232 (K+DCAN)';
    case 'ch340':
      return 'CH340 (K+DCAN-Klon)';
    case 'cp2102':
      return 'CP2102';
  }
}

/** Port-Auswahl über den nativen WebUSB-Dialog (muss aus User-Geste heraus passieren). */
export async function requestWebUsbDevice(): Promise<QfUsbDevice> {
  const u = usb();
  if (!u) throw new Error('WebUSB wird von diesem Browser nicht unterstützt.');
  return u.requestDevice({ filters: WEBUSB_FILTERS });
}

/* ------------------------------------------------------------------ */
/* Treiber-Mathematik (1:1 aus dem Linux-Kernel)                      */
/* ------------------------------------------------------------------ */

/** FTDI FT232BM/R-Divisor (ftdi_sio.c: ftdi_232bm_baud_base_to_divisor, Base 48 MHz). */
export function ftdiBmDivisor(baud: number): number {
  const base = 48_000_000;
  const divfrac = [0, 3, 2, 4, 1, 5, 6, 7];
  let divisor3 = Math.round(base / (2 * baud));
  if ((divisor3 & 0x7) === 7) divisor3++; // x.7/8 auf x+1 aufrunden
  let divisor = divisor3 >> 3;
  divisor |= divfrac[divisor3 & 0x7] << 14;
  if (divisor === 1) divisor = 0; // höchste Baudrate
  else if (divisor === 0x4001) divisor = 1;
  return divisor;
}

/** CH341-Divisor (ch341.c: ch341_get_divisor). Rückgabe: wIndex für REQ_WRITE_REG. */
export function ch341Divisor(baud: number): number {
  const CLKRATE = 48_000_000;
  const clkDiv = (ps: number, fact: number) => 1 << (12 - 3 * ps - fact);
  const minRate = (ps: number) => CLKRATE / (clkDiv(ps, 1) * 512);
  const minRates = [minRate(0), minRate(1), minRate(2), minRate(3)];
  const speed = Math.min(Math.max(baud, 46), 3_000_000);

  let ps = 3;
  for (; ps >= 0; ps--) {
    if (speed > minRates[ps]) break;
  }
  if (ps < 0) throw new Error(`CH340: Baudrate ${baud} nicht unterstützt.`);

  const clk_div = clkDiv(ps, 1);
  let div = Math.floor(CLKRATE / (clk_div * speed));
  let fact = 1;

  if (div < 9 || div > 255) {
    div = Math.floor(div / 2);
    fact = 0;
  }
  if (div < 2) throw new Error(`CH340: Baudrate ${baud} nicht unterstützt.`);

  // Nächsten Divisor wählen, wenn näher an der Wunschrate
  if (
    (16 * CLKRATE) / (clk_div * div) - 16 * speed >=
    16 * speed - (16 * CLKRATE) / (clk_div * (div + 1))
  ) {
    div++;
  }
  // Gerader Divisor → niedrigeren Basistakt bevorzugen (toleranterer Empfänger)
  if (fact === 1 && div % 2 === 0) {
    div /= 2;
    fact = 0;
  }
  return ((0x100 - div) << 8) | (fact << 2) | ps;
}

/* ------------------------------------------------------------------ */
/* WebUsbSerialPort (implementiert QfSerialPort)                      */
/* ------------------------------------------------------------------ */

interface EndpointPair {
  iface: number;
  epIn: number;
  epOut: number;
  maxIn: number;
}

export class WebUsbSerialPort implements QfSerialPort {
  readonly device: QfUsbDevice;
  private driver: WebUsbDriverKind;
  private eps: EndpointPair | null = null;

  private baudRate = 10400;
  private parity: 'none' | 'even' | 'odd' = 'none';
  private breakOn = false;

  private reading = false;
  private readCancelled = false;
  private readerController: ReadableStreamDefaultController<Uint8Array> | null = null;

  // QfSerialPort-Schnittstelle
  readable: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({ start: () => undefined });
  writable: WritableStream<Uint8Array> = new WritableStream<Uint8Array>();

  constructor(device: QfUsbDevice) {
    this.device = device;
    this.driver = driverForDevice(device.vendorId, device.productId) ?? 'cp2102';
  }

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
  }

  get driverKind(): WebUsbDriverKind {
    return this.driver;
  }

  get label(): string {
    const name = this.device.productName ?? this.device.manufacturerName;
    return name ? `${driverLabel(this.driver)} (${name})` : driverLabel(this.driver);
  }

  forget(): Promise<void> {
    // WebUSB hat kein forget(); No-Op (Interface-Kompatibilität zu SerialPort)
    return Promise.resolve();
  }

  /* --------------------------- open/close ---------------------------- */

  /** QfSerialPort.open – öffnet USB-Gerät, konfiguriert den Chip und startet RX-Pump. */
  async open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }): Promise<void> {
    const kind = driverForDevice(this.device.vendorId, this.device.productId);
    if (!kind) {
      throw new Error(
        `Unbekannter USB-Adapter (VID ${this.device.vendorId.toString(16)} / PID ${this.device.productId.toString(16)}) – FTDI, CH340 oder CP2102 nötig.`
      );
    }
    this.driver = kind;
    this.baudRate = options.baudRate;
    this.parity = options.parity ?? 'none';
    this.breakOn = false;

    if (!this.device.opened) await this.device.open();
    try {
      await this.device.selectConfiguration(1);
    } catch {
      /* manche Geräte sind bereits konfiguriert */
    }
    this.eps = this.findBulkEndpoints();
    if (!this.eps) throw new Error('Kein Bulk-IN/OUT-Endpoint am Adapter gefunden.');
    await this.device.claimInterface(this.eps.iface);

    await this.configureChip();

    // Streams (erneut) aufbauen
    this.readCancelled = false;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readerController = controller;
        void this.readLoop();
      },
      cancel: () => {
        this.readCancelled = true;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (!this.eps) throw new Error('Adapter nicht geöffnet.');
        const res = await this.device.transferOut(this.eps.epOut, chunk as unknown as BufferSource);
        if (res.status === 'stall') await this.recoverOutStall();
      },
    });
  }

  async close(): Promise<void> {
    this.readCancelled = true;
    this.readerController = null;
    if (this.eps && this.device.opened) {
      try {
        await this.device.releaseInterface(this.eps.iface);
      } catch {
        /* ignore */
      }
    }
    this.eps = null;
    try {
      if (this.device.opened) await this.device.close();
    } catch {
      /* ignore */
    }
  }

  /* --------------------------- Signale/BREAK --------------------------- */

  async setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
  }): Promise<void> {
    if (signals.break !== undefined && signals.break !== this.breakOn) {
      this.breakOn = signals.break;
      await this.setBreak(signals.break);
    }
    // DTR/RTS werden beim Öffnen dauerhaft gesetzt (K-Line ohne Flusssteuerung)
  }

  /* ------------------------------ intern ------------------------------ */

  private findBulkEndpoints(): EndpointPair | null {
    const dev = this.device as QfUsbDeviceInternals;
    const ifaceList = dev.configuration?.interfaces;
    if (!ifaceList) return null;
    for (let i = 0; i < ifaceList.length; i++) {
      const alt = ifaceList[i]?.alternate;
      if (!alt?.endpoints) continue;
      const epIn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      const epOut = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      if (epIn && epOut) {
        return {
          iface: i,
          epIn: epIn.endpointNumber | 0x80,
          epOut: epOut.endpointNumber,
          maxIn: epIn.packetSize || 64,
        };
      }
    }
    return null;
  }

  private vendorOut(request: number, value: number, index = 0, data?: BufferSource): Promise<unknown> {
    return this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'device', request, value, index },
      data
    );
  }

  private async vendorIn(request: number, value: number, index = 0, length = 2): Promise<Uint8Array | null> {
    const res = await this.device.controlTransferIn(
      { requestType: 'vendor', recipient: 'device', request, value, index },
      length
    );
    if (res.status !== 'ok' || !res.data) return null;
    return new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
  }

  /** Chip-spezifische Grundkonfiguration (Baudrate 8E1, BREAK aus, DTR/RTS an). */
  private async configureChip(): Promise<void> {
    switch (this.driver) {
      case 'ftdi': {
        // SIO_RESET (0): SIO-Reset, dann Buffer purgen
        await this.vendorOut(0x00, 0x0000);
        await this.vendorOut(0x00, 0x0001); // Purge RX
        await this.vendorOut(0x00, 0x0002); // Purge TX
        // SIO_SET_FLOW_CTRL (2): none
        await this.vendorOut(0x02, 0x0000);
        // SIO_SET_BAUD_RATE (3)
        await this.vendorOut(0x03, ftdiBmDivisor(this.baudRate));
        // SIO_SET_DATA (4): 8 Datenbits, Parität, 1 Stopbit, BREAK aus
        await this.vendorOut(0x04, this.ftdiDataValue());
        // SIO_SET_LATENCY_TIMER (9): 1 ms (Diagnose-Latenz)
        await this.vendorOut(0x09, 0x0001);
        // DTR|RTS setzen (K+DCAN-Kabel erwarten häufig aktive Handshake-Leitungen)
        await this.vendorOut(0x01, 0x0303);
        break;
      }
      case 'ch340': {
        const ver = await this.vendorIn(0x5f, 0x0000, 0, 2);
        const version = ver && ver.length > 0 ? ver[0] : 0x30;
        // SERIAL_INIT (0xA1)
        await this.vendorOut(0xa1, 0x0000);
        // Divisor/Prescaler: WRITE_REG(0x9A), wValue=(REG_DIVISOR<<8)|REG_PRESCALER=0x1312
        let val = ch341Divisor(this.baudRate);
        if (version > 0x27) val |= 0x80; // Full-packet-Buffering aus
        await this.vendorOut(0x9a, 0x1312, val);
        // LCR (ab Version 0x30): wValue=(REG_LCR2<<8)|REG_LCR=0x2518
        if (version >= 0x30) {
          await this.vendorOut(0x9a, 0x2518, this.ch341Lcr());
        }
        // DTR|RTS an (invertierte Logik: ~control)
        await this.vendorOut(0xa4, (~0x60) & 0xffff);
        break;
      }
      case 'cp2102': {
        // SET_BAUDRATE (0x1E): u32 LE im Data-Stage
        const buf = new ArrayBuffer(4);
        new DataView(buf).setUint32(0, this.baudRate, true);
        await this.device.controlTransferOut(
          { requestType: 'vendor', recipient: 'device', request: 0x1e, value: 0, index: 0 },
          buf
        );
        // SET_LINE_CTL (0x03): 8 Datenbits, Parität, 1 Stopbit → 0x0800 | even?0x0020 | odd?0x0010
        const lineCtl =
          0x0800 | (this.parity === 'even' ? 0x0020 : 0) | (this.parity === 'odd' ? 0x0010 : 0);
        await this.vendorOut(0x03, lineCtl);
        // SET_MHS (0x07): DTR|RTS setzen
        await this.vendorOut(0x07, 0x0303);
        // PURGE (0x12): RX+TX
        await this.vendorOut(0x12, 0x0003);
        break;
      }
    }
  }

  private ftdiDataValue(): number {
    const bits = 8;
    const parity = this.parity === 'even' ? 2 : this.parity === 'odd' ? 1 : 0;
    const stop = 0; // 1 Stopbit
    const brk = this.breakOn ? 0x4000 : 0x0000;
    return bits | (parity << 8) | (stop << 11) | brk;
  }

  private ch341Lcr(): number {
    const RX = 0x80, TX = 0x40, PAR_EN = 0x08, PAR_EVEN = 0x10, CS8 = 0x03;
    return RX | TX | CS8 | PAR_EN | (this.parity === 'even' ? PAR_EVEN : 0);
  }

  private async setBreak(on: boolean): Promise<void> {
    switch (this.driver) {
      case 'ftdi':
        // SIO_SET_DATA mit Bit 14 = BREAK an (ftdi_sio.c: FTDI_SIO_SET_BREAK)
        await this.vendorOut(0x04, this.ftdiDataValue());
        break;
      case 'ch340': {
        // ch341_break_ctl: Register 0x05 (BREAK) + 0x18 (LCR) lesen/ändern/schreiben
        const regs = await this.vendorIn(0x95, 0x1805, 0, 2);
        let breakReg = regs && regs.length > 0 ? regs[0] : 0x01;
        let lcr = regs && regs.length > 1 ? regs[1] : this.ch341Lcr();
        if (on) {
          breakReg &= ~0x01; // CH341_NBREAK_BITS
          lcr &= ~0x40; // ENABLE_TX aus → TX-Leitung auf Space (LOW)
        } else {
          breakReg |= 0x01;
          lcr |= 0x40;
        }
        await this.vendorOut(0x9a, 0x1805, (breakReg & 0xff) | ((lcr & 0xff) << 8));
        break;
      }
      case 'cp2102':
        // CP210X_SET_BREAK (0x16): 1 = ON, 0 = OFF
        await this.vendorOut(0x16, on ? 0x0001 : 0x0000);
        break;
    }
  }

  private async recoverOutStall(): Promise<void> {
    // Nach STALL: einfachen Endpoint-Clear vermeiden (nicht in WebUSB verfügbar);
    // nächster Transfer setzt i. d. R. fort.
  }

  /** RX-Pump: transferIn-Schleife; FTDI/CH340 haben 2 Status-Bytes pro Paket. */
  private async readLoop(): Promise<void> {
    const ctrl = this.readerController;
    if (!ctrl) return;
    this.reading = true;
    try {
      while (this.reading && !this.readCancelled && this.eps) {
        const res = await this.device.transferIn(this.eps.epIn, this.eps.maxIn);
        if (this.readCancelled) break;
        if (res.status === 'ok' && res.data && res.data.byteLength > 0) {
          const all = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
          const payload = this.driver === 'cp2102' ? all : stripStatus(all);
          if (payload.length > 0) {
            ctrl.enqueue(new Uint8Array(payload));
          }
        }
      }
    } catch (e) {
      if (!this.readCancelled) {
        try {
          ctrl.error(e instanceof Error ? e : new Error('USB-Lesefehler'));
        } catch {
          /* Stream bereits geschlossen */
        }
      }
    } finally {
      this.reading = false;
    }
  }
}

/** Entfernt die 2 Modem-/Line-Statusbytes am Kopf jedes Pakets (FTDI/CH340). */
function stripStatus(all: Uint8Array): Uint8Array {
  if (all.length <= 2) return new Uint8Array(0);
  return all.subarray(2);
}
