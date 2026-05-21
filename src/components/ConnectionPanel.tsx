import * as React from 'react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFirebaseConnection, useDeviceList } from '../hooks/useFirebase';
import { useParameterDiscovery } from '../hooks/useParameterDiscovery';
import { useStoveStore } from '../store/useStoveStore';
import UserSettingsModal from './UserSettingsModal';
import CategoriesModal from './CategoriesModal';
import ChatSystem from './ChatSystem';
import UsersListModal from './UsersListModal';
import UpdatesPanel from './UpdatesPanel';
import TicketSystem from './TicketSystem';
import KundenTicketsInbox from './KundenTicketsInbox';
import DocsModal from './DocsModal';
import Terminal from './Terminal';
import PrivilegesManagerModal from './PrivilegesManagerModal';
import FirebaseConsole from './FirebaseConsole';
import NotificationHistory from './NotificationHistory';
import { useCategoryManager } from '../hooks/useCategoryManager';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useChatNotifications } from '../hooks/useChatNotifications';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { ref, get, onValue, update, set, runTransaction, remove } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { useTranslation } from 'react-i18next';

interface FavoriteDevice {
  id: string;
  name?: string;
  lastUsed: number;
  comment?: string; // Add comment field
}

interface ConnectionPanelProps {
  onTemporaryCategoriesChange?: (categories: string[]) => void;
  onOpenAdminPanel?: () => void;
  onOpenParameterList?: () => void;
  onAlarmClick?: (deviceId: string, parameterName: string) => void;
}

const ConnectionPanel: React.FC<ConnectionPanelProps> = ({ 
  onTemporaryCategoriesChange,
  onOpenAdminPanel,
  onOpenParameterList,
  onAlarmClick
}) => {
  const { t } = useTranslation();
  const { toggleTheme } = useTheme();
  const [inputValue, setInputValue] = useState('');
  
  // Track DOM dark class via MutationObserver for reliable theme detection
  const [domIsDark, setDomIsDark] = useState(() => 
    document.documentElement.classList.contains('dark')
  );
  
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDomIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);
  const [showFavorites, setShowFavorites] = useState(false);
  // Counter to trigger favorites list re-render when localStorage changes
  const [favoritesRefresh, setFavoritesRefresh] = useState(0);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [temporaryCategories, setTemporaryCategories] = useState<string[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [showUsersList, setShowUsersList] = useState(false);
  const [chatTarget, setChatTarget] = useState<any>(null);
  const [showUpdates, setShowUpdates] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [showKundenTickets, setShowKundenTickets] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showFirebaseConsole, setShowFirebaseConsole] = useState(false);
  const [showNotificationHistory, setShowNotificationHistory] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [activeClients, setActiveClients] = useState<Record<string, any>>({});
  const [showActiveClients, setShowActiveClients] = useState(false);
  const activeClientsRef = useRef<HTMLDivElement>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const namePatchedRef = useRef<Set<string>>(new Set());
  
  // Search functionality
  const [allDeviceIds, setAllDeviceIds] = useState<string[]>([]);
  const [allDeviceComments, setAllDeviceComments] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Cleanup states
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);
  const [isClearingTemporaer, setIsClearingTemporaer] = useState(false);
  
  // Use direct store access
  const deviceId = useStoveStore(state => state.deviceId);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  const isEditMode = useStoveStore(state => state.isEditMode);
  const setEditMode = useStoveStore(state => state.setEditMode);
  // Mobile gate — used to hide actions that depend on HTML5 drag/drop or
  // mouse-based window management (Terminal, parameter/section reorder).
  // Those features just don't work on touch devices and would leave the
  // user with broken UI; better to omit them than to ship dead buttons.
  const isMobile = useIsMobile();
  const currentData = useStoveStore(state => state.currentData);
  const hasCurrentData = useMemo(() => Object.keys(currentData || {}).length > 0, [currentData]);
  
  // Section ordering
  const isSectionReorderMode = useStoveStore(state => state.isSectionReorderMode);
  const setSectionReorderMode = useStoveStore(state => state.setSectionReorderMode);
  const setSectionOrder = useStoveStore(state => state.setSectionOrder);
  const deviceConfig = useStoveStore(state => state.deviceConfig);

  const { connect, disconnect, clientId, ensureActiveClientPresent } = useFirebaseConnection();
  const { testFirestoreConnection } = useParameterDiscovery();
  const { getAllDeviceIds } = useDeviceList();
  const {
    createCategory,
    renameCategory,
    deleteCategory,
    updateParameterCategory,
  } = useCategoryManager(temporaryCategories);
  
  const { getSectionOrder, saveSectionOrder } = useLocalSettings();
  
  // Chat notifications
  const { unreadCount, markAsRead } = useChatNotifications(showChat);

  const { user, hasPermission, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const handlePendingSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error('[ConnectionPanel] Sign out failed:', err);
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut]);

  // Permission flags for cleaner conditions - recalculated when user changes
  const permissionFlags = useMemo(() => {
    const role = String(user?.role || '').toLowerCase().trim();
    const isDev = role === 'developer';
    const isSuper = role === 'super_admin';
    const canManageUsers = !!hasPermission('manage_users');
    
    // Who can see admin controls at all
    const canSeeAdminControls = canManageUsers || isDev || isSuper;
    
    // Who can open Firebase Console
    const canOpenFirebase = isDev || isSuper || canManageUsers;
    // Who can export to C++
    const canExportCpp = isDev || isSuper || role === 'admin';
    
    return {
      role,
      isDev,
      isSuper,
      canManageUsers,
      canSeeAdminControls,
      canOpenFirebase,
      canExportCpp
    };
  }, [user?.role, hasPermission]);
  
  const { role, isDev, isSuper, canManageUsers, canSeeAdminControls, canOpenFirebase, canExportCpp } = permissionFlags;
  const canUseTerminal = (canManageUsers || isDev) && hasPermission('actions.open_terminal');
  const canViewKundenTickets = role === 'admin' || role === 'developer' || role === 'super_admin';
  const isDealerRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/haendler');

  // Derived values for "Alle Werte" (d flag) and "Nur App-Werte" (k flag) from device config
  const dFromStore = useMemo(() => {
    const raw = (deviceConfig as any)?.d;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'ja') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'nein') return false;
      return Boolean(s);
    }
    return false;
  }, [deviceConfig]);
  const kFromStore = useMemo(() => {
    const v = (deviceConfig as any)?.k;
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  }, [deviceConfig]);
  const kManualFlagFromStore = useMemo(() => {
    const v = (deviceConfig as any)?.k_manual;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      return (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
    }
    return false;
  }, [deviceConfig]);

  // Optimistic override while awaiting Firebase confirmation
  const [alleWerteOverride, setAlleWerteOverride] = useState<boolean | null>(null);

  // Keep a precise live value of d directly from Firebase to avoid merge/flicker issues
  const [remoteD, setRemoteD] = useState<boolean | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (deviceId && connectionStatus === 'online' && realtimeDB) {
      const dRef = ref(realtimeDB, `konstant/${deviceId}/d`);
      unsubscribe = onValue(dRef, (snapshot) => {
        if (!snapshot.exists()) {
          setRemoteD(null);
          return;
        }
        const raw = snapshot.val();
        let val: boolean;
        if (typeof raw === 'boolean') val = raw;
        else if (typeof raw === 'number') val = raw !== 0;
        else if (typeof raw === 'string') {
          const s = raw.trim().toLowerCase();
          val = s === 'true' || s === '1' || s === 'yes' || s === 'ja';
        } else {
          val = false;
        }
        setRemoteD(val);
      }, () => {
        setRemoteD(null);
      });
    } else {
      setRemoteD(null);
    }
    return () => {
      try { unsubscribe?.(); } catch {}
    };
  }, [deviceId, connectionStatus]);

  const alleWerteEnabled = useMemo(() => {
    if (deviceId && connectionStatus === 'online') {
      return (alleWerteOverride ?? (remoteD ?? dFromStore));
    }
    // Offline: no preinstallation, default false
    return false;
  }, [deviceId, connectionStatus, dFromStore, alleWerteOverride, remoteD]);

  // Clear optimistic override once server state matches
  useEffect(() => {
    if (alleWerteOverride !== null && alleWerteOverride === dFromStore) {
      setAlleWerteOverride(null);
    }
  }, [dFromStore, alleWerteOverride]);

  // Also clear optimistic override when remoteD matches
  useEffect(() => {
    if (alleWerteOverride !== null && remoteD !== null && alleWerteOverride === remoteD) {
      setAlleWerteOverride(null);
    }
  }, [remoteD, alleWerteOverride]);

  // Reset override when disconnecting
  useEffect(() => {
    if (!(deviceId && connectionStatus === 'online')) {
      setAlleWerteOverride(null);
    }
  }, [deviceId, connectionStatus]);

  const nurAppEnabled = useMemo(() => {
    if (deviceId && connectionStatus === 'online') return kManualFlagFromStore;
    return false;
  }, [deviceId, connectionStatus, kManualFlagFromStore]);

  const handleToggleAlleWerte = useCallback(async () => {
    const next = !alleWerteEnabled;
    // Update remote if connected
    if (deviceId && connectionStatus === 'online' && realtimeDB) {
      try {
        // Ensure this client is registered in active_clients (in case of missed registration)
        try { await ensureActiveClientPresent(deviceId); } catch {}
        // Optimistic UI
        setAlleWerteOverride(next);
        await set(ref(realtimeDB, `konstant/${deviceId}/d`), next);
      } catch (e) {
        console.warn('[ConnectionPanel] Failed to update d in Firebase:', e);
      }
    }
  }, [alleWerteEnabled, deviceId, connectionStatus, ensureActiveClientPresent]);

  const handleToggleNurApp = useCallback(async () => {
    // Offline: do nothing (no preinstallation)
    if (!deviceId || connectionStatus !== 'online' || !realtimeDB) return;
    // Online: toggle k_manual boolean (true => +1 to k, false => +0)
    try {
      // Ensure this client is registered in active_clients (in case of missed registration)
      try { await ensureActiveClientPresent(deviceId); } catch {}
      const kManualRef = ref(realtimeDB, `konstant/${deviceId}/k_manual`);
      await runTransaction(kManualRef, (current) => {
        let cur = false;
        if (typeof current === 'boolean') cur = current;
        else if (typeof current === 'number') cur = current !== 0;
        else if (typeof current === 'string') {
          const s = current.trim().toLowerCase();
          cur = (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
        }
        return !cur;
      });
    } catch (e) {
      console.warn('[ConnectionPanel] Failed to adjust k_manual:', e);
    }
  }, [deviceId, connectionStatus, nurAppEnabled, realtimeDB, ensureActiveClientPresent]);

  const handleClearTemporaer = useCallback(async () => {
    if (!deviceId || connectionStatus !== 'online' || !realtimeDB) return;
    const ok = window.confirm(`Alle Einträge unter /temporaer/${deviceId} löschen?`);
    if (!ok) return;
    setIsClearingTemporaer(true);
    try {
      await remove(ref(realtimeDB, `temporaer/${deviceId}`));
    } catch (e) {
      console.warn('[ConnectionPanel] Failed to clear temporaer:', e);
    } finally {
      setIsClearingTemporaer(false);
    }
  }, [deviceId, connectionStatus, realtimeDB]);

  // State for storing device comments and their listeners
  const [deviceComments, setDeviceComments] = useState<Record<string, string>>({});
  const commentListenersRef = useRef<Record<string, () => void>>({});
  // Export to C++ modal state
  const [showExportCpp, setShowExportCpp] = useState(false);
  const [exportScope, setExportScope] = useState<'all' | 'writable' | 'readable'>('all');
  const [useHighlightedView, setUseHighlightedView] = useState(true);
  const [showPrivileges, setShowPrivileges] = useState(false);
  const [isFixingStats, setIsFixingStats] = useState(false);
  const [fixStatsMessage, setFixStatsMessage] = useState<string | null>(null);
  const writableParameterCount = useMemo(() => {
    if (!discoveredParameters?.length) return 0;
    return discoveredParameters.filter(p => (p as any)?.zugriff && String((p as any).zugriff).includes('w')).length;
  }, [discoveredParameters]);
  const readableOnlyCount = useMemo(() => {
    if (!discoveredParameters?.length) return 0;
    return discoveredParameters.filter(p => {
      const z = String((p as any)?.zugriff || '');
      return z.includes('r') && !z.includes('w');
    }).length;
  }, [discoveredParameters]);
  const paramInfoById = useMemo(() => {
    const map: Record<string, any> = {};
    for (const p of discoveredParameters) {
      map[p.originalName] = p;
    }
    return map;
  }, [discoveredParameters]);
  const categoryOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const p of discoveredParameters) {
      const cat = (p as any)?.kategorie || 'uncategorized';
      if (!seen.has(cat)) {
        seen.add(cat);
        order.push(cat);
      }
    }
    return order;
  }, [discoveredParameters]);

  const includedParamIds = useMemo(() => {
    const ids = Object.keys(currentData || {});
    if (!ids.length) return [] as string[];
    if (exportScope === 'all') return ids;
    return ids.filter(id => {
      const paramInfo = discoveredParameters.find(p => p.originalName === id);
      const z = String((paramInfo as any)?.zugriff || '');
      if (exportScope === 'writable') return z.includes('w');
      // readable only
      return z.includes('r') && !z.includes('w');
    });
  }, [currentData, discoveredParameters, exportScope]);
  const cppExport = useMemo(() => {
    const valueToCpp = (raw: any): string => {
      if (raw === undefined || raw === null) return '0';
      if (typeof raw === 'boolean') return raw ? 'true' : 'false';
      if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '0';
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
        if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
        return `"${trimmed.replace(/"/g, '\\"')}"`;
      }
      return `"${JSON.stringify(raw).replace(/"/g, '\\"')}"`;
    };

    // Group ids by category
    const groups: Record<string, string[]> = {};
    for (const id of includedParamIds) {
      const info = paramInfoById[id];
      const cat = (info?.kategorie || 'uncategorized') as string;
      if (!groups[cat]) groups[cat] = [];
      const valueStr = valueToCpp((currentData as any)[id]);
      const commentRaw = (info?.description || '').trim();
      const commentSingleLine = commentRaw.replace(/\r?\n|\r/g, ', ').replace(/\s{2,}/g, ' ').trim();
      groups[cat].push(`C_OFEN_DEFINITION.${id} = ${valueStr};${commentSingleLine ? ` // ${commentSingleLine}` : ''}`);
    }

    // Category ordering: by first appearance in discoveredParameters, then alphabetical fallback
    const sortedCats = Object.keys(groups).sort((a, b) => {
      const ia = categoryOrder.indexOf(a);
      const ib = categoryOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const textLines: string[] = [];
    for (const cat of sortedCats) {
      const header = `// ${cat}`;
      textLines.push(header);
      const vars = [...groups[cat]].sort((a, b) => a.localeCompare(b));
      textLines.push(...vars);
      textLines.push('');
    }
    const plainText = textLines.join('\n').trim();

    // Very light HTML highlight
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const highlighted = plainText
      .split('\n')
      .map(line => {
        if (line.startsWith('// ')) {
          return `<span class="text-gray-500">${escapeHtml(line)}</span>`;
        }
        const [codePart, commentPart] = (() => {
          const idx = line.indexOf('//');
          if (idx >= 0) return [line.slice(0, idx), line.slice(idx)];
          return [line, ''];
        })();
        const eqIdx = codePart.indexOf('=');
        const semiIdx = codePart.lastIndexOf(';');
        if (eqIdx === -1 || semiIdx === -1 || semiIdx < eqIdx) {
          // Fallback simple highlighting without number replacement to avoid class corruption
          const simple = escapeHtml(codePart)
            .replace(/\bC_OFEN_DEFINITION\b/g, '<span class="text-purple-600 dark:text-purple-400">C_OFEN_DEFINITION</span>')
            .replace(/(=)/g, '<span class="text-gray-500">$1</span>')
            .replace(/(;)/g, '<span class="text-gray-500">$1</span>');
          let html = simple;
          if (commentPart) {
            html += `<span class="text-green-600 dark:text-green-400"> ${escapeHtml(commentPart)}</span>`;
          }
          return html;
        }

        const left = codePart.slice(0, eqIdx);
        const valueRaw = codePart.slice(eqIdx + 1, semiIdx);
        const tail = codePart.slice(semiIdx + 1); // usually empty

        // Left side: only mark namespace
        const leftHtml = escapeHtml(left).replace(/\bC_OFEN_DEFINITION\b/g, '<span class="text-purple-600 dark:text-purple-400">C_OFEN_DEFINITION</span>');

        // Value: highlight booleans and numbers only within value segment
        const valueEsc = escapeHtml(valueRaw);
        const valueHtml = valueEsc
          .replace(/\b([-+]?\d+(?:\.\d+)?)\b/g, '<span class="text-blue-600 dark:text-blue-400">$1</span>')
          .replace(/\b(true|false)\b/g, '<span class="text-pink-600 dark:text-pink-400">$1</span>');

        const eqHtml = '<span class="text-gray-500">=</span>';
        const semiHtml = '<span class="text-gray-500">;</span>';
        const tailHtml = escapeHtml(tail);

        let html = `${leftHtml}${eqHtml}${valueHtml}${semiHtml}${tailHtml}`;
        if (commentPart) {
          html += `<span class="text-green-600 dark:text-green-400"> ${escapeHtml(commentPart)}</span>`;
        }
        return html;
      })
      .join('\n');

    return { plainText, highlightedHtml: highlighted, linesCount: plainText ? plainText.split('\n').length : 0 };
  }, [includedParamIds, currentData, paramInfoById, categoryOrder]);

  // Setup real-time comment listener for a specific device
  const setupCommentListener = useCallback((deviceId: string) => {
    if (!deviceId || !realtimeDB || commentListenersRef.current[deviceId]) return;
    
    const commentRef = ref(realtimeDB, `konstant_app/${deviceId}/comment`);
    
    const unsubscribe = onValue(commentRef, (snapshot) => {
      const comment = snapshot.exists() ? snapshot.val() : '';
      
      setDeviceComments(prev => ({
        ...prev,
        [deviceId]: comment || ''
      }));
    }, (error) => {
      console.error(`Failed to listen to comment for ${deviceId}:`, error);
    });
    
    commentListenersRef.current[deviceId] = unsubscribe;
  }, []);

  // Remove comment listener for a specific device
  const removeCommentListener = useCallback((deviceId: string) => {
    const unsubscribe = commentListenersRef.current[deviceId];
    if (unsubscribe) {
      unsubscribe();
      delete commentListenersRef.current[deviceId];
    }
  }, []);

  // Memoize favorites to prevent re-renders but refresh when needed
  const favorites = useMemo<FavoriteDevice[]>(() => {
    try {
      const stored = localStorage.getItem('firebaseIdFavorites_v2');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, [favoritesRefresh]); // Add dependency on refresh counter

  // Setup comment listeners for all favorites when they change
  useEffect(() => {
    // Setup listeners for current favorites
    favorites.forEach(favorite => {
      setupCommentListener(favorite.id);
    });
    
    // Cleanup listeners for devices no longer in favorites
    const currentFavoriteIds = new Set(favorites.map(f => f.id));
    Object.keys(commentListenersRef.current).forEach(deviceId => {
      if (!currentFavoriteIds.has(deviceId)) {
        removeCommentListener(deviceId);
        // Also remove from state
        setDeviceComments(prev => {
          const newComments = { ...prev };
          delete newComments[deviceId];
          return newComments;
        });
      }
    });
  }, [favorites, setupCommentListener, removeCommentListener]);

  // Cleanup all comment listeners on unmount
  useEffect(() => {
    return () => {
      Object.keys(commentListenersRef.current).forEach(deviceId => {
        removeCommentListener(deviceId);
      });
    };
  }, [removeCommentListener]);

  // Save favorites to localStorage
  const saveFavorites = useCallback((newFavorites: FavoriteDevice[]) => {
    try {
      localStorage.setItem('firebaseIdFavorites_v2', JSON.stringify(newFavorites));
      setFavoritesRefresh(prev => prev + 1); // Trigger refresh
    } catch (error) {
      console.error('Failed to save favorites:', error);
    }
  }, []);

  // Add device to favorites
  const addToFavorites = useCallback((id: string) => {
    if (!id.trim()) return;
    
    const newFavorite: FavoriteDevice = {
      id: id.trim(),
      lastUsed: Date.now(),
    };

    const currentFavorites = favorites;
    const updated = currentFavorites.filter(f => f.id !== newFavorite.id);
    updated.unshift(newFavorite);
    saveFavorites(updated.slice(0, 10)); // Keep max 10 favorites
  }, [favorites, saveFavorites]);

  // Remove from favorites
  const removeFromFavorites = useCallback((id: string) => {
    const updated = favorites.filter(f => f.id !== id);
    saveFavorites(updated);
  }, [favorites, saveFavorites]);

  // Clear all favorites
  const clearFavorites = useCallback(() => {
    if (window.confirm('Are you sure you want to clear all favorites?')) {
      saveFavorites([]);
    }
  }, [saveFavorites]);

  const [copiedLink, setCopiedLink] = useState(false);

  // Computed connection/input state (must be declared before handlers that use them)
  const normalizedInputId = useMemo(() => inputValue.trim(), [inputValue]);
  const isConnected = useMemo(() => !!deviceId && connectionStatus === 'online', [deviceId, connectionStatus]);
  const isDifferentId = useMemo(() => !!normalizedInputId && !!deviceId && normalizedInputId !== deviceId, [normalizedInputId, deviceId]);
  const showConnectButton = useMemo(() => !isConnected, [isConnected]);

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
      console.warn('[ConnectionPanel] Failed to update URL param:', err);
    }
  }, []);

  // Helper: build deep-link URL (?id=...)
  const buildConnectionUrl = useCallback((id: string): string => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('id', id.trim());
      return url.toString();
    } catch {
      return `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(id.trim())}${window.location.hash}`;
    }
  }, []);

  // Copy deep-link to clipboard
  const handleCopyLink = useCallback(async () => {
    const shareId = normalizedInputId || deviceId || '';
    if (!shareId) return;
    const link = buildConnectionUrl(shareId);
    try {
      await navigator.clipboard?.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1600);
    } catch (err) {
      try {
        // Fallback prompt if Clipboard API not available
        window.prompt('Copy link:', link);
      } catch {}
    }
  }, [normalizedInputId, deviceId, buildConnectionUrl]);

  // Performs full state cleanup before switching to a new device.
  // Clears store, device-specific storage keys, and disconnects if needed.
  const performCompleteCleanup = useCallback(async (targetId: string) => {
    setIsCleaningUp(true);
    setCleanupProgress(0);

    // Step 1: Clear store state
    const { clearAllState } = useStoveStore.getState();
    clearAllState();
    setCleanupProgress(20);

    // Step 2: Clear device-specific browser storage (preserve global user prefs)
    try {
      const isDeviceSpecificKey = (key: string | null): boolean => {
        if (!key) return false;
        // Preserve global/user + visual + theme settings
        const preserved = new Set([
          'hase-iq-user-preferences',
          'hase-session-simplification-mode',
          'hase-iq-local-settings', // keep colors/positions/visibility
          'hase-theme-config',      // keep selected theme (default / neo-brutalism)
          'hase-display-configuration-selected', // keep display configuration selection
        ]);
        if (preserved.has(key)) return false;
        return key.startsWith('hase-') || key.includes('device') || key.includes('parameter');
      };

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (isDeviceSpecificKey(key)) localStorage.removeItem(key!);
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (isDeviceSpecificKey(key)) sessionStorage.removeItem(key!);
      }
    } catch (error) {
      console.warn('[ConnectionPanel] Error clearing caches:', error);
    }
    setCleanupProgress(40);

    // Step 3: Disconnect from current device if connected
    if (isConnected && deviceId && targetId !== deviceId) {
      await disconnect();
    }
    setCleanupProgress(60);

    // Step 4: Wait for cleanup to propagate
    await new Promise(resolve => setTimeout(resolve, 5000));
    setCleanupProgress(100);
    await new Promise(resolve => setTimeout(resolve, 100));

    setIsCleaningUp(false);
    setCleanupProgress(0);
  }, [isConnected, deviceId, disconnect]);

  // Initiates connection to the target device after cleanup
  const handleConnect = useCallback(async () => {
    const targetId = inputValue.trim();
    if (!targetId) return;

    setShowSearchResults(false);
    setShowFavorites(false);

    const currentState = useStoveStore.getState();
    if (currentState.connectionStatus === 'connecting' || isCleaningUp) {
      return;
    }

    try {
      await performCompleteCleanup(targetId);
      const ok = await connect(targetId);
      if (ok) {
        updateUrlDeviceParam(targetId);
      } else {
        console.warn('[ConnectionPanel] Connection to', targetId, 'failed');
      }
    } catch (error) {
      console.error('[ConnectionPanel] Connection failed:', error);
      setIsCleaningUp(false);
      setCleanupProgress(0);
    }
  }, [inputValue, isCleaningUp, performCompleteCleanup, connect, updateUrlDeviceParam]);

  // Handle disconnect  
  const handleDisconnect = useCallback(async () => {
    await disconnect();
    updateUrlDeviceParam(undefined);
  }, [disconnect, updateUrlDeviceParam]);

  // Select favorite device
  const selectFavorite = useCallback((id: string) => {
    setInputValue(id);
    setShowFavorites(false);
  }, []);

  // Format favorite display with comment
  const formatFavoriteDisplay = useCallback((deviceId: string): { fullText: string; comment: string } => {
    const comment = deviceComments[deviceId] || '';
    const commentPreview = comment.trim() ? comment.substring(0, 25) + (comment.length > 25 ? '...' : '') : '';
    const fullText = commentPreview ? `${deviceId} – ${commentPreview}` : deviceId;
    
    return {
      fullText,
      comment: comment.trim()
    };
  }, [deviceComments]);

  // Scroll to Data Parameters section
  const scrollToDataParameters = useCallback(() => {
    const dataParametersElement = document.querySelector('[data-section="data-parameters"]');
    if (dataParametersElement) {
      dataParametersElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Load all device IDs on mount for search functionality
  const loadAllDeviceIds = useCallback(async () => {
    if (allDeviceIds.length > 0 && Object.keys(allDeviceComments).length > 0) return; // Already loaded
    
    setIsLoadingDevices(true);
    try {
      const deviceIds = await getAllDeviceIds();
      setAllDeviceIds(deviceIds);

      // Load comments for all devices to enable comment-based search
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

  // Search function
  const searchDevices = useCallback((query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const q = query.toLowerCase();
    const filteredDevices = allDeviceIds.filter(deviceId => {
      const idMatch = deviceId.toLowerCase().includes(q);
      const comment = allDeviceComments[deviceId] || '';
      const commentMatch = comment.toLowerCase().includes(q);
      return idMatch || commentMatch;
    });

    // Show results only if less than 10 found
    if (filteredDevices.length > 0 && filteredDevices.length < 10) {
      setSearchResults(filteredDevices.slice(0, 10)); // Limit to 10 max
      setShowSearchResults(true);
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  }, [allDeviceIds, allDeviceComments]);

  // Handle input change with search
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setShowFavorites(false); // Hide favorites when typing
    
    // Load device IDs if not loaded yet
    if (allDeviceIds.length === 0 && !isLoadingDevices) {
      loadAllDeviceIds();
    }
    
    // Perform search
    searchDevices(value);
  }, [allDeviceIds.length, isLoadingDevices, loadAllDeviceIds, searchDevices]);

  // Select search result
  const selectSearchResult = useCallback((deviceId: string) => {
    setInputValue(deviceId);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  // Get connection status styles - memoized
  const statusStyles = useMemo(() => {
    switch (connectionStatus) {
      case 'online':
        return 'text-success bg-success/10 border-success/30';
      case 'connecting':
        return 'text-warning bg-warning/10 border-warning/30';
      case 'offline':
      default:
        return 'text-destructive bg-destructive/10 border-destructive/30';
    }
  }, [connectionStatus]);

  const statusIcon = useMemo(() => {
    switch (connectionStatus) {
      case 'online':
        return (
          <div className="w-2 h-2 bg-status-online animate-pulse" />
        );
      case 'connecting':
        return (
          <svg className="animate-spin w-3 h-3 text-status-connecting" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V2C5.373 2 2 5.373 2 10h2zm2 5.291A7.962 7.962 0 014 12H2c0 3.042 1.135 5.824 3 7.938l1-0.647z" />
          </svg>
        );
      case 'offline':
      default:
        return (
          <div className="w-2 h-2 bg-status-offline" />
        );
    }
  }, [connectionStatus]);

  const statusText = useMemo(() => {
    switch (connectionStatus) {
      case 'online':
        return t('status.connected');
      case 'connecting':
        return t('status.connecting');
      case 'offline':
      default:
        return t('status.disconnected');
    }
  }, [connectionStatus, t]);

  const activeClientsCount = useMemo(() => Object.keys(activeClients || {}).length, [activeClients]);

  const canUseParameterActions = useMemo(() => {
    const basic = !!deviceId && connectionStatus === 'online' && discoveredParameters.length > 0;
    // viewers and admins shouldn't modify/reorder parameters
    if (role === 'viewer' || role === 'admin') return false;
    return basic;
  }, [deviceId, connectionStatus, discoveredParameters.length, role]);

  // Refs for click outside detection
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [showActions, setShowActions] = useState(false);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
        setShowFavorites(false);
      }
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setShowActions(false);
      }
      if (activeClientsRef.current && !activeClientsRef.current.contains(event.target as Node)) {
        setShowActiveClients(false);
      }
      // no mobile actions dropdown anymore
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSearchResults(false);
        setShowFavorites(false);
        setShowActions(false);
        setShowExportCpp(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, []);

  // Listen to active clients list for the connected device
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (deviceId && connectionStatus === 'online' && realtimeDB) {
      const acRef = ref(realtimeDB, `konstant/${deviceId}/active_clients`);
      unsubscribe = onValue(acRef, (snapshot) => {
        const val = snapshot.exists() ? snapshot.val() : {};
        setActiveClients(val || {});
      }, (error) => {
        console.error('[ConnectionPanel] Active clients listener error:', error);
      });
    } else {
      setActiveClients({});
    }
    return () => {
      try { unsubscribe?.(); } catch {}
    };
  }, [deviceId, connectionStatus]);

  // Ticker for live durations — only runs when the active clients dropdown is open
  // so the entire ConnectionPanel doesn't re-render every second unnecessarily
  useEffect(() => {
    if (!showActiveClients) return;
    setNowTick(Date.now()); // immediate update when dropdown opens
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showActiveClients]);

  const formatDuration = useCallback((sinceIso?: string | number) => {
    if (!sinceIso) return '';
    const sinceMs = typeof sinceIso === 'number' ? sinceIso : Date.parse(String(sinceIso));
    if (!Number.isFinite(sinceMs)) return '';
    const diff = Math.max(0, nowTick - sinceMs);
    const s = Math.floor(diff / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (hh > 0) return `${hh}h ${mm}m`;
    if (mm > 0) return `${mm}m ${ss}s`;
    return `${ss}s`;
  }, [nowTick]);

  // Load section order when device connects
  useEffect(() => {
    if (deviceId && connectionStatus === 'online') {
      const savedOrder = getSectionOrder();
      if (savedOrder.length > 0) {
        setSectionOrder(savedOrder);
      } else {
        // Set default order if nothing saved
        const defaultOrder = ['stove-management', 'secondary-categories', 'main-and-airflow', 'charts'];
        setSectionOrder(defaultOrder);
        saveSectionOrder(defaultOrder);
      }
    }
  }, [deviceId, connectionStatus, getSectionOrder, setSectionOrder, saveSectionOrder]);

  // Section ordering functions
  const toggleSectionReorderMode = useCallback(() => {
    setSectionReorderMode(!isSectionReorderMode);
  }, [isSectionReorderMode, setSectionReorderMode]);

  // Memoized handler for temporary categories changes to prevent infinite re-renders
  const handleTemporaryCategoriesChange = useCallback((categories: string[]) => {
    setTemporaryCategories(categories);
    onTemporaryCategoriesChange?.(categories);
  }, [onTemporaryCategoriesChange]);

  // Handle open users list modal
  const handleOpenChatSelector = useCallback(() => {
    setShowUsersList(true);
  }, []);

  const navigateToDealerMode = useCallback(() => {
    if (typeof window === 'undefined') return;
    const next = `/haendler${window.location.search}${window.location.hash}`;
    window.location.assign(next);
  }, []);

  const navigateToClassicMode = useCallback(() => {
    if (typeof window === 'undefined') return;
    const next = `/${window.location.search}${window.location.hash}`;
    window.location.assign(next);
  }, []);

  // Handle start chat with specific user or general chat
  const handleStartChat = useCallback((targetUser: any) => {
    setChatTarget(targetUser);
    setShowChat(true);
    setShowUsersList(false);
    // Mark messages as read when opening chat
    markAsRead();
  }, [markAsRead]);

  // Copy monthly statistics Jan–Jun from 2025 to 2026 for all devices (skip if destination exists)
  const handleFixStatistik2026 = useCallback(async () => {
    if (!realtimeDB) {
      setFixStatsMessage('Kein Realtime DB verfügbar.');
      return;
    }
    setIsFixingStats(true);
    setFixStatsMessage(null);
    try {
      const isRecord = (val: unknown): val is Record<string, any> => {
        return !!val && typeof val === 'object' && !Array.isArray(val);
      };
      const rootRef = ref(realtimeDB, 'statistik_monat_tage');
      const rootSnap = await get(rootRef);
      if (!rootSnap.exists()) {
        setFixStatsMessage('Keine Daten unter /statistik_monat_tage gefunden.');
        return;
      }

      const months = ['1', '2', '3', '4', '5', '6'];
      const updates: Record<string, any> = {};
      let copied = 0;
      let merged = 0;
      let addedEntries = 0;
      let skipped = 0;

      rootSnap.forEach(deviceSnap => {
        const did = deviceSnap.key;
        if (!did) return;
        months.forEach(month => {
          const srcPath = `2025/${month}`;
          const dstPath = `2026/${month}`;
          const srcExists = deviceSnap.child(srcPath).exists();
          const dstExists = deviceSnap.child(dstPath).exists();
          if (!srcExists) return;
          const srcVal = deviceSnap.child(srcPath).val();
          if (!dstExists) {
            updates[`statistik_monat_tage/${did}/${dstPath}`] = srcVal;
            copied += 1;
            return;
          }
          const dstVal = deviceSnap.child(dstPath).val();
          if (!isRecord(srcVal) || !isRecord(dstVal)) {
            skipped += 1;
            return;
          }
          let changed = false;
          const mergedVal: Record<string, any> = { ...dstVal };
          Object.keys(srcVal).forEach(key => {
            if (!(key in mergedVal)) {
              mergedVal[key] = srcVal[key];
              changed = true;
              addedEntries += 1;
            }
          });
          if (changed) {
            updates[`statistik_monat_tage/${did}/${dstPath}`] = mergedVal;
            merged += 1;
          } else {
            skipped += 1;
          }
        });
      });

      if (Object.keys(updates).length > 0) {
        await update(ref(realtimeDB), updates);
        setFixStatsMessage(`Fertig: ${copied} Monate kopiert, ${merged} Monate ergänzt, ${addedEntries} Einträge hinzugefügt, ${skipped} übersprungen.`);
      } else {
        setFixStatsMessage('Nichts zu kopieren (alles fehlt oder schon vorhanden).');
      }
    } catch (err) {
      console.error('[ConnectionPanel] Statistik-Korrektur fehlgeschlagen:', err);
      setFixStatsMessage('Fehler beim Kopieren. Details in der Konsole.');
    } finally {
      setIsFixingStats(false);
    }
  }, [realtimeDB]);

  // Global hotkey for quick terminal access.
  // Alt+Shift+T is browser-safe and avoids common conflicts (Ctrl+L, Ctrl+T, etc.).
  // Also gated by !isMobile so a desktop browser scaled into responsive mode
  // doesn't open the unusable terminal window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canUseTerminal || isMobile) return;
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 't')) return;

      const target = event.target as HTMLElement | null;
      const isTypingContext =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.getAttribute('contenteditable') === 'true');
      if (isTypingContext) return;

      event.preventDefault();
      setShowTerminal(true);
      setShowActions(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUseTerminal, isMobile]);

  // Special render for pending users - only show logo
  if (role === 'pending') {
    return (
      <div className="bg-card rounded-xl border border-border p-6 mb-3">
        <div className="flex flex-col items-center justify-center gap-4">
          <img 
            key={`logo-${domIsDark ? 'dark' : 'light'}`}
            src="/data/hasenradar-logo.svg" 
            alt="Hasenradar Logo" 
            style={{ 
              imageRendering: 'auto', 
              width: '8rem', 
              height: '3rem',
              filter: domIsDark ? 'invert(1)' : 'invert(0)'
            }}
          />
          <p className="text-sm text-muted-foreground text-center">
            {t('auth.pendingApproval', 'Your account is pending approval')}
          </p>
          <button
            onClick={handlePendingSignOut}
            disabled={isSigningOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSigningOut ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                {t('userSettings.account.signingOut')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                {t('userSettings.account.signOut')}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  const actionSections: Array<{
    key: string;
    title: string;
    items: Array<{
      key: string;
      label: React.ReactNode;
      onClick: () => void;
      icon: React.ReactNode;
      disabled?: boolean;
      active?: boolean;
      title?: string;
    }>;
  }> = [];

  const panelItems: typeof actionSections[number]['items'] = [];
  if (isDev || isSuper) {
    panelItems.push({
      key: 'open-param-list',
      label: t('connectionPanel.openParamList'),
      onClick: () => { onOpenParameterList?.(); setShowActions(false); },
      icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
    });
  }
  // Parameter and section reorder both depend on HTML5 drag-and-drop, which
  // the browser does not deliver touch events for. Hidden on mobile to avoid
  // a button that turns the UI into edit mode the user can't actually use.
  if (!isMobile) {
    panelItems.push(
      {
        key: 'reorder-params',
        label: isEditMode ? t('connectionPanel.doneReorderParams') : t('connectionPanel.reorderParams'),
        onClick: () => {
          if (canUseParameterActions && !(role === 'viewer' || role === 'admin')) setEditMode(!isEditMode);
          setShowActions(false);
        },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>,
        disabled: !canUseParameterActions || (role === 'viewer' || role === 'admin')
      },
      {
        key: 'reorder-sections',
        label: isSectionReorderMode ? t('connectionPanel.doneReorderSections') : t('connectionPanel.reorderSections'),
        onClick: () => { toggleSectionReorderMode(); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>,
        active: isSectionReorderMode
      }
    );
  }
  // Skip the section entirely if it has no items (e.g. mobile non-dev user
  // after reorder/edit-mode entries are hidden).
  if (panelItems.length > 0) {
    actionSections.push({ key: 'panel', title: t('connectionPanel.actions'), items: panelItems });
  }

  // ── Help / Documentation ──────────────────────────────────────────────
  // Single entry that opens the in-app docs modal. Available for everyone,
  // including pending users — knowing what the app is supposed to do should
  // never be gated.
  actionSections.push({
    key: 'help',
    title: t('connectionPanel.help'),
    items: [
      {
        key: 'docs',
        label: t('connectionPanel.docs'),
        onClick: () => { setShowDocs(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
      }
    ]
  });

  actionSections.push({
    key: 'communication',
    title: 'Communication',
    items: [
      {
        key: 'chat',
        label: (
          <>
            {t('connectionPanel.chat')}
            {unreadCount.total > 0 && (<span className="ml-auto text-xs font-medium text-destructive">{unreadCount.total > 9 ? '9+' : unreadCount.total}</span>)}
          </>
        ),
        onClick: () => { handleOpenChatSelector(); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
      },
      {
        key: 'updates',
        label: t('connectionPanel.updates'),
        onClick: () => { setShowUpdates(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
      },
      {
        key: 'tickets',
        label: t('connectionPanel.tickets'),
        onClick: () => { setShowTickets(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
      },
      ...(canViewKundenTickets
        ? [
            {
              key: 'kunden-tickets',
              label: t('connectionPanel.kundenTickets'),
              onClick: () => { setShowKundenTickets(true); setShowActions(false); },
              icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" /></svg>
            }
          ]
        : []),
      {
        key: 'notification-history',
        label: t('notifications.history', 'Notification History'),
        onClick: () => { setShowNotificationHistory(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
      }
    ]
  });

  const preferencesItems: typeof actionSections[number]['items'] = [
    {
      key: 'scroll-to-data',
      label: t('connectionPanel.scrollToData'),
      onClick: () => { scrollToDataParameters(); setShowActions(false); },
      icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
    },
    {
      key: 'toggle-theme',
      label: t('connectionPanel.toggleTheme'),
      onClick: () => { toggleTheme(); setShowActions(false); },
      icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m8-9h1M3 12H2m15.364 6.364l.707.707M5.636 5.636l-.707-.707m12.728 0l-.707.707M5.636 18.364l-.707.707" /></svg>
    },
    {
      key: 'switch-dealer-mode',
      label: isDealerRoute ? t('connectionPanel.openClassicMode') : t('connectionPanel.openDealerMode'),
      onClick: () => {
        if (isDealerRoute) {
          navigateToClassicMode();
        } else {
          navigateToDealerMode();
        }
        setShowActions(false);
      },
      icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7m5 0h4m-4 0l2-2m-2 2l2 2" /></svg>
    }
  ];
  if (canExportCpp && hasPermission('actions.export_cpp')) {
    preferencesItems.push({
      key: 'export-cpp',
      label: t('connectionPanel.exportCpp'),
      onClick: () => { setShowExportCpp(true); setShowActions(false); },
      icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
      disabled: !hasCurrentData,
      title: hasCurrentData ? (t('connectionPanel.exportTooltip') as string) : (t('connectionPanel.noValuesExport') as string)
    });
  }
  actionSections.push({ key: 'preferences', title: 'Preferences', items: preferencesItems });

  if (canSeeAdminControls) {
    const adminItems: typeof actionSections[number]['items'] = [];
    if ((isDev || isSuper) && hasPermission('actions.get_device_list')) {
      adminItems.push({
        key: 'get-device-list',
        label: t('connectionPanel.getDeviceList'),
        onClick: () => { loadAllDeviceIds(); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
      });
      if (hasPermission('actions.test_firestore')) {
        adminItems.push({
          key: 'test-firestore',
          label: t('connectionPanel.testFirestore'),
          onClick: () => { testFirestoreConnection(); setShowActions(false); },
          icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        });
      }
    }
    // Terminal is desktop-only — it uses mouse-event-driven drag/resize and
    // a floating-window layout that genuinely doesn't work on touch. Hidden
    // from the menu on phones; users on tablet (>768 px) still see it.
    if (canUseTerminal && !isMobile) {
      adminItems.push({
        key: 'open-terminal',
        label: `${t('connectionPanel.openTerminal')} (Alt+Shift+T)`,
        onClick: () => { setShowTerminal(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
      });
    }
    if (canOpenFirebase && hasPermission('actions.open_firebase_console')) {
      adminItems.push({
        key: 'open-firebase',
        label: t('connectionPanel.openFirebaseConsole'),
        onClick: () => { setShowFirebaseConsole(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s8-1.79 8-4" /></svg>
      });
    }
    if (hasPermission('users.manage')) {
      adminItems.push({
        key: 'user-management',
        label: t('connectionPanel.userManagement'),
        onClick: () => { onOpenAdminPanel?.(); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
      });
    }
    if ((canManageUsers || isDev || isSuper) && hasPermission('users.manage_privileges')) {
      adminItems.push({
        key: 'manage-privileges',
        label: t('privileges.managePrivileges'),
        onClick: () => { setShowPrivileges(true); setShowActions(false); },
        icon: <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
      });
    }
    if (adminItems.length > 0) {
      actionSections.push({ key: 'admin', title: 'Admin', items: adminItems });
    }
  }

  return (
    <>
      {/* Connection panel container - uses themed colors so Neo Brutalism & other themes apply */}
      <div className="bg-card rounded-xl border border-border border-t border-t-border p-3 sm:p-4 mb-3 shadow-theme-sm">
        {/* Mobile-responsive layout */}
        <div className="flex flex-col flex-wrap gap-3 space-y-3.5 xl:flex-row xl:items-center xl:justify-between xl:space-y-0">
          {/* Top row: Logo + status */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <img
                key={`logo-${domIsDark ? 'dark' : 'light'}`}
                src="/data/hasenradar-logo.svg"
                alt="Hasenradar Logo"
                className="w-24 sm:w-28 flex-shrink-0"
                style={{ imageRendering: 'auto', height: '3rem', filter: domIsDark ? 'invert(1)' : 'invert(0)' }}
              />
              {deviceId && connectionStatus === 'online' && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 bg-muted border border-border rounded-lg min-w-0 max-w-full">
                  <span className="w-2 h-2 bg-status-online rounded-full animate-pulse" />
                  {/* Hide the verbose "Verbundenen Controller:" label on
                      narrower laptops — its long text was the difference
                      between the topbar fitting and overflowing on 13". */}
                  <span className="hidden xl:inline text-xs text-muted-foreground whitespace-nowrap">{t('connectionPanel.connectedController')}</span>
                  <div className="relative flex items-center min-w-0 gap-1.5 sm:gap-2" ref={activeClientsRef}>
                    {/* Truncate the full 22-digit device ID more aggressively
                        on every breakpoint up to xl. The ID is also visible
                        in the connection input below — no need to repeat it
                        in full here. */}
                    <span className="font-mono text-xs font-medium text-foreground truncate max-w-[150px] sm:max-w-[200px] lg:max-w-[150px] xl:max-w-[260px]">{deviceId}</span>
                    {activeClientsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowActiveClients(v => !v)}
                        className="ml-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center hover:bg-primary/80 transition-colors"
                        title={t('connectionPanel.activeClients') as string}
                      >
                        {activeClientsCount}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCopyLink}
                        className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${copiedLink ? 'bg-success text-success-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                      title={t('connectionPanel.copyLink', 'Copy connection link') as string}
                    >
                      {copiedLink ? (
                        <>
                          <span className="sm:hidden">✓</span>
                          <span className="hidden sm:inline">✓ Copied</span>
                        </>
                      ) : (
                        <>
                          <span className="sm:hidden">Copy</span>
                          <span className="hidden sm:inline">Copy Link</span>
                        </>
                      )}
                    </button>
                    {showActiveClients && activeClientsCount > 0 && (
                      <div className="absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-1.5rem))] bg-card/85 backdrop-blur-md border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                        <div className="px-3 py-2.5 border-b border-border text-xs font-medium text-foreground">
                          {t('connectionPanel.currentlyConnected')}
                        </div>
                        <div className="max-h-72 overflow-y-auto divide-y divide-border">
                          {Object.entries(activeClients).map(([cid, info]) => {
                            let name = (info as any)?.name as string | undefined;
                            const isUnknown = !name || !String(name).trim() || String(name).trim().toLowerCase() === 'unknown';
                            if (isUnknown && cid === clientId) {
                              const fallback = (user?.displayName || user?.email || '').toString().trim();
                              if (fallback) {
                                name = fallback;
                                const key = `${deviceId}:${cid}`;
                                if (!namePatchedRef.current.has(key) && realtimeDB) {
                                  namePatchedRef.current.add(key);
                                  try {
                                    const targetRef = ref(realtimeDB, `konstant/${deviceId}/active_clients/${cid}`);
                                    update(targetRef, { name: fallback }).catch(() => {});
                                  } catch {}
                                }
                              }
                            }
                            if (!name || !String(name).trim()) name = 'Unknown';
                            const timeIso = (info as any)?.connected_at || (info as any)?.timestamp;
                            const duration = formatDuration(timeIso);
                            return (
                              <div key={cid} className="px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium text-foreground truncate">{name}</span>
                                  {duration && (
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                      {t('connectionPanel.watchingFor', { time: duration })}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{cid}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile status (when not connected) */}
            <div className="lg:hidden">
              {connectionStatus !== 'online' && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${statusStyles}`}>
                  {statusIcon}
                  {statusText}
                </span>
              )}
            </div>
          </div>

          {/* Second row: Connection Controls */}
          {role !== 'pending' && (
            <div className="flex flex-col space-y-3 lg:flex-row lg:items-center lg:justify-between lg:space-y-0 lg:gap-4">
              {/* Live controls for data sending and app-only values */}
              <div className="flex flex-col gap-1.5 lg:min-w-[260px] xl:min-w-[320px]">
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 mr-1 self-center">Monitoring</span>
                  <button
                    onClick={handleClearTemporaer}
                    disabled={!(deviceId && connectionStatus === 'online') || isClearingTemporaer}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors border ${
                      (deviceId && connectionStatus === 'online') && !isClearingTemporaer
                        ? 'border-destructive/30 text-destructive bg-card/60 hover:bg-destructive/10'
                        : 'border-border/60 text-muted-foreground bg-card/60 opacity-40 cursor-not-allowed'
                    }`}
                    title={deviceId ? `Löscht /temporaer/${deviceId}` : 'Kein Gerät verbunden'}
                  >
                    {isClearingTemporaer ? 'Lösche…' : 'Temp löschen'}
                  </button>
                  <button
                    onClick={handleToggleAlleWerte}
                    disabled={!(deviceId && connectionStatus === 'online')}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors border ${
                      alleWerteEnabled
                        ? 'bg-primary/15 text-primary border-primary/30 ' + (deviceId && connectionStatus === 'online' ? 'hover:bg-primary/20' : 'opacity-50 cursor-not-allowed')
                        : 'bg-card/60 border-border/60 text-muted-foreground ' + (deviceId && connectionStatus === 'online' ? 'hover:bg-card' : 'opacity-50 cursor-not-allowed')
                    }`}
                  >
                    Alle Werte: {alleWerteEnabled ? 'Ja' : 'Nein'}
                  </button>
                  <button
                    onClick={handleToggleNurApp}
                    disabled={!(deviceId && connectionStatus === 'online')}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors border ${
                      nurAppEnabled
                        ? 'bg-primary/15 text-primary border-primary/30 ' + (deviceId && connectionStatus === 'online' ? 'hover:bg-primary/20' : 'opacity-50 cursor-not-allowed')
                        : 'bg-card/60 border-border/60 text-muted-foreground ' + (deviceId && connectionStatus === 'online' ? 'hover:bg-card' : 'opacity-50 cursor-not-allowed')
                    }`}
                    title="Toggle increments/decrements k by 1"
                  >
                    Nur App: {nurAppEnabled ? 'Ja' : 'Nein'}
                  </button>
                </div>
                <div className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border text-center lg:text-left ${
                  !alleWerteEnabled && (kFromStore === 0)
                    ? 'text-muted-foreground bg-muted border-border'
                    : alleWerteEnabled && (kFromStore === 0)
                    ? 'text-success bg-success/10 border-success/30'
                    : !alleWerteEnabled && (kFromStore > 0)
                    ? 'text-foreground bg-muted border-border'
                    : 'text-success bg-success/10 border-success/30'
                }`}>
                  {!alleWerteEnabled && kFromStore === 0 && 'Keine Werte beobachten'}
                  {alleWerteEnabled && kFromStore === 0 && 'Alle Werte beobachten'}
                  {alleWerteEnabled && kFromStore > 0 && 'Alle Werte beobachten'}
                  {!alleWerteEnabled && kFromStore > 0 && 'Nur App-Werte beobachten'}
                </div>
              </div>

              {/* Connection Controls */}
              <div className="flex items-center w-full lg:flex-1 lg:justify-end">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-0 w-full lg:w-auto lg:min-w-[420px] xl:min-w-[520px]">
                  <div className="relative flex-1" ref={searchContainerRef}>
                    <div className="flex items-stretch w-full">
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
                        placeholder={t('connectionPanel.firebaseIdPlaceholder') as string}
                        disabled={connectionStatus === 'connecting'}
                        title={isDifferentId ? (t('connectionPanel.differentIdWarning') as string) : ''}
                        className={`flex-1 min-w-0 px-3 py-2.5 border rounded-l-lg text-sm font-mono bg-card text-foreground placeholder-muted-foreground disabled:bg-muted disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${isDifferentId ? 'border-warning/50 focus:ring-warning' : 'border-border focus:ring-ring'}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowFavorites(!showFavorites)}
                        className="px-2.5 py-2.5 bg-muted border-y border-border hover:bg-accent transition-colors flex items-center rounded-r-lg sm:rounded-r-none"
                        title={t('connectionPanel.favorites') as string}
                      >
                        <svg className="w-4 h-4 text-muted-foreground" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      </button>
                    </div>

                    {isDifferentId && (
                      <p className="mt-1.5 text-xs text-warning">{t('connectionPanel.differentIdWarning')}</p>
                    )}

                  {/* Favorites Dropdown */}
                  {showFavorites && (
                    <div className="absolute top-full left-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] sm:w-80 bg-card/85 backdrop-blur-md border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-border flex justify-between items-center">
                        <h3 className="text-sm font-medium text-foreground">{t('connectionPanel.favorites')}</h3>
                        <button onClick={clearFavorites} className="text-xs text-destructive hover:opacity-80 font-medium transition-colors" title={t('connectionPanel.clearAll') as string}>{t('connectionPanel.clearAll')}</button>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {favorites.length === 0 ? (
                          <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t('connectionPanel.noFavorites')}</p>
                        ) : (
                          <div className="divide-y divide-border">
                            {favorites.map((favorite) => {
                              const display = formatFavoriteDisplay(favorite.id);
                              return (
                                <div key={favorite.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-accent cursor-pointer group transition-colors">
                                  <div onClick={() => selectFavorite(favorite.id)} className="flex-1 min-w-0" title={`Connect to ${favorite.id}${display.comment ? `\nComment: ${display.comment}` : ''}`}>
                                    <div className="text-sm text-foreground font-mono truncate">{favorite.id}</div>
                                    {display.comment && (
                                      <div className="text-xs text-muted-foreground truncate mt-0.5">{display.comment.substring(0, 40)}{display.comment.length > 40 ? '...' : ''}</div>
                                    )}
                                  </div>
                                  <button onClick={() => removeFromFavorites(favorite.id)} className="ml-2 p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all" title={t('connectionPanel.remove') as string}>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2.5 border-t border-border">
                        <button onClick={() => { if (inputValue.trim()) { addToFavorites(inputValue.trim()); setShowFavorites(false); } }} disabled={!inputValue.trim()} className="w-full px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                          {t('connectionPanel.addCurrent')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Search Results Dropdown */}
                  {showSearchResults && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 mt-2 w-[min(18rem,calc(100vw-1.5rem))] sm:w-72 bg-card/85 backdrop-blur-md border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-border flex justify-between items-center">
                        <h3 className="text-sm font-medium text-foreground">{t('connectionPanel.searchResults')}</h3>
                        <span className="text-xs text-muted-foreground">{t('connectionPanel.foundCount', { count: searchResults.length })}</span>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-border">
                        {searchResults.map((did) => {
                          const comment = (allDeviceComments[did] || '').trim();
                          return (
                            <div key={did} onClick={() => selectSearchResult(did)} className="px-3 py-2.5 hover:bg-accent cursor-pointer transition-colors" title={`${t('connectionPanel.clickToSelect')}`}>
                              <div className="text-sm text-foreground font-mono">{did}</div>
                              {comment && (
                                <div className="text-xs text-muted-foreground truncate mt-0.5">{comment.substring(0, 60)}{comment.length > 60 ? '...' : ''}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="px-3 py-2 border-t border-border">
                        <p className="text-xs text-muted-foreground">{t('connectionPanel.clickToSelect')}</p>
                      </div>
                    </div>
                  )}
                  </div>
                  <button
                    onClick={showConnectButton ? handleConnect : handleDisconnect}
                    disabled={(showConnectButton && (!normalizedInputId || connectionStatus === 'connecting' || isCleaningUp)) || (!showConnectButton && connectionStatus === 'connecting')}
                    className={`px-4 py-2.5 rounded-lg sm:rounded-l-none sm:rounded-r-lg text-sm font-medium min-w-[96px] sm:min-w-[110px] flex items-center justify-center transition-colors border sm:border-l-0 border-border disabled:opacity-50 disabled:cursor-not-allowed ${
                      showConnectButton
                        ? 'bg-primary text-primary-foreground hover:bg-primary/80'
                        : 'bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    {showConnectButton ? (
                      isCleaningUp ? (
                        <div className="flex flex-col items-center justify-center">
                          <span className="text-xs font-medium">Connecting</span>
                          <div className="w-14 h-1 bg-muted-foreground rounded-full mt-1 overflow-hidden">
                            <div
                              className="h-full bg-card transition-all duration-300 ease-out"
                              style={{ width: `${cleanupProgress}%` }}
                            />
                          </div>
                        </div>
                      ) : connectionStatus === 'connecting' ? (
                        <>
                          <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-1.5" />
                          <span>{t('status.connecting')}</span>
                        </>
                      ) : (
                        'Connect'
                      )
                    ) : (
                      'Disconnect'
                    )}
                  </button>
                </div>
              </div>

              {/* Quick actions on mobile (compact, with main actions menu) */}
              <div className="flex items-center justify-center lg:hidden w-full pt-1">
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={handleOpenChatSelector}
                    className="relative w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                    title={t('connectionPanel.chat') as string}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                    {unreadCount.total > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-4 text-center font-semibold">
                        {unreadCount.total > 9 ? '9+' : unreadCount.total}
                      </span>
                    )}
                  </button>
                  <button onClick={() => setShowUserSettings(true)} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors" title={t('connectionPanel.userSettings') as string}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </button>
                  <button onClick={toggleTheme} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors" title={t('connectionPanel.toggleTheme') as string}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m8-9h1M3 12H2m15.364 6.364l.707.707M5.636 5.636l-.707-.707m12.728 0l-.707.707M5.636 18.364l-.707.707" /></svg>
                  </button>
                </div>
              </div>


              {/* Desktop controls */}
              <div className="hidden lg:flex items-center gap-1.5 ml-2">
                <button onClick={() => setShowUserSettings(true)} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors" title={t('connectionPanel.userSettings') as string}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </button>
                <button onClick={handleOpenChatSelector} className="relative w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors" title={t('connectionPanel.chat') as string}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                  {unreadCount.total > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-4 text-center font-semibold">
                      {unreadCount.total > 9 ? '9+' : unreadCount.total}
                    </span>
                  )}
                </button>
                <div className="w-px h-4 bg-border/60" />

                {/* Actions dropdown */}
                <div className="relative" ref={actionsMenuRef}>
                  <button onClick={() => setShowActions(v => !v)} className="h-8 px-3 inline-flex items-center gap-1.5 border border-border text-sm font-medium text-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors" title={t('connectionPanel.actions') as string}>
                    {t('connectionPanel.actions')}
                    <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {showActions && (
                    <div className="absolute right-0 mt-2 w-64 bg-card/85 backdrop-blur-md border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                      <div className="py-1">
                        {actionSections.map((section, sectionIndex) => (
                          <React.Fragment key={section.key}>
                            {sectionIndex > 0 && <div className="my-1 border-t border-border" />}
                            <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {section.title}
                            </div>
                            {section.items.map((item) => (
                              <button
                                key={item.key}
                                onClick={item.onClick}
                                disabled={item.disabled}
                                title={item.title}
                                className={`w-full px-3 py-2 text-left text-sm flex items-center transition-colors ${
                                  item.disabled
                                    ? 'text-muted-foreground cursor-not-allowed'
                                    : item.active
                                      ? 'text-foreground bg-muted'
                                      : 'text-foreground hover:bg-accent'
                                }`}
                              >
                                {item.icon}
                                {item.label}
                              </button>
                            ))}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {deviceId && connectionStatus === 'offline' && (
        <div className="flex items-center gap-2 px-3 py-2 mt-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl shadow-theme-xs">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{t('status.connectionLost')}</span>
        </div>
      )}

      {/* Modals and overlays */}
      <UserSettingsModal
        isOpen={showUserSettings}
        onClose={() => setShowUserSettings(false)}
        onOpenCategories={() => { setShowUserSettings(false); setShowCategories(true); }}
        onOpenAdminPanel={onOpenAdminPanel}
      />
      <CategoriesModal
        isOpen={showCategories}
        onClose={() => setShowCategories(false)}
        parameters={discoveredParameters}
        onUpdateParameterCategory={updateParameterCategory}
        onCreateCategory={createCategory}
        onRenameCategory={renameCategory}
        onDeleteCategory={deleteCategory}
        onTemporaryCategoriesChange={handleTemporaryCategoriesChange}
      />
      <UsersListModal isOpen={showUsersList} onClose={() => setShowUsersList(false)} onStartChat={handleStartChat} />
      <ChatSystem isOpen={showChat} onClose={() => setShowChat(false)} targetUser={chatTarget} />
      <UpdatesPanel isOpen={showUpdates} onClose={() => setShowUpdates(false)} />
      <TicketSystem isOpen={showTickets} onClose={() => setShowTickets(false)} />
      <KundenTicketsInbox isOpen={showKundenTickets} onClose={() => setShowKundenTickets(false)} />
      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />
      <NotificationHistory 
        isOpen={showNotificationHistory} 
        onClose={() => setShowNotificationHistory(false)} 
        onAlarmClick={(deviceId, parameterName) => {
          setShowNotificationHistory(false); // Close history modal
          onAlarmClick?.(deviceId, parameterName); // Navigate to alarm
        }}
      />
      <Terminal isOpen={showTerminal} onClose={() => setShowTerminal(false)} />
      <FirebaseConsole isOpen={showFirebaseConsole} onClose={() => setShowFirebaseConsole(false)} />
      <PrivilegesManagerModal isOpen={showPrivileges} onClose={() => setShowPrivileges(false)} />
      {fixStatsMessage && (
          <div className="mt-2 px-3 py-2 text-sm rounded-lg border border-border bg-muted text-foreground">
          {fixStatsMessage}
        </div>
      )}
      {/* Export to C++ Modal */}
      {showExportCpp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowExportCpp(false)}>
          <div className="bg-card rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Export parameters to C++</h2>
              <button onClick={() => setShowExportCpp(false)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground font-medium">Scope:</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setExportScope('all')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${exportScope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>All</button>
                  <button onClick={() => setExportScope('writable')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${exportScope === 'writable' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>Writable ({writableParameterCount})</button>
                  <button onClick={() => setExportScope('readable')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${exportScope === 'readable' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>Readable only ({readableOnlyCount})</button>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{cppExport.linesCount} lines</span>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-border text-foreground focus:ring-ring" checked={useHighlightedView} onChange={(e) => setUseHighlightedView(e.target.checked)} />
                Highlight syntax
              </label>

              {useHighlightedView ? (
                <div className="rounded-lg border border-border overflow-y-auto bg-muted h-96">
                  <pre className="m-0 p-4 text-xs font-mono text-foreground leading-relaxed" dangerouslySetInnerHTML={{ __html: cppExport.highlightedHtml }} />
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <textarea
                    value={cppExport.plainText}
                    readOnly
                    className="w-full h-96 px-4 py-3 bg-muted text-foreground text-xs font-mono resize-none outline-none leading-relaxed"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">Format: C_OFEN_DEFINITION.&lt;Parameter-Name&gt; = &lt;Parameter-Wert&gt;;</p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => { navigator.clipboard?.writeText(cppExport.plainText); }}
                className="px-4 py-2 text-sm font-medium text-foreground hover:bg-accent rounded-md transition-colors"
              >
                {t('actions.copy')}
              </button>
              <button onClick={() => setShowExportCpp(false)} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/80 transition-colors">{t('actions.close')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ConnectionPanel;
