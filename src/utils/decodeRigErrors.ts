/**
 * Bitfield decoding for the controller's `ecode` / `ecode2` registers.
 *
 * These are the same definitions used by ErrorBlock.tsx — re-implemented here
 * as a stateless helper so the dealer view can render its own minimal error
 * card without pulling in ErrorBlock's heatmap/chart machinery.
 *
 * Keep both copies of the table in sync if Claus adds new fault codes.
 */

export interface DecodedRigError {
  description: string;
  source: 'E' | 'E2';
  bit: number;
  /**
   * Whether dealers should see this error. "kein Strom" entries are filtered
   * out per Claus' 2026-05-05 request — they fire as a side-effect of the
   * rig being switched off and would only confuse the dealer.
   */
  dealerVisible: boolean;
  /** Concrete steps a dealer / customer can try first. */
  massnahmen: string[];
}

interface ErrorDefinition {
  bit: number;
  description: string;
  dealerVisible: boolean;
  massnahmen: string[];
}

const ERROR_DEFINITIONS: Record<'E' | 'E2', ReadonlyArray<ErrorDefinition>> = {
  // Hinweis: HASE baut Holz-Rigöfen (kein Pellet!). Motor A/B sind nach
  // aktuellem Stand die Stellmotoren der Primär- (PL) bzw. Sekundärluftklappe
  // (SL). Die Maßnahmen sind generisch gehalten und sollten von Claus / dem
  // HASE-Team noch fachlich verifiziert werden.
  E: [
    {
      bit: 0,
      description: 'Motor A hakt',
      dealerVisible: true,
      massnahmen: [
        'Klappenmechanik der Primärluft auf Schwergängigkeit prüfen',
        'Klappenwelle und Lager auf Schmutz / Asche kontrollieren',
        'Motor und Verkabelung auf festen Sitz prüfen',
      ],
    },
    {
      bit: 1,
      description: 'Motor A dreht durch',
      dealerVisible: true,
      massnahmen: [
        'Mechanische Connection Motor ↔ Klappe prüfen (Mitnehmer / Kupplung)',
        'Klappenwelle auf Bruch oder ausgeschlagene Lagerung kontrollieren',
        'Endschalter / Positionsrückmeldung prüfen',
      ],
    },
    {
      bit: 3,
      description: 'Motor B hakt',
      dealerVisible: true,
      massnahmen: [
        'Klappenmechanik der Sekundärluft auf Schwergängigkeit prüfen',
        'Aschelade leeren und Brennraum reinigen',
        'Verkabelung am Motor B kontrollieren',
      ],
    },
    {
      bit: 4,
      description: 'Motor B dreht durch',
      dealerVisible: true,
      massnahmen: [
        'Mechanische Connection Motor ↔ Klappe prüfen (Mitnehmer / Kupplung)',
        'Klappe auf Blockade durch Asche / Verbrennungsrückstände prüfen',
        'Endschalter / Positionsrückmeldung prüfen',
      ],
    },
    {
      bit: 6,
      description: 'Temperatursensor defekt',
      dealerVisible: true,
      massnahmen: [
        'Sensor und Stecker am Brennraum reinigen',
        'Verkabelung bis zum Controller prüfen',
        'Bei Fortbestehen: Sensor tauschen',
      ],
    },
  ],
  E2: [
    // "kein Strom" — fires when the rig is simply switched off; we hide
    // these from dealers so the error card stays meaningful.
    { bit: 2, description: 'Motor A kein Strom', dealerVisible: false, massnahmen: [] },
    { bit: 5, description: 'Motor B kein Strom', dealerVisible: false, massnahmen: [] },
  ],
};

const decodeRegister = (
  source: 'E' | 'E2',
  value: number | undefined | null,
): DecodedRigError[] => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return [];
  return ERROR_DEFINITIONS[source]
    .filter((def) => (value & (1 << def.bit)) !== 0)
    .map(({ bit, description, dealerVisible, massnahmen }) => ({
      source,
      bit,
      description,
      dealerVisible,
      massnahmen,
    }));
};

export const decodeRigErrors = (input: {
  ecode?: number | null;
  ecode2?: number | null;
}): DecodedRigError[] => [
  ...decodeRegister('E', input.ecode),
  ...decodeRegister('E2', input.ecode2),
];
