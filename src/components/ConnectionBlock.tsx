import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoveStore } from '../store/useStoveStore';
import { useFirebaseConnection, useDeviceList } from '../hooks/useFirebase';
import { formatDateWithUserTimezone } from '../utils/timezone';
import { ref, get, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import KundenTicketsInbox from './KundenTicketsInbox';

interface FavoriteDevice {
  id: string;
  name?: string;
  lastUsed: number;
  comment?: string;
}

const ConnectionBlock: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const deviceId = useStoveStore(state => state.deviceId);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  const deviceMetadata = useStoveStore(state => state.deviceMetadata);
  const deviceConfig = useStoveStore(state => state.deviceConfig);
  
  const { connect, disconnect } = useFirebaseConnection();
  const { getAllDeviceIds } = useDeviceList();
  
  const [inputValue, setInputValue] = useState('');
  
  // Favorites
  const [showFavorites, setShowFavorites] = useState(false);
  const [favoritesRefresh, setFavoritesRefresh] = useState(0);
  
  // Search
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [allDeviceIds, setAllDeviceIds] = useState<string[]>([]);
  const [allDeviceComments, setAllDeviceComments] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  
  // Stove model name
  const [stoveModelName, setStoveModelName] = useState<string>('—');
  
  // Ping test states
  const [pingStatus, setPingStatus] = useState<'unknown' | 'testing' | 'online' | 'offline'>('unknown');
  const [pingResponseTime, setPingResponseTime] = useState<number | null>(null);
  const autoCheckTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Comment editing
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [editedComment, setEditedComment] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);

  // Cleanup states
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const aktionenRef = useRef<HTMLDivElement>(null);

  const [showKundenTickets, setShowKundenTickets] = useState(false);
  const [showAktionenMenu, setShowAktionenMenu] = useState(false);

  const role = useMemo(() => String(user?.role || '').toLowerCase().trim(), [user?.role]);
  const canViewKundenTickets =
    role === 'admin' || role === 'developer' || role === 'super_admin';

  // Computed connection states
  const normalizedInputId = useMemo(() => inputValue.trim(), [inputValue]);
  const isConnected = useMemo(() => !!deviceId && connectionStatus === 'online', [deviceId, connectionStatus]);
  const isDifferentId = useMemo(() => !!normalizedInputId && !!deviceId && normalizedInputId !== deviceId, [normalizedInputId, deviceId]);
  const showConnectButton = useMemo(() => !isConnected || isDifferentId, [isConnected, isDifferentId]);

  // Ping test function (same as in StoveInfoModal)
  const handlePingTest = useCallback(async () => {
    if (!deviceId || !realtimeDB) return;

    setPingStatus('testing');
    setPingResponseTime(null);

    try {
      const konstantRef = ref(realtimeDB!, `konstant/${deviceId}/p`);
      const konstantAppRef = ref(realtimeDB!, `konstant_app/${deviceId}/c`);

      const initialSnapshot = await get(konstantAppRef);
      const initialCValue = initialSnapshot.val() || 0;

      const pingValues = [
        Math.floor(Math.random() * 1000) + 1000,
        Math.floor(Math.random() * 1000) + 2000,
        Math.floor(Math.random() * 1000) + 3000
      ];

      const startTime = Date.now();
      for (let i = 0; i < pingValues.length; i++) {
        await set(konstantRef, pingValues[i]);
        
        if (i < pingValues.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      const finalSnapshot = await get(konstantAppRef);
      const finalCValue = finalSnapshot.val() || 0;
      const responseTime = Date.now() - startTime;

      if (finalCValue !== initialCValue) {
        setPingStatus('online');
        setPingResponseTime(responseTime);
      } else {
        setPingStatus('offline');
      }

    } catch (error) {
      console.error('[ConnectionBlock] ❌ Error during ping test:', error);
      setPingStatus('offline');
    }
  }, [deviceId]);

  // Reset auto-check timer
  const resetAutoCheckTimer = useCallback(() => {
    // Clear existing timer
    if (autoCheckTimerRef.current) {
      clearInterval(autoCheckTimerRef.current);
      autoCheckTimerRef.current = null;
    }

    // Set new timer for 1 minute (60000ms)
    if (isConnected && deviceId) {
      autoCheckTimerRef.current = setInterval(() => {
        handlePingTest();
      }, 60000);
    }
  }, [isConnected, deviceId, handlePingTest]);

  // Auto-check connection status every 2 minutes when connected
  useEffect(() => {
    if (isConnected && deviceId) {
      // Initial ping test
      handlePingTest();
      // Start auto-check timer
      resetAutoCheckTimer();
    } else {
      // Clear timer when disconnected
      if (autoCheckTimerRef.current) {
        clearInterval(autoCheckTimerRef.current);
        autoCheckTimerRef.current = null;
      }
      setPingStatus('unknown');
      setPingResponseTime(null);
    }

    return () => {
      if (autoCheckTimerRef.current) {
        clearInterval(autoCheckTimerRef.current);
        autoCheckTimerRef.current = null;
      }
    };
  }, [isConnected, deviceId, handlePingTest, resetAutoCheckTimer]);

  // Manual ping test with timer reset
  const handleManualPingTest = useCallback(() => {
    handlePingTest();
    resetAutoCheckTimer(); // Reset the 2-minute timer
  }, [handlePingTest, resetAutoCheckTimer]);

  // Cancel comment editing
  const handleCancelCommentEdit = useCallback(() => {
    setEditedComment('');
    setIsEditingComment(false);
  }, []);

  // Start comment editing
  const handleStartCommentEdit = useCallback(() => {
    const currentComment = (deviceMetadata as any)?.comment || '';
    setEditedComment(currentComment);
    setIsEditingComment(true);
  }, [deviceMetadata]);

  // Initialize input value with connected device ID (only once)
  useEffect(() => {
    if (deviceId && isConnected && !inputValue) {
      setInputValue(deviceId);
    }
  }, [deviceId, isConnected]); // Remove inputValue from deps to allow editing

  // Load verz (Ofentyp) from /konstant/<id>/verz
  useEffect(() => {
    if (!isConnected || !deviceId) {
      setStoveModelName('—');
      return;
    }

    const loadVerz = async () => {
      try {
        if (!realtimeDB) {
          console.warn('[ConnectionBlock] realtimeDB not available');
          setStoveModelName('—');
          return;
        }

        const verzRef = ref(realtimeDB, `konstant/${deviceId}/verz`);
        const verzSnapshot = await get(verzRef);
        
        if (verzSnapshot.exists()) {
          const verzValue = verzSnapshot.val();
          setStoveModelName(verzValue ? String(verzValue) : '—');
        } else {
          console.warn('[ConnectionBlock] No verz found');
          setStoveModelName('—');
        }
      } catch (error) {
        console.error('[ConnectionBlock] Error loading verz:', error);
        setStoveModelName('—');
      }
    };

    loadVerz();
  }, [deviceId, isConnected]);

  // Helper: update URL query param ?id=
  const updateUrlDeviceParam = useCallback((newId?: string) => {
    try {
      const url = new URL(window.location.href);
      if (newId && newId.trim()) {
        url.searchParams.set('id', newId.trim());
      } else {
        url.searchParams.delete('id');
      }
      const query = url.searchParams.toString();
      const newUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
      window.history.replaceState({}, '', newUrl);
    } catch (err) {
      console.warn('[ConnectionBlock] Failed to update URL param:', err);
    }
  }, []);

  // Enhanced cleanup function for device switching
  const performCompleteCleanup = useCallback(async (targetId: string) => {
    setIsCleaningUp(true);
    setCleanupProgress(0);

    // Step 1: Clear store state (20%)
    const { clearAllState } = useStoveStore.getState();
    clearAllState();
    setCleanupProgress(20);

    // Step 2: Clear browser caches (40%)
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // Don't remove user preferences - they are global, not device-specific
        if (key && (key.startsWith('hase-') || key.includes('device') || key.includes('parameter')) && key !== 'hase-iq-user-preferences') {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      const sessionKeysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        // Don't remove user preferences - they are global, not device-specific
        if (
          key &&
          (key.startsWith('hase-') || key.includes('device') || key.includes('parameter')) &&
          key !== 'hase-iq-user-preferences' &&
          key !== 'hase-session-simplification-mode'
        ) {
          sessionKeysToRemove.push(key);
        }
      }
      sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));
    } catch (error) {
      console.warn('[ConnectionBlock] Error clearing caches:', error);
    }
    setCleanupProgress(40);

    // Step 3: Disconnect from current device if connected (60%)
    if (isConnected && deviceId && targetId !== deviceId) {
      await disconnect();
    }
    setCleanupProgress(60);

    // Step 4: Wait for cleanup to complete (100%)
    await new Promise(resolve => setTimeout(resolve, 5000));
    setCleanupProgress(100);

    // Small delay to ensure store state has updated
    await new Promise(resolve => setTimeout(resolve, 100));

    setIsCleaningUp(false);
    setCleanupProgress(0);
  }, [isConnected, deviceId, disconnect]);

  const handleConnect = useCallback(async () => {
    const targetId = inputValue.trim();
    if (!targetId) return;

    // Close search results when connecting
    setShowSearchResults(false);
    setShowFavorites(false);

    // Check current state from store, not from closure
    const currentState = useStoveStore.getState();

    if (currentState.connectionStatus === 'connecting' || isCleaningUp) {
      return;
    }

    try {
      await performCompleteCleanup(targetId);

      const ok = await connect(targetId);
      if (ok) {
        updateUrlDeviceParam(targetId);
        // Don't clear input field - keep the connected ID visible
      } else {
        console.warn('[ConnectionBlock] Connection to', targetId, 'failed');
      }
    } catch (error) {
      console.error('[ConnectionBlock] Connection failed:', error);
      setIsCleaningUp(false);
      setCleanupProgress(0);
    }
  }, [inputValue, isCleaningUp, performCompleteCleanup, connect, updateUrlDeviceParam]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    updateUrlDeviceParam(undefined);
  }, [disconnect, updateUrlDeviceParam]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnect();
    }
  }, [handleConnect]);

  const formatLastLogin = (timestamp: number | undefined): string => {
    if (!timestamp) return '—';
    try {
      return formatDateWithUserTimezone(timestamp * 1000, i18n.language || 'de', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'N/A';
    }
  };

  // Favorites management
  const favorites = useMemo<FavoriteDevice[]>(() => {
    try {
      const stored = localStorage.getItem('firebaseIdFavorites_v2');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, [favoritesRefresh]);

  const saveFavorites = useCallback((newFavorites: FavoriteDevice[]) => {
    try {
      localStorage.setItem('firebaseIdFavorites_v2', JSON.stringify(newFavorites));
      setFavoritesRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Failed to save favorites:', error);
    }
  }, []);

  const addToFavorites = useCallback((id: string) => {
    if (!id.trim()) return;
    const newFavorite: FavoriteDevice = {
      id: id.trim(),
      lastUsed: Date.now(),
    };
    const updated = favorites.filter(f => f.id !== newFavorite.id);
    updated.unshift(newFavorite);
    saveFavorites(updated.slice(0, 10));
  }, [favorites, saveFavorites]);

  const removeFromFavorites = useCallback((id: string) => {
    const updated = favorites.filter(f => f.id !== id);
    saveFavorites(updated);
  }, [favorites, saveFavorites]);

  const selectFavorite = useCallback((id: string) => {
    setInputValue(id);
    setShowFavorites(false);
  }, []);

  // Device search with comments
  const loadAllDeviceIds = useCallback(async (forceUpdate = false) => {
    if (!forceUpdate && allDeviceIds.length > 0 && Object.keys(allDeviceComments).length > 0) return;

    setIsLoadingDevices(true);
    try {
      const deviceIds = await getAllDeviceIds();
      setAllDeviceIds(deviceIds);

      if (realtimeDB) {
        const konstantAppRef = ref(realtimeDB, 'konstant_app');
        const snapshot = await get(konstantAppRef);
        const commentsMap: Record<string, string> = {};
        if (snapshot.exists()) {
          snapshot.forEach(child => {
            const id = child.key;
            const val = child.val() as any;
            if (id) {
              const comment = typeof val?.comment === 'string' ? val.comment : '';
              commentsMap[id] = comment;
            }
          });
        }
        setAllDeviceComments(commentsMap);
      }
    } catch (error) {
      console.error('[Search] Failed to load device IDs:', error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [getAllDeviceIds, allDeviceIds.length, allDeviceComments]);

  // Update comment in cache
  const updateCommentInCache = useCallback((deviceId: string, newComment: string) => {
    setAllDeviceComments(prev => ({
      ...prev,
      [deviceId]: newComment
    }));
  }, []);

  // Force refresh all device comments
  const refreshAllComments = useCallback(async () => {
    if (!realtimeDB) return;

    try {
      const konstantAppRef = ref(realtimeDB, 'konstant_app');
      const snapshot = await get(konstantAppRef);
      const commentsMap: Record<string, string> = {};
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          const id = child.key;
          const val = child.val() as any;
          if (id) {
            const comment = typeof val?.comment === 'string' ? val.comment : '';
            commentsMap[id] = comment;
          }
        });
      }
      setAllDeviceComments(commentsMap);
    } catch (error) {
      console.error('[Search] Failed to refresh comments:', error);
    }
  }, []);

  // Update search results without opening dropdown
  const updateSearchResults = useCallback((query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }

    const q = query.toLowerCase();
    const filteredDevices = allDeviceIds.filter(id => {
      const idMatch = id.toLowerCase().includes(q);
      const comment = allDeviceComments[id] || '';
      const commentMatch = comment.toLowerCase().includes(q);
      return idMatch || commentMatch;
    });

    setSearchResults(filteredDevices.length > 0 && filteredDevices.length < 10 ?
      filteredDevices.slice(0, 10) : []);
  }, [allDeviceIds, allDeviceComments]);

  // Save comment
  const handleSaveComment = useCallback(async () => {
    if (!deviceId || !realtimeDB) return;

    setIsSavingComment(true);
    try {
      const commentRef = ref(realtimeDB!, `konstant_app/${deviceId}/comment`);
      const newComment = editedComment.trim();
      await set(commentRef, newComment);

      // Small delay to ensure Firebase has updated
      await new Promise(resolve => setTimeout(resolve, 500));

      // Update comment in cache and refresh all comments to ensure consistency
      updateCommentInCache(deviceId, newComment);
      await refreshAllComments();

      // If search is currently active, refresh search results in cache
      if (inputValue && inputValue.length >= 2) {
        updateSearchResults(inputValue);
      }

      setIsEditingComment(false);
    } catch (error) {
      console.error('[ConnectionBlock] Error saving comment:', error);
      alert('Fehler beim Speichern des Kommentars');
    } finally {
      setIsSavingComment(false);
    }
  }, [deviceId, editedComment, updateCommentInCache, refreshAllComments, inputValue, updateSearchResults]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setShowFavorites(false);

    // Load device IDs if not loaded yet
    if (allDeviceIds.length === 0 && !isLoadingDevices) {
      loadAllDeviceIds();
    }

    // Search devices - if we have devices loaded, search immediately
    if (allDeviceIds.length > 0) {
      updateSearchResults(value);
      // Show search results if there are matches and query is valid
      const query = value.trim();
      if (query.length >= 2) {
        const q = query.toLowerCase();
        const hasMatches = allDeviceIds.some(id => {
          const idMatch = id.toLowerCase().includes(q);
          const comment = allDeviceComments[id] || '';
          const commentMatch = comment.toLowerCase().includes(q);
          return idMatch || commentMatch;
        });
        setShowSearchResults(hasMatches);
      } else {
        setShowSearchResults(false);
      }
    }
  }, [allDeviceIds.length, isLoadingDevices, loadAllDeviceIds, updateSearchResults, allDeviceComments]);

  const selectSearchResult = useCallback((deviceId: string) => {
    setInputValue(deviceId);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  // Click outside detection
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowSearchResults(false);
        setShowFavorites(false);
      }
      if (aktionenRef.current && !aktionenRef.current.contains(target)) {
        setShowAktionenMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const isUpdateAvailable = deviceMetadata?.v === true;
  const firmwareVersion: string = (typeof deviceMetadata?.vers === 'string' && deviceMetadata.vers.trim()) ? deviceMetadata.vers : '—';
  const lastLoginTs: number | undefined = (deviceMetadata && typeof (deviceMetadata as any).tsfc === 'number') ? (deviceMetadata as any).tsfc : undefined;
  const lastLoginStr = formatLastLogin(lastLoginTs);
  const softwareLevel: string = deviceConfig?.sws !== undefined && deviceConfig?.sws !== null ? String(deviceConfig.sws) : '—';
  const commentText: string = (typeof (deviceMetadata as any)?.comment === 'string' && (deviceMetadata as any).comment.trim()) ? (deviceMetadata as any).comment : '—';

  return (
    <div className="bg-info/10 rounded border-2 border-border">
      {/* Header */}
      <div className="bg-section-header text-section-header-foreground px-3 py-2 rounded-t flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold flex items-center min-w-0 flex-1">
          <div className="w-4 h-4 mr-2 flex items-center justify-center flex-shrink-0">
            <svg
              className={`w-3.5 h-3.5 ${isConnected ? 'text-success' : 'text-muted-foreground'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
          </div>
          <span className="truncate">{t('connectionBlock.title')}</span>
          {isConnected && deviceId && (
            <span className="ml-2 text-xs text-muted-foreground font-normal truncate hidden sm:inline">
              ({t('connectionBlock.connectedTo')} {deviceId})
            </span>
          )}
        </h2>
        {canViewKundenTickets && (
          <div className="relative flex-shrink-0" ref={aktionenRef}>
            <button
              type="button"
              onClick={() => setShowAktionenMenu((v) => !v)}
              className="h-8 px-2.5 inline-flex items-center gap-1 border border-border text-xs font-medium text-section-header-foreground hover:bg-section-header/80 rounded-lg transition-colors touch-manipulation"
              title={t('connectionPanel.actions') as string}
            >
              <span>{t('connectionPanel.actions')}</span>
              <svg className={`w-3.5 h-3.5 transition-transform ${showAktionenMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showAktionenMenu && (
              <div className="absolute right-0 top-full mt-1 min-w-[200px] py-1 bg-card border border-border rounded-lg shadow-lg z-[60]">
                <button
                  type="button"
                  onClick={() => {
                    setShowKundenTickets(true);
                    setShowAktionenMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2 touch-manipulation"
                >
                  <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" />
                  </svg>
                  {t('connectionPanel.kundenTickets')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 transition-colors rounded-b">
        {/* Input Section */}
        <div className="mb-3" ref={searchContainerRef}>
          <div className="relative w-full">
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={t('connectionPanel.firebaseIdPlaceholder') as string}
                disabled={connectionStatus === 'connecting'}
                className={`flex-1 px-4 py-2.5 border rounded-lg focus:ring-2 disabled:bg-muted disabled:cursor-not-allowed text-sm font-mono touch-manipulation bg-card text-foreground border-border focus:ring-primary focus:border-primary transition-all`}
              />
              <button
                type="button"
                onClick={() => setShowFavorites(!showFavorites)}
                className="px-3 py-2.5 bg-card border border-border hover:bg-muted transition-colors touch-manipulation flex items-center justify-center rounded-lg"
                title={t('connectionPanel.favorites') as string}
              >
                <svg className="w-4 h-4 text-muted-foreground" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </button>
              <button
                onClick={showConnectButton ? handleConnect : handleDisconnect}
                disabled={(showConnectButton && (!normalizedInputId || connectionStatus === 'connecting' || isCleaningUp)) || (!showConnectButton && connectionStatus === 'connecting')}
                className={`px-5 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium touch-manipulation min-w-[110px] flex flex-col items-center justify-center relative overflow-hidden transition-all ${
                  showConnectButton
                    ? isCleaningUp
                      ? 'bg-primary/70 text-primary-foreground'
                      : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    : 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                }`}
              >
                {showConnectButton ? (
                  isCleaningUp ? (
                    <>
                      <span className="text-xs font-medium">Connecting</span>
                      <div className="w-16 h-1 bg-primary/30 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-primary-foreground transition-all duration-300 ease-out"
                          style={{ width: `${cleanupProgress}%` }}
                        />
                      </div>
                    </>
                  ) : connectionStatus === 'connecting' ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="hidden sm:inline mt-1">{t('status.connecting')}</span>
                      <span className="sm:hidden mt-1">...</span>
                    </>
                  ) : (
                    <>Connect</>
                  )
                ) : (
                  <>Disconnect</>
                )}
              </button>
            </div>

            {isDifferentId && (
              <div className="mt-2">
                <p className="text-xs text-warning">{t('connectionPanel.differentIdWarning')}</p>
              </div>
            )}

            {/* Favorites Dropdown */}
            {showFavorites && (
              <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto" style={{ width: '100%', maxWidth: '400px' }}>
                <div className="p-3">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-foreground text-sm">{t('connectionPanel.favorites')}</h3>
                  </div>
                  {favorites.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-2">{t('connectionPanel.noFavorites')}</p>
                  ) : (
                    <div className="space-y-1">
                      {favorites.map((favorite) => (
                        <div key={favorite.id} className="flex items-center justify-between p-2 hover:bg-muted rounded-md cursor-pointer group">
                          <div onClick={() => selectFavorite(favorite.id)} className="flex-1 touch-manipulation min-w-0">
                            <div className="text-xs text-muted-foreground font-mono truncate">{favorite.id}</div>
                          </div>
                          <button onClick={() => removeFromFavorites(favorite.id)} className="ml-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity touch-manipulation flex-shrink-0">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-border flex space-x-2">
                    <button onClick={() => { if (inputValue.trim()) { addToFavorites(inputValue.trim()); setShowFavorites(false); } }} disabled={!inputValue.trim()} className="flex-1 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation">
                      {t('connectionPanel.addCurrent')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Search Results Dropdown */}
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto" style={{ width: '100%' }}>
                <div className="p-3">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-foreground text-sm">{t('connectionPanel.searchResults')}</h3>
                    <span className="text-xs text-muted-foreground">{t('connectionPanel.foundCount', { count: searchResults.length })}</span>
                  </div>
                  <div className="space-y-1">
                    {searchResults.map((did) => {
                      const comment = (allDeviceComments[did] || '').trim();
                      return (
                        <div key={did} onClick={() => selectSearchResult(did)} className="p-2 hover:bg-info/10 rounded-md cursor-pointer group border border-transparent hover:border-info/40 touch-manipulation">
                          <div className="text-sm text-muted-foreground font-mono">{did}</div>
                          {comment && (
                            <div className="text-xs text-muted-foreground truncate mt-0.5 italic">{comment.substring(0, 80)}{comment.length > 80 ? '...' : ''}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground italic">{t('connectionPanel.clickToSelect')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stove Info Section - Only when connected */}
        {isConnected && (
          <div className="pt-3 border-t border-border">
            {/* First Row: ID des Ofens + Ofentyp + Softwarestufe + Firmware-Version */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-2">
              {/* ID des Ofens - 1/6 width */}
              <div className="p-2 bg-card rounded md:col-span-1">
                <div className="text-xs text-muted-foreground mb-0.5">ID des Ofens</div>
                <div className="text-xs font-mono font-semibold text-foreground truncate" title={deviceId || '—'}>
                  {deviceId || '—'}
                </div>
              </div>

              {/* Ofentyp - 1/6 width */}
              <div className="p-2 bg-card rounded md:col-span-1">
                <div className="text-xs text-muted-foreground mb-0.5">Ofentyp</div>
                <div className="text-xs font-semibold text-foreground truncate" title={stoveModelName}>{stoveModelName}</div>
              </div>

              {/* Softwarestufe - 2/6 width */}
              <div className="p-2 bg-card rounded md:col-span-2">
                <div className="text-xs text-muted-foreground mb-0.5">Softwarestufe</div>
                <div className="text-sm font-semibold text-foreground">{softwareLevel}</div>
              </div>

              {/* Firmware-Version - 2/6 width */}
              <div className="p-2 bg-card rounded md:col-span-2">
                <div className="text-xs text-muted-foreground mb-0.5">Firmware-Version</div>
                <div className="text-sm font-semibold text-foreground">
                  {firmwareVersion}
                  {isUpdateAvailable && (
                    <span className="block text-destructive text-xs font-semibold mt-0.5">Update verfügbar</span>
                  )}
                </div>
              </div>
            </div>

            {/* Second Row: Letzte Anmeldung + Status + Anmerkung */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="p-2 bg-card rounded">
                <div className="text-xs text-muted-foreground mb-0.5">Letzte Anmeldung</div>
                <div className="text-xs font-semibold text-foreground">{lastLoginStr}</div>
              </div>
              <div className="p-2 bg-card rounded">
                <div className="text-xs text-muted-foreground mb-0.5 flex items-center justify-between">
                  <span>Status</span>
                  <button
                    onClick={handleManualPingTest}
                    disabled={pingStatus === 'testing'}
                    className="text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Status aktualisieren"
                  >
                    <svg
                      className={`w-3.5 h-3.5 ${pingStatus === 'testing' ? 'animate-spin' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <div className={`text-sm font-semibold ${
                  pingStatus === 'online' ? 'text-success' :
                  pingStatus === 'offline' ? 'text-destructive' :
                  pingStatus === 'testing' ? 'text-warning' :
                  'text-muted-foreground'
                }`}>
                  {pingStatus === 'online' && 'Online'}
                  {pingStatus === 'offline' && 'Offline'}
                  {pingStatus === 'testing' && 'Prüfe...'}
                  {pingStatus === 'unknown' && '—'}
                  {pingStatus === 'online' && pingResponseTime && (
                    <span className="text-xs text-muted-foreground ml-1">({pingResponseTime}ms)</span>
                  )}
                </div>
              </div>
              <div className="p-2 bg-card rounded">
                {!isEditingComment ? (
                  <>
                    <div className="text-xs text-muted-foreground mb-0.5 flex items-center justify-between">
                      <span>Anmerkung</span>
                      <button
                        onClick={handleStartCommentEdit}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Bearbeiten"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                    <div className="text-xs font-semibold text-foreground line-clamp-1">{commentText}</div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground mb-0.5">Anmerkung bearbeiten</div>
                    <input
                      type="text"
                      value={editedComment}
                      onChange={(e) => setEditedComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveComment();
                        if (e.key === 'Escape') handleCancelCommentEdit();
                      }}
                      className="w-full px-2 py-1 text-xs border border-primary rounded bg-card text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                      autoFocus
                      disabled={isSavingComment}
                    />
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleSaveComment}
                        disabled={isSavingComment}
                        className="flex-1 px-2 py-1 text-xs font-medium bg-success hover:bg-success/90 disabled:opacity-50 text-success-foreground rounded transition-colors"
                      >
                        {isSavingComment ? 'Speichere...' : '✓ Speichern'}
                      </button>
                      <button
                        onClick={handleCancelCommentEdit}
                        disabled={isSavingComment}
                        className="flex-1 px-2 py-1 text-xs font-medium bg-muted hover:bg-muted/80 disabled:opacity-50 text-foreground rounded transition-colors"
                      >
                        ✗ Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <KundenTicketsInbox isOpen={showKundenTickets} onClose={() => setShowKundenTickets(false)} />
    </div>
  );
};

export default ConnectionBlock;

