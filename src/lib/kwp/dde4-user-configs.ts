/**
 * DDE4.0 (EDC15C4) – ECHTE Fahrzeugdaten aus der persönlichen DeepOBD-Konfigsammlung
 * des Nutzers (DeepOBD.zip, über Proton-Drive-Link übermittelt, 14.09.2026, 9,62 MB,
 * 1434 Dateien). Diese Datei ergänzt/überbietet deepobd-knowledge.ts (öffentliche
 * Repos enthielten KEINE DDE4-Daten) mit den **community-erprobten Custom-Konfigs**
 * für genau die Ziel-Fahrzeuge: E46 330d M57, E39 525d/530d M57, E53 X5 3.0d M57.
 *
 * PROVENIENZ (alle Werte wörtlich aus den Dateien übernommen, nichts erfunden):
 *  - #ecus/DDE40KW0.ccpage (4535 B) & copy_configs/.../E39 M57_Automat/DDE40KW0.ccpage (8861 B)
 *  - .../DDE40KW0_log.ccpage, DDE40KW0_log2.ccpage (MWB-Sets 1+2)
 *  - .../Injektoren.ccpage (Mengenkorrektur je Zylinder)
 *  - .../DDEAbgleich_DDE40KW0.ccpage (md5 7aee86e8 – IDENTISCH für E46/E39/E53!)
 *  - .../IBUS_App.ccpage (Multi-ECU-Job dde40kw0 + gs20 + ihka39_5)
 *  - .../Errors.ccpage (read_errors-ECU-Listen je Fahrzeug)
 *  - Anleitung.txt (Custom-Job-Anleitung DE/EN, Basis „Deep OBD für BMW und VAG")
 * SGBD-Name in allen Jobs: "dde40kw0" (DDE4.0/KWP2000 K-Line, EDC15C4).
 * Interface-Referenz der Konfigs: <global interface="FTDI" /> – exakt das
 * K+DCAN-FT232R-Kabel, das unsere WebUSB-Treiber (webusb-serial.ts) abbilden.
 */

/** Ein einzelner Messwert innerhalb eines MWB-Args-Satzes (positionsgebunden). */
export interface Dde4MwbField {
  /** DeepOBD-Ergebnisname (STAT_*_WERT) wie in der ccpage referenziert */
  result: string;
  /** Deutsches Label für die UI */
  label: string;
  unit: string;
  min: number;
  max: number;
  decimals: number;
}

/** Ein komplettes, in der Praxis erprobtes mw_select_lesen_norm-Args-Set. */
export interface Dde4MwbSet {
  id: string;
  title: string;
  source: string;
  /** Jobname im SGBD dde40kw0 */
  job: 'mw_select_lesen_norm' | 'mw_select_lesen_norm2';
  /** Hex-Args exakt wie in der ccpage (2 Hex-Ziffern je FSP-Code, norm2: 4-stellig) */
  args: string;
  fields: Dde4MwbField[];
  /** Kurze Interpretationshilfe für die Diagnose */
  hint: string;
}

/**
 * MWB-Sets: Die Community-Konfigs binden FSP-Args-Sets an Display-Sets
 * (Ergebnisnamen kommen aus dem SGBD dde40kw0; die Zuordnung ist positions-
 * gebunden innerhalb eines Sets). Wir übernehmen die Sets 1:1 als Paare.
 */
export const DDE4_MWB_SETS: Dde4MwbSet[] = [
  {
    id: 'main',
    title: 'MWB Haupt-Set (Live-Diagnose)',
    source: '#ecus/DDE40KW0.ccpage + E39/E46/E53 DDE40KW0.ccpage',
    job: 'mw_select_lesen_norm',
    args: '0F100F400F421F060FFC1F5E0F8CDF0E0F000F65',
    fields: [
      { result: 'STAT_dzmNmit_WERT', label: 'Drehzahl', unit: '1/min', min: 0, max: 6500, decimals: 0 },
      { result: 'STAT_ANMVDF_WERT', label: 'Vorförderdruck', unit: 'bar', min: 0, max: 5, decimals: 2 },
      { result: 'STAT_anmKDF_WERT', label: 'Raildruck (IST)', unit: 'bar', min: 0, max: 1400, decimals: 0 },
      { result: 'STAT_ZUMPQSOLL_WERT', label: 'Raildruck (SOLL)', unit: 'bar', min: 0, max: 1400, decimals: 0 },
      { result: 'STAT_LDMP_LLIN_WERT', label: 'Ladedruck (IST)', unit: 'mbar', min: 0, max: 2500, decimals: 0 },
      { result: 'STAT_LDMP_LSOLL_WERT', label: 'Ladedruck (SOLL)', unit: 'mbar', min: 0, max: 2500, decimals: 0 },
      { result: 'STAT_AROIST_5_WERT', label: 'Luftmasse', unit: 'mg/Hub', min: 0, max: 1500, decimals: 0 },
      { result: 'STAT_MRMM_EMOT_WERT', label: 'Einspritzmenge', unit: 'mm³', min: 0, max: 80, decimals: 1 },
      { result: 'STAT_ANMUBT_WERT', label: 'Batteriespannung', unit: 'V', min: 0, max: 15, decimals: 1 },
      { result: 'STAT_ANMWTF_WERT', label: 'Kühlmitteltemperatur', unit: '°C', min: -20, max: 120, decimals: 0 },
    ],
    hint:
      'Kern-Set für die Alltagdiagnose: Raildruck-IST vs. SOLL identifiziert Druckleistungs-/Regelventil-Probleme, ' +
      'Ladedruck-IST vs. SOLL zeigt VTG-/Ladeluftstrecken-Lecks, Vorförderdruck <3,5 bar = Kraftstoffversorgung.',
  },
  {
    id: 'log2',
    title: 'MWB Log-Set 2 (erweitert)',
    source: 'DDE40KW0_log2.ccpage',
    job: 'mw_select_lesen_norm',
    args: '0F100F400F421F060FFC1F5E0F8C0EA5DF0E0E81',
    fields: [
      { result: 'STAT_dzmNmit_WERT', label: 'Drehzahl', unit: '1/min', min: 0, max: 5500, decimals: 0 },
      { result: 'STAT_ANMVDF_WERT', label: 'Vorförderdruck', unit: 'bar', min: 0, max: 5, decimals: 3 },
      { result: 'STAT_ZUMPQSOLL_WERT', label: 'Raildruck (SOLL)', unit: 'bar', min: 0, max: 1700, decimals: 0 },
      { result: 'STAT_anmKDF_WERT', label: 'Raildruck (IST)', unit: 'bar', min: 0, max: 1700, decimals: 0 },
      { result: 'STAT_EHMFKDR_WERT', label: 'Raildruckregelventil', unit: '%', min: 0, max: 100, decimals: 1 },
      { result: 'STAT_AROIST_5_WERT', label: 'Luftmasse', unit: 'mg/Hub', min: 0, max: 1500, decimals: 0 },
      { result: 'STAT_EHMFLDS_WERT', label: 'VTG-Position', unit: '%', min: 0, max: 100, decimals: 1 },
      { result: 'STAT_MRMM_EMOT_WERT', label: 'Einspritzmenge', unit: 'mm³', min: 0, max: 90, decimals: 1 },
      { result: 'STAT_LDMP_LSOLL_WERT', label: 'Ladedruck (SOLL)', unit: 'mbar', min: 0, max: 3000, decimals: 0 },
      { result: 'STAT_LDMP_LLIN_WERT', label: 'Ladedruck (IST)', unit: 'mbar', min: 0, max: 3000, decimals: 0 },
    ],
    hint:
      'Erweitert um Raildruckregelventil-Duty (EHMFKDR) und VTG-Position (EHMFLDS) – ideal zur ' +
      'Beurteilung von Druckregelventil-Verschleiß und VTG-Verkantung bei Volllast.',
  },
  {
    id: 'injectors',
    title: 'Injektor-Mengenkorrektur (je Zylinder)',
    source: 'Injektoren.ccpage (E39 M57 + E46 M57)',
    job: 'mw_select_lesen_norm',
    args: '0F190F1A0F1B0F1C0F1D0F1E0F8C0F10',
    fields: [
      { result: 'STAT_dzmzMk1_WERT', label: 'Injektor Zyl 1', unit: 'mm³', min: -10, max: 10, decimals: 2 },
      { result: 'STAT_dzmzMk2_WERT', label: 'Injektor Zyl 2', unit: 'mm³', min: -10, max: 10, decimals: 2 },
      { result: 'STAT_dzmzMk3_WERT', label: 'Injektor Zyl 3', unit: 'mm³', min: -10, max: 10, decimals: 2 },
      { result: 'STAT_dzmzMk4_WERT', label: 'Injektor Zyl 4', unit: 'mm³', min: -10, max: 10, decimals: 2 },
      { result: 'STAT_dzmzMk5_WERT', label: 'Injektor Zyl 5', unit: 'mm³', min: -10, max: 10, decimals: 2 },
      { result: 'STAT_dzmzMk6_WERT', label: 'Injektor Zyl 6', unit: 'mm³', min: -10, max: 10, decimals: 2 },
      { result: 'STAT_AROIST_5_WERT', label: 'Luftmasse', unit: 'mg/Hub', min: 0, max: 1500, decimals: 0 },
      { result: 'STAT_dzmNmit_WERT', label: 'Drehzahl', unit: '1/min', min: 0, max: 6000, decimals: 0 },
    ],
    hint:
      'Mengenkorrektur dzmzMk1–6 im Leerlauf: |Wert| ≤ 2 mm³ = gesund; ein Ausreißer > 3 mm³ deutet auf ' +
      'verschließenden Injektor / Rücklaufproblem. Mit Zubehör „Injektor-Abgleich" kombinierbar.',
  },
  {
    id: 'llt',
    title: 'Ladelufttemperatur (norm2)',
    source: 'DDE40KW0+LLT.ccpage (E39 M57 +LLT-Varianten)',
    job: 'mw_select_lesen_norm2',
    args: '0036',
    fields: [
      { result: 'STAT_LADELUFTTEMPERATUR_WERT', label: 'Ladelufttemperatur', unit: '°C', min: -20, max: 120, decimals: 0 },
    ],
    hint: 'Zusatzjob mw_select_lesen_norm2 (FSP 0036) – Ladeluftkühler-Effizienz: ΔT zur Außentemperatur im Volllastcheck.',
  },
];

/** Adaptions-Jobs (DDEAbgleich_DDE40KW0.ccpage, identisch für E46/E39/E53). */
export interface Dde4AdaptationJob {
  job: string;
  mode: 'read' | 'write';
  label: string;
  result?: string;
  danger: 'safe' | 'caution' | 'danger';
  note: string;
}

export const DDE4_ADAPTATION_JOBS: Dde4AdaptationJob[] = [
  {
    job: 'ABGLEICH_LESEN_AGR_RUECK',
    mode: 'read',
    label: 'AGR-Abgleich lesen (Frischluftrate)',
    result: 'ABGLEICH_LESEN_AGR_RUECK_WERT',
    danger: 'safe',
    note: 'Liest die aktive AGR-Mengenadaption. 0 % = Serie, reduzierte Werte = eingetragene AGR-Optimierung.',
  },
  {
    job: 'ABGLEICH_LESEN_LL_REGELUNG',
    mode: 'read',
    label: 'Leerlaufanhebung lesen',
    result: 'ABGLEICH_LESEN_LL_REGELUNG_WERT',
    danger: 'safe',
    note: 'Aktuelle Leerlaufdrehzahl-Anhebung in 1/min (0 = Serie, +50/+70/+100 = Getriebe-/Komfort-Feintuning).',
  },
  {
    job: 'ABGLEICH_VERSTELLEN_AGR_RUECK',
    mode: 'write',
    label: 'AGR-Abgleich verstellen',
    danger: 'caution',
    note: 'Setzt den AGR-Adaptionswert neu (Serie = 0 %, „AGR min." = reduziert). Muss mit PROG bestätigt werden.',
  },
  {
    job: 'ABGLEICH_PROG_AGR_RUECK',
    mode: 'write',
    label: 'AGR-Abgleich programmieren',
    danger: 'danger',
    note: 'Brennt die AGR-Adaption ins EEPROM. Nur nach VERSTELLEN ausführen; rebootbeständig.',
  },
  {
    job: 'ABGLEICH_VERSTELLEN_LL_REGELUNG',
    mode: 'write',
    label: 'Leerlaufanhebung verstellen',
    danger: 'caution',
    note: 'Neuer Wert für die Leerlaufdrehzahl-Anhebung (0/+50/+70/+100 1/min). Muss mit PROG bestätigt werden.',
  },
  {
    job: 'ABGLEICH_PROG_LL_REGELUNG',
    mode: 'write',
    label: 'Leerlaufanhebung programmieren',
    danger: 'danger',
    note: 'Brennt die Leerlaufanhebung ins EEPROM. Nur nach VERSTELLEN ausführen; rebootbeständig.',
  },
];

/**
 * Farbschwellen aus dem C#-FormatResult der Community-Konfig
 * (1:1 aus DDE40KW0.ccpage <code>-Block übernommen).
 */
export const DDE4_THRESHOLDS = {
  rpm: [
    { max: 3500, color: 'white', note: 'normal' },
    { max: 4000, color: 'yellow', note: 'hohe Drehzahl' },
    { max: 4500, color: 'orange', note: 'kritisch' },
    { max: Infinity, color: 'red', note: 'Abregulierung' },
  ],
  voltage: [
    { max: 10.5, color: 'red', note: 'Batterie tief / Startproblem' },
    { max: 11.5, color: 'orange', note: 'Ladezustand schlecht' },
    { max: 12.5, color: 'yellow', note: 'Zündung aus – ok' },
    { max: 13.2, color: 'gray', note: 'Zündung an, kein Laden' },
    { max: 14.5, color: 'green', note: 'Lichtmaschine ok' },
    { max: Infinity, color: 'red', note: 'Regler defekt!' },
  ],
  preSupply: [
    { max: 3.5, color: 'red', note: 'Kraftstoffmangel (Filter/Pumpe)' },
    { max: 3.7, color: 'orange', note: 'grenzwertig' },
    { max: 4.0, color: 'green', note: 'ok' },
    { max: Infinity, color: 'yellow', note: 'Vordruckregler prüfen' },
  ],
  coolant: [
    { max: 70, color: 'blue', note: 'kalt / aufwärmen' },
    { max: 85, color: 'green', note: 'Betriebstemperatur' },
    { max: 98, color: 'yellow', note: 'warm' },
    { max: 105, color: 'orange', note: 'warm – Thermostat/Ventilator' },
    { max: 110, color: 'orange', note: 'kritisch' },
    { max: Infinity, color: 'red', note: 'ÜBERHITZUNG – Motor aus!' },
  ],
} as const;

/**
 * Fehler-Auslese-ECUs je Fahrzeug aus den Errors.ccpage-Dateien
 * (read_errors-Listen: ECU-Name + SGBD, in DeepOBD-Reihenfolge).
 */
export interface ErrorEcu {
  ecu: string;
  sgbd: string;
}

export const DDE4_ERROR_ECUS: Record<'E39' | 'E46' | 'E53', ErrorEcu[]> = {
  E39: [
    { ecu: 'DDE40KW0', sgbd: 'dde40kw0' },
    { ecu: 'EWS3', sgbd: 'ews3' },
    { ecu: 'IHKA39_5', sgbd: 'ihka39_5' },
    { ecu: 'DSC57', sgbd: 'dsc57' },
    { ecu: 'IKI', sgbd: 'iki' },
    { ecu: 'LCM_III', sgbd: 'lcm_iii' },
    { ecu: 'LWS5_1B', sgbd: 'lws5_1b' },
    { ecu: 'MFL2', sgbd: 'mfl2' },
    { ecu: 'MRS4', sgbd: 'mrs4' },
    { ecu: 'PDCACT', sgbd: 'pdcact' },
    { ecu: 'SZM38', sgbd: 'szm38' },
    { ecu: 'ZKE3', sgbd: 'zke3' },
    { ecu: 'ZKE3_GM1', sgbd: 'zke3_gm1' },
    { ecu: 'ZUHEIZ', sgbd: 'zuheiz' },
  ],
  E46: [
    { ecu: 'DDE40KW0', sgbd: 'dde40kw0' },
    { ecu: 'EWS3', sgbd: 'ews3' },
    { ecu: 'DSC57', sgbd: 'dsc57' },
    { ecu: 'IHKA46_3', sgbd: 'ihka46_3' },
    { ecu: 'IKI', sgbd: 'iki' },
    { ecu: 'LCM_III', sgbd: 'lcm_iii' },
    { ecu: 'LWS5_1B', sgbd: 'lws5_1b' },
    { ecu: 'MFL2', sgbd: 'mfl2' },
    { ecu: 'MRS4', sgbd: 'mrs4' },
    { ecu: 'PDCACT', sgbd: 'pdcact' },
    { ecu: 'SZM38', sgbd: 'szm38' },
    { ecu: 'ZKE3', sgbd: 'zke3' },
    { ecu: 'ZKE3_GM1', sgbd: 'zke3_gm1' },
    { ecu: 'ZUHEIZ', sgbd: 'zuheiz' },
  ],
  E53: [
    { ecu: 'DDE40KW0', sgbd: 'dde40kw0' },
    { ecu: 'EWS3', sgbd: 'ews3' },
    { ecu: 'DSC57', sgbd: 'dsc57' },
    { ecu: 'IHKA39_5', sgbd: 'ihka39_5' },
    { ecu: 'IKI', sgbd: 'iki' },
    { ecu: 'LCM_III', sgbd: 'lcm_iii' },
    { ecu: 'MRS4', sgbd: 'mrs4' },
    { ecu: 'ZKE3', sgbd: 'zke3' },
    { ecu: 'ZKE3_GM1', sgbd: 'zke3_gm1' },
  ],
};

/** DDE3.0-STATUS-Jobs (M47 320d/520d, DDE30DS0-Konfigs derselben Sammlung). */
export const DDE3_STATUS_JOBS: string[] = [
  'STATUS_ATMOSPHAERENDRUCK',
  'STATUS_LADEDRUCK',
  'STATUS_LADEDRUCK_SOLLWERT',
  'STATUS_EINSPRITZMENGE',
  'STATUS_LMM_MASSE',
  'STATUS_UBATT',
  'STATUS_MOTORTEMPERATUR',
  'STATUS_MOTORDREHZAHL',
  'STATUS_GESCHWINDIGKEIT',
];

/** Fahrzeug-Katalog der Nutzer-Sammlung (Top-Level aus copy_configs/Configurations/BMW). */
export interface VehicleConfigGroup {
  chassis: string;
  engines: { name: string; variants: string[]; dde: string }[];
}

export const USER_CONFIG_CATALOG: VehicleConfigGroup[] = [
  {
    chassis: 'E46',
    engines: [
      { name: 'M47 320d (DDE3.0)', variants: ['Automat', 'Schalter'], dde: 'DDE30DS0' },
      { name: 'M47N 320d (EDC16)', variants: ['Automat D50M47A', 'Schalter D50M47A', 'Schalter D50M47B1'], dde: 'D50M47A/B1' },
      { name: 'M52TU 320i 323i 328i', variants: ['Schalter ASC', 'Schalter DSC'], dde: 'MS42/MSS52' },
      { name: 'M54 320i 325i 330i', variants: ['MS430DS0 Automat', 'MS430DS0 Schalter', 'MS450DS0 Schalter'], dde: 'MS430/MS450' },
      { name: 'M57 330d (DDE4.0 ★)', variants: ['Automat', 'Schalter'], dde: 'DDE40KW0' },
      { name: 'M57N 330d (EDC16)', variants: ['D50M57A1', 'D50M57A1 Automat', 'D50M57E1'], dde: 'D50M57' },
      { name: 'S54 M3', variants: ['—'], dde: 'MSS54' },
    ],
  },
  {
    chassis: 'E39',
    engines: [
      { name: 'M47 520d (DDE3.0)', variants: ['Automat', 'Schalter'], dde: 'DDE30DS0' },
      { name: 'M51 525tds', variants: ['—'], dde: 'DDE22DS0' },
      { name: 'M52 520i 523i 528i', variants: ['12 Varianten inkl. vorTU/TU, LCM III/IV, +Tankinfo'], dde: 'MS42/MSS52' },
      { name: 'M54 520i 525i 530i', variants: ['Automat(+EHC/Tankinfo)', 'Schalter(+EHC/Tankinfo)'], dde: 'MS43' },
      { name: 'M57 525d 530d (DDE4.0 ★)', variants: ['Automat', 'Schalter', '+DSP2+EHC', '+Tankinfo', '_D40M57A1', '+LLT', '+Test'], dde: 'DDE40KW0' },
      { name: 'M62 535i 540i', variants: ['8 Varianten MJ97–TU'], dde: 'MSS52/M52' },
      { name: 'S62 M5', variants: ['—', '+EHC', '+Tankinfo'], dde: 'MSS52' },
    ],
  },
  {
    chassis: 'E38',
    engines: [
      { name: 'M60 (Benziner)', variants: ['Automat LM DM338DS0', 'Automat LM DM528DS3'], dde: '—' },
      { name: 'M62TU (Benziner)', variants: ['Automat LCMIII'], dde: 'MSS52' },
      { name: 'M73 750i', variants: ['—'], dde: 'MSS70' },
    ],
  },
  {
    chassis: 'E53 (X5)',
    engines: [
      { name: 'M54 3.0i', variants: ['Automat', 'Schalter'], dde: 'MS43' },
      { name: 'M57 3.0d (DDE4.0 ★)', variants: ['Automat'], dde: 'DDE40KW0' },
      { name: 'M57N (EDC16)', variants: ['Automat D50M57B1'], dde: 'D50M57B1' },
      { name: 'M62 4.4i/4.6is', variants: ['Automat'], dde: 'MSS52' },
    ],
  },
  {
    chassis: 'E6x / E83',
    engines: [
      { name: 'E6x M57N 525d 530d', variants: ['D60M57A0 GS19A', 'D62M57B0 GS19B (+old/_2)'], dde: 'DDE5/6 (CAN)' },
      { name: 'E6x N54', variants: ['MSD80'], dde: 'MSD80' },
      { name: 'E83 X3 M47N', variants: ['D60M47A0 Schalter'], dde: 'D60M47A0' },
      { name: 'E83 X3 M57N', variants: ['Automat D50M57E0'], dde: 'D50M57E0' },
    ],
  },
];

export const DDE4_USER_SOURCE_INFO: string[] = [
  'Quelle: Persönliche DeepOBD-Konfigsammlung des Nutzers (DeepOBD.zip, 9,62 MB, 1434 Dateien) über Proton-Drive-Link, Tiefenanalyse 18.09.2026.',
  'Kern-Nachweis: DDE40KW0-Konfigs existieren für E46 M57 330d (Automat+Schalter), E39 M57 525d/530d (7 Varianten), E53 X5 3.0d – inkl. log/log2/Injektoren/DDEAbgleich-Seiten.',
  'DDEAbgleich_DDE40KW0.ccpage ist über alle drei Fahrzeuge BYTE-IDENTISCH (md5 7aee86e8) – Adaptions-Jobs sind fahrzeugunabhängig.',
  'Interface-Referenz: <global interface="FTDI" /> – bestätigt FT232R-basierte K+DCAN-Kabel (deckungsgleich mit unserem WebUSB-Treiber).',
  'Basis-App laut Anleitung.txt: „Deep OBD für BMW und VAG" (de.holeschak.bmw_deep_obd), Konfig-Pfad Android/data/de.holeschak.bmw_deep_obd/files/Configurations.',
  'Die Sammlung deckt zusätzlich M47 (DDE30DS0), M51 (DDE22DS0), M47N/M57N (EDC16) und alle relevanten Benziner ab – vollständiger Katalog siehe USER_CONFIG_CATALOG.',
];
