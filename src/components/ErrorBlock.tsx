import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useErrors } from '../hooks/useErrors';
import { useTranslation } from 'react-i18next';
import { realtimeDB } from '../lib/firebase';
import { useRigStore } from '../store/useRigStore';

interface ErrorBlockProps {
  simpleMode?: boolean;
}

const ANGLE_BIN_SIZE = 10;
const ANGLE_BIN_COUNT = Math.ceil(100 / ANGLE_BIN_SIZE);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ERROR_DEFINITIONS = {
  E: [
    { bit: 0, description: 'Motor A hakt' },
    { bit: 1, description: 'Motor A dreht durch' },
    { bit: 3, description: 'Motor B hakt' },
    { bit: 4, description: 'Motor B dreht durch' },
    { bit: 6, description: 'Temperatursensor defekt' }
  ],
  E2: [
    { bit: 2, description: 'Motor A kein Strom' },
    { bit: 5, description: 'Motor B kein Strom' }
  ]
} as const;

const ErrorBlock: React.FC<ErrorBlockProps> = ({ simpleMode = false }) => {
  const { errors: activeErrors, hasErrors, errorData } = useErrors();
  const { t } = useTranslation();
  const deviceId = useRigStore(state => state.deviceId);
  const [fehlerPL, setFehlerPL] = useState<Record<string, unknown> | null>(null);
  const [fehlerSL, setFehlerSL] = useState<Record<string, unknown> | null>(null);
  const [fehlerAll, setFehlerAll] = useState<Record<string, unknown> | null>(null);
  const [showHeatmaps, setShowHeatmaps] = useState(false);
  const [showBars, setShowBars] = useState(false);
  const [heatmapCompact, setHeatmapCompact] = useState(true);
  const [showLists, setShowLists] = useState(false);

  useEffect(() => {
    if (!deviceId || !realtimeDB) {
      setFehlerPL(null);
      setFehlerSL(null);
      setFehlerAll(null);
      return;
    }

    const plRef = ref(realtimeDB, `fehler/PL/${deviceId}`);
    const slRef = ref(realtimeDB, `fehler/SL/${deviceId}`);
    const allRef = ref(realtimeDB, `fehler/${deviceId}`);

    const unsubscribePL = onValue(plRef, snapshot => {
      const raw = snapshot.exists() ? snapshot.val() : null;
      setFehlerPL(raw && typeof raw === 'object' ? raw : null);
    });

    const unsubscribeSL = onValue(slRef, snapshot => {
      const raw = snapshot.exists() ? snapshot.val() : null;
      setFehlerSL(raw && typeof raw === 'object' ? raw : null);
    });

    const unsubscribeAll = onValue(allRef, snapshot => {
      const raw = snapshot.exists() ? snapshot.val() : null;
      setFehlerAll(raw && typeof raw === 'object' ? raw : null);
    });

    return () => {
      unsubscribePL();
      unsubscribeSL();
      unsubscribeAll();
    };
  }, [deviceId]);

  const buildHeatmap = (raw: Record<string, unknown> | null) => {
    const grid = Array.from({ length: 24 }, () => Array.from({ length: ANGLE_BIN_COUNT }, () => 0));
    if (!raw) return grid;

    Object.entries(raw).forEach(([timestampKey, value]) => {
      const timestamp = Number(timestampKey);
      const numericValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(timestamp) || !Number.isFinite(numericValue)) return;
      const hour = new Date(timestamp * 1000).getHours();
      const clamped = Math.max(0, Math.min(100, numericValue));
      const bin = Math.min(ANGLE_BIN_COUNT - 1, Math.floor(clamped / ANGLE_BIN_SIZE));
      if (hour >= 0 && hour < 24) {
        grid[hour][bin] += 1;
      }
    });

    return grid;
  };

  const buildDailyCounts = (raw: Record<string, unknown> | null) => {
    const counts: Record<string, number> = {};
    if (!raw) return [];

    Object.keys(raw).forEach((timestampKey) => {
      const timestamp = Number(timestampKey);
      if (!Number.isFinite(timestamp)) return;
      const date = new Date(timestamp * 1000);
      const key = date.toISOString().slice(0, 10);
      counts[key] = (counts[key] ?? 0) + 1;
    });

    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  };

  const plHeatmap = useMemo(() => buildHeatmap(fehlerPL), [fehlerPL]);
  const slHeatmap = useMemo(() => buildHeatmap(fehlerSL), [fehlerSL]);
  const plDaily = useMemo(() => buildDailyCounts(fehlerPL), [fehlerPL]);
  const slDaily = useMemo(() => buildDailyCounts(fehlerSL), [fehlerSL]);

  const formatDateTime = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

  const buildAngleList = (raw: Record<string, unknown> | null) => {
    if (!raw) return [];
    return Object.entries(raw)
      .map(([timestampKey, value]) => {
        const timestamp = Number(timestampKey);
        const numericValue = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(timestamp) || !Number.isFinite(numericValue)) return null;
        return {
          timestamp,
          dateTime: formatDateTime(timestamp),
          value: numericValue
        };
      })
      .filter((entry): entry is { timestamp: number; dateTime: string; value: number } => Boolean(entry))
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const buildAllErrorsList = (raw: Record<string, unknown> | null) => {
    if (!raw) return [];
    const entries: Array<{ timestamp: number; dateTime: string; path: string; valueString: string; rawValue: unknown }> = [];

    const visit = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
        const timestamp = Number(key);
        if (Number.isFinite(timestamp)) {
          entries.push({
            timestamp,
            dateTime: formatDateTime(timestamp),
            path,
            valueString: typeof value === 'string' ? value : JSON.stringify(value),
            rawValue: value
          });
          return;
        }
        if (value && typeof value === 'object') {
          visit(value, path ? `${path}/${key}` : key);
        }
      });
    };

    visit(raw, '');

    return entries.sort((a, b) => a.timestamp - b.timestamp);
  };

  const plList = useMemo(() => buildAngleList(fehlerPL), [fehlerPL]);
  const slList = useMemo(() => buildAngleList(fehlerSL), [fehlerSL]);
  const allList = useMemo(() => buildAllErrorsList(fehlerAll), [fehlerAll]);

  const getMaxCount = (grid: number[][]) =>
    grid.reduce((max, row) => Math.max(max, ...row), 0);

  const getCellColor = (count: number, max: number) => {
    if (max === 0 || count === 0) return 'hsl(var(--muted) / 0.4)';
    const intensity = Math.min(1, count / max);
    const alpha = 0.2 + intensity * 0.8;
    return `hsl(var(--destructive) / ${alpha})`;
  };

  const angleLabels = Array.from({ length: ANGLE_BIN_COUNT }, (_, i) => {
    const start = i * ANGLE_BIN_SIZE;
    const end = i === ANGLE_BIN_COUNT - 1 ? 100 : (i + 1) * ANGLE_BIN_SIZE;
    return `${start}-${end}`;
  });

  const renderHeatmap = (label: string, grid: number[][], compact: boolean) => {
    const max = getMaxCount(grid);
    const hasData = max > 0;
    const angleTotals = Array.from({ length: ANGLE_BIN_COUNT }, (_, idx) =>
      grid.reduce((sum, row) => sum + row[idx], 0)
    );
    const angleMax = Math.max(0, ...angleTotals);

    return (
      <div className="space-y-2">
        <div className={'text-xs font-semibold text-foreground'}>
          Heatmap {label}
        </div>
        {!hasData ? (
          <div className={'text-xs text-muted-foreground'}>
            No heatmap data
          </div>
        ) : (
          <div className="space-y-1">
            {compact ? (
              <>
                <div
                  className={'grid gap-[2px] text-[10px] text-muted-foreground'}
                  style={{ gridTemplateColumns: `repeat(${ANGLE_BIN_COUNT}, minmax(0, 1fr))` }}
                >
                  {angleLabels.map(labelText => (
                    <div key={`angle-compact-${labelText}`} className="text-center">
                      {labelText}
                    </div>
                  ))}
                </div>
                <div
                  className="grid gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${ANGLE_BIN_COUNT}, minmax(0, 1fr))` }}
                >
                  {angleTotals.map((count, idx) => {
                    const maxHeightPx = 96;
                    const heightPx = angleMax > 0 ? Math.max(2, Math.round((count / angleMax) * maxHeightPx)) : 0;
                    return (
                      <div key={`angle-bar-${idx}`} className="h-24 flex items-end">
                        <div
                          title={`${angleLabels[idx]}: ${count}`}
                          className={'w-full rounded-sm border border-border/60'}
                          style={{
                            height: `${heightPx}px`,
                            backgroundColor: getCellColor(count, angleMax)
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className={'text-[10px] text-muted-foreground'}>
                  X: Winkelbereich, Y: Anzahl
                </div>
              </>
            ) : (
              <>
                <div
                  className={'grid gap-[2px] text-[10px] text-muted-foreground'}
                  style={{ gridTemplateColumns: `24px repeat(${ANGLE_BIN_COUNT}, minmax(0, 1fr))` }}
                >
                  <div />
                  {angleLabels.map(labelText => (
                    <div key={labelText} className="text-center">
                      {labelText}
                    </div>
                  ))}
                </div>
                <div
                  className="grid gap-[2px]"
                  style={{ gridTemplateColumns: `24px repeat(${ANGLE_BIN_COUNT}, minmax(0, 1fr))` }}
                >
                  {HOURS.map(hour => (
                    <React.Fragment key={hour}>
                      <div className={'text-[10px] text-muted-foreground'}>
                        {hour.toString().padStart(2, '0')}
                      </div>
                      {grid[hour].map((count, idx) => (
                        <div
                          key={`${hour}-${idx}`}
                          title={`${hour.toString().padStart(2, '0')}:00, ${angleLabels[idx]}: ${count}`}
                          className={'h-4 rounded-sm border border-border/60'}
                          style={{ backgroundColor: getCellColor(count, max) }}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </div>
                <div className={'text-[10px] text-muted-foreground'}>
                  Anzahl pro Stunde (lokale Zeit) vs. Winkel (%)
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderBarChart = (label: string, data: Array<{ date: string; count: number }>) => {
    const max = data.reduce((acc, item) => Math.max(acc, item.count), 0);
    const hasData = max > 0;

    return (
      <div className="space-y-2">
        <div className={'text-xs font-semibold text-foreground'}>
          Bar Chart {label}
        </div>
        {!hasData ? (
          <div className={'text-xs text-muted-foreground'}>
            No bar data
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end gap-2 h-24 overflow-x-auto pb-1">
              {data.map(item => {
                const maxHeightPx = 96;
                const heightPx = max > 0 ? Math.max(2, Math.round((item.count / max) * maxHeightPx)) : 0;
                return (
                  <div key={item.date} className="w-16 shrink-0 h-full flex flex-col items-center justify-end">
                    <div
                      title={`${item.date}: ${item.count}`}
                      className={'w-6 rounded-sm border border-border/60'}
                      style={{
                        height: `${heightPx}px`,
                        backgroundColor: getCellColor(item.count, max)
                      }}
                    />
                    <div className={'mt-1 text-[9px] text-muted-foreground'}>
                      {item.date}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={'text-[10px] text-muted-foreground'}>
              X: Tag, Y: Anzahl
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAngleList = (label: string, data: Array<{ timestamp: number; dateTime: string; value: number }>) => {
    const handleCopy = async () => {
      if (data.length === 0) return;
      const csv = ['timestamp,dateTime,value', ...data.map(item => `${item.timestamp},${item.dateTime},${item.value}`)].join('\n');
      try {
        await navigator.clipboard.writeText(csv);
      } catch (error) {
        console.error('Failed to copy CSV', error);
      }
    };

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className={'text-xs font-semibold text-foreground'}>
            Fehlerliste {label}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="text-[10px] px-2 py-0.5 rounded border border-border/60 bg-card text-foreground"
            disabled={data.length === 0}
            title="CSV kopieren"
          >
            CSV
          </button>
        </div>
        {data.length === 0 ? (
          <div className={'text-xs text-muted-foreground'}>
            No entries
          </div>
        ) : (
          <div className={'max-h-56 overflow-auto rounded border border-border/60 bg-card/40'}>
            <ul className={'text-xs text-foreground'}>
              {data.map(item => (
                <li key={`${label}-${item.timestamp}`} className="px-2 py-1 border-b last:border-b-0 border-border/30">
                  {item.dateTime}: {item.value}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const parseErrorNumber = (raw: unknown) => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw !== 'string') return null;
    const numericPart = raw.split('/')[0]?.trim();
    if (!numericPart) return null;
    const parsed = Number(numericPart);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const decodeErrorDescriptions = (raw: unknown, type: 'E' | 'E2') => {
    const value = parseErrorNumber(raw);
    if (value === null) return [];
    return ERROR_DEFINITIONS[type]
      .filter(def => (value & (1 << def.bit)) !== 0)
      .map(def => def.description);
  };

  const formatDecodedErrors = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const parts: string[] = [];

    if ('ecode' in record) {
      const rawValue = record.ecode;
      const descriptions = decodeErrorDescriptions(rawValue, 'E');
      const rawString = typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : JSON.stringify(rawValue);
      parts.push(descriptions.length > 0 ? `ecode=${rawString} (${descriptions.join(', ')})` : `ecode=${rawString}`);
    }

    if ('ecode2' in record) {
      const rawValue = record.ecode2;
      const descriptions = decodeErrorDescriptions(rawValue, 'E2');
      const rawString = typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : JSON.stringify(rawValue);
      parts.push(descriptions.length > 0 ? `ecode2=${rawString} (${descriptions.join(', ')})` : `ecode2=${rawString}`);
    }

    return parts.length > 0 ? parts.join(' | ') : null;
  };

  const renderAllErrorsList = (data: Array<{ timestamp: number; dateTime: string; path: string; valueString: string; rawValue: unknown }>) => {
    const handleCopy = async () => {
      if (data.length === 0) return;
      const csv = ['timestamp,dateTime,path,value', ...data.map(item => `${item.timestamp},${item.dateTime},${item.path},${item.valueString}`)].join('\n');
      try {
        await navigator.clipboard.writeText(csv);
      } catch (error) {
        console.error('Failed to copy CSV', error);
      }
    };

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className={'text-xs font-semibold text-foreground'}>
            Fehlerübersicht
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="text-[10px] px-2 py-0.5 rounded border border-border/60 bg-card text-foreground"
            disabled={data.length === 0}
            title="CSV kopieren"
          >
            CSV
          </button>
        </div>
        {data.length === 0 ? (
          <div className={'text-xs text-muted-foreground'}>
            No entries
          </div>
        ) : (
          <div className={'max-h-64 overflow-auto rounded border border-border/60 bg-card/40'}>
            <ul className={'text-xs text-foreground'}>
              {data.map(item => {
                const decoded = formatDecodedErrors(item.rawValue);
                return (
                  <li key={`${item.path}-${item.timestamp}`} className="px-2 py-1 border-b last:border-b-0 border-border/30">
                    {decoded && (
                      <div className={'text-destructive font-medium'}>
                        [{decoded}]
                      </div>
                    )}
                    <div>
                      {item.dateTime}{item.path ? ` [${item.path}]` : ''}: {item.valueString}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="bg-card rounded-xl overflow-hidden border border-border shadow-sm"
    >
      {/* Header */}
      <div
        className="bg-muted/70 text-foreground border-b border-border px-3 py-2"
      >
        <h2 className="text-sm font-semibold flex items-center">
          <div className="w-4 h-4 mr-2 flex items-center justify-center">
            <svg
              className={`w-3.5 h-3.5 ${hasErrors ? 'text-destructive' : 'text-success'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {hasErrors ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
          </div>
          <span>{t('errorBlock.title')}</span>
          {hasErrors && (
            <span className="ml-2 bg-destructive/10 text-destructive px-2 py-0.5 rounded-md text-xs font-medium border border-destructive/30">
              {activeErrors.length}
            </span>
          )}
        </h2>
      </div>

      {/* Content */}
      <div className="p-2 sm:p-3 transition-colors">
        <div className="space-y-2">
          {activeErrors.map((error) => (
            <div
              key={error.code}
              className="flex items-start space-x-2 p-2 bg-destructive/10 border border-destructive/40 rounded-md"
            >
              <div className="flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-destructive">
                  {error.description}
                </div>
                {!simpleMode && (
                  <div className="text-xs text-destructive/80 mt-1">
                    Bit {error.code > 100 ? error.code - 100 : error.code} gesetzt
                    {error.code > 100 ? ' (E2)' : ' (E)'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {!simpleMode && (
          <div className="mt-3 space-y-3">
            <button
              type="button"
              onClick={() => setShowHeatmaps(prev => !prev)}
              className={
                'w-full flex items-center justify-between px-2 py-1 rounded-md border border-border/60 bg-card text-foreground text-xs font-semibold'
              }
            >
              <span>Heatmap</span>
              <span className={'text-muted-foreground'}>
                {showHeatmaps ? 'Collapse' : 'Expand'}
              </span>
            </button>
            {showHeatmaps && (
              <div
                className={
                  'ml-2 pl-3 pr-3 py-2 border-l-2 border-border/60 bg-card/40 rounded-md space-y-4'
                }
              >
                <button
                  type="button"
                  onClick={() => setHeatmapCompact(prev => !prev)}
                  className={
                    'w-full flex items-center justify-between px-2 py-1 rounded-md border border-border/60 bg-card text-foreground text-[11px] font-semibold'
                  }
                >
                  <span>Heatmap Ansicht</span>
                  <span className={'text-muted-foreground'}>
                    {heatmapCompact ? 'Erweitern' : '0-23 Ansicht'}
                  </span>
                </button>
                {renderHeatmap('PL', plHeatmap, heatmapCompact)}
                {renderHeatmap('SL', slHeatmap, heatmapCompact)}
              </div>
            )}
            <div className="pt-2 space-y-3">
              <button
                type="button"
                onClick={() => setShowBars(prev => !prev)}
                className={
                  'w-full flex items-center justify-between px-2 py-1 rounded-md border border-border/60 bg-card text-foreground text-xs font-semibold'
                }
              >
                <span>Bar Chart</span>
                <span className={'text-muted-foreground'}>
                  {showBars ? 'Collapse' : 'Expand'}
                </span>
              </button>
              {showBars && (
                <div
                  className={
                    'ml-2 pl-3 pr-3 py-2 border-l-2 border-border/60 bg-card/40 rounded-md space-y-4'
                  }
                >
                  {renderBarChart('PL', plDaily)}
                  {renderBarChart('SL', slDaily)}
                </div>
              )}
            </div>
            <div className="pt-2 space-y-3">
              <button
                type="button"
                onClick={() => setShowLists(prev => !prev)}
                className={
                  'w-full flex items-center justify-between px-2 py-1 rounded-md border border-border/60 bg-card text-foreground text-xs font-semibold'
                }
              >
                <span>Error Lists</span>
                <span className={'text-muted-foreground'}>
                  {showLists ? 'Collapse' : 'Expand'}
                </span>
              </button>
              {showLists && (
                <div
                  className={
                    'ml-2 pl-3 pr-3 py-2 border-l-2 border-border/60 bg-card/40 rounded-md space-y-4'
                  }
                >
                  {renderAngleList('PL', plList)}
                  {renderAngleList('SL', slList)}
                  {renderAllErrorsList(allList)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className={'px-3 py-2 bg-muted border-t border-border'}>
          <div className={'text-xs text-muted-foreground'}>
            Debug: E={errorData.E ?? 'null'}, E2={errorData.E2 ?? 'null'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorBlock; 