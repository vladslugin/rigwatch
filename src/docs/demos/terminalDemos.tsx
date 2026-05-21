import React from 'react';

/**
 * Demos that illustrate the in-app Terminal: a generic session showing the
 * typical look of commands and output, plus the `hasenfetch` easter egg
 * rendered with the real ASCII logo.
 *
 * All styles inline so the demos survive forced-light mode + print without
 * depending on any theme CSS variables.
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

const terminalRoot: React.CSSProperties = {
  background: '#0f172a',
  color: '#e5e7eb',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: '12px',
  lineHeight: 1.55,
  overflow: 'hidden',
  breakInside: 'avoid',
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
};

const terminalChrome: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.4rem 0.75rem',
  background: '#1e293b',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const dot = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: 9999,
  background: color,
});

const terminalBody: React.CSSProperties = {
  padding: '0.85rem 1rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/* Color codes mimic the real Terminal.tsx line-level palette:
   - prompt / command:  light blue
   - info / output:     light slate
   - success:           light green
   - error:             coral red
   - comment:           faded grey                                    */
const C = {
  prompt: '#60a5fa',
  command: '#e0e7ff',
  output: '#e5e7eb',
  info: '#94a3b8',
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
  muted: '#64748b',
};

interface LineProps {
  tone?: keyof typeof C;
  prompt?: boolean;
  children: React.ReactNode;
}
const Line: React.FC<LineProps> = ({ tone = 'output', prompt, children }) => (
  <div style={{ color: C[tone], margin: 0 }}>
    {prompt ? <span style={{ color: C.prompt, marginRight: 6 }}>$</span> : null}
    {children}
  </div>
);

/**
 * Generic Terminal session demo — shows command echoes, output and info
 * lines, mirroring how the real terminal renders. Static content; no
 * cursor, no animation.
 */
export const DemoTerminal: React.FC = () => (
  <div>
    <SectionLabel>Beispielansicht — Terminal</SectionLabel>
    <div style={terminalRoot}>
      <div style={terminalChrome}>
        <span style={dot('#ef4444')} />
        <span style={dot('#f59e0b')} />
        <span style={dot('#22c55e')} />
        <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 11 }}>
          terminal — Hasenradar
        </span>
      </div>
      <div style={terminalBody}>
        <Line tone="command" prompt>
          connect 1000028300033490000033
        </Line>
        <Line tone="success">✓ Connected to device 1000028300033490000033</Line>
        <Line tone="command" prompt>
          get T as temp
        </Line>
        <Line tone="output">T = 412 °C  →  $temp</Line>
        <Line tone="command" prompt>
          if @T &gt; 400 &#123; log "heiß" &#125;
        </Line>
        <Line tone="info">heiß</Line>
        <Line tone="command" prompt>
          fb_keys /konstant_app shallow prefix 72 as ids
        </Line>
        <Line tone="info">$ids = [37 keys]</Line>
        <Line tone="command" prompt>
          for id in $ids &#123; substr $id 0 7 as sn; log "$sn" &#125;
        </Line>
        <Line tone="info">7247902</Line>
        <Line tone="info">7249625</Line>
        <Line tone="info">7253088</Line>
        <Line tone="muted">… (34 weitere Zeilen)</Line>
        <Line tone="command" prompt>
          disconnect
        </Line>
        <Line tone="info">Disconnected.</Line>
      </div>
    </div>
  </div>
);

/* The original asciiLogo lives in src/assets/ascii_logo.txt; we copy a
   slightly compressed snapshot here so the demo file stays self-contained
   and survives any future asset re-organisation. */
const ASCII_LOGO = `            ...............
         ......................
      ............................
     ..............................
   ..........:=+++++++++++++=-:......
  ...........++++++++==++++++++=:.....
 ............:----:::.-+++++++++:......
.....................-++++++-::.........
..................:-++++++++-...........
..............:-=+++++++++++-...........
...........:-+++++++++++++++:...........
..........-++++++++++++++++-............
.........=+++++++++++++++=:.............
........-++++++++++=::++=...............
........=+++++++++++..=+=..............
 .......+++++++++++=..-+=..............
  ......++++++++++=:..:+=.............
   .....=+++++++++==:..+=............
     ...............................
      ............................
        ........................
           .................`;

const HASENFETCH_INFO: ReadonlyArray<string> = [
  'Hasenradar v2.0.0',
  'Developer: Vladislav Slugin',
  'Email: vladslugin987@gmail.com',
  '',
  'User: max@hase.de',
  'Role: developer',
  'Connection: online',
  'Device ID: 1000028300033490000033',
  'Model: Lhasa',
  'Firmware: v2.5.1',
];

/**
 * `hasenfetch` easter-egg renderer — laying out the ASCII logo next to a
 * info block, just like `emitHasenfetch` in Terminal.tsx.
 *
 * The real implementation pads the info column with non-breaking spaces and
 * trims trailing whitespace. We achieve the same visual via a CSS grid with
 * two `min-content`-fitted columns.
 */
export const DemoHasenfetch: React.FC = () => (
  <div>
    <SectionLabel>Beispielansicht — hasenfetch</SectionLabel>
    <div style={terminalRoot}>
      <div style={terminalChrome}>
        <span style={dot('#ef4444')} />
        <span style={dot('#f59e0b')} />
        <span style={dot('#22c55e')} />
        <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 11 }}>
          terminal — hasenfetch
        </span>
      </div>
      <div style={{ ...terminalBody, padding: '1rem 1.25rem' }}>
        <div style={{ color: C.prompt, marginBottom: '0.5rem' }}>
          <span style={{ color: C.prompt, marginRight: 6 }}>$</span>
          <span style={{ color: C.command }}>hasenfetch</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            columnGap: '1.25rem',
            alignItems: 'start',
            fontSize: '10.5px',
            lineHeight: 1.3,
          }}
        >
          <pre
            style={{
              margin: 0,
              color: '#fbbf24',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              whiteSpace: 'pre',
            }}
          >
            {ASCII_LOGO}
          </pre>
          <div
            style={{
              margin: 0,
              color: C.output,
              alignSelf: 'center',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            {HASENFETCH_INFO.map((line, i) => {
              if (i === 0) {
                return (
                  <div key={i} style={{ color: C.success, fontWeight: 600 }}>
                    {line}
                  </div>
                );
              }
              if (line === '') {
                return <div key={i}>&nbsp;</div>;
              }
              const m = line.match(/^([^:]+):\s*(.*)$/);
              if (m) {
                return (
                  <div key={i}>
                    <span style={{ color: C.prompt }}>{m[1]}</span>
                    <span>: </span>
                    <span>{m[2]}</span>
                  </div>
                );
              }
              return <div key={i}>{line}</div>;
            })}
          </div>
        </div>
      </div>
    </div>
  </div>
);
