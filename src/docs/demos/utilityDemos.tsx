import React from 'react';

/**
 * Static, print-friendly demo components for the /docs page.
 *
 * Constraints honored here:
 *  - /docs is FORCED LIGHT THEME and must look good on A4 paper.
 *  - No Tailwind theme tokens (no `bg-card`, `text-foreground`, etc.) — these
 *    would shift with dark mode and confuse the printed page. Instead we use
 *    inline styles with hex/rgba colors so the visuals are stable.
 *  - No Firebase, no live data, no animations.
 *  - Each root carries `style={{ breakInside: 'avoid' }}` so the print engine
 *    keeps a single demo on one page.
 *  - All copy in German, matching the production components these demos
 *    illustrate (DealerHeaderCard, StoveActionsBlock, ProblemInfoToggle).
 */

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    style={{
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: '#6b7280',
      margin: '1rem 0 0.5rem',
    }}
  >
    {children}
  </p>
);

/* -------------------------------------------------------------------------- */
/* 1. DemoStatusPills — Online / Nicht online / Prüfe…                        */
/* -------------------------------------------------------------------------- */

interface PillProps {
  label: string;
  bg: string;
  fg: string;
  dot: string;
}

const Pill: React.FC<PillProps> = ({ label, bg, fg, dot }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      background: bg,
      color: fg,
      borderRadius: 9999,
      padding: '6px 12px',
      fontSize: 13,
      fontWeight: 500,
    }}
  >
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 9999,
        background: dot,
        marginRight: 6,
      }}
    />
    {label}
  </span>
);

export const DemoStatusPills: React.FC = () => (
  <div style={{ breakInside: 'avoid' }}>
    <SectionLabel>Beispielansicht</SectionLabel>
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <Pill
        label="Online"
        bg="rgb(34 197 94 / 0.15)"
        fg="#16a34a"
        dot="#16a34a"
      />
      <Pill
        label="Nicht online"
        bg="rgb(239 68 68 / 0.15)"
        fg="#dc2626"
        dot="#dc2626"
      />
      <Pill
        label="Prüfe…"
        bg="rgb(245 158 11 / 0.15)"
        fg="#d97706"
        dot="#d97706"
      />
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */
/* 2. DemoFirmwareStatus — three stacked banners (info / warning / success)   */
/* -------------------------------------------------------------------------- */

const bannerBase: React.CSSProperties = {
  borderRadius: '0.5rem',
  padding: '0.5rem 0.75rem',
  fontSize: 12,
  marginBottom: '0.5rem',
};

export const DemoFirmwareStatus: React.FC = () => (
  <div style={{ breakInside: 'avoid' }}>
    <SectionLabel>Beispielansicht</SectionLabel>

    {/* Info / progress banner */}
    <div
      style={{
        ...bannerBase,
        background: 'rgb(59 130 246 / 0.10)',
        color: '#2563eb',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 500 }}>Firmware wird aktualisiert</span>
        <span style={{ fontWeight: 700 }}>47 %</span>
      </div>
      <div
        style={{
          background: 'rgba(0,0,0,0.08)',
          height: 6,
          borderRadius: 3,
          marginTop: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'currentColor',
            height: '100%',
            width: '47%',
            borderRadius: 3,
          }}
        />
      </div>
    </div>

    {/* Warning banner */}
    <div
      style={{
        ...bannerBase,
        background: 'rgb(245 158 11 / 0.10)',
        color: '#d97706',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        width={16}
        height={16}
        style={{ marginRight: 8, flexShrink: 0 }}
      >
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.667-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      <span style={{ fontWeight: 500 }}>Update verfügbar</span>
    </div>

    {/* Success banner */}
    <div
      style={{
        ...bannerBase,
        background: 'rgb(34 197 94 / 0.10)',
        color: '#16a34a',
        display: 'flex',
        alignItems: 'center',
        marginBottom: 0,
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        width={16}
        height={16}
        style={{ marginRight: 8, flexShrink: 0 }}
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      <span style={{ fontWeight: 500 }}>Auf dem neuesten Stand</span>
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */
/* 3. DemoInfoToggle — closed + open variants of the round "i" button         */
/* -------------------------------------------------------------------------- */

const InfoIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={20}
    height={20}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

const infoButtonBase: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 9999,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  cursor: 'default',
  padding: 0,
};

const captionStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  marginTop: '0.25rem',
  textAlign: 'center',
};

export const DemoInfoToggle: React.FC = () => (
  <div style={{ breakInside: 'avoid' }}>
    <SectionLabel>Beispielansicht</SectionLabel>
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
      {/* Closed state */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button
          type="button"
          aria-label="Hintergrund anzeigen"
          style={{
            ...infoButtonBase,
            background: 'rgb(59 130 246 / 0.15)',
            color: '#2563eb',
          }}
        >
          <InfoIcon />
        </button>
        <span style={captionStyle}>geschlossen</span>
      </div>

      {/* Open state */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button
          type="button"
          aria-label="Hintergrund verbergen"
          aria-expanded
          style={{
            ...infoButtonBase,
            background: '#2563eb',
            color: '#ffffff',
          }}
        >
          <InfoIcon />
        </button>
        <span style={captionStyle}>geöffnet</span>
      </div>
    </div>
  </div>
);
