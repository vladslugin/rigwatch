import { useState, useEffect, useCallback } from 'react';

interface VersionInfo {
  version: string;
  buildTime: number;
  message: string;
}

export const useAppUpdates = () => {
  const [currentVersion, setCurrentVersion] = useState<VersionInfo | null>(null);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);

  const checkForUpdates = useCallback(async () => {
    try {
      const response = await fetch('/version.json', {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });

      if (!response.ok) {
        console.warn('[AppUpdates] Failed to fetch version info');
        return;
      }

      const versionData: VersionInfo = await response.json();

      if (!currentVersion) {
        setCurrentVersion(versionData);
        return;
      }

      if (versionData.buildTime > currentVersion.buildTime) {
        console.log('[AppUpdates] New version detected');
        setIsUpdateAvailable(true);
        setCurrentVersion(versionData);

        // Show update notification using custom event system
        try {
          const evt = new CustomEvent('app-update-toast', {
            detail: {
              version: versionData.version,
              buildTime: versionData.buildTime,
              message: versionData.message
            }
          });
          window.dispatchEvent(evt);
        } catch (error) {
          console.error('[AppUpdates] Failed to dispatch update event:', error);
        }
      }
    } catch (error) {
      console.error('[AppUpdates] Update check failed:', error);
    }
  }, [currentVersion]);

  const dismissUpdate = useCallback(() => {
    setIsUpdateAvailable(false);
  }, []);

  const forceReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Check for updates on mount and periodically
  useEffect(() => {
    // Initial check
    checkForUpdates();

    // Check every 2 minutes (less frequent than SW to avoid conflicts)
    const interval = setInterval(checkForUpdates, 2 * 60 * 1000);

    return () => clearInterval(interval);
  }, [checkForUpdates]);

  return {
    currentVersion,
    isUpdateAvailable,
    checkForUpdates,
    dismissUpdate,
    forceReload
  };
};
