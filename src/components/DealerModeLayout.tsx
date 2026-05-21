import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, ref } from 'firebase/database';

import { useDeviceList, useFirebaseConnection, useStoveModel } from '../hooks/useFirebase';
import { useStoveStore } from '../store/useStoveStore';
import { useAuth } from '../hooks/useAuth';
import { realtimeDB } from '../lib/firebase';
import { askDealerAssistant } from '../services/dealerAiClient';
import { useKundenTickets } from '../hooks/useKundenTickets';
import { usePingTest } from '../hooks/usePingTest';
import { useBrennbewertung } from '../hooks/useBrennbewertung';
import { useBrennbewertungKnowledge } from '../hooks/useBrennbewertungKnowledge';
import { useDealerPromptSettings } from '../hooks/useDealerPromptSettings';
import { resolveBySeriennr, extractSeriennr } from '../utils/seriennrResolver';
import { decodeStoveErrors } from '../utils/decodeStoveErrors';

import { DealerHeaderCard } from './dealer/DealerHeaderCard';
import { BrennbewertungCard } from './dealer/BrennbewertungCard';
import { OfenFunktionCard } from './dealer/OfenFunktionCard';
import { ProblemInputCard } from './dealer/ProblemInputCard';
import { DevCsPanel } from './dealer/DevCsPanel';
import { BrennbewertungKnowledgeEditor } from './dealer/BrennbewertungKnowledgeEditor';
import { DealerPromptEditor } from './dealer/DealerPromptEditor';

import type { KundenTicketStovePassport } from '../types/kundenTickets';

interface FavoriteDevice {
  id: string;
  lastUsed: number;
}

const FAVORITES_STORAGE_KEY = 'firebaseIdFavorites_v2';

const pickStoveModelImageUrl = (modelData: unknown): string | null => {
  if (!modelData || typeof modelData !== 'object') return null;
  const d = modelData as Record<string, unknown>;
  const raw = d.img_url ?? d.image_url ?? d.imageUrl;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

const DealerModeLayout: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Dealer mode is permanently dark — toggling on a sales-floor iPad confused
  // dealers and the design only got QA on the dark palette. We force the
  // `dark` class on mount and restore the user's previous mode on unmount so
  // the standard mode keeps respecting their saved preference.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (!wasDark) root.classList.add('dark');
    return () => {
      if (!wasDark) root.classList.remove('dark');
    };
  }, []);

  // Firebase + store wiring (unchanged from v1).
  const { connect } = useFirebaseConnection();
  const { getAllDeviceIds } = useDeviceList();
  const { getStoveModelName, getStoveModelData } = useStoveModel();
  const getStoveModelNameRef = useRef(getStoveModelName);
  const getStoveModelDataRef = useRef(getStoveModelData);
  useEffect(() => {
    getStoveModelNameRef.current = getStoveModelName;
    getStoveModelDataRef.current = getStoveModelData;
  }, [getStoveModelName, getStoveModelData]);

  const { createKundenTicket, isLoading: isSendingTicket } = useKundenTickets();

  const deviceId = useStoveStore((state) => state.deviceId);
  const connectionStatus = useStoveStore((state) => state.connectionStatus);
  const deviceMetadata = useStoveStore((state) => state.deviceMetadata);
  const deviceExistence = useStoveStore((state) => state.deviceExistence);
  const errorData = useStoveStore((state) => state.errorData);

  // Brennbewertung wiring (commit 1).
  const ping = usePingTest(deviceId);
  const brennbewertung = useBrennbewertung(deviceId);
  const { knowledge } = useBrennbewertungKnowledge();
  const { settings: promptSettings } = useDealerPromptSettings();

  // Dealer-only role gating.
  const isStaff = useMemo(() => {
    const role = String(user?.role || '').toLowerCase();
    return role === 'admin' || role === 'developer' || role === 'super_admin';
  }, [user?.role]);
  const canSeeDevPanel = useMemo(() => {
    const role = String(user?.role || '').toLowerCase();
    return role === 'developer' || role === 'super_admin';
  }, [user?.role]);
  // Prompt editor: only developer / super_admin can save changes. Other
  // roles see the button as disabled (so they know the feature exists).
  const canEditPrompt = useMemo(() => {
    const role = String(user?.role || '').toLowerCase();
    return role === 'developer' || role === 'super_admin';
  }, [user?.role]);

  // Search / connect form state.
  const [inputId, setInputId] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [favoritesRefresh, setFavoritesRefresh] = useState(0);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [allDeviceIds, setAllDeviceIds] = useState<string[]>([]);
  const [allDeviceComments, setAllDeviceComments] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Loaded model info — only public fields, no serials beyond the dealer-visible Seriennr.
  const [modelInfo, setModelInfo] = useState<{ name: string | null; imageUrl: string | null }>({
    name: null,
    imageUrl: null,
  });

  // Cards visibility / mount animation.
  const [renderCards, setRenderCards] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);

  // Customer problem + AI answer.
  const [customerProblem, setCustomerProblem] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Escalation state.
  const [isEscalating, setIsEscalating] = useState(false);
  const [escalationFeedback, setEscalationFeedback] = useState<'success' | 'error' | null>(null);

  // Dev panel state.
  const [isDevPanelOpen, setIsDevPanelOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);

  const isConnected = connectionStatus === 'online' && !!deviceId;
  const shouldShowCards = isConnected;

  // Track auto-connect attempts so we don't loop on the URL ?id= parameter.
  const autoConnectAttemptedRef = useRef(false);

  // Decoded controller errors — empty when stove is healthy.
  const decodedErrors = useMemo(
    () => decodeStoveErrors({ ecode: errorData?.ecode, ecode2: errorData?.ecode2 }),
    [errorData?.ecode, errorData?.ecode2],
  );

  // ─── Favorites ──────────────────────────────────────────────────────────
  const favorites = useMemo<FavoriteDevice[]>(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
    // favoritesRefresh is intentionally referenced so the memo recomputes on save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesRefresh]);

  const recentIds = useMemo<FavoriteDevice[]>(
    () =>
      [...favorites]
        .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
        .slice(0, 10),
    [favorites],
  );

  const saveFavorites = useCallback((next: FavoriteDevice[]) => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      setFavoritesRefresh((prev) => prev + 1);
    } catch (error) {
      console.error('[DealerMode] Failed to save favorites:', error);
    }
  }, []);

  const addToFavorites = useCallback(
    (id: string) => {
      if (!id.trim()) return;
      const entry: FavoriteDevice = { id: id.trim(), lastUsed: Date.now() };
      const updated = favorites.filter((f) => f.id !== entry.id);
      updated.unshift(entry);
      saveFavorites(updated.slice(0, 10));
    },
    [favorites, saveFavorites],
  );

  const removeFromFavorites = useCallback(
    (id: string) => saveFavorites(favorites.filter((f) => f.id !== id)),
    [favorites, saveFavorites],
  );

  // ─── Device search ──────────────────────────────────────────────────────
  const loadAllDevices = useCallback(async () => {
    if (allDeviceIds.length > 0 && Object.keys(allDeviceComments).length > 0) return;
    setIsLoadingDevices(true);
    try {
      const ids = await getAllDeviceIds();
      setAllDeviceIds(ids);
      if (realtimeDB) {
        const snapshot = await get(ref(realtimeDB, 'konstant_app'));
        const commentsMap: Record<string, string> = {};
        if (snapshot.exists()) {
          snapshot.forEach((child) => {
            const id = child.key;
            const val = child.val() as { comment?: unknown } | null;
            if (id) commentsMap[id] = typeof val?.comment === 'string' ? val.comment : '';
          });
        }
        setAllDeviceComments(commentsMap);
      }
    } catch (error) {
      console.error('[DealerMode] Failed to load device list:', error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [allDeviceComments, allDeviceIds.length, getAllDeviceIds]);

  const searchDevices = useCallback(
    (query: string) => {
      if (!query.trim() || query.length < 2) {
        setSearchResults([]);
        setShowSearchResults(false);
        return;
      }
      const normalized = query.toLowerCase();
      const filtered = allDeviceIds.filter((id) => {
        const idMatch = id.toLowerCase().includes(normalized);
        const comment = (allDeviceComments[id] || '').toLowerCase();
        return idMatch || comment.includes(normalized);
      });
      if (filtered.length > 0 && filtered.length < 10) {
        setSearchResults(filtered.slice(0, 10));
        setShowSearchResults(true);
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    },
    [allDeviceComments, allDeviceIds],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputId(value);
      setShowFavorites(false);
      if (allDeviceIds.length === 0 && !isLoadingDevices) {
        loadAllDevices().catch(() => {});
      }
      searchDevices(value);
    },
    [allDeviceIds.length, isLoadingDevices, loadAllDevices, searchDevices],
  );

  // Picking from the search/favorites list shows only the dealer-visible
  // 7-digit Seriennr in the input — the full ID stays internal. handleConnect
  // expands the prefix back to the full ID via resolveBySeriennr().
  const selectFavorite = useCallback((id: string) => {
    setInputId(extractSeriennr(id));
    setShowFavorites(false);
    setShowSearchResults(false);
  }, []);

  // ─── URL sync ───────────────────────────────────────────────────────────
  const syncIdToUrl = useCallback((id: string) => {
    const params = new URLSearchParams(window.location.search);
    if (id.trim()) params.set('id', id.trim());
    else params.delete('id');
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', newUrl);
  }, []);

  // ─── Connect ────────────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    const trimmed = inputId.trim();
    if (!trimmed) return;
    setResolveError(null);
    setShowFavorites(false);
    setShowSearchResults(false);

    const allIds = allDeviceIds.length > 0 ? allDeviceIds : await getAllDeviceIds().catch(() => [] as string[]);
    if (allDeviceIds.length === 0 && allIds.length > 0) setAllDeviceIds(allIds);

    const resolved = await resolveBySeriennr(trimmed, allIds);
    if (!resolved) {
      setResolveError(t('dealerRadar.notFound') as string);
      return;
    }

    syncIdToUrl(resolved);
    await connect(resolved);
    addToFavorites(resolved);
    // Active connectivity check — runs in parallel with model loading.
    void ping.ping();
  }, [addToFavorites, allDeviceIds, connect, getAllDeviceIds, inputId, ping, syncIdToUrl, t]);

  // Pull `?id=` from the URL on first mount.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('id');
    if (urlId && !inputId) setInputId(extractSeriennr(urlId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-connect to the URL device on first load.
  useEffect(() => {
    if (autoConnectAttemptedRef.current) return;
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('id');
    if (!urlId || deviceId) {
      autoConnectAttemptedRef.current = true;
      return;
    }
    autoConnectAttemptedRef.current = true;
    connect(urlId)
      .then(() => void ping.ping())
      .catch(() => {});
  }, [connect, deviceId, ping]);

  // Mirror the connected device into the input box so re-connecting feels
  // obvious — but show only the 7-digit Seriennr (per Claus' privacy rule).
  useEffect(() => {
    if (deviceId) setInputId(extractSeriennr(deviceId));
  }, [deviceId]);

  // Reset the customer-problem / AI-answer / escalation state whenever the
  // dealer switches stoves — otherwise the analysis from the previous Ofen
  // would stick around on the new card and mislead the dealer.
  useEffect(() => {
    setCustomerProblem('');
    setAiAnswer('');
    setAiPrompt('');
    setAiError(null);
    setEscalationFeedback(null);
  }, [deviceId]);

  // Auto-poll connectivity once we are connected. Coverage is automatic — no
  // manual "Re-check" button. Each ping takes ~10 s; we wait 60 s between
  // cycles so the badge keeps updating without hammering the controller.
  useEffect(() => {
    if (!isConnected || !deviceId) return;
    const interval = window.setInterval(() => {
      void ping.ping();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [deviceId, isConnected, ping]);

  // Stable connectivity status for the header — keeps the last known result
  // visible while a background ping is running, so the badge doesn't flicker
  // back to "checking" every minute.
  const [stableConnectivity, setStableConnectivity] = useState<'unknown' | 'online' | 'offline'>(
    'unknown',
  );
  useEffect(() => {
    if (ping.status === 'online') setStableConnectivity('online');
    else if (ping.status === 'offline') setStableConnectivity('offline');
  }, [ping.status]);
  useEffect(() => {
    setStableConnectivity('unknown');
  }, [deviceId]);

  // ─── Model info (image + name) ──────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !deviceId) {
      setModelInfo({ name: null, imageUrl: null });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [modelNameRaw, modelData] = await Promise.all([
          getStoveModelNameRef.current().catch(() => ''),
          getStoveModelDataRef.current().catch(() => null),
        ]);
        if (cancelled) return;
        let name = (modelNameRaw || '').trim();
        if (!name || name === 'Unknown Model') {
          const fromMeta = typeof deviceMetadata?.ofenname === 'string' ? deviceMetadata.ofenname.trim() : '';
          if (fromMeta) name = fromMeta;
        }
        setModelInfo({
          name: name && name !== 'Unknown Model' ? name : null,
          imageUrl: pickStoveModelImageUrl(modelData),
        });
      } catch (error) {
        console.warn('[DealerMode] Failed to load stove model:', error);
        if (!cancelled) setModelInfo({ name: null, imageUrl: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, deviceMetadata?.ofenname, isConnected]);

  // ─── Cards mount/unmount animation ──────────────────────────────────────
  useEffect(() => {
    if (shouldShowCards) {
      setRenderCards(true);
      const frame = window.requestAnimationFrame(() => setCardsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setCardsVisible(false);
    const timer = window.setTimeout(() => setRenderCards(false), 360);
    return () => window.clearTimeout(timer);
  }, [shouldShowCards]);

  // ─── Click-outside for the search dropdowns ─────────────────────────────
  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowFavorites(false);
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // ─── Gemini ────────────────────────────────────────────────────────────
  const handleAskGemini = useCallback(async () => {
    if (!customerProblem.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await askDealerAssistant({
        customerProblem: customerProblem.trim(),
        cValues: brennbewertung.values,
        topThree: brennbewertung.topThree,
        knowledge,
        controllerErrors: decodedErrors.filter((e) => e.dealerVisible).map((e) => e.description),
        modelName: modelInfo.name ?? undefined,
        settings: promptSettings,
      });
      setAiAnswer(result.answer);
      setAiPrompt(result.prompt);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setAiLoading(false);
    }
  }, [
    brennbewertung.topThree,
    brennbewertung.values,
    customerProblem,
    decodedErrors,
    knowledge,
    modelInfo.name,
    promptSettings,
  ]);

  // ─── Escalation (KundenTicket) ─────────────────────────────────────────
  const handleEscalateToHase = useCallback(async () => {
    if (!deviceId) return;
    setIsEscalating(true);
    setEscalationFeedback(null);
    try {
      const seriennr = extractSeriennr(deviceId);
      // Passport for the ticket: we keep the full device ID + seriennr for
      // the back-office, but the dealer view itself never displays them.
      const passport: KundenTicketStovePassport = {
        modelName: modelInfo.name || 'Unbekanntes Modell',
        stoveSerial: seriennr,
        controllerSerial: deviceId.length > 7 ? deviceId.substring(7, 14) : 'Unbekannt',
        currentControllerSerial: 'Unbekannt',
        imageUrl: modelInfo.imageUrl ?? undefined,
      };

      const summaryParts: string[] = [
        `Modell: ${passport.modelName}`,
        `Seriennr: ${seriennr}`,
        `Connectivity: ${ping.status}${ping.responseTimeMs ? ` (${ping.responseTimeMs} ms)` : ''}`,
        `Brennbewertung-Quelle: ${brennbewertung.source}`,
        `C-Werte: ${(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const)
          .map((k) => `${k}=${brennbewertung.values[k]}`)
          .join(', ')}`,
        `Top-3 aktiv: ${brennbewertung.topThree.length > 0 ? brennbewertung.topThree.join(', ') : 'keine'}`,
        decodedErrors.filter((e) => e.dealerVisible).length > 0
          ? `Controller-Fehler: ${decodedErrors
              .filter((e) => e.dealerVisible)
              .map((e) => e.description)
              .join(' | ')}`
          : 'Controller-Fehler: keine',
        customerProblem.trim() ? `Kundenproblem: ${customerProblem.trim()}` : '',
        aiAnswer.trim() ? `Gemini Antwort: ${aiAnswer.trim()}` : 'Gemini Antwort: nicht vorhanden',
      ].filter(Boolean);

      const ok = await createKundenTicket({
        deviceId,
        stovePassport: passport,
        statusSnapshot: {
          health:
            brennbewertung.isAllZero && decodedErrors.filter((e) => e.dealerVisible).length === 0
              ? 'good'
              : 'bad',
          headline: brennbewertung.isAllZero
            ? 'Der Ofen brennt einwandfrei'
            : 'Der Ofen könnte besser brennen',
          details: brennbewertung.topThree
            .map((k) => `${k} (${brennbewertung.values[k]}): ${knowledge[k].title}`)
            .join(' • '),
          safeHints: brennbewertung.topThree.flatMap((k) => knowledge[k].massnahmen),
          aiRecommendations: aiAnswer || undefined,
        },
        customerQuestion: customerProblem.trim(),
        geminiAnswer: aiAnswer,
        pageSummary: summaryParts.join('\n'),
        author: {
          uid: user?.uid ?? null,
          email: user?.email ?? null,
          displayName: user?.displayName ?? null,
          role: user?.role ?? null,
        },
      });
      setEscalationFeedback(ok ? 'success' : 'error');
    } catch {
      setEscalationFeedback('error');
    } finally {
      setIsEscalating(false);
    }
  }, [
    aiAnswer,
    brennbewertung.isAllZero,
    brennbewertung.source,
    brennbewertung.topThree,
    brennbewertung.values,
    createKundenTicket,
    customerProblem,
    decodedErrors,
    deviceId,
    knowledge,
    modelInfo.imageUrl,
    modelInfo.name,
    ping.responseTimeMs,
    ping.status,
    user?.displayName,
    user?.email,
    user?.role,
    user?.uid,
  ]);

  useEffect(() => {
    if (!escalationFeedback) return;
    const timer = window.setTimeout(() => setEscalationFeedback(null), 6000);
    return () => window.clearTimeout(timer);
  }, [escalationFeedback]);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* Header strip with brand + theme/back controls */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/hase_logo_light.svg" alt="HASE" className="h-10" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('dealerRadar.badge')}</p>
              <h1 className="text-xl font-semibold">{t('dealerRadar.title')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!user?.isDealer && (
              <button
                onClick={() => {
                  const next = `/${window.location.search}${window.location.hash}`;
                  window.location.assign(next);
                }}
                className="rounded-theme border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted"
                title={t('connectionPanel.openClassicMode') as string}
              >
                {t('connectionPanel.openClassicMode')}
              </button>
            )}
          </div>
        </header>

        {/* Search box */}
        <section className="mb-6 rounded-theme bg-card p-5 shadow-theme-md">
          <p className="mb-3 text-sm text-muted-foreground">{t('dealerRadar.subtitle')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full" ref={searchContainerRef}>
              <div className="flex items-stretch">
                <input
                  value={inputId}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputId.trim() && connectionStatus !== 'connecting') {
                      handleConnect();
                    }
                  }}
                  placeholder={t('dealerRadar.ofenSnPlaceholder') as string}
                  inputMode="numeric"
                  className="w-full rounded-l-theme border border-input bg-background px-4 py-3 text-base outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowFavorites((prev) => !prev)}
                  className="rounded-r-theme border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={t('dealerRadar.recentIds') as string}
                  aria-label={t('dealerRadar.recentIds') as string}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </button>
              </div>

              {showFavorites && (
                <div className="absolute top-full left-0 z-50 mt-2 w-full overflow-hidden rounded-theme border border-border bg-card shadow-theme-md">
                  <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                    {t('dealerRadar.recentIds')}
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {recentIds.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        {t('connectionPanel.noFavorites')}
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {recentIds.map((favorite) => (
                          <div key={favorite.id} className="group flex items-center justify-between px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => selectFavorite(favorite.id)}
                              className="min-w-0 flex-1 text-left font-mono text-sm text-foreground hover:text-primary"
                            >
                              {/* Show only the dealer-visible Seriennr — full ID stays internal. */}
                              {extractSeriennr(favorite.id)}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromFavorites(favorite.id)}
                              className="ml-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                              title={t('connectionPanel.remove') as string}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {showSearchResults && searchResults.length > 0 && (
                <div className="absolute top-full left-0 z-40 mt-2 w-full overflow-hidden rounded-theme border border-border bg-card shadow-theme-md">
                  <div className="max-h-56 divide-y divide-border overflow-y-auto">
                    {searchResults.map((id) => {
                      const comment = (allDeviceComments[id] || '').trim();
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => selectFavorite(id)}
                          className="w-full px-3 py-2.5 text-left transition-colors hover:bg-accent"
                        >
                          {/* Search results also stay limited to Seriennr for the dealer. */}
                          <div className="font-mono text-sm text-foreground">{extractSeriennr(id)}</div>
                          {comment && <div className="truncate text-xs text-muted-foreground">{comment}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleConnect}
              disabled={!inputId.trim() || connectionStatus === 'connecting'}
              className="rounded-theme border border-primary bg-primary px-6 py-3 font-medium text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connectionStatus === 'connecting' ? t('dealerRadar.checking') : t('dealerRadar.connect')}
            </button>
          </div>

          {isLoadingDevices && (
            <p className="mt-2 text-xs text-muted-foreground">{t('dealerRadar.searching')}</p>
          )}
          {resolveError && <p className="mt-3 text-sm text-destructive">{resolveError}</p>}
          {deviceExistence === 'not_found' && !resolveError && (
            <p className="mt-3 text-sm text-destructive">{t('app.deviceNotFoundHint')}</p>
          )}
        </section>

        {/* Vertical stack of dealer cards */}
        {renderCards && (
          <section
            className={`space-y-4 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              cardsVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
            }`}
          >
            <DealerHeaderCard
              modelName={modelInfo.name}
              deviceId={deviceId}
              imageUrl={modelInfo.imageUrl}
              connectivity={stableConnectivity}
            />

            <BrennbewertungCard
              values={brennbewertung.values}
              topThree={brennbewertung.topThree}
              isAllZero={brennbewertung.isAllZero}
              isLoading={brennbewertung.isLoading}
              knowledge={knowledge}
              source={brennbewertung.source}
            />

            <OfenFunktionCard
              errors={decodedErrors}
              showFirmwareHint={decodedErrors.some((e) => e.dealerVisible)}
            />

            <ProblemInputCard
              customerProblem={customerProblem}
              onCustomerProblemChange={setCustomerProblem}
              aiAnswer={aiAnswer}
              aiError={aiError}
              isAnalysing={aiLoading}
              onAnalyse={handleAskGemini}
              debugPrompt={aiPrompt}
              showDebugPrompt={isStaff}
            />

            {/* Escalation — sends a KundenTicket to HASE back-office. */}
            <section className="rounded-theme bg-card p-5 shadow-theme-md">
              <button
                type="button"
                onClick={handleEscalateToHase}
                disabled={!isConnected || isEscalating || isSendingTicket || escalationFeedback === 'success'}
                className="w-full rounded-theme border border-primary bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isEscalating || isSendingTicket
                  ? t('dealerRadar.escalation.sending')
                  : t('dealerRadar.escalation.cta')}
              </button>
              {escalationFeedback === 'success' && (
                <p
                  role="status"
                  className="tint-success mt-3 rounded-theme p-3 text-sm text-success"
                >
                  {t('dealerRadar.escalation.success')}
                </p>
              )}
              {escalationFeedback === 'error' && (
                <p
                  role="alert"
                  className="tint-destructive mt-3 rounded-theme p-3 text-sm text-destructive"
                >
                  {t('dealerRadar.escalation.error')}
                </p>
              )}
            </section>
          </section>
        )}
      </div>

      {/* Floating buttons — visible to staff. Dealers never see them.
          "Prompt" opens the AI-prompt editor (saves globally; editable for
          developer / super_admin only — admin sees the button disabled).
          "Texte" opens the C0..C6 knowledge-base editor and "C0–C6" the
          dev-only value-override panel; both stay developer/super_admin. */}
      {(isStaff || canSeeDevPanel) && (
        <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
          {isStaff && (
            <button
              type="button"
              onClick={() => setIsPromptEditorOpen(true)}
              disabled={!canEditPrompt}
              className="rounded-full border border-border bg-card/75 px-4 py-2 text-sm font-medium text-foreground shadow-theme-md backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-theme-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-card/75 disabled:hover:shadow-theme-md"
              title={
                canEditPrompt
                  ? (t('dealerV2.promptEditor.title') as string)
                  : (t('dealerV2.promptEditor.disabledTooltip') as string)
              }
            >
              {t('dealerV2.promptEditor.openButton')}
            </button>
          )}
          {canSeeDevPanel && (
            <>
              <button
                type="button"
                onClick={() => setIsEditorOpen(true)}
                className="rounded-full border border-border bg-card/75 px-4 py-2 text-sm font-medium text-foreground shadow-theme-md backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-theme-lg"
                title={t('dealerV2.editor.title') as string}
              >
                {t('dealerV2.editor.openButton')}
              </button>
              <button
                type="button"
                onClick={() => setIsDevPanelOpen(true)}
                className="rounded-full border border-border bg-card/75 px-4 py-2 font-mono text-sm font-semibold text-foreground shadow-theme-md backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-theme-lg"
                title={t('dealerV2.devCs.title') as string}
              >
                {t('dealerV2.devCs.openButton')}
                {brennbewertung.hasDevOverride ? (
                  <span className="ml-2 inline-block h-2 w-2 rounded-full bg-warning" aria-label="override active" />
                ) : null}
              </button>
            </>
          )}
        </div>
      )}

      <DevCsPanel
        isOpen={isDevPanelOpen}
        onClose={() => setIsDevPanelOpen(false)}
        currentValues={brennbewertung.values}
        hasDevOverride={brennbewertung.hasDevOverride}
        onApply={brennbewertung.setDevOverride}
        onClear={() => brennbewertung.setDevOverride(null)}
        knowledge={knowledge}
      />

      <BrennbewertungKnowledgeEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        knowledge={knowledge}
        editorUid={user?.uid}
      />

      <DealerPromptEditor
        isOpen={isPromptEditorOpen}
        onClose={() => setIsPromptEditorOpen(false)}
        settings={promptSettings}
        editorUid={user?.uid}
        canEdit={canEditPrompt}
      />
    </div>
  );
};

export default DealerModeLayout;
