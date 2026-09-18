/**
 * QFLASH21 – Wissensbasis aus öffentlichen DeepOBD-Konfigurations-Repos
 * (Task 9-a, GitHub-Deepweb-Research Runde 2)
 *
 * QUELLEN (lokal geklont, extrahiert am 2025-XX, Remotes verifiziert):
 *  1. https://github.com/Dekon01/DeepObdE46Config        (E46-Konfigs: MS430DS0, GS8604, IHKA, IKI, ZUHEIZ, Errors)
 *  2. https://github.com/kmalinich/deepobd-configs        (B803819/DME_DDE.ccpage, E90/DDE.ccpage, A778780/D_MOTOR/jobs/*, code/DME-DDE.ccpage)
 *  3. https://github.com/uholeschak/ediabaslib            (BmwDeepObd-Android-App-Quelle; BmwDeepObd/Xml/{E90,E61,E61R,G31}, BmwFileReader)
 *  4. https://github.com/radelbro/BimmerDis               (.prg/.b1v-Beispiele ME9/MS430 – nur Benziner, kein DDE4)
 *
 * ⚠️ WICHTIGER BEFUND (explizit, siehe docs/research/github-findings-2.md):
 *  In ALLEN durchsuchten Klons existieren KEINE DDE4-/EDC15C4-spezifischen Daten:
 *  - Kein MS450DS0-ähnliches SGBD/PRG für DDE4 (Dekon01-E46-Config enthält nur Benziner MS430DS0;
 *    BimmerDis nur ME9/MS430/MSS52; ediabaslib-Xml nur d_motor/d_dsc = DDE5+ CAN-Ära).
 *  - Keine Fehlernummer→Klartext-Tabelle: Translation.xml.zip in Dekon01 enthält NUR
 *    <?xml?><LanguageCache /> (leerer Cache); die .ccpage-Dateien referenzieren F_ORT_TEXT,
 *    liefern aber KEINE Texte selbst (Texte stecken im proprietären EDIABAS-.prg/SGBD).
 *  - Die unten gelisteten Jobs/MWB stammen aus Benziner (MS45.1) bzw. DDE5/EDC16-Referenz
 *    (d_motor) und sind als solche GRUPPIERT und NICHT als DDE4-Daten zu verwenden.
 *    Sie dienen als Namens-/Struktur-Referenz (Bosch-STATUS_-Konvention, F_*-Fehlerstruktur).
 */

/**
 * Fehlernummer → Klartext (DDE4/EDC15C4).
 *
 * LEER – in den öffentlichen DeepOBD-Repos existieren keine DDE4-DTC-Texte
 * (deutsche Klartexte stecken ausschließlich in den proprietären BMW SGBD/.prg-Dateien
 * bzw. DDE4-SGBD; Translation.xml der DeepOBD-Apps wird zur Laufzeit gefüllt und
 * ist in den Repos leer). Nicht synthetisch ergänzt (Zero-Trust-Prinzip).
 *
 * Format-Spezifikation (aus BmwDeepObd.xsd / Errors.ccpage, verifiziert):
 *  Schlüssel = ORT-Nummer als 4-stelliger Hex-String (z. B. "4407"),
 *  Wert = deutscher Klartext. Die App liest F_ORT_NR (numerisch) und
 *  F_ORT_TEXT (wird vom SGBD aufgelöst – QFLASH21 muss das selbst tun).
 */
export const DEEP_OBD_DTC_TEXTS: Record<string, string> = {};

/**
 * Result-Feldnamen des EDIABAS-Fehler-Lesejobs (STATUS_FEHLER_LESEN), wie sie in
 * ALLEN DeepOBD-`read_errors`-Definitionen für Motorsteuergeräte (inkl. DDE)
 * verwendet werden. Struktur verifiziert aus:
 *  - Dekon01/DeepObdE46Config/Errors.ccpage (MS430DS0-Zeile, vollständige Liste)
 *  - kmalinich/deepobd-configs B803819/Errors.ccpage (MS450DS0 als DME/DDE-Eintrag)
 * Semantik (Bosch/EDIABAS-Konvention):
 *  F_ANZ_NR = Anzahl Einträge; F_ORT_NR = Fehlernummer (ORT); F_ORT_TEXT = Klartext (SGBD);
 *  F_ART*_NR/Text = Fehlerart (1..5, z. B. "aktuell"/"statisch"); F_UW*_NR/TEXT/EINH/WERT =
 *  Umweltparameter 1..5 (Nr, Text, Einheit, Wert); F_ART_BYTE = rohes Art-Byte;
 *  F_UW_SATZ = roher Umweltsatz. Entspricht dem 28-Byte-FSP-Eintrag aus der
 *  Bosch-EDC15C-Funktionsbeschreibung (Kap. 8.5.2.4, siehe docs/research/github-findings.md).
 */
export const DEEP_OBD_ERROR_RESULTS: string[] = [
  "F_ANZ_NR",
  "F_ORT_NR",
  "F_ORT_TEXT",
  "F_ART_ANZ",
  "F_UW_ANZ",
  "F_ART1_NR",
  "F_ART1_Text",
  "F_ART2_NR",
  "F_ART2_Text",
  "F_ART3_NR",
  "F_ART3_Text",
  "F_ART4_NR",
  "F_ART4_Text",
  "F_ART5_NR",
  "F_ART5_Text",
  "F_ART_BYTE",
  "F_UW1_NR",
  "F_UW1_TEXT",
  "F_UW1_EINH",
  "F_UW1_WERT",
  "F_UW2_TEXT",
  "F_UW2_EINH",
  "F_UW2_WERT",
  "F_UW3_TEXT",
  "F_UW3_EINH",
  "F_UW3_WERT",
  "F_UW4_TEXT",
  "F_UW4_EINH",
  "F_UW4_WERT",
  "F_UW5_TEXT",
  "F_UW5_EINH",
  "F_UW5_WERT",
  "F_UW_SATZ",
];

/**
 * Übersetzungs-Schlüsselkonvention der DeepOBD-ccpage-Dateien (verifiziert aus
 * BmwDeepObd.xsd + allen .ccpage der Klons):
 *   "!JOB#<JOBNAME>#<RESULTNAME>"  → benutzerfreundlicher Text (Strings-Sektion)
 *   "!ECU#<SGBDNAME>"              → Steuergerät-Anzeigename
 * Nützlich, falls QFLASH21 später ein ccpage-kompatibles Seitenformat importiert.
 */
export const DEEP_OBD_TRANSLATION_KEY_FORMAT = {
  jobResult: "!JOB#<JOBNAME>#<RESULTNAME>",
  ecu: "!ECU#<SGBDNAME>",
} as const;

export interface DeepObdJob {
  /** EDIABAS-Jobname wie im SGBD (STATUS_- bzw. JOB_-Konvention) */
  name: string;
  /** Was liefert der Job (deutsch) */
  description: string;
  /** Gruppenlabel MIT ECU-Kontext (wichtig: kein Eintrag ist DDE4-verifiziert!) */
  group?: string;
  /** Result-Feldnamen, wie sie der Job laut ccpage liefert */
  results?: string[];
}

/**
 * Jobs aus kmalinich/deepobd-configs B803819/DME_DDE.ccpage, sgbd="MS450DS0".
 * ACHTUNG: Die eigene Errors.ccpage desselben Verzeichnisses labelt diese ECU als
 * "MS45.1" → BENZIN-DME (E65/E38-Ära), NICHT DDE4! Die Namenskonvention und die
 * Bosch-Adaptionsstruktur (ADD/MUL/INT pro Lambdasonde) ist aber exemplarisch für
 * die gesamte Bosch STATUS_-Job-Familie.
 * Formatierungen/Range: format="4.0R" usw. direkt aus der ccpage übernommen.
 */
export const DEEP_OBD_JOBS: DeepObdJob[] = [
  {
    name: "STATUS_MOTORDREHZAHL",
    description: "Motordrehzahl (Anzeige 0–7000 1/min, format 4.0R)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_MOTORDREHZAHL_WERT"],
  },
  {
    name: "STATUS_AN_LUFTTEMPERATUR",
    description: "Ansauglufttemperatur (0–50 °C, format 2.1R)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_AN_LUFTTEMPERATUR_WERT"],
  },
  {
    name: "STATUS_MOTORTEMPERATUR",
    description: "Kühlmitteltemperatur (0–100 °C, format 3.0R)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_MOTORTEMPERATUR_WERT"],
  },
  {
    name: "STATUS_DROSSELKLAPPE",
    description: "Drosselklappen-Querschnitt (0–100 %, format 3.3R)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_DROSSELKLAPPE_WERT"],
  },
  {
    name: "STATUS_ADD / STATUS_ADD_2",
    description:
      "Lambdasonde: additive Adaptation. Rohwert: >64 → Wert − 131.072 (Zweierkomplement-Korrektur aus code/DME-DDE.ccpage)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_ADD_WERT", "STAT_ADD_2_WERT"],
  },
  {
    name: "STATUS_MUL / STATUS_MUL_2",
    description: "Lambdasonde: multiplikative Adaptation (Anzeige −50…50)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_MUL_WERT", "STAT_MUL_2_WERT"],
  },
  {
    name: "STATUS_INT / STATUS_INT_2",
    description: "Lambdasonde: integrale Adaptation (I-Anteil, 0.75–1.25 typ.)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_INT_WERT", "STAT_INT_2_WERT"],
  },
  {
    name: "STATUS_L_SONDE / STATUS_L_SONDE_2",
    description: "Lambdasonden-Spannung Bank 1/2 (0–5 V, format 1.3R)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_L_SONDE_WERT", "STAT_L_SONDE_2_WERT"],
  },
  {
    name: "STATUS_E_LUEFTER",
    description: "Elektrolüfter-Ausgang (STAT_AUSGANG, 0–100 %)",
    group: "MS45.1-B803819 (Benzin, NICHT DDE4)",
    results: ["STAT_AUSGANG"],
  },
  {
    name: "STATUS_DIGITAL",
    description:
      "Boolesche Zustände als Einzelergebnisse (Auswahl verifiziert aus code/DME-DDE.ccpage): STAT_KL15_EIN, STAT_KL50_EIN, STAT_EWS3_FREIGABE, STAT_MOTOR_START, STAT_MOTOR_STEHT, STAT_MOTOR_NACHLAUF, STAT_EKP_EIN, STAT_KATHEIZEN_EIN, STAT_MIL_EIN, STAT_AC_EIN, STAT_LL_EIN, STAT_TL_EIN, STAT_LDP_EIN, STAT_LDR1_EIN, STAT_LDR2_EIN (je 0/1, >0.5 = wahr)",
    group: "DME/DDE-generisch (code/DME-DDE.ccpage)",
  },
];

export interface DeepObdMwb {
  /**
   * Nummerischer Bezeichner. In den DeepOBD-Configs wird STATUS_MESSWERTBLOCK_LESEN
   * NICHT über LID-Bytes, sondern über NAMENSLISTEN (args, Semikolon-getrennt)
   * adressiert; `lid` ist daher die 1-basierte Position im verifizierten
   * args-Array der ccpage (kein Bosch-LID!).
   */
  lid: number;
  /** Arg-Bezeichner im Jobaufruf + zugehöriger STAT-Resultname */
  name: string;
  /** Anzeige-Einheit (aus Label der ccpage) */
  unit: string;
  /** Verifizierte Umrechnungsformel aus dem C#-FormatResult-Code */
  formula?: string;
}

/**
 * Messwertblock-Referenz aus kmalinich/deepobd-configs E90/DDE.ccpage +
 * A778780/D_MOTOR/jobs/STATUS_MESSWERTBLOCK_LESEN.ccpage, sgbd="d_motor"
 * (E90-Diesel = DDE5/EDC16, NICHT DDE4!).
 *
 * Nutzbar als: (a) Vorlage für QFLASH21s LID-0x20–0x2F-MWB-Scan-Darstellung,
 * (b) Arg-Namenskonventionen Bosch-Diesel (I*=Ist, S*=Soll, IT*=Temperatur,
 * IP*=Druck, IL/SL*=Luftmasse), (c) Einheiten/Umrechnungen.
 * args_first="JA" (Erstabruf) / args="NEIN" (Folgeabruf) – Konvention aus der ccpage.
 */
export const DEEP_OBD_MWB: DeepObdMwb[] = [
  { lid: 1, name: "IUBAT2 → STAT_UBATT2_WERT", unit: "V", formula: "raw / 1000 (Anzeige 9000–18000 mV)" },
  { lid: 2, name: "OBD_PID05_CEngDsT_tSens → STAT_CEngDsT_tSens_WERT", unit: "°C", formula: "raw (OBD-PID 05 Kühlmitteltemp)" },
  { lid: 3, name: "ITMOT → STAT_MOTORTEMPERATUR_WERT", unit: "°C", formula: "raw" },
  { lid: 4, name: "ITOEL → STAT_MOTOROEL_TEMPERATUR_WERT", unit: "°C", formula: "raw" },
  { lid: 5, name: "ITKRS → (kein Display in ccpage)", unit: "?" },
  { lid: 6, name: "OBD_PID10_AFS_dmSens → STAT_AFS_dmSens_WERT", unit: "kg/h", formula: "raw (OBD-PID 10 Luftmasse, 0–2000)" },
  { lid: 7, name: "ILMMG → STAT_LUFTMASSE_PRO_HUB_WERT", unit: "mg/Hub", formula: "raw (Ist-Luftmasse)" },
  { lid: 8, name: "SLMMG → STAT_LUFTMASSE_SOLL_WERT", unit: "mg/Hub", formula: "raw (Soll-Luftmasse)" },
  { lid: 9, name: "ITUMG → STAT_UMGEBUNGSTEMPERATUR_WERT", unit: "°C", formula: "raw" },
  { lid: 10, name: "IPLAD → STAT_LADEDRUCK_WERT", unit: "mbar (hPa)", formula: "Anzeige relativ: (raw − 1007) [Umgebungsoffset 1007 hPa]; Range 500–4045" },
  { lid: 11, name: "SPLAD → STAT_LADEDRUCK_SOLL_WERT", unit: "mbar (hPa)", formula: "wie IPLAD (Sollwert)" },
  { lid: 12, name: "ITLAL → STAT_LADELUFTTEMPERATUR_WERT", unit: "°C", formula: "raw" },
  { lid: 13, name: "IPUMG → STAT_UMGEBUNGSDRUCK_WERT", unit: "hPa", formula: "raw (900–1100)" },
  { lid: 14, name: "IPRDR → STAT_RAILDRUCK_WERT", unit: "bar", formula: "raw × 14.503773773 (bar→psi im C#-Code; Rohwert 0–500)" },
  { lid: 15, name: "SPRDR → STAT_RAILDRUCK_SOLL_WERT", unit: "bar", formula: "wie IPRDR (Sollwert)" },
  { lid: 16, name: "ITAVO → (kein Display in ccpage)", unit: "?" },
  { lid: 17, name: "ITAVP1 → (kein Display in ccpage)", unit: "?" },
  { lid: 18, name: "IPDIP → (kein Display in ccpage)", unit: "?" },
  { lid: 19, name: "IDSLRE → (kein Display in ccpage)", unit: "?" },
  { lid: 20, name: "PFltRgn_numRgn → STAT_PFltRgn_numRgn_WERT", unit: "bool", formula: "Regenanforderung: 1 wenn 3.5 < raw < 6.5" },
  { lid: 21, name: "CoEOM_stOpModeAct → STAT_CoEOM_stOpModeAct_WERT", unit: "bit", formula: "Regenstatus aktiv: (int(raw+0.5) & 0x02) != 0" },
  { lid: 22, name: "ISRBF → (kein Display in ccpage)", unit: "?" },
  { lid: 23, name: "ISOED → (kein Display in ccpage)", unit: "?" },
  { lid: 24, name: "PCBS_lDistanceOut → STAT_PCBS_lDistanceOut_WERT", unit: "km", formula: "raw / 1000 (Reststrecke DPF, 0–150000)" },
  { lid: 25, name: "STAT_ABGASTEMPERATUR_VOR_KATALYSATOR_WERT", unit: "°C", formula: "raw (0–1000)" },
  { lid: 26, name: "STAT_ABGASTEMPERATUR_VOR_PARTIKELFILTER_1_WERT", unit: "°C", formula: "raw (0–1000)" },
  { lid: 27, name: "STAT_DIFFERENZDRUCK_UEBER_PARTIKELFILTER_WERT", unit: "hPa", formula: "(raw − 1007), Range 500–3045" },
  { lid: 28, name: "STAT_OELDRUCKSCHALTER_EIN_WERT", unit: "bool", formula: "raw > 0.5" },
  { lid: 29, name: "STAT_STRECKE_SEIT_ERFOLGREICHER_REGENERATION_WERT", unit: "km", formula: "raw / 1000" },
  { lid: 30, name: "STAT_REGENERATION_BLOCKIERUNG_UND_FREIGABE_WERT", unit: "bool", formula: "Freigabe: raw < 0.5" },
];

/**
 * Herkunftsnachweis für alle Daten in dieser Datei (Maschinenlesbar).
 */
export const DEEP_OBD_SOURCE_INFO = [
  "Quelle 1: https://github.com/Dekon01/DeepObdE46Config – Errors.ccpage (DEEP_OBD_ERROR_RESULTS, sgbd MS430DS0/petziner E46), Translation.xml.zip (LEER – keine DTC-Texte!), Pages.ccpages (nur Benziner/Comfort-ECUs, kein DDE4).",
  "Quelle 2: https://github.com/kmalinich/deepobd-configs – B803819/DME_DDE.ccpage (13× STATUS_* gegen sgbd MS450DS0, von der Repo-eigenen Errors.ccpage als MS45.1=Benzin gelabelt), E90/DDE.ccpage + A778780/D_MOTOR/jobs/STATUS_MESSWERTBLOCK_LESEN.ccpage (sgbd d_motor = DDE5/EDC16, args-Liste + Formeln), code/DME-DDE.ccpage (C#-Umrechnungen, STATUS_DIGITAL-Booleans).",
  "Quelle 3: https://github.com/uholeschak/ediabaslib – BmwDeepObd-Android-App-Quelle; BmwDeepObd/Xml nur E90/E61/E61R/G31 (d_motor/d_dsc/…, CAN-Ära, kein K-Line-DDE4); BmwFileReader (F_ORT_TEXT-Regelauflösung RulesInfo.cs); docs/Page_specification.md (ccpage-Formatspezifikation).",
  "Quelle 4: https://github.com/radelbro/BimmerDis – .prg/.b1v-Beispiele (me9_4n, mev9n46, ms430ds0, szm46) – ausschließlich Benziner, bestätigt: kein DDE4-PRG öffentlich in diesen Repos.",
  "FAZIT: Für DDE4/EDC15C4 existieren in den Klons KEINE DTC-Texte, KEINE MWB-args, KEIN .prg. DEEP_OBD_DTC_TEXTS bleibt deshalb absichtlich leer (keine Erfindungen). Kandidaten-Quelle für echte DDE4-Texte: BMW-DDE4-SGBD (INPA/ISTA-Datenstand) oder die Translation.xml aus der DeepOBD-APP EINES E46-Diesel-Nutzers (entsteht erst nach Nutzung am Fahrzeug).",
].join("\n");
