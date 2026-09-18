import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

interface DtcInput {
  code: string;
  description: string;
  statusText: string;
  sporadic?: boolean;
  shadow?: boolean;
}

const FALLBACK_HINTS: Record<string, string> = {
  '00025':
    'Luftmassenmesser (HFM): Prüfen Sie Stecker/Korrosion. Typische Folge: Rauchentwicklung, Leistungsabfall, Notlaufprogramm.',
  '00064':
    'Laderdruckregelung: Laderschlauch auf Leckagen prüfen, Wastegate/Stellglied bewegen. Häufig Undichtigkeit oder verkoktes VTG.',
  '17964':
    'Ladedruck zu niedrig: Nebenluft bzw. geplatzte Laderschlauchleitung prüfen. Auch AGR-Undichtigkeit möglich.',
  '00087':
    'AGR-Ventil: AGR-Kühler/Ventil auf Verkokung prüfen, Stellglied ansteuern. Häufig bei hoher Laufleistung.',
  '00438':
    'Kurbelwellensensor: Kein Signal → Motor startet nicht. Sensorwechsel, Prüfen auf Metallspäne am Geber.',
  '01795': 'Interne Steuergeräte-Störung: EEPROM/Programmspeicher defekt – Reparatur oder Tauschgerät nötig.',
};

export async function POST(req: NextRequest) {
  // Body NUR EINMAL lesen (single-use) – der Fallback braucht dieselben Daten
  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  try {
    const dtcs: DtcInput[] = Array.isArray(body.dtcs) ? body.dtcs.slice(0, 12) : [];
    const vehicle = String(body.vehicle ?? 'unbekannt');
    const ecuType = String(body.ecuType ?? 'DDE4.0');

    if (dtcs.length === 0) {
      return NextResponse.json({ analysis: 'Keine Fehlercodes vorhanden.' });
    }

    const list = dtcs
      .map(
        (d) =>
          `Fehlernummer ${d.code}: ${d.description} (Status: ${d.statusText}${d.shadow ? ', Schattenspeicher' : ''}${d.sporadic ? ', sporadisch' : ''})`
      )
      .join('\n');

    const prompt = `Fahrzeug: BMW ${vehicle}, Steuergerät: ${ecuType} (Bosch EDC15C4, Diesel M47/M57).
Ausgelesene Fehlercodes:

${list}

Erstelle eine praxisnahe Werkstatt-Analyse auf Deutsch:
1. Kurze Bewertung jedes Fehlers (Ursache, typische Symptome)
2. Priorität: Was zuerst prüfen?
3. Konkrete Messschritte/Teile (BMW/Bosch-übliche Bezeichnungen)
Halte es kompakt (max. 250 Wörter), nutze Aufzählungen. Keine HTML-Tags, nur einfacher Text.`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            'Du bist ein erfahrener BMW-Diesel-Meister mit Spezialisierung auf Bosch EDC15/DDE4 Steuergeräte. Antworte präzise und werkstattgerecht auf Deutsch.',
        },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    });

    const analysis = completion.choices[0]?.message?.content?.trim();
    if (!analysis) throw new Error('Leere Antwort vom Modell');

    return NextResponse.json({ analysis, source: 'llm' });
  } catch (e) {
    console.error('[api/analyze-dtc]', e);
    // Fallback: statische Hinweise (wiederverwendet das oben gelesene body!)
    const dtcs: DtcInput[] = Array.isArray(body.dtcs) ? body.dtcs : [];
    const hints = dtcs.map((d) => {
      const hint = FALLBACK_HINTS[d.code];
      return `• ${d.code} – ${d.description}\n  ${hint ?? 'Allgemeine Diagnose: Verkabelung, Massepunkte und Sensorversorgung prüfen; im Zweifel Komponententest per Live-Daten.'}`;
    });
    return NextResponse.json({
      analysis: `Werkstatt-Hinweise (offline):\n\n${hints.join('\n\n') || 'Keine Fehler vorhanden.'}`,
      source: 'fallback',
    });
  }
}
