import type { StoveData } from '../types';

export interface DealerDiagnosis {
  problem: string;
  reason: string;
  solution: string;
}

export type DealerHealth = 'good' | 'bad';

export interface DealerStatusResult {
  health: DealerHealth;
  headline: string;
  details: string;
  safeHints: string[];
  suggestedImprovements: string[];
}

/**
 * Placeholder diagnosis generator for dealer UI.
 * Real rule-based and AI logic can be plugged in later.
 */
export const deriveDealerDiagnosis = (_currentData: StoveData): DealerDiagnosis => {
  return {
    problem:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.',
    reason:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas faucibus mollis interdum. Etiam porta sem malesuada magna mollis euismod.',
    solution:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla vitae elit libero, a pharetra augue. Cras mattis consectetur purus sit amet fermentum.',
  };
};

export const deriveDealerStatus = (currentData: StoveData): DealerStatusResult => {
  const ecode = typeof currentData.ecode === 'number' ? currentData.ecode : 0;
  const ecode2 = typeof currentData.ecode2 === 'number' ? currentData.ecode2 : 0;
  const controllerTempRaw = typeof currentData.TC === 'number' ? currentData.TC : null;
  const controllerTemp = controllerTempRaw !== null ? controllerTempRaw / 100 : null;
  const flameTemp = typeof currentData.T === 'number' ? currentData.T : null;

  const hasKnownError = ecode > 0 || ecode2 > 0;
  const looksOverheated = (controllerTemp !== null && controllerTemp > 42) || (flameTemp !== null && flameTemp > 700);
  const health: DealerHealth = hasKnownError || looksOverheated ? 'bad' : 'good';

  if (health === 'bad') {
    return {
      health,
      headline: 'Der Ofen zeigt Auffaelligkeiten',
      details:
        'Es wurden klare Hinweise erkannt, dass ein Problem vorliegt. Die finalen Firebase-Regeln folgen in der naechsten Iteration.',
      safeHints: [
        ecode > 0 ? `E-Code aktiv: ${ecode}` : 'Unregelmaessige Temperaturwerte erkannt',
        ecode2 > 0 ? `E2-Code aktiv: ${ecode2}` : 'Systemzustand sollte vor Ort geprueft werden',
        controllerTemp !== null ? `Controller-Temperatur: ${controllerTemp.toFixed(1)}°C` : 'Controller-Temperatur nicht verfuegbar',
      ],
      suggestedImprovements: [
        'Kontrollieren Sie die Luftzufuhr und den Brennstoff.',
        'Pruefen Sie Verkabelung und Sensorik vor Ort.',
      ],
    };
  }

  return {
    health,
    headline: 'Der Ofen brennt einwandfrei',
    details:
      'Aktuell sind keine sicheren Stoerungsmuster erkennbar. Es koennen dennoch Optimierungen fuer Stabilitaet und Verbrauch empfohlen werden.',
    safeHints: [
      'Keine aktiven E-/E2-Fehlercodes erkannt.',
      controllerTemp !== null ? `Controller-Temperatur wirkt normal (${controllerTemp.toFixed(1)}°C).` : 'Controller-Temperatur derzeit nicht vorhanden.',
      'Grundlegender Betriebszustand ist stabil.',
    ],
    suggestedImprovements: [
      'Regelmaessig Brennstoffqualitaet pruefen.',
      'Luftwege sauber halten, um die Effizienz konstant zu halten.',
    ],
  };
};

