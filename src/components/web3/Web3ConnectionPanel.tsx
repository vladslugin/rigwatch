import * as React from 'react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  MessageCircle,
  ChevronDown,
  Power,
  LogOut,
  Settings,
  Loader2,
  X,
  Star,
  Copy,
  Check,
  Users,
  AlertTriangle,
  MoreVertical,
} from 'lucide-react';
import { useFirebaseConnection, useDeviceList } from '../../hooks/useFirebase';
import { useParameterDiscovery } from '../../hooks/useParameterDiscovery';
import { useStoveStore } from '../../store/useStoveStore';
import UserSettingsModal from '../UserSettingsModal';
import CategoriesModal from '../CategoriesModal';
import ChatSystem from '../ChatSystem';
import UsersListModal from '../UsersListModal';
import UpdatesPanel from '../UpdatesPanel';
import TicketSystem from '../TicketSystem';
import KundenTicketsInbox from '../KundenTicketsInbox';
import DocsModal from '../DocsModal';
import Terminal from '../Terminal';
import PrivilegesManagerModal from '../PrivilegesManagerModal';
import FirebaseConsole from '../FirebaseConsole';
import NotificationHistory from '../NotificationHistory';
import { useCategoryManager } from '../../hooks/useCategoryManager';
import { useLocalSettings } from '../../hooks/useLocalSettings';
import { useChatNotifications } from '../../hooks/useChatNotifications';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { ref, get, onValue, update, set, runTransaction, remove } from 'firebase/database';
import { realtimeDB } from '../../lib/firebase';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { extractSeriennr } from '../../utils/seriennrResolver';

interface FavoriteDevice {
  id: string;
  name?: string;
  lastUsed: number;
  comment?: string;
}

interface ConnectionPanelProps {
  onTemporaryCategoriesChange?: (categories: string[]) => void;
  onOpenAdminPanel?: () => void;
  onOpenParameterList?: () => void;
  onAlarmClick?: (deviceId: string, parameterName: string) => void;
}

const Web3ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  onTemporaryCategoriesChange,
  onOpenAdminPanel,
  onOpenParameterList,
  onAlarmClick,
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
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);
  const [showFavorites, setShowFavorites] = useState(false);
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

  // Listen for shell-sidebar requests to open the Docs / User-Settings modals.
  // Sidebar lives in ShellLayout (no direct ref to this panel), so we use a
  // window-level CustomEvent as a decoupled bridge.
  useEffect(() => {
    const openDocs = () => setShowDocs(true);
    const openSettings = () => setShowUserSettings(true);
    window.addEventListener('shell-open-docs', openDocs);
    window.addEventListener('shell-open-settings', openSettings);
    return () => {
      window.removeEventListener('shell-open-docs', openDocs);
      window.removeEventListener('shell-open-settings', openSettings);
    };
  }, []);

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
  const isMobile = useIsMobile();
  const currentData = useStoveStore(state => state.currentData);
  const hasCurrentData = useMemo(() => Object.keys(currentData || {}).length > 0, [currentData]);

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

  const { unreadCount, markAsRead } = useChatNotifications(showChat);

  const { user, hasPermission, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const handlePendingSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error('[Web3ConnectionPanel] Sign out failed:', err);
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut]);

  // Permission flags
  const permissionFlags = useMemo(() => {
    const role = String(user?.role || '').toLowerCase().trim();
    const isDev = role === 'developer';
    const isSuper = role === 'super_admin';
    const canManageUsers = !!hasPermission('manage_users');
    const canSeeAdminControls = canManageUsers || isDev || isSuper;
    const canOpenFirebase = isDev || isSuper || canManageUsers;
    const canExportCpp = isDev || isSuper || role === 'admin';

    return {
      role,
      isDev,
      isSuper,
      canManageUsers,
      canSeeAdminControls,
      canOpenFirebase,
      canExportCpp,
    };
  }, [user?.role, hasPermission]);

  const { role, isDev, isSuper, canManageUsers, canSeeAdminControls, canOpenFirebase, canExportCpp } = permissionFlags;
  const canUseTerminal = (canManageUsers || isDev) && hasPermission('actions.open_terminal');
  const canViewKundenTickets = role === 'admin' || role === 'developer' || role === 'super_admin';
  const isDealerRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/haendler');

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

  const [alleWerteOverride, setAlleWerteOverride] = useState<boolean | null>(null);

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
    return false;
  }, [deviceId, connectionStatus, dFromStore, alleWerteOverride, remoteD]);

  useEffect(() => {
    if (alleWerteOverride !== null && alleWerteOverride === dFromStore) {
      setAlleWerteOverride(null);
    }
  }, [dFromStore, alleWerteOverride]);

  useEffect(() => {
    if (alleWerteOverride !== null && remoteD !== null && alleWerteOverride === remoteD) {
      setAlleWerteOverride(null);
    }
  }, [remoteD, alleWerteOverride]);

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
    if (deviceId && connectionStatus === 'online' && realtimeDB) {
      try {
        try { await ensureActiveClientPresent(deviceId); } catch {}
        setAlleWerteOverride(next);
        await set(ref(realtimeDB, `konstant/${deviceId}/d`), next);
      } catch (e) {
        console.warn('[Web3ConnectionPanel] Failed to update d in Firebase:', e);
      }
    }
  }, [alleWerteEnabled, deviceId, connectionStatus, ensureActiveClientPresent]);

  const handleToggleNurApp = useCallback(async () => {
    if (!deviceId || connectionStatus !== 'online' || !realtimeDB) return;
    try {
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
      console.warn('[Web3ConnectionPanel] Failed to adjust k_manual:', e);
    }
  }, [deviceId, connectionStatus, ensureActiveClientPresent]);

  const handleClearTemporaer = useCallback(async () => {
    if (!deviceId || connectionStatus !== 'online' || !realtimeDB) return;
    const ok = window.confirm(`Alle Einträge unter /temporaer/${deviceId} löschen?`);
    if (!ok) return;
    setIsClearingTemporaer(true);
    try {
      await remove(ref(realtimeDB, `temporaer/${deviceId}`));
    } catch (e) {
      console.warn('[Web3ConnectionPanel] Failed to clear temporaer:', e);
    } finally {
      setIsClearingTemporaer(false);
    }
  }, [deviceId, connectionStatus]);

  const [deviceComments, setDeviceComments] = useState<Record<string, string>>({});
  const commentListenersRef = useRef<Record<string, () => void>>({});
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
        const tail = codePart.slice(semiIdx + 1);

        const leftHtml = escapeHtml(left).replace(/\bC_OFEN_DEFINITION\b/g, '<span class="text-purple-600 dark:text-purple-400">C_OFEN_DEFINITION</span>');
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

  const setupCommentListener = useCallback((deviceId: string) => {
    if (!deviceId || !realtimeDB || commentListenersRef.current[deviceId]) return;

    const commentRef = ref(realtimeDB, `konstant_app/${deviceId}/comment`);

    const unsubscribe = onValue(commentRef, (snapshot) => {
      const comment = snapshot.exists() ? snapshot.val() : '';
      setDeviceComments(prev => ({
        ...prev,
        [deviceId]: comment || '',
      }));
    }, (error) => {
      console.error(`Failed to listen to comment for ${deviceId}:`, error);
    });

    commentListenersRef.current[deviceId] = unsubscribe;
  }, []);

  const removeCommentListener = useCallback((deviceId: string) => {
    const unsubscribe = commentListenersRef.current[deviceId];
    if (unsubscribe) {
      unsubscribe();
      delete commentListenersRef.current[deviceId];
    }
  }, []);

  const favorites = useMemo<FavoriteDevice[]>(() => {
    try {
      const stored = localStorage.getItem('firebaseIdFavorites_v2');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, [favoritesRefresh]);

  useEffect(() => {
    favorites.forEach(favorite => {
      setupCommentListener(favorite.id);
    });

    const currentFavoriteIds = new Set(favorites.map(f => f.id));
    Object.keys(commentListenersRef.current).forEach(deviceId => {
      if (!currentFavoriteIds.has(deviceId)) {
        removeCommentListener(deviceId);
        setDeviceComments(prev => {
          const newComments = { ...prev };
          delete newComments[deviceId];
          return newComments;
        });
      }
    });
  }, [favorites, setupCommentListener, removeCommentListener]);

  useEffect(() => {
    return () => {
      Object.keys(commentListenersRef.current).forEach(deviceId => {
        removeCommentListener(deviceId);
      });
    };
  }, [removeCommentListener]);

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

    const currentFavorites = favorites;
    const updated = currentFavorites.filter(f => f.id !== newFavorite.id);
    updated.unshift(newFavorite);
    saveFavorites(updated.slice(0, 10));
  }, [favorites, saveFavorites]);

  const removeFromFavorites = useCallback((id: string) => {
    const updated = favorites.filter(f => f.id !== id);
    saveFavorites(updated);
  }, [favorites, saveFavorites]);

  const clearFavorites = useCallback(() => {
    if (window.confirm('Are you sure you want to clear all favorites?')) {
      saveFavorites([]);
    }
  }, [saveFavorites]);

  const [copiedLink, setCopiedLink] = useState(false);

  const normalizedInputId = useMemo(() => inputValue.trim(), [inputValue]);
  const isConnected = useMemo(() => !!deviceId && connectionStatus === 'online', [deviceId, connectionStatus]);
  const isDifferentId = useMemo(() => !!normalizedInputId && !!deviceId && normalizedInputId !== deviceId, [normalizedInputId, deviceId]);
  const showConnectButton = useMemo(() => !isConnected, [isConnected]);

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
      console.warn('[Web3ConnectionPanel] Failed to update URL param:', err);
    }
  }, []);

  const buildConnectionUrl = useCallback((id: string): string => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('id', id.trim());
      return url.toString();
    } catch {
      return `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(id.trim())}${window.location.hash}`;
    }
  }, []);

  const handleCopyLink = useCallback(async () => {
    const shareId = normalizedInputId || deviceId || '';
    if (!shareId) return;
    const link = buildConnectionUrl(shareId);
    try {
      await navigator.clipboard?.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1600);
    } catch {
      try {
        window.prompt('Copy link:', link);
      } catch {}
    }
  }, [normalizedInputId, deviceId, buildConnectionUrl]);

  const performCompleteCleanup = useCallback(async (targetId: string) => {
    setIsCleaningUp(true);
    setCleanupProgress(0);

    const { clearAllState } = useStoveStore.getState();
    clearAllState();
    setCleanupProgress(20);

    try {
      const isDeviceSpecificKey = (key: string | null): boolean => {
        if (!key) return false;
        const preserved = new Set([
          'hase-iq-user-preferences',
          'hase-session-simplification-mode',
          'hase-iq-local-settings',
          'hase-theme-config',
          'hase-display-configuration-selected',
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
      console.warn('[Web3ConnectionPanel] Error clearing caches:', error);
    }
    setCleanupProgress(40);

    if (isConnected && deviceId && targetId !== deviceId) {
      await disconnect();
    }
    setCleanupProgress(60);

    await new Promise(resolve => setTimeout(resolve, 5000));
    setCleanupProgress(100);
    await new Promise(resolve => setTimeout(resolve, 100));

    setIsCleaningUp(false);
    setCleanupProgress(0);
  }, [isConnected, deviceId, disconnect]);

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
        console.warn('[Web3ConnectionPanel] Connection to', targetId, 'failed');
      }
    } catch (error) {
      console.error('[Web3ConnectionPanel] Connection failed:', error);
      setIsCleaningUp(false);
      setCleanupProgress(0);
    }
  }, [inputValue, isCleaningUp, performCompleteCleanup, connect, updateUrlDeviceParam]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    updateUrlDeviceParam(undefined);
  }, [disconnect, updateUrlDeviceParam]);

  const selectFavorite = useCallback((id: string) => {
    setInputValue(id);
    setShowFavorites(false);
  }, []);

  const handleConnectFavorite = useCallback((id: string) => {
    setInputValue(id);
    // Defer to allow state update; reuse cleanup+connect flow
    setTimeout(() => {
      const currentState = useStoveStore.getState();
      if (currentState.connectionStatus === 'connecting' || isCleaningUp) return;
      (async () => {
        try {
          await performCompleteCleanup(id);
          const ok = await connect(id);
          if (ok) updateUrlDeviceParam(id);
        } catch (error) {
          console.error('[Web3ConnectionPanel] Favorite connect failed:', error);
          setIsCleaningUp(false);
          setCleanupProgress(0);
        }
      })();
    }, 0);
  }, [isCleaningUp, performCompleteCleanup, connect, updateUrlDeviceParam]);

  const formatFavoriteDisplay = useCallback((did: string): { fullText: string; comment: string } => {
    const comment = deviceComments[did] || '';
    const commentPreview = comment.trim() ? comment.substring(0, 25) + (comment.length > 25 ? '...' : '') : '';
    const fullText = commentPreview ? `${did} – ${commentPreview}` : did;

    return {
      fullText,
      comment: comment.trim(),
    };
  }, [deviceComments]);

  const scrollToDataParameters = useCallback(() => {
    const dataParametersElement = document.querySelector('[data-section="data-parameters"]');
    if (dataParametersElement) {
      dataParametersElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const loadAllDeviceIds = useCallback(async () => {
    if (allDeviceIds.length > 0 && Object.keys(allDeviceComments).length > 0) return;

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

  const searchDevices = useCallback((query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const q = query.toLowerCase();
    const filteredDevices = allDeviceIds.filter(did => {
      const idMatch = did.toLowerCase().includes(q);
      const comment = allDeviceComments[did] || '';
      const commentMatch = comment.toLowerCase().includes(q);
      return idMatch || commentMatch;
    });

    if (filteredDevices.length > 0 && filteredDevices.length < 10) {
      setSearchResults(filteredDevices.slice(0, 10));
      setShowSearchResults(true);
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  }, [allDeviceIds, allDeviceComments]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setShowFavorites(false);

    if (allDeviceIds.length === 0 && !isLoadingDevices) {
      loadAllDeviceIds();
    }

    searchDevices(value);
  }, [allDeviceIds.length, isLoadingDevices, loadAllDeviceIds, searchDevices]);

  const selectSearchResult = useCallback((did: string) => {
    setInputValue(did);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  const activeClientsCount = useMemo(() => Object.keys(activeClients || {}).length, [activeClients]);

  const canUseParameterActions = useMemo(() => {
    const basic = !!deviceId && connectionStatus === 'online' && discoveredParameters.length > 0;
    if (role === 'viewer' || role === 'admin') return false;
    return basic;
  }, [deviceId, connectionStatus, discoveredParameters.length, role]);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [showActions, setShowActions] = useState(false);

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

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (deviceId && connectionStatus === 'online' && realtimeDB) {
      const acRef = ref(realtimeDB, `konstant/${deviceId}/active_clients`);
      unsubscribe = onValue(acRef, (snapshot) => {
        const val = snapshot.exists() ? snapshot.val() : {};
        setActiveClients(val || {});
      }, (error) => {
        console.error('[Web3ConnectionPanel] Active clients listener error:', error);
      });
    } else {
      setActiveClients({});
    }
    return () => {
      try { unsubscribe?.(); } catch {}
    };
  }, [deviceId, connectionStatus]);

  useEffect(() => {
    if (!showActiveClients) return;
    setNowTick(Date.now());
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

  useEffect(() => {
    if (deviceId && connectionStatus === 'online') {
      const savedOrder = getSectionOrder();
      if (savedOrder.length > 0) {
        setSectionOrder(savedOrder);
      } else {
        const defaultOrder = ['stove-management', 'secondary-categories', 'main-and-airflow', 'charts'];
        setSectionOrder(defaultOrder);
        saveSectionOrder(defaultOrder);
      }
    }
  }, [deviceId, connectionStatus, getSectionOrder, setSectionOrder, saveSectionOrder]);

  const toggleSectionReorderMode = useCallback(() => {
    setSectionReorderMode(!isSectionReorderMode);
  }, [isSectionReorderMode, setSectionReorderMode]);

  const handleTemporaryCategoriesChange = useCallback((categories: string[]) => {
    setTemporaryCategories(categories);
    onTemporaryCategoriesChange?.(categories);
  }, [onTemporaryCategoriesChange]);

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

  const handleStartChat = useCallback((targetUser: any) => {
    setChatTarget(targetUser);
    setShowChat(true);
    setShowUsersList(false);
    markAsRead();
  }, [markAsRead]);

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
      console.error('[Web3ConnectionPanel] Statistik-Korrektur fehlgeschlagen:', err);
      setFixStatsMessage('Fehler beim Kopieren. Details in der Konsole.');
    } finally {
      setIsFixingStats(false);
    }
  }, []);

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

  // Comment editing (when connected)
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const currentDeviceComment = deviceId ? (deviceComments[deviceId] || '') : '';

  useEffect(() => {
    if (deviceId && connectionStatus === 'online') {
      setupCommentListener(deviceId);
    }
  }, [deviceId, connectionStatus, setupCommentListener]);

  const startEditingComment = useCallback(() => {
    setCommentDraft(currentDeviceComment);
    setEditingComment(true);
  }, [currentDeviceComment]);

  const saveComment = useCallback(async () => {
    if (!deviceId || !realtimeDB) {
      setEditingComment(false);
      return;
    }
    try {
      await set(ref(realtimeDB, `konstant_app/${deviceId}/comment`), commentDraft);
    } catch (e) {
      console.warn('[Web3ConnectionPanel] Failed to save comment:', e);
    } finally {
      setEditingComment(false);
    }
  }, [deviceId, commentDraft]);

  // ── Special render for pending users ─────────────────────────────
  if (role === 'pending') {
    return (
      <div className="flex justify-center mt-12 px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-theme-lg">
          <div className="flex flex-col items-center justify-center gap-4">
            <img
              key={`logo-${domIsDark ? 'dark' : 'light'}`}
              src="/hase_logo_light.svg"
              alt="Hasenradar Logo"
              className="h-14 w-auto opacity-90"
              style={{ filter: domIsDark ? 'invert(1)' : 'invert(0)' }}
            />
            <h2 className="text-xl font-semibold text-foreground">Konto wird überprüft</h2>
            <p className="text-sm text-muted-foreground text-center">
              {t('auth.pendingApproval', 'Your account is pending approval')}
            </p>
            <Button
              variant="ghost"
              onClick={handlePendingSignOut}
              disabled={isSigningOut}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {isSigningOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isSigningOut
                ? t('userSettings.account.signingOut')
                : t('userSettings.account.signOut')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Build action sections (mirrors the original logic)
  const actionSections: Array<{
    key: string;
    title: string;
    items: Array<{
      key: string;
      label: React.ReactNode;
      onClick: () => void;
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
    });
  }
  if (!isMobile) {
    panelItems.push(
      {
        key: 'reorder-params',
        label: isEditMode ? t('connectionPanel.doneReorderParams') : t('connectionPanel.reorderParams'),
        onClick: () => {
          if (canUseParameterActions && !(role === 'viewer' || role === 'admin')) setEditMode(!isEditMode);
          setShowActions(false);
        },
        disabled: !canUseParameterActions || (role === 'viewer' || role === 'admin'),
      },
      {
        key: 'reorder-sections',
        label: isSectionReorderMode ? t('connectionPanel.doneReorderSections') : t('connectionPanel.reorderSections'),
        onClick: () => { toggleSectionReorderMode(); setShowActions(false); },
        active: isSectionReorderMode,
      }
    );
  }
  if (panelItems.length > 0) {
    actionSections.push({ key: 'panel', title: t('connectionPanel.actions'), items: panelItems });
  }

  actionSections.push({
    key: 'help',
    title: t('connectionPanel.help'),
    items: [
      {
        key: 'docs',
        label: t('connectionPanel.docs'),
        onClick: () => { setShowDocs(true); setShowActions(false); },
      },
    ],
  });

  actionSections.push({
    key: 'communication',
    title: 'Communication',
    items: [
      {
        key: 'chat',
        label: (
          <span className="flex items-center justify-between w-full">
            {t('connectionPanel.chat')}
            {unreadCount.total > 0 && (
              <span className="ml-auto text-xs font-medium text-destructive">
                {unreadCount.total > 9 ? '9+' : unreadCount.total}
              </span>
            )}
          </span>
        ),
        onClick: () => { handleOpenChatSelector(); setShowActions(false); },
      },
      {
        key: 'updates',
        label: t('connectionPanel.updates'),
        onClick: () => { setShowUpdates(true); setShowActions(false); },
      },
      {
        key: 'tickets',
        label: t('connectionPanel.tickets'),
        onClick: () => { setShowTickets(true); setShowActions(false); },
      },
      ...(canViewKundenTickets
        ? [{
            key: 'kunden-tickets',
            label: t('connectionPanel.kundenTickets'),
            onClick: () => { setShowKundenTickets(true); setShowActions(false); },
          }]
        : []),
      {
        key: 'notification-history',
        label: t('notifications.history', 'Notification History'),
        onClick: () => { setShowNotificationHistory(true); setShowActions(false); },
      },
    ],
  });

  const preferencesItems: typeof actionSections[number]['items'] = [
    {
      key: 'scroll-to-data',
      label: t('connectionPanel.scrollToData'),
      onClick: () => { scrollToDataParameters(); setShowActions(false); },
    },
    {
      key: 'toggle-theme',
      label: t('connectionPanel.toggleTheme'),
      onClick: () => { toggleTheme(); setShowActions(false); },
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
    },
    {
      key: 'user-settings',
      label: t('connectionPanel.userSettings'),
      onClick: () => { setShowUserSettings(true); setShowActions(false); },
    },
  ];
  if (canExportCpp && hasPermission('actions.export_cpp')) {
    preferencesItems.push({
      key: 'export-cpp',
      label: t('connectionPanel.exportCpp'),
      onClick: () => { setShowExportCpp(true); setShowActions(false); },
      disabled: !hasCurrentData,
      title: hasCurrentData ? (t('connectionPanel.exportTooltip') as string) : (t('connectionPanel.noValuesExport') as string),
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
      });
      if (hasPermission('actions.test_firestore')) {
        adminItems.push({
          key: 'test-firestore',
          label: t('connectionPanel.testFirestore'),
          onClick: () => { testFirestoreConnection(); setShowActions(false); },
        });
      }
    }
    if (canUseTerminal && !isMobile) {
      adminItems.push({
        key: 'open-terminal',
        label: `${t('connectionPanel.openTerminal')} (Alt+Shift+T)`,
        onClick: () => { setShowTerminal(true); setShowActions(false); },
      });
    }
    if (canOpenFirebase && hasPermission('actions.open_firebase_console')) {
      adminItems.push({
        key: 'open-firebase',
        label: t('connectionPanel.openFirebaseConsole'),
        onClick: () => { setShowFirebaseConsole(true); setShowActions(false); },
      });
    }
    if (hasPermission('users.manage')) {
      adminItems.push({
        key: 'user-management',
        label: t('connectionPanel.userManagement'),
        onClick: () => { onOpenAdminPanel?.(); setShowActions(false); },
      });
    }
    if ((canManageUsers || isDev || isSuper) && hasPermission('users.manage_privileges')) {
      adminItems.push({
        key: 'manage-privileges',
        label: t('privileges.managePrivileges'),
        onClick: () => { setShowPrivileges(true); setShowActions(false); },
      });
    }
    if ((isDev || isSuper) && hasPermission('users.manage_privileges')) {
      adminItems.push({
        key: 'fix-statistik-2026',
        label: isFixingStats ? 'Statistiken werden kopiert...' : 'Statistik 2025 → 2026',
        onClick: () => { handleFixStatistik2026(); setShowActions(false); },
        disabled: isFixingStats,
      });
    }
    if (adminItems.length > 0) {
      actionSections.push({ key: 'admin', title: 'Admin', items: adminItems });
    }
  }

  const statusDotClass = cn(
    'h-2 w-2 rounded-full shrink-0',
    connectionStatus === 'online' && 'bg-success animate-pulse',
    connectionStatus === 'connecting' && 'bg-warning animate-pulse',
    connectionStatus === 'offline' && 'bg-destructive'
  );

  const statusLabel = connectionStatus === 'online'
    ? 'Online'
    : connectionStatus === 'connecting'
      ? t('status.connecting')
      : t('status.disconnected');

  const seriennr = deviceId ? extractSeriennr(deviceId) : '';
  const displayName = currentDeviceComment.trim() || seriennr || (deviceId ? deviceId.slice(0, 7) : '');

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={200}>
      {/* STATE A: Pre-connect hero */}
      {!isConnected && (
        <div className="flex justify-center mt-12 px-4">
          <div className="w-full max-w-[640px] rounded-2xl border border-border bg-card p-8 shadow-theme-lg">
            {/* Logo + heading */}
            <div className="text-center mb-6">
              <img
                key={`logo-${domIsDark ? 'dark' : 'light'}`}
                src="/hase_logo_light.svg"
                alt="Hasenradar"
                className="mx-auto h-14 w-auto mb-3 opacity-90"
                style={{ filter: domIsDark ? 'invert(1)' : 'invert(0)' }}
              />
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Hasenradar</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Verbinden Sie Ihr Kamin-Gerät
              </p>
            </div>

            {/* Big input + button */}
            <div className="flex gap-2" ref={searchContainerRef}>
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  placeholder={(t('connectionPanel.firebaseIdPlaceholder') as string) || 'Firebase-ID (22 Ziffern)'}
                  disabled={connectionStatus === 'connecting' || isCleaningUp}
                  className={cn(
                    'pl-10 pr-10 h-11 text-base font-mono',
                    isDifferentId && 'border-warning focus-visible:ring-warning'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowFavorites(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                  title={t('connectionPanel.favorites') as string}
                >
                  <Star className="h-4 w-4" />
                </button>

                {/* Favorites dropdown */}
                {showFavorites && (
                  <div className="absolute left-0 right-0 top-full mt-2 bg-card border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-border flex justify-between items-center">
                      <h3 className="text-sm font-medium text-foreground">{t('connectionPanel.favorites')}</h3>
                      <button onClick={clearFavorites} className="text-xs text-destructive hover:opacity-80 font-medium transition-colors">
                        {t('connectionPanel.clearAll')}
                      </button>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {favorites.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                          {t('connectionPanel.noFavorites')}
                        </p>
                      ) : (
                        <div className="divide-y divide-border">
                          {favorites.map((favorite) => {
                            const display = formatFavoriteDisplay(favorite.id);
                            return (
                              <div key={favorite.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-accent group transition-colors">
                                <button
                                  onClick={() => selectFavorite(favorite.id)}
                                  className="flex-1 min-w-0 text-left"
                                >
                                  <div className="text-sm text-foreground font-mono truncate">{favorite.id}</div>
                                  {display.comment && (
                                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                                      {display.comment}
                                    </div>
                                  )}
                                </button>
                                <button
                                  onClick={() => removeFromFavorites(favorite.id)}
                                  className="ml-2 p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                                  title={t('connectionPanel.remove') as string}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2.5 border-t border-border">
                      <Button
                        size="sm"
                        onClick={() => { if (inputValue.trim()) { addToFavorites(inputValue.trim()); setShowFavorites(false); } }}
                        disabled={!inputValue.trim()}
                        className="w-full"
                      >
                        {t('connectionPanel.addCurrent')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Search Results dropdown */}
                {showSearchResults && searchResults.length > 0 && !showFavorites && (
                  <div className="absolute left-0 right-0 top-full mt-2 bg-card border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-border flex justify-between items-center">
                      <h3 className="text-sm font-medium text-foreground">{t('connectionPanel.searchResults')}</h3>
                      <span className="text-xs text-muted-foreground">
                        {t('connectionPanel.foundCount', { count: searchResults.length })}
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-border">
                      {searchResults.map((did) => {
                        const comment = (allDeviceComments[did] || '').trim();
                        return (
                          <button
                            key={did}
                            onClick={() => selectSearchResult(did)}
                            className="block w-full text-left px-3 py-2.5 hover:bg-accent transition-colors"
                          >
                            <div className="text-sm text-foreground font-mono">{did}</div>
                            {comment && (
                              <div className="text-xs text-muted-foreground truncate mt-0.5">
                                {comment.substring(0, 60)}{comment.length > 60 ? '...' : ''}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={handleConnect}
                disabled={!normalizedInputId || connectionStatus === 'connecting' || isCleaningUp}
                className="h-11 px-6"
              >
                {(connectionStatus === 'connecting' || isCleaningUp) ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('status.connecting')}</span>
                  </>
                ) : (
                  <>{t('connectionPanel.connect') || 'Verbinden'}</>
                )}
              </Button>
            </div>

            {isDifferentId && (
              <p className="mt-2.5 text-xs text-warning flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('connectionPanel.differentIdWarning')}
              </p>
            )}

            {/* Cleanup progress bar */}
            {isCleaningUp && (
              <div className="mt-4">
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${cleanupProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Favorites as pills */}
            {favorites.length > 0 && (
              <div className="mt-6">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
                  {t('connectionPanel.favorites')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {favorites.slice(0, 8).map(fav => {
                    const display = formatFavoriteDisplay(fav.id);
                    const shortId = extractSeriennr(fav.id) || fav.id.slice(0, 7);
                    return (
                      <button
                        key={fav.id}
                        onClick={() => handleConnectFavorite(fav.id)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted hover:bg-accent border border-border/60 px-3 py-1.5 text-xs font-mono transition-colors"
                      >
                        <span className="text-foreground">{shortId}</span>
                        {display.comment && (
                          <span className="text-muted-foreground truncate max-w-[150px]">
                            — {display.comment}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Offline connection lost banner */}
            {deviceId && connectionStatus === 'offline' && (
              <div className="mt-4 flex items-center gap-2 px-3 py-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>{t('status.connectionLost')}</span>
              </div>
            )}

            {/* Footer quick actions */}
            <div className="mt-6 pt-6 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <button
                onClick={() => setShowUserSettings(true)}
                className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                {t('connectionPanel.userSettings')}
              </button>
              <button
                onClick={() => setShowDocs(true)}
                className="hover:text-foreground transition-colors"
              >
                {t('connectionPanel.docs')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE B: Connected — sticky topbar */}
      {isConnected && (
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 max-w-screen-2xl mx-auto">
            {/* Left: status + device */}
            <div className="flex items-center gap-2.5 min-w-0" ref={activeClientsRef}>
              <div className={statusDotClass} />
              <div className="min-w-0">
                {editingComment ? (
                  <input
                    autoFocus
                    type="text"
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onBlur={saveComment}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveComment();
                      if (e.key === 'Escape') setEditingComment(false);
                    }}
                    className="bg-transparent border-b border-border focus:outline-none focus:border-primary text-sm font-medium text-foreground w-full max-w-[200px]"
                  />
                ) : (
                  <button
                    onClick={startEditingComment}
                    className="text-left max-w-[200px]"
                    title={deviceId}
                  >
                    <p className="text-sm font-medium truncate text-foreground">
                      {displayName}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {statusLabel}
                      {seriennr && currentDeviceComment.trim() && (
                        <span className="ml-1 font-mono">· {seriennr}</span>
                      )}
                    </p>
                  </button>
                )}
              </div>

              {activeClientsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowActiveClients(v => !v)}
                  className="ml-1 inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-primary/15 text-primary border border-primary/30 text-[10px] font-semibold hover:bg-primary/25 transition-colors"
                  title={t('connectionPanel.activeClients') as string}
                >
                  <Users className="h-3 w-3" />
                  {activeClientsCount}
                </button>
              )}

              {showActiveClients && activeClientsCount > 0 && (
                <div className="absolute left-4 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
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

            {/* Center: secondary search */}
            <div className="hidden md:flex flex-1 max-w-md mx-auto" ref={searchContainerRef}>
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  placeholder="Anderes Gerät verbinden..."
                  className="pl-9 h-9 text-sm bg-card border-border"
                />

                {showSearchResults && searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-2 bg-card border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                    <div className="max-h-56 overflow-y-auto divide-y divide-border">
                      {searchResults.map((did) => {
                        const comment = (allDeviceComments[did] || '').trim();
                        return (
                          <button
                            key={did}
                            onClick={() => selectSearchResult(did)}
                            className="block w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                          >
                            <div className="text-xs text-foreground font-mono">{did}</div>
                            {comment && (
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {comment.substring(0, 60)}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: quick actions */}
            <div className="flex items-center gap-1 ml-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCopyLink}
                    className="h-8 w-8 relative"
                  >
                    {copiedLink ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('connectionPanel.copyLink', 'Copy connection link')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleOpenChatSelector}
                    className="h-8 w-8 relative"
                  >
                    <MessageCircle className="h-4 w-4" />
                    {unreadCount.total > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center px-1">
                        {unreadCount.total > 9 ? '9+' : unreadCount.total}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('connectionPanel.chat')}</TooltipContent>
              </Tooltip>

              <div className="relative" ref={actionsMenuRef}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowActions(v => !v)}
                  className="h-8 gap-1"
                >
                  <span className="hidden sm:inline">{t('connectionPanel.actions')}</span>
                  <MoreVertical className="sm:hidden h-4 w-4" />
                  <ChevronDown className="hidden sm:inline h-3.5 w-3.5" />
                </Button>
                {showActions && (
                  <div className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-theme-md z-50 overflow-hidden">
                    <div className="py-1 max-h-[70vh] overflow-y-auto">
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
                              className={cn(
                                'w-full px-3 py-2 text-left text-sm transition-colors',
                                item.disabled
                                  ? 'text-muted-foreground cursor-not-allowed'
                                  : item.active
                                    ? 'text-foreground bg-muted'
                                    : 'text-foreground hover:bg-accent'
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleDisconnect}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Power className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Trennen</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Sub-bar: monitoring chips */}
          <div className="border-t border-border/60 px-4 py-1.5 flex items-center gap-1.5 max-w-screen-2xl mx-auto overflow-x-auto">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 mr-1 whitespace-nowrap">
              Monitoring
            </span>
            <button
              onClick={handleClearTemporaer}
              disabled={!(deviceId && connectionStatus === 'online') || isClearingTemporaer}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
                (deviceId && connectionStatus === 'online') && !isClearingTemporaer
                  ? 'border-destructive/30 text-destructive bg-card hover:bg-destructive/10'
                  : 'border-border/60 text-muted-foreground bg-card opacity-40 cursor-not-allowed'
              )}
              title={deviceId ? `Löscht /temporaer/${deviceId}` : 'Kein Gerät verbunden'}
            >
              {isClearingTemporaer ? 'Lösche…' : (t('connectionPanel.clearTemp') as string) || 'Temp löschen'}
            </button>
            <button
              onClick={handleToggleAlleWerte}
              disabled={!(deviceId && connectionStatus === 'online')}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
                alleWerteEnabled
                  ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/20'
                  : 'bg-card hover:bg-accent border-border/60 text-foreground'
              )}
            >
              Alle Werte: {alleWerteEnabled ? 'Ja' : 'Nein'}
            </button>
            <button
              onClick={handleToggleNurApp}
              disabled={!(deviceId && connectionStatus === 'online')}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
                nurAppEnabled
                  ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/20'
                  : 'bg-card hover:bg-accent border-border/60 text-foreground'
              )}
              title="Toggle increments/decrements k by 1"
            >
              Nur App: {nurAppEnabled ? 'Ja' : 'Nein'}
            </button>
            <div className={cn(
              'text-[10px] font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ml-auto',
              !alleWerteEnabled && (kFromStore === 0)
                ? 'text-muted-foreground bg-muted border-border'
                : alleWerteEnabled && (kFromStore === 0)
                  ? 'text-success bg-success/10 border-success/30'
                  : !alleWerteEnabled && (kFromStore > 0)
                    ? 'text-foreground bg-muted border-border'
                    : 'text-success bg-success/10 border-success/30'
            )}>
              {!alleWerteEnabled && kFromStore === 0 && 'Keine Werte beobachten'}
              {alleWerteEnabled && kFromStore === 0 && 'Alle Werte beobachten'}
              {alleWerteEnabled && kFromStore > 0 && 'Alle Werte beobachten'}
              {!alleWerteEnabled && kFromStore > 0 && 'Nur App-Werte beobachten'}
            </div>
          </div>
        </header>
      )}

      {fixStatsMessage && (
        <div className="mt-2 mx-4 px-3 py-2 text-sm rounded-lg border border-border bg-muted text-foreground">
          {fixStatsMessage}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────── */}
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
        onAlarmClick={(did, parameterName) => {
          setShowNotificationHistory(false);
          onAlarmClick?.(did, parameterName);
        }}
      />
      <Terminal isOpen={showTerminal} onClose={() => setShowTerminal(false)} />
      <FirebaseConsole isOpen={showFirebaseConsole} onClose={() => setShowFirebaseConsole(false)} />
      <PrivilegesManagerModal isOpen={showPrivileges} onClose={() => setShowPrivileges(false)} />

      {/* Export to C++ Modal */}
      {showExportCpp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowExportCpp(false)}>
          <div className="bg-card rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Export parameters to C++</h2>
              <Button size="icon" variant="ghost" onClick={() => setShowExportCpp(false)} className="h-8 w-8">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground font-medium">Scope:</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setExportScope('all')} className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors', exportScope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>All</button>
                  <button onClick={() => setExportScope('writable')} className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors', exportScope === 'writable' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>Writable ({writableParameterCount})</button>
                  <button onClick={() => setExportScope('readable')} className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors', exportScope === 'readable' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>Readable only ({readableOnlyCount})</button>
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

            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(cppExport.plainText); }}>
                {t('actions.copy')}
              </Button>
              <Button onClick={() => setShowExportCpp(false)}>{t('actions.close')}</Button>
            </div>
          </div>
        </div>
      )}
    </TooltipProvider>
  );
};

export default Web3ConnectionPanel;
