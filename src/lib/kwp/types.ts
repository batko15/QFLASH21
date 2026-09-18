/** QFLASH21 – Gemeinsame Typen für KWP2000/DDE4-Diagnose */

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'connected'
  | 'busy'
  | 'error';

export type PortKind = 'ftdi' | 'ftdi-x' | 'ch340' | 'cp2102' | 'mock' | 'unknown';

export interface PortDescriptor {
  kind: PortKind;
  label: string;
  vendorId?: number;
  productId?: number;
}

/** Strukturelles Port-Interface – erfüllt von Web-Serial SerialPort und MockSerialPort */
export interface QfSerialPort {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
  }): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  forget?(): Promise<void>;
}

/** Ein ausgewerteter Antwort-Frame */
export interface ParsedFrame {
  fmt: number;
  target: number;
  source: number;
  service: number;
  data: Uint8Array;
}

export class KwpError extends Error {
  readonly nrc?: number;
  readonly raw?: Uint8Array;
  constructor(message: string, nrc?: number, raw?: Uint8Array) {
    super(message);
    this.name = 'KwpError';
    this.nrc = nrc;
    this.raw = raw;
  }
}

export interface EcuIdent {
  partNumber: string;
  ecuType: string;
  softwareVersion: string;
  hardwareNumber: string;
  serialNumber: string;
  engineCode: string;
  vin: string;
  immobilizerId: string;
  coding: string;
  workshopCode: string;
}

export interface DtcEntry {
  /** EDC-Stil Fehlernummer, z.B. "0064" */
  code: string;
  /** Roher 2-Byte-Code */
  raw: number;
  status: number;
  statusText: string;
  description: string;
  shadow: boolean;
  priority: 'Niedrig' | 'Mittel' | 'Hoch';
  sporadic: boolean;
}

export interface LiveValue {
  label: string;
  value: number;
  unit: string;
  decimals: number;
}

export interface LiveDataFrame {
  timestamp: number;
  blockId: number;
  values: LiveValue[];
}

export type LogDir = 'tx' | 'rx' | 'info' | 'error' | 'ok';

export interface ProtocolLogEntry {
  id: number;
  ts: number;
  dir: LogDir;
  message: string;
  hex?: string;
}

export interface FlashProgress {
  phase: string;
  current: number;
  total: number;
  label: string;
}

export interface ChecksumBlockResult {
  bankIndex: number;
  offset: number;
  start: number;
  end: number;
  calculated: number;
  stored: number;
  ok: boolean;
}

export type BinKind = 'FULL' | 'CAL' | 'UNKNOWN';

export interface DiffRegion {
  start: number;
  end: number;
  bytes: number;
}
