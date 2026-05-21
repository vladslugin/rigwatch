import { useState, useEffect } from 'react';

export const useTimezoneRefresh = () => {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleTimezoneChange = () => {
      setRefreshKey(prev => prev + 1);
    };

    window.addEventListener('timezone-settings-changed', handleTimezoneChange);
    return () => {
      window.removeEventListener('timezone-settings-changed', handleTimezoneChange);
    };
  }, []);

  return refreshKey;
};
