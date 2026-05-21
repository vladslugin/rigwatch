import React, { useEffect, useCallback } from 'react';
import { useRigStore } from '../store/useRigStore';

const AppUpdateNotifier: React.FC = () => {
  const addNotification = useRigStore(state => state.addNotification);

  const handleUpdateToast = useCallback((event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail) return;

    // Add update notification
    addNotification({
      message: 'Neues Update verfügbar. Refresh Sie die Seite für die neuesten Features.',
      type: 'info',
      duration: 60000, // Show for 15 seconds
      isAlarm: false
    });
  }, [addNotification]);

  useEffect(() => {
    window.addEventListener('app-update-toast', handleUpdateToast);
    return () => window.removeEventListener('app-update-toast', handleUpdateToast);
  }, [handleUpdateToast]);

  return null; // This component doesn't render anything
};

export default AppUpdateNotifier;
