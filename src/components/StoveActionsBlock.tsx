import React, { useState, useCallback } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import { ref, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { useTranslation } from 'react-i18next';

const StoveActionsBlock: React.FC = () => {
  const deviceId = useStoveStore(state => state.deviceId);
  const deviceMetadata = useStoveStore(state => state.deviceMetadata);
  const { t } = useTranslation();
  
  const [isSettingSoftware, setIsSettingSoftware] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Set software level to 4
  const handleSetSoftwareLevel = useCallback(async () => {
    if (!deviceId || !realtimeDB) return;
    
    setIsSettingSoftware(true);
    try {
      const swsRef = ref(realtimeDB, `konstant/${deviceId}/sws`);
      await set(swsRef, 4);
      
      alert(t('stove.softwareLevelSetSuccess'));
    } catch (error) {
      console.error('[StoveActionsBlock] Error setting software level:', error);
      alert(t('stove.softwareLevelSetError'));
    } finally {
      setIsSettingSoftware(false);
    }
  }, [deviceId]);

  // Trigger firmware update
  const handleMakeUpdate = useCallback(async () => {
    if (!deviceId || !realtimeDB) return;
    
    setIsUpdating(true);
    try {
      const updateRef = ref(realtimeDB, `konstant/${deviceId}/u`);
      await set(updateRef, true);
      
      alert(t('stove.updateStartedSuccess'));
    } catch (error) {
      console.error('[StoveActionsBlock] Error triggering update:', error);
      alert(t('stove.updateStartedError'));
    } finally {
      setIsUpdating(false);
    }
  }, [deviceId]);

  return (
    <div className="bg-card rounded-xl overflow-hidden border border-border shadow-sm flex-1 flex flex-col">
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span>Aktionen</span>
        </h2>
      </div>

      {/* Content */}
      <div className="p-3 transition-colors flex-1 flex flex-col">
        {/* Firmware Update Status and Progress */}
        <div className="mb-3">
          {/* Unified status indicator: show exactly one state */}
          {deviceMetadata.f !== undefined && deviceMetadata.f > 0 && deviceMetadata.f < 100 ? (
            <div className="px-3 py-2 bg-primary/10 text-primary rounded-lg text-xs border border-primary/30">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{t('stove.updatingFirmware')}</span>
                <span className="font-bold">{deviceMetadata.f}%</span>
              </div>
              <div className="w-full bg-muted rounded h-1.5">
                <div
                  className="bg-primary h-1.5 rounded"
                  style={{ width: `${deviceMetadata.f}%` }}
                ></div>
              </div>
            </div>
          ) : deviceMetadata.v ? (
            <div className="px-3 py-2 bg-warning/10 text-warning text-xs rounded-lg flex items-center border border-warning/30">
              <svg className="w-4 h-4 mr-2 text-warning" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.667-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{t('stove.updateAvailable')}</span>
            </div>
          ) : deviceMetadata.f === 100 ? (
            <div className="px-3 py-2 bg-success/10 text-success rounded-lg text-xs flex items-center border border-success/30">
              <svg className="w-4 h-4 mr-2 text-success" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{t('stove.upToDate')}</span>
            </div>
          ) : null}
        </div>

        <div className="flex-1 flex flex-col justify-center space-y-2">
          {/* Software Level Button */}
          <button
            onClick={handleSetSoftwareLevel}
            disabled={isSettingSoftware}
            className="w-full px-2 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {isSettingSoftware ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>{t('stove.settingSoftware')}</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>{t('stove.setSoftwareLevel4')}</span>
              </>
            )}
          </button>

          {/* Update Button - Hide when firmware is updating */}
          {!(deviceMetadata.f !== undefined && deviceMetadata.f > 0 && deviceMetadata.f < 100) && (
            <button
              onClick={handleMakeUpdate}
              disabled={isUpdating}
              className="w-full px-2 py-1.5 bg-success hover:bg-success/90 disabled:opacity-50 text-white text-xs font-semibold rounded transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {isUpdating ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{t('stove.updating')}</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>{t('stove.update')}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoveActionsBlock;

