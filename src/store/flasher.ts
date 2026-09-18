'use client';

/**
 * QFLASH21 – Zustand-Store (Zustand).
 * Kapselt SerialClient + MockSerialPort und hält den gesamten
 * Diagnose-/Flash-Zustand. Alle Hardware-Aktionen laufen über hier.
 */

import { create } from 'zustand';
import { toast } from 'sonner';

import { SerialClient, isWebSerialSupported, isAndroid, portKindFromInfo, DDE4_KEYWORDS } from '@/lib/kwp/serial-client';
import { reportOperationSupabase } from '@/lib/supabase-log';
import { MockSerialPort } from '@/lib/kwp/mock';
import { DDE4, IDENT_SERVICES, LIVE_BLOCKS, liveBlockById, parseDtcResponse } from '@/lib/kwp/dde4';
import { computeAllChecksums, fixAllChecksums, touchesProtectedArea, FULL_SIZE } from '@/lib/kwp/checksum';
import { analyzeBin, detectBinKind } from '@/lib/kwp/bin';
import { KwpError } from '@/lib/kwp/types';
import type {
  ConnectionState,
  DtcEntry,
  EcuIdent,
  FlashProgress,
  LiveDataFrame,
  ProtocolLogEntry,
  QfSerialPort,
} from '@/lib/kwp/types';

export const VEHICLES = [
  { id: 'e38-730d', label: 'E38 730d', engine: 'M57D30' },
  { id: 'e39-525d', label: 'E39 525d', engine: 'M57D25' },
  { id: 'e39-530d', label: 'E39 530d', engine: 'M57D30' },
  { id: 'e46-330d', label: 'E46 330d', engine: 'M57D30' },
  { id: 'e46-330xd', label: 'E46 330xd', engine: 'M57D30' },
  { id: 'e53-x5-30d', label: 'E53 X5 3.0d', engine: 'M57D30' },
] as const;

export interface BinState {
  name: string;
  kind: ReturnType<typeof detectBinKind>;
  size: number;
  data: Uint8Array;
  checksumsOk: number;
  checksumsBad: number;
}

interface FlasherState {
  // Verbindung
  supported: boolean;
  android: boolean;
  connection: ConnectionState;
  portLabel: string;
  isMock: boolean;
  baudRate: number;
  keywords: [number, number] | null;
  initSteps: string[];

  // Fahrzeug & ECU
  vehicle: string;
  ident: EcuIdent | null;

  // Fehlerspeicher
  dtcs: DtcEntry[];
  shadowDtcs: DtcEntry[];
  dtcReadAt: number | null;

  // Live-Daten
  liveFrames: Record<number, LiveDataFrame>;
  livePolling: boolean;
  liveHistory: Record<number, LiveDataFrame[]>;
  recording: boolean;
  recordedFrames: LiveDataFrame[];

  // Einstellungen
  autoReconnect: boolean;

  // BIN & Flash
  bin: BinState | null;
  ecuBin: { size: number; data: Uint8Array; saved: boolean; name: string } | null;
  progress: FlashProgress | null;
  busy: boolean;
  lastVoltage: number | null;

  // Protokoll-Log
  logs: ProtocolLogEntry[];

  // Aktionen
  initSupport: () => void;
  setVehicle: (v: string) => void;
  setBaudRate: (b: number) => void;
  connectMock: () => Promise<void>;
  connectReal: () => Promise<void>;
  disconnect: () => Promise<void>;
  log: (dir: ProtocolLogEntry['dir'], message: string, hex?: string) => void;
  clearLogs: () => void;

  readIdent: () => Promise<boolean>;
  readDtc: () => Promise<void>;
  clearDtc: () => Promise<void>;
  pollLiveOnce: (blockId: number) => Promise<void>;
  startLivePoll: (blockId: number) => void;
  stopLivePoll: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  setAutoReconnect: (v: boolean) => void;
  reconnect: () => Promise<void>;

  loadBinFile: (file: File) => Promise<void>;
  readEcuFlash: () => Promise<void>;
  saveEcuBin: () => void;
  eraseFlash: () => Promise<void>;
  writeFlash: (data: Uint8Array, label: string) => Promise<void>;
  fixBinChecksums: () => void;
  setLastVoltage: (v: number | null) => void;
}

let client: SerialClient | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveFailures = 0;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastPort: Awaited<ReturnType<typeof SerialClient.requestPort>> | null = null;
let lastPortLabel = '–';
let logCounter = 0;
const MAX_LOGS = 600;
const LIVE_HISTORY_CAP = 120;
const RECORDING_CAP = 1500;
const MAX_RECONNECT_ATTEMPTS = 3;

// ── Einstellungs-Persistenz (localStorage, SSR-sicher) ──
const SETTINGS_KEY = 'qflash21.settings.v1';

interface StoredSettings {
  baudRate?: number;
  vehicle?: string;
  autoReconnect?: boolean;
}

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as StoredSettings) : {};
  } catch {
    return {};
  }
}

function saveSettings(patch: StoredSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    /* privat/SSR */
  }
}

function stopKeepAlive(): void {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
  keepAliveFailures = 0;
}

/**
 * KWP2000-TesterPresent (0x3E): hält die Diagnose-Session am Leben
 * (ECU baut ohne Traffic nach ~5 s ab). Zwei Ausfälle hintereinander
 * = Session verloren → Disconnect + optional Auto-Reconnect.
 */
function startKeepAlive(get: () => FlasherState, set: (p: Partial<FlasherState>) => void): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    const st = get();
    if (!client || st.connection !== 'connected' || st.busy || st.livePolling || st.isMock) return;
    void (async () => {
      try {
        await client!.sendRequest(0x3e, [0x00], { timeoutMs: 1200 });
        keepAliveFailures = 0;
      } catch {
        keepAliveFailures++;
        // Buffer flushen, damit verspätete Bytes die nächste Anfrage nicht vergiften
        try {
          await client!.drainInitAck(120);
        } catch {
          /* egal */
        }
        if (keepAliveFailures >= 2) {
          stopKeepAlive();
          get().stopLivePoll();
          set({ connection: 'disconnected', portLabel: '–' });
          get().log('error', 'Session-Timeout: ECU hat die Diagnose-Session abgebaut (0x3E unbeantwortet)');
          toast.warning('Verbindung verloren', { description: 'Session abgelaufen – Wiederverbindung …' });
          if (get().autoReconnect && lastPort) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => void get().reconnect(), 2000);
          }
        }
      }
    })();
  }, 3000);
}

async function reportOperation(
  operation: string,
  status: 'OK' | 'ERROR',
  details: Record<string, unknown>,
  durationMs: number
): Promise<void> {
  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, status, details, durationMs }),
    });
    if (res.ok) return;
    // Server ohne DB-Konfiguration (503) → direkter Supabase-Fallback
  } catch {
    // Netzwerkfehler → ebenso Fallback
  }
  try {
    await reportOperationSupabase({
      operation,
      status,
      details: JSON.stringify(details).slice(0, 4000),
      durationMs,
    });
  } catch {
    // Logging darf die Diagnose niemals blockieren
  }
}

function errMessage(e: unknown): string {
  if (e instanceof KwpError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const useFlasher = create<FlasherState>((set, get) => ({
  supported: false,
  android: false,
  connection: 'disconnected',
  portLabel: '–',
  isMock: false,
  baudRate: 10400,
  keywords: null,
  initSteps: [],

  vehicle: 'e46-330d',
  ident: null,

  dtcs: [],
  shadowDtcs: [],
  dtcReadAt: null,

  liveFrames: {},
  livePolling: false,
  liveHistory: {},
  recording: false,
  recordedFrames: [],

  autoReconnect: true,

  bin: null,
  ecuBin: null,
  progress: null,
  busy: false,
  lastVoltage: null,

  logs: [],

  initSupport: () => {
    const stored = loadSettings();
    set({
      supported: isWebSerialSupported(),
      android: isAndroid(),
      ...(stored.baudRate ? { baudRate: stored.baudRate } : {}),
      ...(stored.vehicle ? { vehicle: stored.vehicle } : {}),
      ...(typeof stored.autoReconnect === 'boolean' ? { autoReconnect: stored.autoReconnect } : {}),
    });
  },

  setVehicle: (v) => {
    set({ vehicle: v });
    saveSettings({ vehicle: v });
  },
  setBaudRate: (b) => {
    set({ baudRate: b });
    if (client) client.config.baudRate = b;
    saveSettings({ baudRate: b });
  },

  log: (dir, message, hex) =>
    set((s) => ({
      logs: [{ id: ++logCounter, ts: Date.now(), dir, message, hex }, ...s.logs].slice(0, MAX_LOGS),
    })),

  clearLogs: () => set({ logs: [] }),

  connectMock: async () => {
    if (get().connection === 'connected' || get().connection === 'connecting') return;
    set({ connection: 'connecting', initSteps: [], keywords: null, isMock: true });
    client = new SerialClient();
    client.onLog = (dir, message, bytes) => get().log(dir, message, bytes ? Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : undefined);
    try {
      const port: QfSerialPort = new MockSerialPort();
      client.config.baudRate = get().baudRate;
      await client.connect(port as unknown as QfSerialPort);
      const steps: string[] = [];
      set({ connection: 'initializing', portLabel: 'Virtuelles DDE4 (Simulator)', initSteps: steps });
      const kw = await client.fiveBaudInit(DDE4.ecuAddress);
      steps.push(`5-Baud-Init OK – Schlüsselwörter 0x${kw[0].toString(16).toUpperCase()} 0x${kw[1].toString(16).toUpperCase()}`);
      set({ keywords: kw, initSteps: [...steps] });
      await client.sendKeywordComplement(kw[0], kw[1]);
      await client.drainInitAck(600);
      await client.sendRequest(0x10, Array.from(DDE4.startSessionParams), { timeoutMs: 2000 });
      steps.push('Diagnose-Session gestartet (0x10/0x84 bestätigt)');
      set({ connection: 'connected', initSteps: [...steps] });
      get().log('ok', 'Mock-Verbindung hergestellt (virtuelles DDE4.0)');
      toast.success('Simulator verbunden', { description: 'Virtuelles DDE4.0 (EDC15C4) bereit.' });
      void reportOperation('CONNECT', 'OK', { mock: true, keywords: kw }, 0);
    } catch (e) {
      set({ connection: 'error', portLabel: '–' });
      get().log('error', `Mock-Verbindung fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Simulator-Verbindung fehlgeschlagen', { description: errMessage(e) });
      await client?.close();
      client = null;
    }
  },

  connectReal: async () => {
    if (get().connection === 'connected' || get().connection === 'connecting') return;
    if (!isWebSerialSupported()) {
      toast.error('Web Serial nicht verfügbar', {
        description: 'Chrome/Edge ≥ 89 nötig (Android: Chrome über USB-C-OTG).',
      });
      return;
    }
    set({ connection: 'connecting', initSteps: [], keywords: null, isMock: false });
    const t0 = Date.now();
    try {
      const port = await SerialClient.requestPort();
      lastPort = port;
      reconnectAttempts = 0;
      client = new SerialClient();
      client.onLog = (dir, message, bytes) => get().log(dir, message, bytes ? Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : undefined);
      client.onDisconnect = () => {
        if (get().connection !== 'disconnected') {
          stopKeepAlive();
          get().stopLivePoll();
          set({ connection: 'disconnected', portLabel: '–', keywords: null });
          get().log('error', 'Adapter getrennt (USB/OTG)');
          toast.warning('Adapter getrennt');
          if (get().autoReconnect && lastPort) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => void get().reconnect(), 2000);
          }
        }
      };
      client.config.baudRate = get().baudRate;
      await client.connect(port);
      const info = portKindFromInfo(port.getInfo());
      const steps: string[] = [`Port geöffnet: ${info.label} @ ${get().baudRate} Bd`];
      set({ connection: 'initializing', portLabel: info.label, initSteps: steps });

      const kw = await client.fiveBaudInit(DDE4.ecuAddress);
      const kwOk = kw[0] === DDE4_KEYWORDS[0] && kw[1] === DDE4_KEYWORDS[1];
      steps.push(`5-Baud-Init OK – Schlüsselwörter 0x${kw[0].toString(16).toUpperCase()} 0x${kw[1].toString(16).toUpperCase()}${kwOk ? ' (DDE4 bestätigt)' : ' (abweichend!)'}`);
      set({ keywords: kw, initSteps: [...steps] });

      await client.sendKeywordComplement(kw[0], kw[1]);
      await client.drainInitAck(600);
      await client.sendRequest(0x10, Array.from(DDE4.startSessionParams), { timeoutMs: 2500 });
      steps.push('Diagnose-Session gestartet');
      set({ connection: 'connected', initSteps: [...steps] });
      lastPortLabel = info.label;
      startKeepAlive(get, set);
      get().log('ok', `Verbindung hergestellt: ${info.label} · TesterPresent-KeepAlive aktiv`);
      toast.success('Steuergerät verbunden', { description: info.label });
      void reportOperation('CONNECT', 'OK', { port: info, baudRate: get().baudRate, keywords: kw }, Date.now() - t0);
    } catch (e) {
      const msg = errMessage(e);
      set({ connection: 'error', portLabel: '–' });
      get().log('error', `Verbindung fehlgeschlagen: ${msg}`);
      toast.error('Verbindung fehlgeschlagen', { description: msg });
      void reportOperation('CONNECT', 'ERROR', { error: msg }, Date.now() - t0);
      await client?.close();
      client = null;
    }
  },

  disconnect: async () => {
    get().stopLivePoll();
    stopKeepAlive();
    lastPort = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    await client?.close();
    client = null;
    set({
      connection: 'disconnected',
      portLabel: '–',
      keywords: null,
      ident: null,
      dtcs: [],
      shadowDtcs: [],
      dtcReadAt: null,
      liveFrames: {},
      recording: false,
      initSteps: [],
      busy: false,
      progress: null,
    });
    get().log('info', 'Verbindung getrennt');
  },

  readIdent: async () => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return false;
    }
    const t0 = Date.now();
    set({ busy: true });
    try {
      const ident = {} as EcuIdent;
      for (const svc of IDENT_SERVICES) {
        const resp = await client.sendRequest(0x1a, [svc.id], { timeoutMs: 1500 });
        const raw = resp.data.slice(1); // ID-Byte überspringen
        const text = new TextDecoder('latin1').decode(raw).replace(/\u0000+$/g, '').trim();
        (ident as unknown as Record<string, string>)[svc.key] = text || '–';
      }
      set({ ident });
      get().log('ok', 'ECU-Identifikation vollständig gelesen');
      toast.success('ECU identifiziert', { description: `${ident.ecuType} · SW ${ident.softwareVersion}` });
      void reportOperation('READ_IDENT', 'OK', { ecuType: ident.ecuType, partNumber: ident.partNumber }, Date.now() - t0);
      return true;
    } catch (e) {
      get().log('error', `Identifikation fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Identifikation fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('READ_IDENT', 'ERROR', { error: errMessage(e) }, Date.now() - t0);
      return false;
    } finally {
      set({ busy: false });
    }
  },

  readDtc: async () => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    const t0 = Date.now();
    set({ busy: true });
    try {
      const normal = await client.sendRequest(0x18, [0xff, 0x00], { timeoutMs: 2000 });
      const shadow = await client.sendRequest(0x18, [0xfd, 0x00], { timeoutMs: 2000 });
      const dtcs = parseDtcResponse(normal.data, false);
      const shadowDtcs = parseDtcResponse(shadow.data, true);
      set({ dtcs, shadowDtcs, dtcReadAt: Date.now() });
      get().log('ok', `Fehlerspeicher gelesen: ${dtcs.length} normal, ${shadowDtcs.length} Schatten`);
      toast.success('Fehlerspeicher gelesen', {
        description: `${dtcs.length} Einträge normal · ${shadowDtcs.length} Schattenspeicher`,
      });
      void reportOperation('READ_DTC', 'OK', { normal: dtcs.length, shadow: shadowDtcs.length }, Date.now() - t0);
    } catch (e) {
      get().log('error', `Fehlerspeicher lesen fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Fehlerspeicher lesen fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('READ_DTC', 'ERROR', { error: errMessage(e) }, Date.now() - t0);
    } finally {
      set({ busy: false });
    }
  },

  clearDtc: async () => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    const t0 = Date.now();
    set({ busy: true });
    try {
      await client.sendRequest(0x14, [0xff, 0x00], { timeoutMs: 3000 });
      await client.sendRequest(0x14, [0xfd, 0x00], { timeoutMs: 3000 });
      set({ dtcs: [], shadowDtcs: [], dtcReadAt: Date.now() });
      get().log('ok', 'Fehlerspeicher gelöscht (normal + Schatten)');
      toast.success('Fehlerspeicher gelöscht');
      void reportOperation('CLEAR_DTC', 'OK', {}, Date.now() - t0);
    } catch (e) {
      get().log('error', `Löschen fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Löschen fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('CLEAR_DTC', 'ERROR', { error: errMessage(e) }, Date.now() - t0);
    } finally {
      set({ busy: false });
    }
  },

  pollLiveOnce: async (blockId) => {
    if (!client || get().connection !== 'connected') return;
    try {
      const resp = await client.sendRequest(0x21, [blockId], { timeoutMs: 1200 });
      const block = liveBlockById(blockId);
      if (!block) return;
      const values = block.parse(resp.data.slice(1));
      const frame: LiveDataFrame = { timestamp: Date.now(), blockId, values };
      set((s) => ({
        liveFrames: { ...s.liveFrames, [blockId]: frame },
        liveHistory: {
          ...s.liveHistory,
          [blockId]: [...(s.liveHistory[blockId] ?? []), frame].slice(-LIVE_HISTORY_CAP),
        },
        recordedFrames: s.recording
          ? [...s.recordedFrames, frame].slice(-RECORDING_CAP)
          : s.recordedFrames,
      }));
      const volt = values.find((v) => v.unit === 'V');
      if (volt) set({ lastVoltage: volt.value });
    } catch {
      // beim Polling Fehler still übergehen (K-Line-Störungen sind normal)
    }
  },

  startLivePoll: (blockId) => {
    if (liveTimer) clearInterval(liveTimer);
    set({ livePolling: true });
    void get().pollLiveOnce(blockId);
    liveTimer = setInterval(() => {
      if (get().busy) return;
      void get().pollLiveOnce(blockId);
    }, 600);
  },

  stopLivePoll: () => {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    set({ livePolling: false });
  },

  startRecording: () => {
    set({ recording: true });
    get().log('info', 'Live-Aufzeichnung gestartet');
  },

  stopRecording: () => {
    set({ recording: false });
    get().log('info', `Live-Aufzeichnung gestoppt (${get().recordedFrames.length} Frames)`);
  },

  clearRecording: () => set({ recordedFrames: [] }),

  setAutoReconnect: (v) => {
    set({ autoReconnect: v });
    saveSettings({ autoReconnect: v });
  },

  /** Wiederverbindung über den zuletzt verwendeten Port (kein neuer requestPort-Dialog). */
  reconnect: async () => {
    const st = get();
    if (!lastPort || st.connection === 'connected' || st.connection === 'connecting') return;
    if (st.isMock) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      toast.error('Automatische Wiederverbindung aufgegeben', {
        description: 'Adapter prüfen und manuell neu verbinden.',
      });
      return;
    }
    reconnectAttempts++;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    set({ connection: 'connecting', initSteps: [], keywords: null });
    get().log('info', `Automatische Wiederverbindung (Versuch ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) …`);
    try {
      client = new SerialClient();
      client.onLog = (dir, message, bytes) => get().log(dir, message, bytes ? Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : undefined);
      client.onDisconnect = () => {
        if (get().connection !== 'disconnected') {
          stopKeepAlive();
          get().stopLivePoll();
          set({ connection: 'disconnected', portLabel: '–', keywords: null });
          if (get().autoReconnect && lastPort) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => void get().reconnect(), 2500);
          }
        }
      };
      client.config.baudRate = get().baudRate;
      await client.connect(lastPort);
      set({ connection: 'initializing', portLabel: lastPortLabel, initSteps: [] });
      const kw = await client.fiveBaudInit(DDE4.ecuAddress);
      await client.sendKeywordComplement(kw[0], kw[1]);
      await client.drainInitAck(600);
      await client.sendRequest(0x10, Array.from(DDE4.startSessionParams), { timeoutMs: 2500 });
      set({
        connection: 'connected',
        keywords: kw,
        initSteps: [`Automatisch wiederverbunden: ${lastPortLabel}`, `Schlüsselwörter 0x${kw[0].toString(16).toUpperCase()} 0x${kw[1].toString(16).toUpperCase()}`],
      });
      startKeepAlive(get, set);
      reconnectAttempts = 0;
      get().log('ok', 'Wiederverbindung erfolgreich – Session wiederhergestellt');
      toast.success('Wiederverbunden', { description: lastPortLabel });
    } catch (e) {
      await client?.close();
      client = null;
      set({ connection: 'error', portLabel: '–' });
      get().log('error', `Wiederverbindung fehlgeschlagen: ${errMessage(e)}`);
      if (get().autoReconnect && lastPort) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => void get().reconnect(), 3000);
      }
    }
  },

  loadBinFile: async (file) => {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const kind = detectBinKind(buf.length);
      if (kind === 'UNKNOWN') {
        toast.error('Unbekannte Bildgröße', {
          description: `${buf.length} Bytes – erwartet: 524288 (FULL) oder 49152 (CAL).`,
        });
        return;
      }
      const res = computeAllChecksums(buf);
      set({
        bin: {
          name: file.name,
          kind,
          size: buf.length,
          data: buf,
          checksumsOk: res.filter((r) => r.ok).length,
          checksumsBad: res.filter((r) => !r.ok).length,
        },
      });
      get().log('ok', `BIN geladen: ${file.name} (${kind}, ${buf.length} Bytes, ${res.filter((r) => !r.ok).length} fehlerhafte Bänke)`);
      toast.success('BIN geladen', { description: `${file.name} · ${kind}` });
    } catch (e) {
      toast.error('BIN laden fehlgeschlagen', { description: errMessage(e) });
    }
  },

  readEcuFlash: async () => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    const t0 = Date.now();
    set({ busy: true, progress: { phase: 'read', current: 0, total: FULL_SIZE, label: 'Flash-Lesen startet …' } });
    try {
      const image = new Uint8Array(FULL_SIZE);
      await client.sendRequest(0x35, [0x00, 0x00, 0x00, (FULL_SIZE >> 16) & 0xff, (FULL_SIZE >> 8) & 0xff, FULL_SIZE & 0xff], { timeoutMs: 3000 });
      let received = 0;
      let seq = 0;
      while (received < FULL_SIZE) {
        const resp = await client.sendRequest(0x76, [seq & 0xff], { timeoutMs: 3000, expectService: 0x36 });
        if (resp.service !== 0x36) throw new KwpError(`Unerwarteter Frame beim Upload: 0x${resp.service.toString(16)}`);
        const dataSeq = resp.data[0];
        if (dataSeq !== (seq & 0xff)) throw new KwpError(`Sequenzfehler: erwartet ${seq}, erhalten ${dataSeq}`);
        const bytes = resp.data.slice(1);
        image.set(bytes, received);
        received += bytes.length;
        seq++;
        if (seq % 40 === 0 || received >= FULL_SIZE) {
          set({ progress: { phase: 'read', current: received, total: FULL_SIZE, label: `Gelesen: ${received} / ${FULL_SIZE} Bytes` } });
        }
      }
      await client.sendRequest(0x37, [], { timeoutMs: 3000 });
      const name = `dde4_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.bin`;
      set({ ecuBin: { size: FULL_SIZE, data: image, saved: false, name } });
      get().log('ok', `Flash ausgelesen: ${FULL_SIZE} Bytes`);
      toast.success('Flash ausgelesen', { description: '512 KiB empfangen – Backup jetzt speichern!' });
      void reportOperation('READ_FLASH', 'OK', { size: FULL_SIZE }, Date.now() - t0);
    } catch (e) {
      get().log('error', `Flash-Lesen fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Flash-Lesen fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('READ_FLASH', 'ERROR', { error: errMessage(e) }, Date.now() - t0);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  saveEcuBin: () => {
    const ecu = get().ecuBin;
    if (!ecu) return;
    import('@/lib/kwp/bin').then(({ downloadBin }) => {
      downloadBin(ecu.name, ecu.data);
      set({ ecuBin: { ...ecu, saved: true } });
      toast.success('Backup gespeichert', { description: ecu.name });
    });
  },

  eraseFlash: async () => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    const t0 = Date.now();
    set({ busy: true, progress: { phase: 'erase', current: 0, total: 1, label: 'Flash wird gelöscht …' } });
    try {
      const resp = await client.sendRequest(0x31, [0x01, 0xff, 0x00], { timeoutMs: 6000 });
      if (resp.data[3] !== 0x00) throw new KwpError('Lösch-Routine meldete Fehler');
      get().log('ok', 'Flash gelöscht (Routine 0xFF00)');
      toast.success('Flash gelöscht');
      void reportOperation('ERASE_FLASH', 'OK', {}, Date.now() - t0);
    } catch (e) {
      get().log('error', `Löschen fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Löschen fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('ERASE_FLASH', 'ERROR', { error: errMessage(e) }, Date.now() - t0);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  writeFlash: async (data, label) => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    const ecuBin = get().ecuBin;
    if (!ecuBin?.saved) {
      toast.error('Kein Backup!', { description: 'Vor dem Schreiben muss das Original ausgelesen und gespeichert werden.' });
      return;
    }
    const t0 = Date.now();
    set({ busy: true, progress: { phase: 'write', current: 0, total: data.length, label: 'Schreiben startet …' } });
    try {
      // Security Access
      const seedResp = await client.sendRequest(0x27, [0x01], { timeoutMs: 2000 });
      const seedHi = seedResp.data[1];
      const seedLo = seedResp.data[2];
      const { dde4KeyFromSeed } = await import('@/lib/kwp/dde4');
      const [kHi, kLo] = dde4KeyFromSeed(seedHi, seedLo);
      await client.sendRequest(0x27, [0x02, kHi, kLo], { timeoutMs: 2000 });
      get().log('ok', 'Security Access bestanden');

      // Download anfragen
      await client.sendRequest(0x34, [0x00, 0x00, 0x00, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff], { timeoutMs: 3000 });
      const chunk = 58;
      let sent = 0;
      let seq = 0;
      while (sent < data.length) {
        const len = Math.min(chunk, data.length - sent);
        await client.sendRequest(0x36, [seq & 0xff, ...Array.from(data.subarray(sent, sent + len))], { timeoutMs: 3000 });
        sent += len;
        seq++;
        if (seq % 40 === 0 || sent >= data.length) {
          set({ progress: { phase: 'write', current: sent, total: data.length, label: `Geschrieben: ${sent} / ${data.length} Bytes` } });
        }
      }
      await client.sendRequest(0x37, [], { timeoutMs: 3000 });

      // Prüfsummen-Routine
      const verify = await client.sendRequest(0x31, [0x01, 0xff, 0x01], { timeoutMs: 5000 });
      const verifyOk = verify.data[3] === 0x00;
      if (!verifyOk) throw new KwpError('Prüfsummenverifikation im ECU fehlgeschlagen');
      get().log('ok', `Flash geschrieben & verifiziert: ${label} (${data.length} Bytes)`);
      toast.success('Flash geschrieben', { description: 'Prüfsummen im ECU bestätigt.' });
      void reportOperation('WRITE_FLASH', 'OK', { label, size: data.length }, Date.now() - t0);
    } catch (e) {
      get().log('error', `Schreiben fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Schreiben fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('WRITE_FLASH', 'ERROR', { error: errMessage(e), label }, Date.now() - t0);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  fixBinChecksums: () => {
    const bin = get().bin;
    if (!bin) return;
    const fixed = fixAllChecksums(bin.data);
    const res = computeAllChecksums(bin.data);
    set({
      bin: {
        ...bin,
        checksumsOk: res.filter((r) => r.ok).length,
        checksumsBad: res.filter((r) => !r.ok).length,
      },
    });
    toast.success('Prüfsummen korrigiert', { description: `${fixed} Bänke neu berechnet.` });
    get().log('ok', `CR2-Prüfsummen korrigiert: ${fixed} Bänke`);
  },

  setLastVoltage: (v) => set({ lastVoltage: v }),
}));

/** Hilfsfunktionen, die keine Reaktivität brauchen */
export function getLiveBlocksMeta() {
  return LIVE_BLOCKS.map((b) => ({ id: b.id, name: b.name }));
}

export function checkProtectedArea(offset: number): boolean {
  return touchesProtectedArea(offset);
}

export function binSummary(data: Uint8Array) {
  return analyzeBin(data);
}

export type { MockSerialPort };
