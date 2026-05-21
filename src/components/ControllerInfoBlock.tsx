import React, { useState, useCallback, useEffect } from 'react';
import { useRigStore } from '../store/useRigStore';
import { useTranslation } from 'react-i18next';
import { formatDateWithUserTimezone } from '../utils/timezone';
import { ref, get, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';

const ControllerInfoBlock: React.FC = () => {
  const { i18n } = useTranslation();
  const deviceId = useRigStore(state => state.deviceId);
  
  const [currentControllerSerial, setCurrentControllerSerial] = useState<string>('—');
  const [firstControllerSerial, setFirstControllerSerial] = useState<string>('—');
  const [firstControllerFromDeviceId, setFirstControllerFromDeviceId] = useState(false);
  const [exchangeDate, setExchangeDate] = useState<string>('—');
  
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

  // Parse device ID to get rig serial
  const parseDeviceId = (deviceId: string): string => {
    if (deviceId.length !== 22) return '';
    return deviceId.substring(0, 7); // First 7 characters = Rig Serial
  };

  // Helper to format dates
  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return '—';
    try {
      // Format: YYYY-MM-DD HH-MM-SS or similar
      const parts = dateString.split(' ');
      if (parts.length !== 2) return dateString;
      
      const dateParts = parts[0].split('-');
      const timeParts = parts[1].split('-');
      
      if (dateParts.length !== 3 || timeParts.length !== 3) return dateString;
      
      const year = parseInt(dateParts[0]);
      const month = parseInt(dateParts[1]) - 1;
      const day = parseInt(dateParts[2]);
      const hour = parseInt(timeParts[0]);
      const minute = parseInt(timeParts[1]);
      const second = parseInt(timeParts[2]);
      
      const date = new Date(year, month, day, hour, minute, second);
      
      return formatDateWithUserTimezone(date.getTime(), i18n.language || 'de', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('[ControllerInfoBlock] Error formatting date:', error);
      return dateString;
    }
  };

  // Load controller data from Firebase
  const loadControllerData = useCallback(async () => {
    if (!deviceId || !realtimeDB) return;
    
    setIsLoading(true);
    try {
      const rigSerial = parseDeviceId(deviceId);
      if (!rigSerial) {
        console.error('[ControllerInfoBlock] Invalid device ID format');
        return;
      }

      // Load current controller serial (csnr_akt)
      const csnrAktRef = ref(realtimeDB, `controllertausch/fepaliste/${rigSerial}/csnr_akt`);
      const csnrAktSnapshot = await get(csnrAktRef);
      const csnrAkt = csnrAktSnapshot.exists() ? String(csnrAktSnapshot.val()).trim() : '—';
      setCurrentControllerSerial(csnrAkt);
      setEditValue(csnrAkt);

      // Load first controller serial (csnr)
      const csnrRef = ref(realtimeDB, `controllertausch/fepaliste/${rigSerial}/csnr`);
      const csnrSnapshot = await get(csnrRef);
      
      let csnr: string;
      let fromDeviceId = false;
      
      if (csnrSnapshot.exists() && String(csnrSnapshot.val()).trim()) {
        csnr = String(csnrSnapshot.val()).trim();
      } else {
        csnr = deviceId.substring(7, 14);
        fromDeviceId = true;
      }
      
      setFirstControllerSerial(csnr);
      setFirstControllerFromDeviceId(fromDeviceId);

      // Load exchange date (datum)
      const datumRef = ref(realtimeDB, `controllertausch/erl/${rigSerial}/datum`);
      const datumSnapshot = await get(datumRef);
      const datum = datumSnapshot.exists() ? String(datumSnapshot.val()) : '';
      setExchangeDate(formatDate(datum));

    } catch (error) {
      console.error('[ControllerInfoBlock] Error loading controller data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, i18n.language]);

  // Load data on mount and when deviceId changes
  useEffect(() => {
    loadControllerData();
  }, [loadControllerData]);

  // Handle edit mode
  const handleEdit = useCallback(() => {
    setIsEditing(true);
    setEditValue(currentControllerSerial);
  }, [currentControllerSerial]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!deviceId || !realtimeDB || !editValue.trim()) return;
    
    setIsSaving(true);
    try {
      const rigSerial = parseDeviceId(deviceId);
      if (!rigSerial) {
        console.error('[ControllerInfoBlock] Invalid device ID format');
        return;
      }

      const csnrAktRef = ref(realtimeDB, `controllertausch/fepaliste/${rigSerial}/csnr_akt`);
      await set(csnrAktRef, editValue.trim());
      
      setCurrentControllerSerial(editValue.trim());
      setIsEditing(false);
      
    } catch (error) {
      console.error('[ControllerInfoBlock] Error saving controller serial:', error);
    } finally {
      setIsSaving(false);
    }
  }, [deviceId, editValue]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(currentControllerSerial);
  }, [currentControllerSerial]);

  // Handle key press
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  return (
    <div className="bg-card rounded-xl overflow-hidden border border-border shadow-sm">
      {/* Header */}
      <div className="bg-muted/70 dark:bg-muted/50 text-foreground border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold flex items-center">
          <div className="w-4 h-4 mr-2 flex items-center justify-center">
            <svg
              className="w-3.5 h-3.5 text-primary"
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <span>Controller-Informationen</span>
        </h2>
      </div>

      {/* Content */}
      <div className="p-3 transition-colors">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            <span className="ml-2 text-sm text-muted-foreground">Lädt...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {/* Current Controller (Editable) */}
            <div className="p-2 bg-muted/50 rounded-lg">
              {!isEditing ? (
                <>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    Momentaner Controller
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-mono font-semibold text-foreground truncate pr-2">
                      {currentControllerSerial}
                    </div>
                    <button
                      onClick={handleEdit}
                      className="flex-shrink-0 ml-1 p-1 text-muted-foreground hover:text-primary rounded"
                      title="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground mb-1">
                    Edit
                  </div>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    className="w-full px-2 py-1 text-xs font-mono bg-card border border-primary rounded focus:ring-1 focus:ring-primary text-foreground"
                    autoFocus
                    disabled={isSaving}
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={handleSave}
                      disabled={isSaving || !editValue.trim()}
                      className="flex-1 px-2 py-1 bg-success hover:bg-success/90 disabled:opacity-50 text-white text-xs rounded disabled:cursor-not-allowed"
                    >
                      {isSaving ? '...' : '✓'}
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={isSaving}
                      className="flex-1 px-2 py-1 bg-muted hover:bg-muted/80 text-foreground text-xs rounded border border-border"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>

              {/* First Controller (Read-only) */}
              <div className="p-2 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-0.5 flex items-center justify-between">
                  <span>Erster Controller</span>
                  {firstControllerFromDeviceId && (
                    <div className="relative">
                      <button
                        onClick={() => setShowInfoTooltip(!showInfoTooltip)}
                        className="w-4 h-4 flex items-center justify-center text-xs text-primary hover:text-primary/80 font-bold rounded-full border border-primary hover:bg-primary/10 transition-colors"
                        title="Info"
                      >
                        *
                      </button>
                      {showInfoTooltip && (
                        <>
                          {/* Backdrop to close tooltip */}
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setShowInfoTooltip(false)}
                          />
                          {/* Tooltip */}
                          <div className="absolute right-0 top-6 z-50 w-64 p-3 bg-card border border-border rounded-lg shadow-xl">
                            <div className="text-xs text-foreground">
                              <div className="font-semibold text-primary mb-2">
                                Wert aus Device ID extrahiert
                              </div>
                              <div className="space-y-1 mb-2">
                                <div className="text-muted-foreground">
                                  Device ID:
                                </div>
                                <div className="font-mono text-xs break-all bg-muted p-1.5 rounded">
                                  {deviceId}
                                </div>
                              </div>
                              <div className="text-muted-foreground mb-1">
                                Erster Controller (Pos. 7-14):
                              </div>
                              <div className="font-mono font-bold text-sm text-primary bg-primary/10 p-1.5 rounded text-center">
                                {firstControllerSerial}
                              </div>
                              <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground italic">
                                Da kein Wert in Firebase gefunden wurde, wurde die Seriennummer aus der Device ID extrahiert.
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-sm font-mono font-semibold text-foreground">
                  {firstControllerSerial}
                </div>
              </div>

                {/* Exchange Date (Read-only) */}
                <div className="p-2 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-0.5">
                    Ausgetauscht am
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                  {exchangeDate}
                </div>
              </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ControllerInfoBlock;

