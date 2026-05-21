import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoveStore } from '../store/useStoveStore';
import { useTheme } from '../hooks/useTheme';
import UserSettingsModal from './UserSettingsModal';
import StoveInfoModal from './StoveInfoModal';
import ConnectionBlock from './ConnectionBlock';
import StoveStatusBlock from './StoveStatusBlock';
import ControllerInfoBlock from './ControllerInfoBlock';
import StoveIdentificationBlock from './StoveIdentificationBlock';
import StoveActionsBlock from './StoveActionsBlock';
import RealtimeChart from './RealtimeChart';

const SimpleModeLayout: React.FC = () => {
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const deviceId = useStoveStore(state => state.deviceId);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  const deviceConfig = useStoveStore(state => state.deviceConfig);
  const deviceMetadata = useStoveStore(state => state.deviceMetadata);
  const currentData = useStoveStore(state => state.currentData);
  const isHistoricalMode = useStoveStore(state => state.isHistoricalMode);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStoveInfoOpen, setIsStoveInfoOpen] = useState(false);

  // Computed connection state
  const isConnected = useMemo(() => !!deviceId && connectionStatus === 'online', [deviceId, connectionStatus]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex-1" />
          <div className="flex items-center justify-center gap-2">
            <img
              src={isDark ? '/logo.svg' : '/logo.svg'}
              alt="RigWatch"
              className="h-10"
            />
            <span className="text-xl font-bold text-muted-foreground">easy</span>
          </div>
          <div className="flex-1 flex justify-end items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 text-muted-foreground hover:bg-accent rounded"
              title={t('connectionPanel.toggleTheme', 'Toggle theme')}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-muted-foreground hover:bg-accent rounded"
              title={t('userSettings.title')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 px-4 py-6">
        <div className="max-w-7xl mx-auto space-y-3">
          {/* Connection Block - Always visible */}
          <ConnectionBlock />

          {/* Stove Identification Block - Always visible */}
          <div className={`grid grid-cols-1 ${isConnected ? 'lg:grid-cols-3' : ''} gap-3 items-stretch`}>
            {/* Stove Identification - 2/3 width when connected, full width when not connected */}
            <div className={`flex ${isConnected ? 'lg:col-span-2' : ''}`}>
              <StoveIdentificationBlock />
            </div>

            {/* Actions Block - 1/3 width - Only when connected */}
            {isConnected && (
              <div className="lg:col-span-1 flex">
                <StoveActionsBlock />
              </div>
            )}
          </div>

          {/* Data Blocks - Only when connected */}
          {isConnected && (
            <>
              {/* Status Block - Full Width */}
              <StoveStatusBlock />

              {/* Controller Info - Full Width */}
              <ControllerInfoBlock />

              <RealtimeChart
                parameters={discoveredParameters}
                currentData={currentData}
                isHistoricalMode={isHistoricalMode}
                deviceId={deviceId || 'N/A'}
                stoveModel={deviceMetadata.ofenname || 'N/A'}
                stoveModelInfo={deviceMetadata.ofen ? `Model #${deviceMetadata.ofen}` : ''}
                parameterSet={deviceConfig.verz === '~' || !deviceConfig.verz ? 'Default' : deviceConfig.verz}
              />
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <UserSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <StoveInfoModal
        isOpen={isStoveInfoOpen}
        onClose={() => setIsStoveInfoOpen(false)}
      />
    </div>
  );
};

export default SimpleModeLayout;
