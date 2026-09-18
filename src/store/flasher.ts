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
import { DDE4, IDENT_SERVICES, LIVE_BLOCKS, liveBlockById, parseDtcResponse, OUTPUT_LABELS, EWS_VERIFY_TEXT } from '@/lib/kwp/dde4';
import type { EcuJob } from '@/lib/kwp/dde4';
import { computeAllChecksums, fixAllChecksums, touchesProtectedArea, FULL_SIZE, CAL_OFFSET_IN_FULL } from '@/lib/kwp/checksum';
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

/** Ergebnis eines ausgeführten Steuergeräte-Jobs */
export interface JobResult {
  jobId: string;
  name: string;
  ok: boolean;
  text: string;
  hex?: string;
  at: number;
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
  /** Aktive Live-Seite: Blöcke, die im Round-Robin abgefragt werden (DeepOBD-Prinzip) */
  livePage: number[];

  // Jobs
  jobRunning: string | null;
  jobResult: JobResult | null;
  jobHistory: JobResult[];

  // Einstellungen
  autoReconnect: boolean;
  /** Bildschirm-Wachhalten (WakeLock API) während aktiver Verbindung */
  wakeLockEnabled: boolean;
  wakeLockActive: boolean;

  // BIN & Flash
  bin: BinState | null;
  ecuBin: { size: number; data: Uint8Array; saved: boolean; name: string; swNumber?: string } | null;
  /** Ergebnis des LID-Scans (0x20–0x2F, Bosch-Standard-Messwertblöcke) */
  lidScan: { lid: number; hex: string; words: string[] }[] | null;
  lidScanning: boolean;
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
  startLivePoll: () => void;
  stopLivePoll: () => void;
  /** Intern: fragt den nächsten Block der aktiven Live-Seite ab */
  pollRound: () => Promise<void>;
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  setAutoReconnect: (v: boolean) => void;
  reconnect: () => Promise<void>;

  // Live-Seiten-Konfigurator
  toggleLiveBlock: (blockId: number) => void;
  runJob: (job: EcuJob) => Promise<void>;
  /** Scannt die Bosch-Standard-Messwertblöcke LID 0x20–0x2F (Roh-Wörter, SW-variantenspezifisch) */
  scanLids: () => Promise<void>;
  setWakeLockEnabled: (v: boolean) => void;

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
let liveRoundIdx = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveFailures = 0;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHooked = false;
let lastPort: Awaited<ReturnType<typeof SerialClient.requestPort>> | null = null;
let lastPortLabel = '–';
let logCounter = 0;
const MAX_LOGS = 600;
const LIVE_HISTORY_CAP = 120;
const RECORDING_CAP = 1500;
const MAX_RECONNECT_ATTEMPTS = 3;
/** Generation-Counter: invalidiert laufende Timer bei Neu-/Trennung (ECU-Reset-Race). */
let connectGeneration = 0;

// ── Einstellungs-Persistenz (localStorage, SSR-sicher) ──
const SETTINGS_KEY = 'qflash21.settings.v1';

interface StoredSettings {
  baudRate?: number;
  vehicle?: string;
  autoReconnect?: boolean;
  livePage?: number[];
  wakeLockEnabled?: boolean;
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

/* ── WakeLock: Bildschirm wachhalten während aktiver Diagnose (DeepOBD-Prinzip) ── */
interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: string, cb: () => void) => void;
}
let wakeSentinel: WakeLockSentinelLike | null = null;
let wakeDesired = false;

function syncWakeLock(set: (p: Partial<FlasherState>) => void): void {
  void (async () => {
    const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) return;
    try {
      if (wakeDesired && document.visibilityState === 'visible' && !wakeSentinel) {
        wakeSentinel = await nav.wakeLock.request('screen');
        wakeSentinel.addEventListener('release', () => {
          wakeSentinel = null;
          set({ wakeLockActive: false });
          // Nach Tab-Wechsel neu anfordern
          if (wakeDesired) setTimeout(() => syncWakeLock(set), 300);
        });
        set({ wakeLockActive: true });
      } else if (!wakeDesired && wakeSentinel) {
        await wakeSentinel.release();
        wakeSentinel = null;
        set({ wakeLockActive: false });
      }
    } catch {
      set({ wakeLockActive: false });
    }
  })();
}

function releaseWakeLock(set: (p: Partial<FlasherState>) => void): void {
  wakeDesired = false;
  syncWakeLock(set);
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
          // WICHTIG: Client wirklich schließen – sonst hält der alte Pump-Loop den
          // Reader-Lock und der Auto-Reconnect scheitert an InvalidStateError
          await client!.close();
          client = null;
          connectGeneration++;
          set({ connection: 'disconnected', portLabel: '–', lastVoltage: null });
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
  livePage: LIVE_BLOCKS.map((b) => b.id),

  jobRunning: null,
  jobResult: null,
  jobHistory: [],

  autoReconnect: true,
  wakeLockEnabled: true,
  wakeLockActive: false,

  bin: null,
  ecuBin: null,
  lidScan: null,
  lidScanning: false,
  progress: null,
  busy: false,
  lastVoltage: null,

  logs: [],

  initSupport: () => {
    const stored = loadSettings();
    const validPage =
      Array.isArray(stored.livePage) && stored.livePage.length > 0
        ? stored.livePage.filter((id) => LIVE_BLOCKS.some((b) => b.id === id))
        : [];
    set({
      supported: isWebSerialSupported(),
      android: isAndroid(),
      ...(stored.baudRate ? { baudRate: stored.baudRate } : {}),
      ...(stored.vehicle ? { vehicle: stored.vehicle } : {}),
      ...(typeof stored.autoReconnect === 'boolean' ? { autoReconnect: stored.autoReconnect } : {}),
      ...(validPage.length > 0 ? { livePage: validPage } : {}),
      ...(typeof stored.wakeLockEnabled === 'boolean' ? { wakeLockEnabled: stored.wakeLockEnabled } : {}),
    });
    // WakeLock nach Tab-Wechsel wieder aufnehmen (einmalige Registrierung)
    if (!visibilityHooked && typeof document !== 'undefined') {
      visibilityHooked = true;
      document.addEventListener('visibilitychange', () => syncWakeLock(useFlasher.setState));
    }
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
      if (get().wakeLockEnabled) {
        wakeDesired = true;
        syncWakeLock(useFlasher.setState);
      }
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
        // Nur echte Laufzeit-Trennungen behandeln – nicht 'error'/'connecting' (sonst
        // startet nach fehlgeschlagener Erstanmeldung eine sinnlose Reconnect-Kette)
        const c = get().connection;
        if (c === 'connected' || c === 'initializing') {
          stopKeepAlive();
          get().stopLivePoll();
          set({ connection: 'disconnected', portLabel: '–', keywords: null, lastVoltage: null });
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
      if (get().wakeLockEnabled) {
        wakeDesired = true;
        syncWakeLock(useFlasher.setState);
      }
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
    releaseWakeLock(useFlasher.setState);
    lastPort = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    connectGeneration++;
    // State ZUERST zurücksetzen – verhindert Spurious-Disconnect-Handling während close()
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
      lastVoltage: null,
    });
    await client?.close();
    client = null;
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
      const clearedNormal = get().dtcs.length;
      const clearedShadow = get().shadowDtcs.length;
      set({ dtcs: [], shadowDtcs: [], dtcReadAt: Date.now() });
      get().log('ok', 'Fehlerspeicher gelöscht (normal + Schatten)');
      toast.success('Fehlerspeicher gelöscht', {
        description: `${clearedNormal} normal · ${clearedShadow} Schatten`,
      });
      void reportOperation(
        'CLEAR_DTC',
        'OK',
        { normal: clearedNormal, shadow: clearedShadow, cleared: clearedNormal + clearedShadow },
        Date.now() - t0
      );
    } catch (e) {
      get().log('error', `Löschen fehlgeschlagen: ${errMessage(e)}`);
      toast.error('Löschen fehlgeschlagen', { description: errMessage(e) });
      void reportOperation('CLEAR_DTC', 'ERROR', { error: errMessage(e) }, Date.now() - t0);
    } finally {
      set({ busy: false });
    }
  },

  pollLiveOnce: async (blockId) => {
    if (!client || get().connection !== 'connected' || get().busy) return;
    set({ busy: true }); // In-Flight-Guard: keine parallelen Requests (Antwort-Kreuzung)
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
    } finally {
      set({ busy: false });
    }
  },

  startLivePoll: () => {
    if (liveTimer) clearInterval(liveTimer);
    set({ livePolling: true });
    liveRoundIdx = 0;
    void get().pollRound();
    liveTimer = setInterval(() => {
      if (get().busy) return;
      void get().pollRound();
    }, 600);
  },

  stopLivePoll: () => {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    set({ livePolling: false });
  },

  /** Round-Robin über die aktive Live-Seite (ein Block pro Tick, DeepOBD-Seiten-Prinzip) */
  pollRound: async () => {
    const page = get().livePage.length > 0 ? get().livePage : [LIVE_BLOCKS[0]?.id ?? 0x03];
    const id = page[liveRoundIdx % page.length];
    liveRoundIdx++;
    await get().pollLiveOnce(id);
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

  toggleLiveBlock: (blockId) => {
    const page = get().livePage;
    if (page.includes(blockId)) {
      if (page.length <= 1) {
        toast.warning('Mindestens ein Block muss aktiv bleiben');
        return;
      }
      const next = page.filter((id) => id !== blockId);
      set({ livePage: next });
      saveSettings({ livePage: next });
    } else {
      // Reihenfolge an LIVE_BLOCKS orientieren für stabile Polling-Folge
      const next = LIVE_BLOCKS.map((b) => b.id).filter((id) => id === blockId || page.includes(id));
      set({ livePage: next });
      saveSettings({ livePage: next });
    }
  },

  setWakeLockEnabled: (v) => {
    set({ wakeLockEnabled: v });
    saveSettings({ wakeLockEnabled: v });
    if (v && get().connection === 'connected') {
      wakeDesired = true;
      syncWakeLock(useFlasher.setState);
    } else {
      releaseWakeLock(useFlasher.setState);
    }
  },

  /** Führt einen Steuergeräte-Job aus (0x11 Reset / 0x30 Ausgang / 0x31 Routine / 0x1A Lesen) */
  runJob: async (job) => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    if (get().busy) {
      toast.warning('Anderer Vorgang läuft noch');
      return;
    }
    const t0 = Date.now();
    set({ busy: true, jobRunning: job.id });
    let result: JobResult;
    try {
      if (job.kind === 'reset') {
        await client.sendRequest(job.service, job.params, { timeoutMs: 2500 });
        result = {
          jobId: job.id,
          name: job.name,
          ok: true,
          text: 'ECU-Reset bestätigt (0x51) – Steuergerät startet neu, Diagnose-Session wird abgebaut.',
          at: Date.now(),
        };
        get().log('ok', `Job ausgeführt: ${job.name}`);
        toast.info('Steuergerät startet neu', {
          description: get().autoReconnect && lastPort && !get().isMock ? 'Automatische Wiederverbindung …' : 'Bitte neu verbinden.',
        });
        void reportOperation('JOB_ECU_RESET', 'OK', { job: job.id }, Date.now() - t0);
        // Session ist weg: sauber trennen, danach optional automatisch neu verbinden.
        // Generation-Check: bricht ab, wenn inzwischen neu verbunden/getrennt wurde.
        const gen = connectGeneration;
        setTimeout(() => {
          if (gen !== connectGeneration) return;
          void get().disconnect().then(() => {
            if (gen !== connectGeneration) return;
            if (get().autoReconnect && lastPort && !get().isMock) {
              if (reconnectTimer) clearTimeout(reconnectTimer);
              reconnectTimer = setTimeout(() => void get().reconnect(), 1500);
            }
          });
        }, 1200);
      } else if (job.kind === 'output') {
        const resp = await client.sendRequest(job.service, job.params, { timeoutMs: 2500 });
        if (resp.service !== 0x70) throw new KwpError(`Unerwartete Antwort: 0x${resp.service.toString(16)}`);
        const localId = resp.data[0];
        const value = resp.data[1];
        const label = OUTPUT_LABELS[localId] ?? `Ausgang 0x${localId?.toString(16).padStart(2, '0')}`;
        result = {
          jobId: job.id,
          name: job.name,
          ok: true,
          text: `${label} angesteuert${value ? ` (Task ${Math.round((value / 255) * 100)} %)` : ' (aus)'} – Wirkung endet automatisch.`,
          hex: Array.from(resp.data).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
          at: Date.now(),
        };
        get().log('ok', `Job ausgeführt: ${job.name} (0x70 bestätigt)`);
        toast.success('Ausgang angesteuert', { description: label });
        void reportOperation('JOB_OUTPUT', 'OK', { job: job.id, localId }, Date.now() - t0);
      } else if (job.kind === 'routine') {
        const resp = await client.sendRequest(job.service, job.params, { timeoutMs: 6000, pendingTimeoutMs: 12_000 });
        if (resp.service !== 0x71) throw new KwpError(`Unerwartete Antwort: 0x${resp.service.toString(16)}`);
        const status = resp.data[3];
        const results = Array.from(resp.data.slice(4));
        // EWS-Startwertinitialisierung (0x0083): Verifybyte ist KEIN Fehlercode,
        // sondern der Routine-Status (00 bereit / 01 schon gespeichert / 02 kein Startwert / 03 Urcode zerstört)
        if (((job.params[1] << 8) | job.params[2]) === 0x0083) {
          const verifyText = EWS_VERIFY_TEXT[status] ?? `Unbekanntes Verifybyte 0x${status.toString(16)}`;
          result = {
            jobId: job.id,
            name: job.name,
            ok: status !== 0x03,
            text: `EWS-Verifybyte 0x${status.toString(16).padStart(2, '0')}: ${verifyText}`,
            hex: Array.from(resp.data).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
            at: Date.now(),
          };
          get().log('ok', `Job ausgeführt: ${job.name} · Verify 0x${status.toString(16)}`);
          toast.success('EWS-Routine ausgeführt', { description: verifyText });
          void reportOperation('JOB_ROUTINE', 'OK', { job: job.id, verify: status }, Date.now() - t0);
        } else {
        if (status !== 0x00) throw new KwpError(`Routine meldete Status 0x${status.toString(16)}`);
        result = {
          jobId: job.id,
          name: job.name,
          ok: true,
          text:
            results.length > 0
              ? `Routine OK (Status 0x00) · Ergebniswerte: ${results.join(', ')}`
              : 'Routine OK (Status 0x00).',
          hex: Array.from(resp.data).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
          at: Date.now(),
        };
        get().log('ok', `Job ausgeführt: ${job.name} · Routine-Status OK`);
        toast.success('Routine ausgeführt', { description: job.name });
        void reportOperation('JOB_ROUTINE', 'OK', { job: job.id }, Date.now() - t0);
        }
      } else {
        // read
        const resp = await client.sendRequest(job.service, job.params, { timeoutMs: 2500 });
        if (resp.service !== 0x5a) throw new KwpError(`Unerwartete Antwort: 0x${resp.service.toString(16)}`);
        const text = new TextDecoder('latin1').decode(resp.data.slice(1)).replace(/\u0000+$/g, '').trim();
        result = {
          jobId: job.id,
          name: job.name,
          ok: true,
          text: text || '(leer)',
          at: Date.now(),
        };
        get().log('ok', `Job ausgeführt: ${job.name} → „${text}“`);
        toast.success('Wert gelesen', { description: text });
        void reportOperation('JOB_READ', 'OK', { job: job.id }, Date.now() - t0);
      }
    } catch (e) {
      const msg = errMessage(e);
      result = { jobId: job.id, name: job.name, ok: false, text: msg, at: Date.now() };
      get().log('error', `Job fehlgeschlagen (${job.name}): ${msg}`);
      toast.error('Job fehlgeschlagen', { description: msg });
      void reportOperation('JOB_RUN', 'ERROR', { job: job.id, error: msg }, Date.now() - t0);
      // Puffer flushen, damit kein Response-Rest die nächste Aktion vergiftet
      try {
        await client?.drainInitAck(120);
      } catch {
        /* egal */
      }
    } finally {
      set((s) => ({ busy: false, jobRunning: null, jobResult: result, jobHistory: [result, ...s.jobHistory].slice(0, 12) }));
    }
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
        const c = get().connection;
        if (c === 'connected' || c === 'initializing') {
          stopKeepAlive();
          get().stopLivePoll();
          set({ connection: 'disconnected', portLabel: '–', keywords: null, lastVoltage: null });
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
      if (get().wakeLockEnabled) {
        wakeDesired = true;
        syncWakeLock(useFlasher.setState);
      }
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

  /** Scannt LID 0x20–0x2F (Bosch: 16 applizierbare Blöcke à 10 Messwert-Wörter).
   *  Die konkrete Zuordnung ist SW-variantenspezifisch – der Scan liefert Roh-Wörter
   *  zur manuellen Zuordnung (Plausibilisierung gegen Live-Daten). */
  scanLids: async () => {
    if (!client || get().connection !== 'connected') {
      toast.error('Nicht verbunden');
      return;
    }
    if (get().busy) {
      toast.warning('Anderer Vorgang läuft noch');
      return;
    }
    set({ lidScanning: true });
    const rows: { lid: number; hex: string; words: string[] }[] = [];
    let failures = 0;
    try {
      for (let lid = 0x20; lid <= 0x2f; lid++) {
        try {
          const resp = await client.sendRequest(0x21, [lid], { timeoutMs: 1200 });
          if (resp.service !== 0x61) throw new KwpError('Unerwartete Antwort');
          const words = Array.from(resp.data.slice(1));
          const wordList: string[] = [];
          for (let i = 0; i + 1 < words.length; i += 2) {
            wordList.push(((words[i] << 8) | words[i + 1]).toString(16).padStart(4, '0').toUpperCase());
          }
          rows.push({ lid, hex: words.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '), words: wordList });
          failures = 0;
        } catch {
          failures++;
          if (failures >= 3) break; // ECU antwortet nicht mehr → Scan abbrechen
        }
      }
      set({ lidScan: rows, lidScanning: false });
      get().log('ok', `LID-Scan abgeschlossen: ${rows.length}/16 Blöcke geantwortet`);
      toast.success('LID-Scan fertig', { description: `${rows.length} von 16 Blöcken haben geantwortet.` });
    } catch (e) {
      set({ lidScanning: false });
      toast.error('LID-Scan fehlgeschlagen', { description: errMessage(e) });
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
      // SW-Nummer aus dem Image extrahieren (Boot-Read-Layout: 6-Byte-ASCII bei 0x7BFB4,
      // terminiert mit 0xC3 – verifiziert an 4 echten EDC15C4-Dumps, Repo Mursteinen/EcuID)
      let swNumber: string | undefined;
      try {
        const SW_OFFSET = 0x7bfb4;
        let s = '';
        for (let i = 0; i < 8; i++) {
          const b = image[SW_OFFSET + i];
          if (b === 0xc3 || b < 0x30 || b > 0x39) break;
          s += String.fromCharCode(b);
        }
        if (s.length >= 5) swNumber = s;
      } catch {
        // Layout nicht erkennbar – optional
      }
      const name = `dde4_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.bin`;
      set({ ecuBin: { size: FULL_SIZE, data: image, saved: false, name, swNumber } });
      get().log('ok', `Flash ausgelesen: ${FULL_SIZE} Bytes${swNumber ? ` · SW-Nummer: ${swNumber}` : ''}`);
      toast.success('Flash ausgelesen', { description: swNumber ? `512 KiB empfangen · SW ${swNumber} – Backup speichern!` : '512 KiB empfangen – Backup jetzt speichern!' });
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
      // SICHERHEITSGATE: Bildtyp bestimmen, Zieladresse ableiten, geschützte Zone prüfen.
      // Ein CAL-Image (48 KiB) gehört nach 0x74000 – ein Write an 0x000000 würde die
      // Boot-/Immobilizer-Zone überschreiben (ECU-Brick!).
      const kind = detectBinKind(data.length);
      const addr = kind === 'CAL' ? CAL_OFFSET_IN_FULL : 0x000000;
      if (kind === 'UNKNOWN') throw new KwpError(`Unbekannte Bildgröße (${data.length} Bytes) – Schreiben verweigert.`);
      if (touchesProtectedArea(addr)) {
        throw new KwpError('Schreibvorgang würde geschützten Boot-Bereich (erste 16 KiB) treffen – abgelehnt.');
      }
      // FULL-Images: erste 16 KiB gegen ECU-Backup vergleichen – Boot-Bereich darf nicht abweichen
      if (kind === 'FULL' && ecuBin.data.length === FULL_SIZE) {
        for (let i = 0; i < 0x4000; i++) {
          if (data[i] !== ecuBin.data[i]) {
            throw new KwpError(`Boot-Bereich weicht bei Offset 0x${i.toString(16)} vom Backup ab – Schreiben verweigert (Boot-Zone wird nie überschrieben).`);
          }
        }
      }
      // Security Access
      const seedResp = await client.sendRequest(0x27, [0x01], { timeoutMs: 2000 });
      const seedHi = seedResp.data[1];
      const seedLo = seedResp.data[2];
      const { dde4KeyFromSeed } = await import('@/lib/kwp/dde4');
      const [kHi, kLo] = dde4KeyFromSeed(seedHi, seedLo);
      await client.sendRequest(0x27, [0x02, kHi, kLo], { timeoutMs: 2000 });
      get().log('ok', `Security Access bestanden (Ziel: 0x${addr.toString(16).toUpperCase().padStart(6, '0')}, ${kind})`);

      // Download anfragen (6-Byte-Header: Startadresse + Länge)
      await client.sendRequest(0x34, [(addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff], { timeoutMs: 3000 });
      const chunk = 58;
      let sent = 0;
      let seq = 0;
      while (sent < data.length) {
        const len = Math.min(chunk, data.length - sent);
        const ack = await client.sendRequest(0x36, [seq & 0xff, ...Array.from(data.subarray(sent, sent + len))], { timeoutMs: 3000 });
        // Ack-Sequenz VALIDIEREN – sonst stille Korruption bei verlorenen/doppelten Blöcken
        if (ack.data.length < 1 || ack.data[0] !== (seq & 0xff)) {
          throw new KwpError(`Transfer-Ack-Sequenzfehler: erwartet ${seq & 0xff}, erhalten ${ack.data[0] ?? '–'}`);
        }
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
