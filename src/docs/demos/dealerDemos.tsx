import React from 'react';

/**
 * Static, print-friendly demo components for the /docs page.
 *
 * Rules of engagement for this file:
 *   - /docs is forced light-theme and must look good on A4 paper.
 *   - No Firebase, no live data, no animations. Pure static React.
 *   - Avoid the project's CSS-variable utilities (`bg-card`, `text-foreground`,
 *     `border-border` etc.) — those flip under dark mode. We use inline styles
 *     with concrete hex colors instead so the output is stable in any theme.
 *   - Every demo root carries `breakInside: 'avoid'` so a single illustration
 *     never gets cut in half by a page break.
 *   - All copy is German to match the real dealer UI.
 *
 * Shared design tokens (kept inline rather than in a module-level object so
 * each demo stays grep-friendly and self-contained):
 *   - Card root:     #ffffff bg, 0.5rem radius, subtle shadow.
 *   - Success tint:  rgb(34 197 94 / 0.10) bg, #16a34a text.
 *   - Destructive:   rgb(239 68 68 / 0.10) bg, #dc2626 text.
 *   - Info:          rgb(59 130 246 / 0.10) bg, #2563eb text.
 *   - Raised inner:  rgb(0 0 0 / 0.04) bg.
 *   - Stars:         filled #f59e0b, empty #e5e7eb, 16x16.
 */

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** A row of 5 stars; `filled` are gold, the rest are pale gray. */
const StarRow: React.FC<{ filled: number; total?: number }> = ({ filled, total = 5 }) => (
  <span
    aria-label={`${filled} von ${total} Sternen`}
    style={{ display: 'inline-flex', alignItems: 'center', gap: '1px' }}
  >
    {Array.from({ length: total }, (_, i) => (
      <svg
        key={i}
        aria-hidden="true"
        viewBox="0 0 20 20"
        width={16}
        height={16}
        fill={i < filled ? '#f59e0b' : '#e5e7eb'}
      >
        <path d="M9.05 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 0 0 .95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 0 0-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.539 1.118l-3.977-2.888a1 1 0 0 0-1.176 0l-3.976 2.888c-.784.57-1.838-.196-1.539-1.118l1.518-4.674a1 1 0 0 0-.364-1.118L2.075 10.1c-.783-.57-.38-1.81.588-1.81h4.915a1 1 0 0 0 .95-.69l1.518-4.674Z" />
      </svg>
    ))}
  </span>
);

const FlameIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill={color}>
    <path d="M12 2c-1 5-5 6-5 11a5 5 0 0 0 10 0c0-1.5-.5-3-2-4 .5 2-.5 3-1.5 3-1 0-1.5-1-1.5-2 0-3 1-5 0-8Z" />
    <path
      d="M9.5 14.5c0-1 .5-2 1.5-2.5.2 1 .8 1.5 1.5 1.5.7 0 1.2-.4 1.5-1 .8.7 1 1.7 1 2.5 0 1.7-1.5 3-3.5 3s-3-1.3-3-2.5c0-.4.1-.7.3-1Z"
      fillOpacity="0.5"
    />
  </svg>
);

const AlertIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

/**
 * Closed = light-blue tint with blue stroke; Open = solid blue with white
 * stroke. Mirrors the real ProblemInfoToggle from BrennbewertungCard so the
 * docs match what dealers actually see.
 */
const InfoToggle: React.FC<{ open: boolean }> = ({ open }) => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-flex',
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '9999px',
      background: open ? '#2563eb' : 'rgb(59 130 246 / 0.15)',
      color: open ? '#ffffff' : '#2563eb',
      flexShrink: 0,
    }}
  >
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  </span>
);

/** "C1"-style monospace chip used to identify a Brennbewertung variable. */
const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      background: '#f3f4f6',
      borderRadius: '9999px',
      padding: '2px 8px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 11,
      color: '#6b7280',
      flexShrink: 0,
    }}
  >
    {children}
  </span>
);

/** Pill-shaped "Maßnahmen anzeigen / verbergen" button (always static here). */
const PillButton: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      background: '#ffffff',
      borderRadius: '9999px',
      padding: '4px 12px',
      fontSize: 11,
      color: '#111111',
      border: '1px solid #d1d5db',
      flexShrink: 0,
    }}
  >
    {children}
  </span>
);

const SectionLabel: React.FC = () => (
  <p
    style={{
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: '#6b7280',
      margin: '1rem 0 0.5rem',
    }}
  >
    Beispielansicht
  </p>
);

// Shared root style for every demo card. `breakInside: avoid` keeps the card
// glued together across A4 page breaks during print.
const cardRoot: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '0.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  padding: '1rem 1.25rem',
  color: '#111111',
  fontSize: 14,
  lineHeight: 1.45,
  breakInside: 'avoid',
};

// `›`-bullet list, used for Maßnahmen everywhere.
const BulletList: React.FC<{ items: string[]; markerColor?: string }> = ({
  items,
  markerColor = 'rgba(0,0,0,0.5)',
}) => (
  <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0 }}>
    {items.map((item, idx) => (
      <li
        key={idx}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          margin: idx === 0 ? 0 : '4px 0 0',
          color: '#4b5563',
          fontSize: 13,
        }}
      >
        <span aria-hidden="true" style={{ color: markerColor, marginTop: 1 }}>
          ›
        </span>
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

// ---------------------------------------------------------------------------
// 1. DemoBrennbewertungGood — "Der Ofen brennt einwandfrei"
// ---------------------------------------------------------------------------

export const DemoBrennbewertungGood: React.FC = () => (
  <>
    <SectionLabel />
    <section style={cardRoot} aria-label="Beispiel: Brennbewertung, alles gut">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            display: 'flex',
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            background: 'rgb(34 197 94 / 0.10)',
            color: '#16a34a',
            flexShrink: 0,
          }}
        >
          <FlameIcon color="#16a34a" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#111111' }}>
            Der Ofen brennt einwandfrei
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Alle Brennparameter liegen im grünen Bereich.
          </p>
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {[
              'Das Holz hat die richtige Restfeuchte (14 – 20 %).',
              'Kaminzug und Brennstoffmenge passen zur Bedienungsanleitung.',
              'Es treten keine Auffälligkeiten bei Anzünden oder Nachlegen auf.',
            ].map((line, idx) => (
              <li
                key={idx}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  margin: idx === 0 ? 0 : '6px 0 0',
                  fontSize: 13,
                  color: '#111111',
                }}
              >
                <span aria-hidden="true" style={{ color: '#16a34a', marginTop: 1 }}>
                  →
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  </>
);

// ---------------------------------------------------------------------------
// 2. DemoBrennbewertungBad — red header + two ProblemEntry rows
// ---------------------------------------------------------------------------

interface ProblemEntryProps {
  cKey: string;
  title: string;
  stars: number;
  massnahmen: string[];
  infoOpen?: boolean;
  auswirkungen?: string[];
}

const ProblemEntry: React.FC<ProblemEntryProps> = ({
  cKey,
  title,
  stars,
  massnahmen,
  infoOpen = false,
  auswirkungen,
}) => (
  <li
    style={{
      background: 'rgb(0 0 0 / 0.04)',
      borderRadius: '0.5rem',
      padding: '1rem',
      listStyle: 'none',
    }}
  >
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Chip>{cKey}</Chip>
      <h4
        style={{
          margin: 0,
          minWidth: 0,
          flex: 1,
          fontSize: 15,
          fontWeight: 600,
          color: '#111111',
        }}
      >
        {title}
      </h4>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <StarRow filled={stars} />
        <InfoToggle open={infoOpen} />
      </div>
    </div>
    <BulletList items={massnahmen} />
    {infoOpen && auswirkungen && auswirkungen.length > 0 ? (
      <div
        style={{
          marginTop: 12,
          background: 'rgb(59 130 246 / 0.10)',
          borderRadius: '0.5rem',
          padding: '0.75rem',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#2563eb',
          }}
        >
          Auswirkungen
        </p>
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {auswirkungen.map((line, idx) => (
            <li
              key={idx}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                margin: idx === 0 ? 0 : '4px 0 0',
                fontSize: 13,
                color: '#4b5563',
              }}
            >
              <span aria-hidden="true" style={{ color: '#2563eb', marginTop: 1 }}>
                →
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </li>
);

export const DemoBrennbewertungBad: React.FC = () => (
  <>
    <SectionLabel />
    <section style={cardRoot} aria-label="Beispiel: Brennbewertung mit Problemen">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            background: 'rgb(239 68 68 / 0.10)',
            color: '#dc2626',
            flexShrink: 0,
          }}
        >
          <FlameIcon color="#dc2626" />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#111111' }}>
            Der Ofen könnte besser brennen
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Diese Punkte sollten zuerst überprüft werden.
          </p>
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ProblemEntry
          cKey="C1"
          title="Der Ofen brennt sehr stark"
          stars={5}
          massnahmen={[
            'Feuchtigkeit des Holzes messen (Restfeuchte 14 – 20 %)',
            'Evtl. Drosselklappe im Schornstein oder der Zuluft schließen',
            'Holzart und Aufgabemenge nach Bedienungsanleitung wählen',
          ]}
        />
        <ProblemEntry
          cKey="C2"
          title="Der Ofen brennt träge"
          stars={4}
          massnahmen={[
            'Kleinere Scheite wählen',
            'Nicht nur ein Scheit auflegen',
          ]}
          infoOpen
          auswirkungen={[
            'Ofen kommt nicht auf Touren',
            'Aufheizen dauert zu lange',
            'Ofen brennt nicht schön, wenig Flamme',
          ]}
        />
      </ul>
    </section>
  </>
);

// ---------------------------------------------------------------------------
// 3. DemoOfenFunktionError — 2 stacked errors, second one open
// ---------------------------------------------------------------------------

interface ErrorRowProps {
  description: string;
  pillLabel: string;
  open?: boolean;
  massnahmen?: string[];
}

const ErrorRow: React.FC<ErrorRowProps> = ({ description, pillLabel, open = false, massnahmen }) => (
  <li
    style={{
      background: 'rgb(239 68 68 / 0.10)',
      borderRadius: '0.5rem',
      padding: '0.75rem',
      listStyle: 'none',
    }}
  >
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
      <p style={{ margin: 0, minWidth: 0, flex: 1, fontSize: 14, fontWeight: 500, color: '#111111' }}>
        {description}
      </p>
      <PillButton>{pillLabel}</PillButton>
    </div>
    {open && massnahmen && massnahmen.length > 0 ? <BulletList items={massnahmen} /> : null}
  </li>
);

export const DemoOfenFunktionError: React.FC = () => (
  <>
    <SectionLabel />
    <section style={cardRoot} aria-label="Beispiel: Ofen-Funktion mit Fehlern">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            display: 'flex',
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            background: 'rgb(239 68 68 / 0.10)',
            color: '#dc2626',
            flexShrink: 0,
          }}
        >
          <AlertIcon color="#dc2626" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#111111' }}>
            Der Ofen meldet 2 Fehler
          </h3>
          <ul
            style={{
              listStyle: 'none',
              margin: '12px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <ErrorRow description="Motor A hakt" pillLabel="Maßnahmen anzeigen" />
            <ErrorRow
              description="Temperatursensor defekt"
              pillLabel="Maßnahmen verbergen"
              open
              massnahmen={[
                'Sensor und Stecker am Brennraum reinigen',
                'Verkabelung bis zum Controller prüfen',
                'Bei Fortbestehen: Sensor tauschen',
              ]}
            />
          </ul>
          <p
            style={{
              margin: '12px 0 0',
              background: 'rgb(59 130 246 / 0.10)',
              color: '#2563eb',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              fontSize: 13,
            }}
          >
            Bitte zuerst die Firmware aktualisieren. Viele Fehler verschwinden nach dem Update.
          </p>
        </div>
      </div>
    </section>
  </>
);

// ---------------------------------------------------------------------------
// 4. DemoCauseEntry — single AI-answer cause card (no C-chip)
// ---------------------------------------------------------------------------

export const DemoCauseEntry: React.FC = () => (
  <>
    <SectionLabel />
    <section style={cardRoot} aria-label="Beispiel: KI-Ursachenkarte">
      <div
        style={{
          background: 'rgb(0 0 0 / 0.04)',
          borderRadius: '0.5rem',
          padding: '1rem',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <h4
            style={{
              margin: 0,
              minWidth: 0,
              flex: 1,
              fontSize: 15,
              fontWeight: 600,
              color: '#111111',
            }}
          >
            Holzqualität ist schlecht
          </h4>
          <StarRow filled={4} />
        </div>
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          <li
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              fontSize: 13,
              color: '#4b5563',
            }}
          >
            <span aria-hidden="true" style={{ color: 'rgba(0,0,0,0.5)', marginTop: 1 }}>
              ›
            </span>
            <span>Restfeuchte über 20 % verursacht Rauch und niedrige Temperaturen</span>
          </li>
        </ul>
      </div>
    </section>
  </>
);
