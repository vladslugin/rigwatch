import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateWithUserTimezone } from '../utils/timezone';
import { useRigStore } from '../store/useRigStore';
import { useAuth } from '../hooks/useAuth';
import type { AIResult } from '../services/aiClient';
import { analyzeRigWithFirebase } from '../services/aiFirebaseClient';
import { normalize } from '../analysis/normalize';
import { runRules } from '../analysis/rules';

interface AIAnalysisCardProps {
  className?: string;
}

const AIAnalysisCard: React.FC<AIAnalysisCardProps> = ({ className = '' }) => {
  const { t, i18n } = useTranslation();
  const deviceId = useRigStore(state => state.deviceId);
  const { user } = useAuth();
  const deviceConfig = useRigStore(state => state.deviceConfig);
  const currentData = useRigStore(state => state.currentData);
  const deviceMetadata = useRigStore(state => state.deviceMetadata);
  const connectionStatus = useRigStore(state => state.connectionStatus);

  const [result, setResult] = useState<AIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [analysisStep, setAnalysisStep] = useState<'idle' | 'ping' | 'analyzing'>('idle');
  const [lastAnalysis, setLastAnalysis] = useState<number>(0);
  const [pingResult, setPingResult] = useState<{ success: boolean; rtt?: number } | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('');
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [analysisSource, setAnalysisSource] = useState<'ai' | 'rules'>('ai');
  const [currentControllerSerial, setCurrentControllerSerial] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [editingPrompt, setEditingPrompt] = useState(false);

  // Persist/restore analysis across modal close/open
  const storageKey = deviceId ? `aiAnalysis:${deviceId}` : null;
  const saveAnalysis = (data: { result: AIResult; lastPrompt: string; lastResponse: string; lastAnalysis: number }) => {
    try {
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {}
  };
  const loadAnalysis = (): { result: AIResult; lastPrompt: string; lastResponse: string; lastAnalysis: number } | null => {
    try {
      if (!storageKey) return null;
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const uiContext = useMemo(() => ({
    status: (connectionStatus === 'online' ? 'online' : connectionStatus === 'offline' ? 'offline' : 'unknown') as 'online'|'offline'|'unknown',
    lastSeen: deviceMetadata.tsfc ? new Date((deviceMetadata.tsfc as number) * 1000).toISOString() : undefined,
    locale: (i18n.language === 'de' ? 'de' : 'en') as 'de' | 'en'
  }), [connectionStatus, deviceMetadata, deviceId, i18n.language, currentControllerSerial]);

  // Memoize sorted actions to prevent reordering on every render
  const sortedActions = useMemo(() => {
    if (!result?.actions) return [];
    return [...result.actions].sort((a, b) => {
      // Stable sort: first by type, then maintain original order
      if (a.type !== b.type) {
        return a.type === 'self' ? -1 : 1;
      }
      return 0;
    });
  }, [result?.actions]);

  const getDefaultAIPrompt = (): string => {
    return `You are an experienced rig diagnostic expert analyzing real-time sensor data.

=== REAL-TIME SENSOR VARIABLES ===
T: Current combustion temperature (°C)
TQUER: Average temperature over recent period (°C)
TC: Controller temperature (°C)
F: Current burn phase (0=off, 1=ignition, 2=main burn, 3=burn down)
N: Refuel need indicator (0=no, 1=yes)
O2: Oxygen level (%)
MLANG: Temperature rise rate (°C/min)
PL: Primary air opening (%)
SL: Secondary air opening (%)
error_flag: System error detected (true/false)
Connection: Device online status
Firmware update: whether an update is available (true/false)

Connection:
- Status: {{CONNECTION_STATUS}}

Real-Time Sensor Data:
{{NORMALIZED_DATA}}

Connection Test Results:
{{PING_RESULTS}}

Provide a comprehensive analysis in {{LOCALE}} focusing on:
1. Current rig operation status and performance
2. Any immediate safety concerns or issues
3. Sensor readings analysis (temperature, oxygen, performance)
4. Error codes interpretation and recommendations
5. Operational efficiency assessment
6. Burn phase analysis and air control optimization

Analyze specifically:
- Temperature readings: T (current), TQUER (average), TC (controller)
- Burn control: F (phase), N (refuel need), PL/SL (air settings)
- Efficiency: O2 (oxygen), MLANG (temperature rise)
- System status: error_flag, Connection, Firmware update

Provide your analysis in STRICT JSON format:
{"summary": "Brief analysis summary", "urgency": "low|medium|high", "confidence": 0.0-1.0,
 "hypotheses": [{"issue":"description","probability":0.0-1.0,"why":["evidence"]}],
 "actions": [{"action":"specific action","type":"self|support","eta_min":number|null}],
 "used_signals": ["list of analyzed parameters"] }`;
  };

  // Sanitize objects before sending to AI: remove identifiers (names, serials, IPs, etc.)
  const sanitize = (obj: any) => {
    try {
      const copy: any = { ...obj };
      const removeKeys = ['rigname', 'rig', 'vers', 'serial', 'csnr', 'ip', 'mac', 'uuid', 'deviceId', 'model', 'modell', 'name'];
      removeKeys.forEach(k => { if (k in copy) delete copy[k]; });
      if ('a' in copy) delete copy['a'];
      return copy;
    } catch { return obj; }
  };

  const buildAIPrompt = (): string => {
    const currentPrompt = customPrompt || getDefaultAIPrompt();
    const normalizedDataJson = JSON.stringify({
      app: sanitize(deviceMetadata),
      core: sanitize({ ...deviceConfig, ...currentData }),
      ui: uiContext
    }, null, 2);

    return currentPrompt
      .replace('{{CONNECTION_STATUS}}', uiContext.status)
      .replace('{{NORMALIZED_DATA}}', normalizedDataJson)
      .replace('{{PING_RESULTS}}', pingResult ? JSON.stringify(pingResult, null, 2) : 'No ping test performed')
      .replace('{{LOCALE}}', i18n.language === 'de' ? 'German' : 'English');
  };

  // Ping test similar to RigInfoModal
  const testConnection = async (): Promise<{ success: boolean; rtt?: number }> => {
    if (!deviceId) return { success: false };

    try {
      const { ref, get, set } = await import('firebase/database');
      const { realtimeDB } = await import('../lib/firebase');

      if (!realtimeDB) return { success: false };

      const konstantRef = ref(realtimeDB, `konstant/${deviceId}/p`);
      const konstantAppRef = ref(realtimeDB, `konstant_app/${deviceId}/c`);

      // Get initial value
      const initialSnapshot = await get(konstantAppRef);
      const initialCValue = initialSnapshot.val() || 0;

      // Send ping
      const pingValue = Math.floor(Math.random() * 1000) + 1000;
      const startTime = Date.now();
      await set(konstantRef, pingValue);

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check response
      const finalSnapshot = await get(konstantAppRef);
      const finalCValue = finalSnapshot.val() || 0;
      const rtt = Date.now() - startTime;

      return {
        success: finalCValue !== initialCValue,
        rtt: finalCValue !== initialCValue ? rtt : undefined
      };
    } catch (error) {
      console.error('[AIAnalysis] Ping test failed:', error);
      return { success: false };
    }
  };

  const run = async (regenerate?: boolean) => {
    if (!deviceId) return;

    // Prevent spam clicks - minimum 10 seconds between analyses
    const now = Date.now();
    if (!regenerate && now - lastAnalysis < 10000) {
      return;
    }

    setLoading(true);
    setError(null);
    setPingResult(null);

    let builtPrompt: string | null = null;
    try {
      // Step 1: Test connection
      setAnalysisStep('ping');
      const pingRes = await testConnection();
      setPingResult(pingRes);

      // Add ping info to context
      const enhancedUiContext = {
        ...uiContext,
        pingResult: pingRes.success,
        pingRtt: pingRes.rtt,
        connectionTest: 'performed'
      };

      // Step 2: Analyze
      setAnalysisStep('analyzing');

      // Build prompt - use custom prompt if available, otherwise use default
      let prompt: string;
      if (customPrompt) {
        prompt = buildAIPrompt();
      } else {
        // Store prompt for debugging
        const { buildPrompt } = await import('../analysis/prompt');
        const { normalize } = await import('../analysis/normalize');
        const normalized = normalize({
          app: sanitize(deviceMetadata) as any,
          core: sanitize({ ...(deviceConfig as any), ...(currentData as any) }) as any,
          ui: enhancedUiContext
        });
        prompt = buildPrompt(normalized, {
          status: enhancedUiContext.status,
          pingOkRatio: (normalized.features as any).pingOkRatio,
        }, { locale: enhancedUiContext.locale || 'en' });
      }
      builtPrompt = prompt;
      setLastPrompt(prompt);

      let res: any;
      if (analysisSource === 'rules') {
        // Force rules-only analysis
        const normalized = normalize({
          app: sanitize(deviceMetadata) as any,
          core: sanitize({ ...(deviceConfig as any), ...(currentData as any) }) as any,
          ui: enhancedUiContext
        });
        const rules = runRules(normalized.features as any, normalized.signals, normalized.params, enhancedUiContext.locale || 'en');
        res = { ...rules, source: 'rules' };
      } else {
        // Try AI first, fallback to rules
        res = await analyzeRigWithFirebase(
          { deviceId: undefined as any, app: sanitize(deviceMetadata) as any, core: sanitize({ ...(deviceConfig as any), ...(currentData as any) }) as any, ui: enhancedUiContext },
          { regenerate, model: 'gemini-2.5-flash', locale: enhancedUiContext.locale || 'en' }
        );
      }

      setResult(res);

      // Save the actual AI response text, not the parsed JSON
      const actualResponse = (res as any).rawResponse || JSON.stringify(res, null, 2);
      setLastResponse(actualResponse);
      setLastAnalysis(now);

      // Persist
      saveAnalysis({ result: res, lastPrompt: builtPrompt || '', lastResponse: actualResponse, lastAnalysis: now });

    } catch (e: any) {
      console.warn('AI analysis failed, using rules fallback:', e?.message);
      // Keep the original prompt that was sent to AI, but mark response as fallback

      // Fallback: rules-only (free, offline)
      try {
        const normalized = normalize({
          app: sanitize(deviceMetadata) as any,
          core: sanitize({ ...(deviceConfig as any), ...(currentData as any) }) as any,
          ui: {
            ...(uiContext as any),
            pingResult: typeof pingResult?.success === 'boolean' ? pingResult.success : undefined,
            pingRtt: pingResult?.rtt,
            connectionTest: 'performed'
          } as any
        });
        const rules = runRules(normalized.features as any, normalized.signals, normalized.params, uiContext.locale || 'en');
        setResult({ ...rules, source: 'rules' } as AIResult);

        // Preserve already built prompt to avoid showing fallback message initially
        setLastPrompt(prev => prev || builtPrompt || `AI Analysis Failed - Using Rules Fallback\nError: ${e?.message}`);

        const fallbackResponse = `AI Analysis Failed: ${e?.message}\n\nFalling back to rules-based analysis:\n\n${JSON.stringify(rules, null, 2)}`;
        setLastResponse(fallbackResponse);

        setLastAnalysis(now);

        // Persist fallback result as well
        saveAnalysis({ result: { ...(rules as any), source: 'rules' }, lastPrompt: builtPrompt || lastPrompt, lastResponse: `AI Analysis Failed: ${e?.message}`, lastAnalysis: now });
      } catch (e2: any) {
        setError(e2?.message || e?.message || 'Failed to analyze');
        console.error('🚨 Rules fallback also failed:', e2);
      }
    } finally {
      setLoading(false);
      setAnalysisStep('idle');
    }
  };

  // Load current controller information from Firebase (kept local, not sent to AI)
  useEffect(() => {
    let isMounted = true;
    const loadCurrentController = async () => {
      if (!deviceId) return;

      try {
        const { ref, get } = await import('firebase/database');
        const { realtimeDB } = await import('../lib/firebase');

        if (!realtimeDB) return;

        const rigSerial = deviceId.substring(0, 7);
        const controllerRef = ref(realtimeDB, `controllertausch/fepaliste/${rigSerial}/csnr_akt`);
        const controllerSnapshot = await get(controllerRef);
        const rawCurrentController = controllerSnapshot.val();
        const currentController = rawCurrentController ? String(rawCurrentController).trim() : null;

        if (!isMounted) return;
        setCurrentControllerSerial(currentController);
      } catch (error) {
        console.error('[AIAnalysisCard] Failed to load current controller:', error);
      }
    };

    loadCurrentController();
    return () => { isMounted = false; };
  }, [deviceId]);

  useEffect(() => {
    // Do not auto-analyze on modal open; restore last analysis if available
    if (deviceId && lastAnalysis === 0) {
      const cached = loadAnalysis();
      if (cached) {
        setResult(cached.result);
        setLastPrompt(cached.lastPrompt);
        setLastResponse(cached.lastResponse);
        setLastAnalysis(cached.lastAnalysis);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const urgencyColor = (u?: AIResult['urgency']) => u === 'high' ? 'bg-destructive' : u === 'medium' ? 'bg-warning' : 'bg-success';

  const generateReport = () => {
    if (!result) return '';

    const timestamp = formatDateWithUserTimezone(new Date(), 'de-DE');
    const report = [
      `=== AI Rig Analysis Report ===`,
      `Timestamp: ${timestamp}`,
      ``,
      `SUMMARY: ${result.summary}`,
      ...(user?.role === 'developer' ? [`PRIORITY: ${result.urgency.toUpperCase()}`] : []),
      ...(user?.role === 'developer' ? [`CONFIDENCE: ${Math.round((result.confidence || 0) * 100)}%`] : []),
      `SOURCE: ${result.source}`,
      ``,
      `ISSUES FOUND:`,
      ...result.hypotheses.map((h, i) =>
        `${i + 1}. ${h.issue} (${Math.round((h.probability || 0) * 100)}%)\n   Evidence: ${h.why?.join(', ') || 'None'}`
      ),
      ``,
      `RECOMMENDED ACTIONS:`,
      ...result.actions.map((a, i) =>
        `${i + 1}. [${a.type.toUpperCase()}] ${a.action}${a.eta_min ? ` (~${a.eta_min} min)` : ''}`
      ),
      ``,
      pingResult && `CONNECTION TEST: ${pingResult.success ? 'ONLINE' : 'OFFLINE'}${pingResult.rtt ? ` (${pingResult.rtt}ms)` : ''}`,
      ``,
      `Note: AI analysis may not capture all issues. Verify important conclusions.`
    ].filter(Boolean).join('\n');

    return report;
  };

  const copySummary = () => {
    const report = generateReport();
    try {
      navigator.clipboard?.writeText(report);
    } catch (e) {
      console.error('Failed to copy report:', e);
    }
  };

  return (
    <div className={`bg-info/10 border-2 border-info/40 rounded-md p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <div>
            <h4 className="text-base font-semibold text-foreground">{t('ai.title', 'Realtime Analysis')}</h4>
            <div className="flex items-center gap-2 mt-1">
              {result && (
                <span className="text-xs px-2 py-0.5 rounded bg-card text-info border border-border">
                  {t('ai.source', 'Source')}: {result.source}
                </span>
              )}
              {isCollapsed && result && (
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  result.urgency === 'high' ? 'bg-destructive/10 text-destructive border-destructive/40' :
                  result.urgency === 'medium' ? 'bg-warning/10 text-warning border-warning/40' :
                  'bg-success/10 text-success border-success/40'
                }`}>
                  {result.urgency.toUpperCase()}{user?.role === 'developer' ? ` (${Math.round((result.confidence || 0) * 100)}%)` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Analysis source selector */}
          <div className="flex items-center gap-1 mr-2">
            <span className="text-xs text-muted-foreground">Source:</span>
            <select
              value={analysisSource}
              onChange={(e) => setAnalysisSource(e.target.value as 'ai' | 'rules')}
              className="text-xs px-2 py-1 border border-border bg-card text-muted-foreground"
            >
              <option value="ai">AI</option>
              <option value="rules">Rules</option>
            </select>
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 hover:bg-info/20"
            title={isCollapsed ? t('actions.expand', 'Expand') : t('actions.collapse', 'Collapse')}
          >
            <svg className={`w-4 h-4 text-info transition-transform ${
              isCollapsed ? 'rotate-180' : ''
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Info button */}
          <button
            onClick={() => setShowInfoModal(true)}
            className="p-2 hover:bg-muted"
            title="Information about AI analysis"
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>


          <button
            onClick={() => run(true)}
            disabled={loading || !deviceId}
            className="inline-flex items-center px-3 py-2 text-xs bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed font-medium border-b-2 border-primary/80"
          >
            {loading ? (
              <>
                <svg className="w-3 h-3 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t('loading', 'Loading...')}
              </>
            ) : (
              <>
                <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('actions.regenerate', 'Regenerate')}
              </>
            )}
          </button>
          <button
            onClick={() => setShowReportModal(true)}
            disabled={!result}
            className="inline-flex items-center px-3 py-2 text-xs rounded-sm bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t('rigInfo.copyReport', 'Bericht kopieren')}
          </button>
          {result && (
            <>
              <button
                onClick={() => {
                  setShowPromptModal(true);
                }}
                disabled={!lastPrompt}
                className="px-3 py-1.5 text-xs rounded-sm bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 disabled:cursor-not-allowed font-medium inline-flex items-center justify-center gap-1.5"
                title={lastPrompt ? 'View AI prompt' : 'No prompt available'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Prompt
              </button>
              <button
                onClick={() => {
                  setShowResponseModal(true);
                }}
                disabled={!lastResponse}
                className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 disabled:cursor-not-allowed font-medium inline-flex items-center justify-center border border-border gap-1.5"
                title={lastResponse ? 'View AI response' : 'No response available'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Response
              </button>
            </>
          )}
        </div>
      </div>

      {!isCollapsed && loading && (
        <div className="py-6">
          <div className="flex flex-col items-center gap-4">
            {/* Beautiful animated analysis steps */}
            <div className="flex items-center gap-4">
              {/* Step 1: Ping */}
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 flex items-center justify-center ${
                  analysisStep === 'ping' ? 'bg-info/20' :
                  pingResult !== null ? 'bg-success/20' : 'bg-muted'
                }`}>
                  {analysisStep === 'ping' ? (
                    <svg className="w-4 h-4 text-info animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                    </svg>
                  ) : pingResult !== null ? (
                    <svg className={`w-4 h-4 ${pingResult.success ? 'text-success' : 'text-destructive'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={pingResult.success ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                  ) : (
                    <span className="w-2 h-2 bg-muted-foreground"></span>
                  )}
                </div>
                <span className={`text-sm ${
                  analysisStep === 'ping' ? 'text-info font-medium' :
                  pingResult !== null ? (pingResult.success ? 'text-success' : 'text-destructive') :
                  'text-muted-foreground'
                }`}>
                  Connection Test
                  {pingResult?.rtt && ` (${pingResult.rtt}ms)`}
                </span>
              </div>

              {/* Arrow */}
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>

              {/* Step 2: Analysis */}
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 flex items-center justify-center ${
                  analysisStep === 'analyzing' ? 'bg-primary/20' :
                  analysisStep === 'idle' && result ? 'bg-success/20' : 'bg-muted'
                }`}>
                  {analysisStep === 'analyzing' ? (
                    <svg className="w-4 h-4 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : result ? (
                    <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  ) : (
                    <span className="w-2 h-2 bg-muted-foreground"></span>
                  )}
                </div>
                <span className={`text-sm ${
                  analysisStep === 'analyzing' ? 'text-primary font-medium' :
                  result ? 'text-success' : 'text-muted-foreground'
                }`}>
                  AI Analysis
                </span>
              </div>
            </div>

            {/* Current step description */}
            <div className="text-center">
              <div className="text-sm font-medium text-foreground">
                {analysisStep === 'ping' && 'Testing rig connection...'}
                {analysisStep === 'analyzing' && 'Analyzing rig data with AI...'}
              </div>
              {analysisStep === 'analyzing' && (
                <div className="text-xs text-muted-foreground mt-1">
                  This may take a few seconds
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-xs">
              <div className="w-full bg-muted h-2">
                <div className={`h-2 bg-primary transition-all duration-1000 ${
                  analysisStep === 'ping' ? 'w-1/3' :
                  analysisStep === 'analyzing' ? 'w-2/3' :
                  result ? 'w-full' : 'w-0'
                }`} />
              </div>
            </div>
          </div>
        </div>
      )}
      {!isCollapsed && error && (
        <div className="bg-destructive/10 border-l-4 border-destructive p-3">
          <div className="flex items-center gap-2 text-destructive">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium">Analysis Failed</span>
          </div>
          <p className="text-xs text-destructive mt-1">{error}</p>
        </div>
      )}
      {!isCollapsed && !loading && !error && result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-card p-3 border border-border">
            <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-3">
            {user?.role === 'developer' && (
              <div className="flex items-center gap-2">
                <span className={`text-xs text-primary-foreground px-3 py-1 font-medium ${urgencyColor(result.urgency)}`}>
                  {result.urgency.toUpperCase()} PRIORITY
                </span>
              </div>
            )}
            {user?.role === 'developer' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">Confidence:</span>
                <div className="w-20 h-2 bg-muted">
                  <div
                    className="h-2 bg-primary"
                    style={{ width: `${Math.round((result.confidence || 0) * 100)}%` }}
                  />
                </div>
                <span className="font-semibold">{Math.round((result.confidence || 0) * 100)}%</span>
              </div>
            )}
          </div>

          {/* Hypotheses */}
          {result.hypotheses && result.hypotheses.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                {t('ai.possibleIssues', 'Possible Issues')}
              </h5>
              <div className="space-y-2">
                {result.hypotheses.slice(0, 3).map((h, i) => (
                  <div key={i} className="bg-card p-3 border-l-2 border-warning">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{h.issue}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-muted">
                          <div
                            className="h-2 bg-warning"
                            style={{ width: `${Math.round((h.probability || 0) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {Math.round((h.probability || 0) * 100)}%
                        </span>
                      </div>
                    </div>
                    {h.why && h.why.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Evidence:</span> {h.why.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {result.actions && result.actions.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Recommended Actions
              </h5>
              <div className="space-y-2">
                {sortedActions.map((a, i) => (
                  <div key={`${a.type}-${a.action.substring(0, 20)}-${i}`} className="bg-card p-3 border-l-2 border-success">
                    <div className="flex items-start gap-3">
                      <span className={`text-xs px-2 py-1 font-medium border ${
                        a.type === 'self'
                          ? 'bg-success/10 text-success border-success/40'
                          : 'bg-warning/10 text-warning border-warning/40'
                      }`}>
                        {a.type === 'self' ? 'Self-Service' : 'Contact Support'}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-foreground">{a.action}</p>
                        {typeof a.eta_min === 'number' && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Estimated time: ~{a.eta_min} minutes
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="bg-warning/10 border-l-4 border-warning p-3">
            <div className="flex items-center gap-2 text-warning">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-medium">Important:</span>
            </div>
            <p className="text-xs text-warning mt-1">
              AI analysis is based on available data and may not capture all issues. Always verify important conclusions and consult technical documentation when in doubt.
            </p>
          </div>
        </div>
      )}
      {/* Modal Windows */}
      {/* Prompt Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowPromptModal(false)}>
          <div className="bg-card rounded-md p-6 max-w-4xl max-h-[80vh] overflow-auto m-4 border-2 border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">AI Prompt</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingPrompt(!editingPrompt)}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  {editingPrompt ? 'Save' : 'Edit'}
                </button>
                <button
                  onClick={() => setShowPromptModal(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="bg-muted rounded-lg p-4">
              {editingPrompt ? (
                <textarea
                  value={customPrompt || getDefaultAIPrompt()}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="w-full h-96 text-xs text-foreground bg-card border border-border rounded p-2 font-mono leading-relaxed resize-none"
                  placeholder="Enter your custom prompt here..."
                />
              ) : (
                <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{lastPrompt}</pre>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {editingPrompt && (
                <button
                  onClick={() => {
                    setCustomPrompt('');
                    setEditingPrompt(false);
                  }}
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Reset to Default
                </button>
              )}
              <button
                onClick={() => navigator.clipboard?.writeText(lastPrompt)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Copy Prompt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Response Modal */}
      {showResponseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowResponseModal(false)}>
          <div className="bg-card rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">AI Response</h3>
              <button onClick={() => setShowResponseModal(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{lastResponse}</pre>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => navigator.clipboard?.writeText(lastResponse)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Copy Response
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowInfoModal(false)}>
          <div className="bg-card rounded-lg p-6 max-w-2xl max-h-[80vh] overflow-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">AI Analysis Information</h3>
              <button onClick={() => setShowInfoModal(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4 text-sm text-muted-foreground">
              <div>
                <h4 className="font-semibold text-foreground mb-2">Priority Levels:</h4>
                <ul className="space-y-1 ml-4">
                  <li><span className="font-medium text-destructive">HIGH:</span> Critical issues requiring immediate attention</li>
                  <li><span className="font-medium text-warning">MEDIUM:</span> Important issues to address soon</li>
                  <li><span className="font-medium text-success">LOW:</span> Minor issues or maintenance recommendations</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-2">Confidence:</h4>
                <p>Shows how certain the AI is about its analysis (0-100%). Higher confidence means more reliable diagnosis.</p>
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-2">Data Sources:</h4>
                <ul className="space-y-1 ml-4">
                  <li><span className="font-medium">Connection Test:</span> Real-time ping test to verify rig connectivity</li>
                  <li><span className="font-medium">Sensor Data:</span> Temperature, oxygen, performance parameters</li>
                  <li><span className="font-medium">Error Codes:</span> Specific error messages from rig diagnostics</li>
                  <li><span className="font-medium">Historical Data:</span> Recent operation patterns and trends</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-2">Action Types:</h4>
                <ul className="space-y-1 ml-4">
                  <li><span className="font-medium text-success">Self-Service:</span> Actions you can perform yourself</li>
                  <li><span className="font-medium text-warning">Contact Support:</span> Requires technical assistance</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowReportModal(false)}>
          <div className="bg-card rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">AI Analysis Report</h3>
              <button onClick={() => setShowReportModal(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="bg-muted rounded-lg p-4 mb-4">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                {generateReport()}
              </pre>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  copySummary();
                  setShowReportModal(false);
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Copy Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIAnalysisCard;

