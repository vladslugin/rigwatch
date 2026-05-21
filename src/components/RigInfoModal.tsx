import React, { useState, useEffect } from 'react';
import { ref, get, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { useRigStore } from '../store/useRigStore';
import { useRigModel } from '../hooks/useFirebase';
import { useTranslation } from 'react-i18next';
import { formatDateWithUserTimezone } from '../utils/timezone';
import AIAnalysisWrapper from './AIAnalysisWrapper';
import { useAuth } from '../hooks/useAuth';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface RigInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RigInfo {
  rigSerial: string;
  controllerSerial: string;
  fepaUID: string;
  softwareId: number;
  rigName: string;
  rigModelData: any;
  lastLogin: number;
  softwareVersion: string;
  versionVariant?: string;
  currentControllerSerial: string;
  comment: string;
}

const RigInfoModal: React.FC<RigInfoModalProps> = ({ isOpen, onClose }) => {
  const deviceId = useRigStore(state => state.deviceId);
  // const deviceMetadata = useRigStore(state => state.deviceMetadata);
  // Use cached data like in RigManagementPanel.tsx
  const { getRigModelName, getRigModelData, cachedModelName, cachedModelData } = useRigModel();
  const [rigInfo, setRigInfo] = useState<RigInfo | null>(null);
  const [comment, setComment] = useState('');
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [loading, setLoading] = useState(false);
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  
  // Connection testing states
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'testing' | 'online' | 'offline'>('unknown');
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [pingHistory, setPingHistory] = useState<Array<{ ts: number; ok: boolean; rttMs?: number }>>([]);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  // Load ping history from localStorage on mount
  useEffect(() => {
    if (deviceId) {
      const storageKey = `pingHistory_${deviceId}`;
      const storedHistory = localStorage.getItem(storageKey);
      if (storedHistory) {
        try {
          const parsedHistory = JSON.parse(storedHistory);
          // Only keep recent history (last 24 hours)
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          const recentHistory = parsedHistory.filter((entry: any) => entry.ts > cutoff);
          setPingHistory(recentHistory.slice(0, 5)); // Keep only last 5
        } catch (error) {
          console.warn('[RigInfoModal] Failed to parse ping history from localStorage:', error);
        }
      }
    }
  }, [deviceId]);
  
  // Save ping history to localStorage
  const savePingHistory = (newHistory: Array<{ ts: number; ok: boolean; rttMs?: number }>) => {
    if (deviceId) {
      const storageKey = `pingHistory_${deviceId}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(newHistory));
      } catch (error) {
        console.warn('[RigInfoModal] Failed to save ping history to localStorage:', error);
      }
    }
  };
  
  // UI states
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showControllerInfo, setShowControllerInfo] = useState(false);
  
  // Rig reset states
  const [isResetting, setIsResetting] = useState(false);

  // Parse device ID into components
  const parseDeviceId = (deviceId: string): { rigSerial: string; controllerSerial: string; fepaUID: string } => {
    if (deviceId.length !== 22) {
      return { rigSerial: 'Invalid', controllerSerial: 'Invalid', fepaUID: 'Invalid' };
    }
    
    return {
      rigSerial: deviceId.substring(0, 7),
      controllerSerial: deviceId.substring(7, 14),
      fepaUID: deviceId.substring(14, 22)
    };
  };

  // Fallback rig name for cases where Firestore lookup fails
  const getRigName = (softwareId: number): string => {
    return `Software ID ${softwareId}`;
  };

  // Simplified loading of all data in one useEffect
  useEffect(() => {
    if (!isOpen || !deviceId || !realtimeDB) return;

    const loadRigInfo = async () => {
      setLoading(true);

      try {
        const { rigSerial, controllerSerial, fepaUID } = parseDeviceId(deviceId);
        
        // Load basic info from konstant_app
        const konstantAppRef = ref(realtimeDB!, `konstant_app/${deviceId}`);
        const konstantAppSnapshot = await get(konstantAppRef);
        const konstantAppData = konstantAppSnapshot.val() || {};

        // Load current controller serial from controllertausch
        const controllerRef = ref(realtimeDB!, `controllertausch/fepaliste/${rigSerial}/csnr_akt`);
        const controllerSnapshot = await get(controllerRef);
        const rawCurrentController = controllerSnapshot.val();
        // Ensure consistent string comparison by converting to string and trimming
        const currentControllerSerial = rawCurrentController ? String(rawCurrentController).trim() : 'Unknown';

        // Load comment
        const commentRef = ref(realtimeDB!, `konstant_app/${deviceId}/comment`);
        const commentSnapshot = await get(commentRef);
        const commentValue = commentSnapshot.val() || '';

        // Determine model name and data (use cache like in RigManagementPanel.tsx)
        let rigName = getRigName(konstantAppData.rig || 0); // fallback
        let rigModelData = null;

        if (cachedModelName && cachedModelName !== 'Unknown Model') {
          rigName = cachedModelName;
          if (cachedModelData) {
            rigModelData = cachedModelData;
          }
        } else {
          try {
            const [modelName, modelData] = await Promise.all([
              getRigModelName(),
              getRigModelData()
            ]);
            
            if (modelName && modelName !== 'Unknown Model') {
              rigName = modelName;
            }
            
            if (modelData) {
              rigModelData = modelData;
            }
            
          } catch (error) {
            rigName = getRigName(konstantAppData.rig || 0);
          }
        }

        // Create complete rig information
        const fullRigInfo: RigInfo = {
          rigSerial,
          controllerSerial,
          fepaUID,
          softwareId: konstantAppData.rig || 0,
          rigName,
          rigModelData,
          lastLogin: konstantAppData.tsfc || 0,
          softwareVersion: konstantAppData.vers || 'Unknown',
          versionVariant: (konstantAppData.versu ? String(konstantAppData.versu).trim() : '') || 'undefined',
          currentControllerSerial,
          comment: commentValue
        };

        setRigInfo(fullRigInfo);
        setComment(commentValue);

      } catch (error) {
        console.error('[RigInfoModal] Error loading rig info:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRigInfo();
    
    // Cleanup function
    return () => {
      if (!isOpen) {
        setConnectionStatus('unknown');
        setResponseTime(null);
        setRigInfo(null);
        setComment('');
        setLoading(false);
        setIsResetting(false);
      }
    };
  }, [isOpen, deviceId]); // Removed cachedModelName and cachedModelData to force reload on device change

  // Save comment
  const handleSaveComment = async () => {
    if (!deviceId || !realtimeDB) return;

    try {
      const commentRef = ref(realtimeDB!, `konstant_app/${deviceId}/comment`);
      await set(commentRef, comment);
      
      if (rigInfo) {
        setRigInfo({ ...rigInfo, comment });
      }
      
      setIsEditingComment(false);
    } catch (error) {
      console.error('[RigInfoModal] Error saving comment:', error);
    }
  };

  // Test connection - ping test using konstant/p and konstant_app/c
  const handleTestConnection = async () => {
    if (!deviceId || !realtimeDB) return;

    setConnectionStatus('testing');
    setResponseTime(null);

    try {
      const konstantRef = ref(realtimeDB!, `konstant/${deviceId}/p`);
      const konstantAppRef = ref(realtimeDB!, `konstant_app/${deviceId}/c`);
      const dRef = ref(realtimeDB!, `konstant/${deviceId}/d`);

      const [initialCSnapshot, initialDSnapshot] = await Promise.all([
        get(konstantAppRef),
        get(dRef),
      ]);
      const initialCValue = initialCSnapshot.val() ?? 0;
      const initialDValue = initialDSnapshot.val();

      const pingValues = [
        Math.floor(Math.random() * 1000) + 1000,
        Math.floor(Math.random() * 1000) + 2000,
        Math.floor(Math.random() * 1000) + 3000
      ];

      const startTime = Date.now();
      let dChanged = false;
      for (let i = 0; i < pingValues.length; i++) {
        await set(konstantRef, pingValues[i]);

        // After each ping, wait a bit and check if d has changed
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const currentDSnapshot = await get(dRef);
          const currentDValue = currentDSnapshot.val();
          if (currentDValue !== initialDValue) {
            dChanged = true;
          }
        } catch {
          // If reading d fails, just skip this step
        }
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      const finalSnapshot = await get(konstantAppRef);
      const finalCValue = finalSnapshot.val() ?? 0;
      const responseTime = Date.now() - startTime;

      // ONLINE if d changed at least once during the test
      // or, for older firmware, if c still changed between start and end
      if (dChanged || finalCValue !== initialCValue) {
        setConnectionStatus('online');
        setResponseTime(responseTime);
        const newHistory = [{ ts: Date.now(), ok: true, rttMs: responseTime }, ...pingHistory].slice(0, 5);
        setPingHistory(newHistory);
        savePingHistory(newHistory);
      } else {
        setConnectionStatus('offline');
        const newHistory = [{ ts: Date.now(), ok: false }, ...pingHistory].slice(0, 5);
        setPingHistory(newHistory);
        savePingHistory(newHistory);
      }

    } catch (error) {
      console.error('[RigInfoModal] ❌ Error during ping test:', error);
      setConnectionStatus('offline');
      const newHistory = [{ ts: Date.now(), ok: false }, ...pingHistory].slice(0, 5);
      setPingHistory(newHistory);
      savePingHistory(newHistory);
    }
  };

  // Reset rig function - set konstant/<deviceId>/r to true
  const handleRigReset = async () => {
    if (!deviceId || !realtimeDB) return;
    const resetRole = String(user?.role || '').toLowerCase();
    if (resetRole !== 'developer' && resetRole !== 'super_admin') {
      return;
    }
    const role = String(user?.role || '').toLowerCase();
    if (role !== 'developer' && role !== 'super_admin') {
      return;
    }

    setIsResetting(true);

    try {
      const resetRef = ref(realtimeDB!, `konstant/${deviceId}/r`);
      await set(resetRef, true);
      
      setTimeout(() => {
        setIsResetting(false);
      }, 2000);

    } catch (error) {
      console.error('[RigInfoModal] ❌ Error sending rig reset command:', error);
      setIsResetting(false);
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    if (!timestamp) return 'Never';
    try {
      return formatDateWithUserTimezone(timestamp * 1000, i18n.language || 'en', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch {
      return formatDateWithUserTimezone(timestamp * 1000, 'de-DE');
    }
  };
  
  // Relative time helper
  const formatRelative = (timestamp: number): string => {
    if (!timestamp) return t('rigInfo.notSet', 'Not set');
    const diffMs = Date.now() - timestamp * 1000;
    const sec = Math.round(diffMs / 1000);
    const min = Math.round(sec / 60);
    const hr = Math.round(min / 60);
    const day = Math.round(hr / 24);
    if (sec < 60) return t('rigInfo.relSeconds', '{{n}}s ago', { n: sec });
    if (min < 60) return t('rigInfo.relMinutes', '{{n}}m ago', { n: min });
    if (hr < 24) return t('rigInfo.relHours', '{{n}}h ago', { n: hr });
    return t('rigInfo.relDays', '{{n}}d ago', { n: day });
  };
  
  // Utilities
  
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // noop
    }
  };
  
  const copySummary = () => {
    if (!rigInfo || !deviceId) return;
    const lines = [
      `Model: ${rigInfo.rigName}`,
      `Device ID: ${deviceId}`,
      `Rig Serial: ${rigInfo.rigSerial}`,
      `FEPA UID: ${rigInfo.fepaUID}`,
      `SW: ${rigInfo.softwareId} | FW: ${rigInfo.softwareVersion}`,
      `Last seen: ${formatTimestamp(rigInfo.lastLogin)} (${formatRelative(rigInfo.lastLogin)})`
    ];
    copyToClipboard(lines.join('\n'));
  };
  
  const isNotPaired = !!rigInfo && (!rigInfo.currentControllerSerial || rigInfo.currentControllerSerial === 'Unknown');
  
  // More robust controller comparison - normalize both values to strings and trim
  const controllerChanged = !!rigInfo && 
    rigInfo.currentControllerSerial && 
    rigInfo.controllerSerial && 
    rigInfo.currentControllerSerial !== 'Unknown' &&
    String(rigInfo.currentControllerSerial).trim() !== String(rigInfo.controllerSerial).trim();
  
  const statusLabel = connectionStatus === 'online' ? t('rigInfo.statusOnline', 'Online')
    : connectionStatus === 'offline' ? t('rigInfo.statusOffline', 'Offline')
    : isNotPaired ? t('rigInfo.notPaired', 'Not paired')
    : connectionStatus === 'testing' ? t('rigInfo.statusChecking', 'Checking…')
    : t('rigInfo.statusUnknown', 'Unknown');
  
  const statusColor = connectionStatus === 'online' ? 'bg-success'
    : connectionStatus === 'offline' ? 'bg-destructive'
    : connectionStatus === 'testing' ? 'bg-warning animate-pulse'
    : isNotPaired ? 'bg-warning'
    : 'bg-muted-foreground';



  if (!isOpen) return null;

  return (
    <div className="rig-info-modal fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="rig-info-title">
      <div 
        className="bg-card rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 id="rig-info-title" className="text-base font-semibold text-foreground">
            {t('rigInfo.title', 'Rig Information')}
          </h2>
          <div className="flex items-center gap-2">
            {/* Actions Menu */}
            <div className="relative">
              <button 
                onClick={() => setIsMoreOpen(v => !v)} 
                className="h-8 px-3 inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:bg-accent rounded-md transition-colors"
              >
                {t('rigInfo.actions', 'Actions')}
                <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isMoreOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-card border border-border rounded-lg shadow-theme-lg z-20 overflow-hidden">
                  <div className="py-1">
                    {rigInfo?.rigModelData?.technical_data_url && (
                      <a href={rigInfo.rigModelData.technical_data_url} target="_blank" rel="noopener noreferrer" className="flex items-center px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
                        <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {t('rigInfo.technicalData', 'Technical Data')}
                      </a>
                    )}
                    {rigInfo?.rigModelData?.replacement_instructions_url && (
                      <a href={rigInfo.rigModelData.replacement_instructions_url} target="_blank" rel="noopener noreferrer" className="flex items-center px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
                        <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        {t('rigInfo.manual', 'Manual')}
                      </a>
                    )}
                    {(rigInfo?.rigModelData?.technical_data_url || rigInfo?.rigModelData?.replacement_instructions_url) && (
                      <div className="my-1 border-t border-border" />
                    )}
                    <button onClick={() => { copySummary(); setIsMoreOpen(false); }} className="flex items-center w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
                      <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {t('rigInfo.copySummary', 'Copy Summary')}
                    </button>
                    <div className="my-1 border-t border-border" />
                    <button 
                      onClick={handleRigReset}
                      disabled={isResetting || (String(user?.role||'').toLowerCase() !== 'developer' && String(user?.role||'').toLowerCase() !== 'super_admin')}
                      className="flex items-center w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                    >
                      {isResetting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2.5"></div>
                          {t('rigInfo.resetting', 'Resetting...')}
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 mr-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {t('rigInfo.resetButton', 'Reset Rig')}
                        </>
                      )}
                    </button>
                    <button onClick={() => { setShowRaw(v => !v); setIsMoreOpen(false); }} className="flex items-center w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors">
                      <svg className="w-4 h-4 mr-2.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                      {showRaw ? t('rigInfo.hideRaw', 'Hide Raw') : t('rigInfo.showRaw', 'Show Raw')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t('actions.close', 'Close') as string}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin mb-3"></div>
              <p className="text-sm">{t('rigInfo.loading')}</p>
            </div>
          ) : rigInfo ? (
            <>
              {/* Model Information */}
              {rigInfo.rigModelData ? (
                <div className="bg-muted rounded-lg p-5 border border-border">
                  <div className="flex flex-col sm:flex-row gap-5">
                    {rigInfo.rigModelData.img_url && (
                      <div className="flex-shrink-0">
                        <div className="relative group">
                          <img 
                            src={rigInfo.rigModelData.img_url} 
                            alt={rigInfo.rigName} 
                            className="w-28 h-28 sm:w-32 sm:h-32 object-contain rounded-lg border border-border bg-card cursor-pointer transition-transform hover:scale-105" 
                            onClick={() => setShowImagePreview(true)}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg cursor-pointer flex items-center justify-center transition-colors" onClick={() => setShowImagePreview(true)}>
                            <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 drop-shadow-lg transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-foreground mb-3">{rigInfo.rigName}</h3>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <svg className="w-4 h-4 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          <span className="text-muted-foreground">Article:</span>
                          <span className="ml-1.5 text-foreground font-medium">{rigInfo.rigModelData.article_number || 'N/A'}</span>
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground">
                          <svg className="w-4 h-4 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-muted-foreground">Firmware:</span>
                          <span className="ml-1.5 text-foreground font-medium">{rigInfo.softwareVersion || 'Unknown'}</span>
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground">
                          <svg className="w-4 h-4 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                          </svg>
                          <span className="text-muted-foreground">Software ID:</span>
                          <span className="ml-1.5 text-foreground font-medium">{rigInfo.softwareId}</span>
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground">
                          <svg className="w-4 h-4 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-muted-foreground">{t('rigInfo.versionVariant', 'Version variant')}:</span>
                          <span className="ml-1.5 text-foreground font-medium">{rigInfo.versionVariant || 'undefined'}</span>
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground">
                          <svg className="w-4 h-4 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-muted-foreground">Last login:</span>
                          <span className="ml-1.5 text-foreground font-medium">{formatRelative(rigInfo.lastLogin)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-muted rounded-lg p-6 border border-border">
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto mb-3 bg-card rounded-lg flex items-center justify-center">
                      <svg className="w-7 h-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-foreground mb-2">{rigInfo.rigName}</h3>
                    <div className="flex justify-center gap-2 text-xs mb-2">
                      <span className="px-2.5 py-1 bg-card text-muted-foreground rounded-md font-medium">
                        {t('rigInfo.swLabel')} {rigInfo.softwareId}
                      </span>
                      <span className="px-2.5 py-1 bg-card text-muted-foreground rounded-md font-medium">
                        {t('rigInfo.versionPrefix', { version: rigInfo.softwareVersion })}
                      </span>
                      <span className="px-2.5 py-1 bg-card text-muted-foreground rounded-md font-medium">
                        {t('rigInfo.versionVariant', 'Version variant')}: {rigInfo.versionVariant || 'undefined'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('rigInfo.modelInfoUnavailable', 'Model information not available')}</p>
                  </div>
                </div>
              )}

              {/* AI Analysis Section (auto simple/advanced) */}
              <div className="space-y-6">
                <AIAnalysisWrapper />
              </div>

              {/* Grid content: Identifiers, Connectivity, Controllers, Notes */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Identifiers Card */}
                <div className="bg-card rounded-lg p-5 border border-border">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{t('rigInfo.identifiers', 'Identifiers')}</h3>
                  </div>
                  
                  <div className="space-y-3">
                    {/* Device ID */}
                    <div className="group">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t('rigInfo.deviceId', 'Device ID')}
                        </label>
                        <button 
                          onClick={() => copyToClipboard(deviceId || '')} 
                          className="p-1 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity" 
                          aria-label={t('actions.copy', 'Copy') as string}
                        >
                          <svg className="w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                          </svg>
                        </button>
                      </div>
                      <input 
                        type="text" 
                        value={deviceId || ''} 
                        readOnly 
                        className="w-full text-sm font-mono bg-muted border border-border rounded-md px-3 py-2 text-foreground cursor-pointer hover:bg-accent transition-colors" 
                        onClick={() => copyToClipboard(deviceId || '')}
                      />
                    </div>
                    
                    {/* Rig Serial */}
                    <div className="group">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t('rigInfo.rigSerial', 'Rig Serial')}
                        </label>
                        <button 
                          onClick={() => copyToClipboard(rigInfo.rigSerial)} 
                          className="p-1 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity" 
                          aria-label={t('actions.copy', 'Copy') as string}
                        >
                          <svg className="w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                          </svg>
                        </button>
                      </div>
                      <input 
                        type="text" 
                        value={rigInfo.rigSerial} 
                        readOnly 
                        className="w-full text-sm font-mono bg-muted border border-border rounded-md px-3 py-2 text-foreground cursor-pointer hover:bg-accent transition-colors" 
                        onClick={() => copyToClipboard(rigInfo.rigSerial)}
                      />
                    </div>
                    
                    {/* FEPA UID */}
                    <div className="group">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t('rigInfo.fepaUID', 'FEPA UID')}
                        </label>
                        <button 
                          onClick={() => copyToClipboard(rigInfo.fepaUID)} 
                          className="p-1 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity" 
                          aria-label={t('actions.copy', 'Copy') as string}
                        >
                          <svg className="w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                          </svg>
                        </button>
                      </div>
                      <input 
                        type="text" 
                        value={rigInfo.fepaUID} 
                        readOnly 
                        className="w-full text-sm font-mono bg-muted border border-border rounded-md px-3 py-2 text-foreground cursor-pointer hover:bg-accent transition-colors" 
                        onClick={() => copyToClipboard(rigInfo.fepaUID)}
                      />
                    </div>
                    
                    {/* Copy All Button */}
                    <div className="pt-3 border-t border-border">
                      <button 
                        onClick={() => copyToClipboard(`Device ID: ${deviceId}\nRig Serial: ${rigInfo.rigSerial}\nFEPA UID: ${rigInfo.fepaUID}`)} 
                        className="w-full inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-foreground hover:bg-accent rounded-md transition-colors"
                      >
                        <svg className="w-4 h-4 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        {t('rigInfo.copyAll', 'Copy All Identifiers')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Connectivity Card */}
                <div className="bg-card rounded-lg p-5 border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{t('rigInfo.connectionStatus', 'Connectivity')}</h3>
                    </div>
                    <button 
                      onClick={handleTestConnection} 
                      disabled={connectionStatus === 'testing'} 
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50 rounded-md transition-colors"
                    >
                      {connectionStatus === 'testing' ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                          {t('rigInfo.pingTesting', 'Testing...')}
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                          </svg>
                          {t('rigInfo.pingTest', 'Ping')}
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* Status Display */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className={`w-2 h-2 rounded-full ${statusColor}`}></span>
                      <span className="text-sm font-medium text-foreground">
                        {statusLabel}
                        {connectionStatus === 'online' && responseTime !== null && (
                          <span className="ml-1.5 text-muted-foreground font-normal">({responseTime}ms)</span>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-4.5">
                      {t('rigInfo.lastLogin', 'Last login')}: {formatTimestamp(rigInfo.lastLogin)} ({formatRelative(rigInfo.lastLogin)})
                    </p>
                  </div>
                  
                  {/* Ping History */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-medium text-muted-foreground">{t('rigInfo.pingHistory', 'Ping History')}</h4>
                      <span className="text-xs text-muted-foreground">{pingHistory.length}/5</span>
                    </div>
                    
                    {pingHistory.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-4 bg-muted rounded-md">
                        {t('rigInfo.noPings', 'No ping tests performed yet')}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {pingHistory.map((p, idx) => (
                          <div key={idx} className="flex items-center justify-between px-3 py-2 bg-muted rounded-md">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${p.ok ? 'bg-success' : 'bg-destructive'}`}></span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(p.ts).toLocaleTimeString()}
                              </span>
                            </div>
                            <span className={`text-xs font-medium ${p.ok ? 'text-success' : 'text-destructive'}`}>
                              {p.ok ? (
                                typeof p.rttMs === 'number' ? `${p.rttMs}ms` : t('rigInfo.pingOK', 'OK')
                              ) : (
                                t('rigInfo.pingTimeout', 'Timeout')
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Controllers Card */}
                <div className="bg-card rounded-lg p-5 border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{t('rigInfo.controllers', 'Controllers')}</h3>
                    </div>
                    <button
                      onClick={() => setShowControllerInfo(!showControllerInfo)}
                      className="p-1.5 rounded-md hover:bg-accent transition-colors"
                      title={t('rigInfo.controllerInfoTooltip', 'Show controller status information')}
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Controller Status Information */}
                  {showControllerInfo && (
                    <div className="mb-4 p-3 bg-muted rounded-md text-xs space-y-2">
                      <p className="font-medium text-foreground">
                        {t('rigInfo.controllerStatusTitle', 'Controller Status Scenarios:')}
                      </p>
                      <div className="space-y-1.5 text-muted-foreground">
                        <p><span className="font-medium">{t('rigInfo.normalState', 'Normal:')}</span> Original = Current</p>
                        <p><span className="font-medium">{t('rigInfo.notPairedState', 'Not paired:')}</span> Current is null/Unknown</p>
                        <p><span className="font-medium">{t('rigInfo.changedState', 'Changed:')}</span> Original ≠ Current</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-3">
                    {/* Original Controller */}
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        {t('rigInfo.originalController', 'Original Controller')}
                        <span className="text-muted-foreground font-normal ml-1">(from device ID)</span>
                      </label>
                      <input 
                        type="text" 
                        value={rigInfo.controllerSerial || t('rigInfo.notSet', 'Not set')} 
                        readOnly 
                        className="w-full text-sm font-mono bg-muted border border-border rounded-md px-3 py-2 text-foreground" 
                      />
                    </div>
                    
                    {/* Current Controller */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t('rigInfo.currentController', 'Current Controller')}
                          <span className="text-muted-foreground font-normal ml-1">(actual)</span>
                        </label>
                        {controllerChanged && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-warning/15 text-warning">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            {t('rigInfo.controllerChanged', 'Changed')}
                          </span>
                        )}
                        {isNotPaired && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-muted text-muted-foreground">
                            {t('rigInfo.notPaired', 'Not paired')}
                          </span>
                        )}
                      </div>
                      <input 
                        type="text" 
                        value={rigInfo.currentControllerSerial || t('rigInfo.notSet', 'Not set')} 
                        readOnly 
                        className={`w-full text-sm font-mono border rounded-md px-3 py-2 ${
                          isNotPaired
                            ? 'bg-destructive/10 border-destructive/40 text-destructive'
                            : controllerChanged
                            ? 'bg-warning/10 border-warning/40 text-warning'
                            : 'bg-muted border-border text-foreground'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* Description Card */}
                <div className="bg-card rounded-lg p-5 border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{t('rigInfo.description', 'Description')}</h3>
                    </div>
                    {!isEditingComment && (
                      <button
                        onClick={() => setIsEditingComment(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent rounded-md transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        {rigInfo.comment ? t('actions.edit', 'Edit') : t('actions.add', 'Add')}
                      </button>
                    )}
                  </div>
                  
                  {isEditingComment ? (
                    <div className="space-y-3">
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="w-full p-3 border border-border rounded-md bg-muted text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
                        rows={3}
                        placeholder={t('rigInfo.descriptionPlaceholder', 'Describe this rig installation, maintenance notes, or other details...') as string}
                        maxLength={500}
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">
                          {comment.length}/500
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setComment(rigInfo!.comment);
                              setIsEditingComment(false);
                            }}
                            className="px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent rounded-md transition-colors"
                          >
                            {t('actions.cancel', 'Cancel')}
                          </button>
                          <button
                            onClick={handleSaveComment}
                            disabled={loading}
                            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50 rounded-md transition-colors"
                          >
                            {loading ? t('rigInfo.saving', 'Saving...') : t('actions.save', 'Save')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted border border-border rounded-md p-3 min-h-[80px] flex items-center">
                      {rigInfo.comment ? (
                        <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                          {rigInfo.comment}
                        </p>
                      ) : (
                        <div className="flex items-center w-full justify-center text-center">
                          <div>
                            <svg className="w-5 h-5 text-muted-foreground mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <p className="text-muted-foreground text-xs">{t('rigInfo.noDescription', 'No description added')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {showRaw && (
                <div className="bg-card rounded-lg p-5 border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Raw Data</h3>
                    <button 
                      onClick={() => copyToClipboard(JSON.stringify(rigInfo, null, 2))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent rounded-md transition-colors"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy JSON
                    </button>
                  </div>
                  <div className="bg-muted rounded-md p-4 overflow-auto max-h-80 border border-border">
                    <pre className="text-xs text-foreground font-mono leading-relaxed">{JSON.stringify(rigInfo, null, 2)}</pre>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <svg className="w-10 h-10 mb-3 text-muted-foreground/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-sm">{t('rigInfo.noDevice')}</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Image Preview Modal */}
      {showImagePreview && rigInfo?.rigModelData?.img_url && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60]" onClick={() => setShowImagePreview(false)}>
          <div className="relative max-w-4xl max-h-[90vh] p-4">
            <button
              onClick={() => setShowImagePreview(false)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              aria-label="Close image preview"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={rigInfo.rigModelData.img_url}
              alt={rigInfo.rigName}
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-sm">
              {rigInfo.rigName}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default RigInfoModal; 