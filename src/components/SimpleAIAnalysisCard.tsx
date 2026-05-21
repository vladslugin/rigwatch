import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoveStore } from '../store/useStoveStore';
import type { HistoricalData } from '../analysis/historicalRules';
import { getSimpleAIPrompt, getFallbackSimpleAnalysis, type SimpleAnalysisResult, type SimpleAnalysisData } from '../analysis/simplePrompt';

// Session-level cache to preserve last analysis between modal close/open
const simpleAnalysisCache: Map<string, { result: SimpleAnalysisResult; timePeriod: 'daily'|'monthly'|'yearly'; selectedDate: string | null }> = new Map();

interface SimpleAIAnalysisCardProps {
  className?: string;
}

interface StatisticsData {
  anz_be?: number;
  anz_a?: number;
  anz_bt?: number;
  anz_s?: number;
  e?: number;
  erster?: number;
  h?: number;
  letzter?: number;
  o?: number;
  p?: number;
  p_ph1?: number;
  p_ph2?: number;
  p_ph3?: number;
  p_ph4?: number;
  t?: number;
  z_ph1?: number;
  z_ph2?: number;
  z_ph3?: number;
  z_ph4?: number;
  wt0?: number;
  wt1?: number;
  wt2?: number;
  wt3?: number;
  wt4?: number;
  wt5?: number;
  wt6?: number;
}

const SimpleAIAnalysisCard: React.FC<SimpleAIAnalysisCardProps> = ({ className = '' }) => {
  const { t, i18n } = useTranslation();
  const deviceId = useStoveStore(state => state.deviceId);
  const currentData = useStoveStore(state => state.currentData);

  const [result, setResult] = useState<SimpleAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timePeriod, setTimePeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [shouldAutoRun, setShouldAutoRun] = useState(false);

  // Normalize historical data for fuzzy analysis (same logic as HistoricalAIAnalysisCard)
  const normalizeHistoricalData = (data: HistoricalData): HistoricalData => {
    const { stats } = data;
    const burnEvents = stats.anz_be || 0;
    const burnDowns = (stats as any).anz_a || 0;
    
    if (burnEvents === 0) return data;
    
    const normalizedStats = { ...stats };
    
    // Normalize parameters by burn events
    const paramsToNormalizeByBe: (keyof typeof stats)[] = [
      'anz_bt', 'anz_s', 'e', 'h', 'o',
      'wt1', 'wt2', 'wt3', 'wt4', 'wt5', 'wt6'
    ];
    
    paramsToNormalizeByBe.forEach(param => {
      if (normalizedStats[param] && normalizedStats[param]! > 0) {
        normalizedStats[param] = Math.round((normalizedStats[param]! / burnEvents) * 100) / 100;
      }
    });

    // Apply z_ph normalization formulas
    if (normalizedStats.z_ph1 && normalizedStats.z_ph1 > 0 && burnEvents > 0) {
      normalizedStats.z_ph1 = Math.round((normalizedStats.z_ph1 / burnEvents) * 100) / 100;
    }

    if (normalizedStats.z_ph2 && normalizedStats.z_ph2 > 0 && burnDowns > 0) {
      normalizedStats.z_ph2 = Math.round((normalizedStats.z_ph2 / burnDowns) * 100) / 100;
    }

    if (normalizedStats.z_ph3 && normalizedStats.z_ph3 > 0 && burnDowns > 0) {
      normalizedStats.z_ph3 = Math.round((normalizedStats.z_ph3 / burnDowns) * 100) / 100;
    }

    const refuelEvents = burnDowns - burnEvents;
    if (normalizedStats.z_ph4 && normalizedStats.z_ph4 > 0 && refuelEvents > 0) {
      normalizedStats.z_ph4 = Math.round((normalizedStats.z_ph4 / refuelEvents) * 100) / 100;
    }
    
    return { ...data, stats: normalizedStats };
  };

  // Fetch available dates (same logic as HistoricalAIAnalysisCard)
  const fetchAvailableDates = async () => {
    if (!deviceId) return;

    setLoadingDates(true);
    
    try {
      const { ref, get } = await import('firebase/database');
      const firebase = await import('../lib/firebase');
      const realtimeDB = firebase.realtimeDB;

      if (!realtimeDB) {
        setLoadingDates(false);
        return;
      }

      let dates: string[] = [];

      if (timePeriod === 'yearly') {
        try {
          const yearlyRef = ref(realtimeDB, `statistik_jahr/${deviceId}`);
          const yearlySnap = await get(yearlyRef);
          if (yearlySnap.exists()) {
            const yearData = yearlySnap.val();
            dates = Object.keys(yearData)
              .filter(year => !isNaN(Number(year)) && Number(year) > 1970)
              .sort()
              .reverse();
          }
        } catch (error) {
          console.log('[SimpleAI] Failed to fetch yearly data:', error);
        }
      } else if (timePeriod === 'monthly') {
        try {
          const monthlyRef = ref(realtimeDB, `statistik_monat_tage/${deviceId}`);
          const monthlySnap = await get(monthlyRef);
          if (monthlySnap.exists()) {
            const yearData = monthlySnap.val();
            const monthSet = new Set<string>();
            
            Object.keys(yearData).forEach(year => {
              if (!isNaN(Number(year)) && Number(year) > 1970) {
                const monthData = yearData[year];
                if (monthData && typeof monthData === 'object') {
                  Object.keys(monthData).forEach(month => {
                    if (!isNaN(Number(month)) && Number(month) >= 1 && Number(month) <= 12) {
                      if (monthData[month]?.monat) {
                        monthSet.add(`${year}-${String(month).padStart(2, '0')}`);
                      }
                    }
                  });
                }
              }
            });
            
            dates = Array.from(monthSet).sort().reverse();
          }
        } catch (error) {
          console.log('[SimpleAI] Failed to fetch monthly data:', error);
        }
      } else {
        // Daily data logic (simplified)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        for (let i = 0; i < 12; i++) {
          const checkDate = new Date(currentYear, currentMonth - 1 - i, 1);
          const year = checkDate.getFullYear();
          const month = checkDate.getMonth() + 1;
          
          try {
            const monthRef = ref(realtimeDB, `statistik_monat_tage/${deviceId}/${year}/${month}`);
            const monthSnap = await get(monthRef);
            
            if (monthSnap.exists()) {
              const monthData = monthSnap.val();
              if (monthData && typeof monthData === 'object') {
                Object.keys(monthData).forEach(day => {
                  if (!isNaN(Number(day)) && Number(day) >= 1 && Number(day) <= 31 && day !== 'monat') {
                    const adjustedDate = new Date(year, month - 1, Number(day) + 1);
                    const adjustedYear = adjustedDate.getFullYear();
                    const adjustedMonth = String(adjustedDate.getMonth() + 1).padStart(2, '0');
                    const adjustedDay = String(adjustedDate.getDate()).padStart(2, '0');
                    dates.push(`${adjustedYear}-${adjustedMonth}-${adjustedDay}`);
                  }
                });
              }
            }
          } catch (error) {
            console.log(`[SimpleAI] Failed to fetch daily data for ${year}/${month}:`, error);
          }
        }
        
        dates = dates.sort().reverse();
      }

      setAvailableDates(dates);
      
      // Auto-select first available date if current selection is not available
      if (dates.length > 0 && !dates.includes(selectedDate)) {
        setSelectedDate(dates[0]);
      }
      
    } catch (error) {
      console.error('[SimpleAI] Failed to fetch available dates:', error);
    } finally {
      setLoadingDates(false);
    }
  };

  // Fetch historical data
  const fetchHistoricalData = async (): Promise<StatisticsData | null> => {
    if (!deviceId || !selectedDate) return null;

    try {
      const { ref, get } = await import('firebase/database');
      const firebase = await import('../lib/firebase');
      const realtimeDB = firebase.realtimeDB;

      if (!realtimeDB) return null;

      let dataPath: string = '';

      if (timePeriod === 'yearly') {
        dataPath = `statistik_jahr/${deviceId}/${selectedDate}`;
      } else if (timePeriod === 'monthly') {
        const [year, month] = selectedDate.split('-');
        dataPath = `statistik_monat_tage/${deviceId}/${year}/${Number(month)}/monat`;
      } else {
        const [year, month, day] = selectedDate.split('-');
        dataPath = `statistik_monat_tage/${deviceId}/${year}/${Number(month)}/${Number(day)}`;
      }
      
      const dataRef = ref(realtimeDB, dataPath);
      const dataSnap = await get(dataRef);
      
      if (dataSnap.exists()) {
        return dataSnap.val() as StatisticsData;
      } else {
        return null;
      }

    } catch (error) {
      console.error('[SimpleAI] Failed to fetch historical data:', error);
      return null;
    }
  };

  // AI Analysis function
  const analyzeWithAI = async (prompt: string): Promise<SimpleAnalysisResult> => {
    try {
      const firebase = await import('../lib/firebase');
      const app = firebase.default;
      if (!app) throw new Error('Firebase not initialized');
      
      const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
      
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
      
      const result = await model.generateContent(prompt);
      const response = (result as any).response;
      const text: string = typeof response?.text === 'function' ? response.text() : 
        (response?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(' ').trim() || '');
      
      // Extract JSON from response
      const extractJson = (s: string) => {
        try { return JSON.parse(s); } catch {}
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        if (start >= 0 && end > start) {
          const sub = s.slice(start, end + 1);
          try { return JSON.parse(sub); } catch {}
        }
        return null;
      };
      
      const parsed = extractJson(text) || {};
      
      // Normalize main_issues to string[]
      let issues: string[] = [];
      if (Array.isArray(parsed.main_issues)) {
        issues = parsed.main_issues.map((it: any) => typeof it === 'string' ? it : (it?.problem || '')).filter(Boolean);
      }

      const aiResult: SimpleAnalysisResult = {
        realtime_summary: parsed.realtime_summary || '',
        historical_summary: parsed.historical_summary || '',
        main_issues: issues,
        urgency: parsed.urgency || 'low',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        source: 'simple_ai',
        rawResponse: text
      };
      
      return aiResult;
      
    } catch (error) {
      console.error('[SimpleAI] AI analysis failed:', error);
      throw error;
    }
  };

  // Main analysis function
  const runAnalysis = async () => {
    if (!deviceId) return;

    setLoading(true);
    setError(null);

    try {
      // Prepare analysis data
      const analysisData: SimpleAnalysisData = {
        locale: i18n.language,
        deviceId
      };

      // Get realtime data
      if (currentData && Object.keys(currentData).length > 0) {
        analysisData.realtimeParams = currentData;
        analysisData.connectionStatus = 'connected'; // Simplified
      }

      // Get historical data (if available)
      let hasHistoricalData = false;
      if (availableDates.length > 0 && selectedDate) {
        const historicalStats = await fetchHistoricalData();
        if (historicalStats) {
          const historicalData: HistoricalData = {
            period: timePeriod,
            date: selectedDate,
            stats: historicalStats,
            deviceId
          };
          
          const normalizedData = normalizeHistoricalData(historicalData);
          analysisData.historicalStats = normalizedData.stats;
          analysisData.historicalPeriod = timePeriod;
          analysisData.historicalDate = selectedDate;
          hasHistoricalData = true;
        }
      }

      // If no data available at all, show error
      if (!analysisData.realtimeParams && !hasHistoricalData) {
        setError('Keine Daten für die Analyse verfügbar. Prüfen Sie die Verbindung zum Kaminofen.');
        return;
      }

      // Generate prompt and run AI analysis
      const prompt = getSimpleAIPrompt(analysisData);
      
      try {
        const aiResult = await analyzeWithAI(prompt);
        setResult(aiResult);
        if (deviceId) simpleAnalysisCache.set(deviceId, { result: aiResult, timePeriod, selectedDate: selectedDate || null });
      } catch (aiError: any) {
        // use fallback
        const fallbackResult = getFallbackSimpleAnalysis(analysisData);
        setResult(fallbackResult);
        if (deviceId) simpleAnalysisCache.set(deviceId, { result: fallbackResult, timePeriod, selectedDate: selectedDate || null });
      }

    } catch (error: any) {
      console.error('[SimpleAI] Analysis failed:', error);
      setError(error?.message || 'Analyse fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  // Initialize dates on mount and period change
  useEffect(() => {
    fetchAvailableDates();
  }, [deviceId, timePeriod]);

  // Load cached analysis on mount, else prepare auto-run
  useEffect(() => {
    if (!deviceId) return;
    const cached = simpleAnalysisCache.get(deviceId);
    if (cached) {
      setResult(cached.result);
      setTimePeriod(cached.timePeriod);
      if (cached.selectedDate) setSelectedDate(cached.selectedDate);
      setShouldAutoRun(false);
    } else {
      // Only auto-run once per session when there is no cache yet
      setShouldAutoRun(true);
    }
  }, [deviceId]);

  // Auto-run analysis exactly once per session (no rerun on reopen)
  useEffect(() => {
    if (!deviceId) return;
    if (!shouldAutoRun || loading || loadingDates) return;
    // If there are no historical dates we can run immediately; otherwise wait for selectedDate
    if (availableDates.length === 0 || selectedDate) {
      setShouldAutoRun(false);
      runAnalysis();
    }
  }, [shouldAutoRun, loading, loadingDates, availableDates.length, selectedDate, deviceId]);

  // Auto-select default date when dates are loaded
  useEffect(() => {
    if (availableDates.length > 0 && !selectedDate) {
      setSelectedDate(availableDates[0]); // Most recent date
    }
  }, [availableDates]);

  // Format date display helpers
  const formatMonthOption = (dateStr: string): string => {
    const [year, month] = dateStr.split('-');
    const monthNames = i18n.language === 'de' 
      ? ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
      : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month) - 1] || month;
    return `${monthName} ${year}`;
  };

  const formatDayOption = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className={`bg-blue-50/60 dark:bg-gray-800/80 border-2 border-blue-300/50 dark:border-blue-700/50 rounded-md p-5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <div>
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">
              {t('simpleAI.title', 'Kamin-Analyse')}
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t('simpleAI.subtitle', 'Schnelle Einschätzung Ihres Kamins')}
            </p>
          </div>
        </div>

        <button 
          onClick={runAnalysis} 
          disabled={loading || !deviceId} 
          className="inline-flex items-center px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed font-medium border-b-2 border-blue-800"
        >
          {loading ? (
            <>
              <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {t('loading', 'Analysiere...')}
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t('actions.analyze', 'Analysieren')}
            </>
          )}
        </button>
      </div>

      {/* Period Selection */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('simpleAI.period', 'Zeitraum')}:
          </span>
          <select
            value={timePeriod}
            onChange={(e) => setTimePeriod(e.target.value as 'daily' | 'monthly' | 'yearly')}
            className="text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            <option value="daily">{t('period.daily', 'Täglich')}</option>
            <option value="monthly">{t('period.monthly', 'Monatlich')}</option>
            <option value="yearly">{t('period.yearly', 'Jährlich')}</option>
          </select>
        </div>

        {availableDates.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('simpleAI.date', 'Datum')}:
            </span>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={loadingDates}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 min-w-[160px]"
            >
              {availableDates.map(date => (
                <option key={date} value={date}>
                  {timePeriod === 'yearly' ? date : 
                   timePeriod === 'monthly' ? formatMonthOption(date) : 
                   formatDayOption(date)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-3 mb-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium">{t('error.analysisError', 'Analyse fehlgeschlagen')}</span>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && !error && result && (
        <div className="space-y-4">
          {/* Summaries */}
          {(result.realtime_summary || result.historical_summary) && (
            <div className="space-y-3">
              {result.realtime_summary && (
                <div className="bg-green-50 dark:bg-green-900/20 border-l-2 border-green-500 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-sm font-medium text-green-900 dark:text-green-100">
                      {t('simpleAI.realtimeStatus', 'Aktueller Zustand')}
                    </span>
                  </div>
                  <p className="text-sm text-green-800 dark:text-green-200">{result.realtime_summary}</p>
                </div>
              )}

              {result.historical_summary && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {t('simpleAI.historicalStatus', 'Verlauf')}
                    </span>
                  </div>
                  <p className="text-sm text-blue-800 dark:text-blue-200">{result.historical_summary}</p>
                </div>
              )}
            </div>
          )}

          {/* Main Issues */}
          {result.main_issues && result.main_issues.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {t('simpleAI.problems', 'Gefundene Probleme')}
              </h5>
              <div className="space-y-3">
                {result.main_issues.map((issue, i) => (
                  <div key={i} className="bg-orange-50 dark:bg-orange-900/20 border-l-2 border-orange-500 p-3">
                    <p className="text-sm font-medium text-orange-900 dark:text-orange-100 mb-0">{issue}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Urgency Indicator removed per request */}

          {/* No Issues Found */}
          {(!result.main_issues || result.main_issues.length === 0) && result.urgency === 'low' && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-green-900 dark:text-green-100">
                  {t('simpleAI.allGood', 'Ihr Kamin funktioniert gut!')}
                </span>
              </div>
              <p className="text-xs text-green-800 dark:text-green-200 mt-1">
                {t('simpleAI.noIssues', 'Es wurden keine kritischen Probleme gefunden.')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* No historical data notice */}
      {availableDates.length === 0 && !loadingDates && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-medium">
              {t('simpleAI.noHistoricalData', 'Keine Verlaufsdaten verfügbar')}
            </span>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            {t('simpleAI.onlyRealtimeAnalysis', 'Die Analyse basiert nur auf aktuellen Daten.')}
          </p>
        </div>
      )}
    </div>
  );
};

export default SimpleAIAnalysisCard;
