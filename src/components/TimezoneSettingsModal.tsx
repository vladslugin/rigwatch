import React, { useState, useEffect } from 'react';
import { getTimezoneSettings, setTimezoneSettings, COMMON_TIMEZONES } from '../utils/timezone';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { ThemeName } from '../hooks/useTheme';

interface TimezoneSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TimezoneSettingsModal: React.FC<TimezoneSettingsModalProps> = ({ isOpen, onClose }) => {
  const [timezone, setTimezone] = useState('Europe/Berlin');
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [offsetHours, setOffsetHours] = useState(0);
  const [offsetMins, setOffsetMins] = useState(0);
  const [themeName, setThemeName] = useState<ThemeName>('default');
  const isNeo = themeName === 'neo-brutalism';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => {
      const next = (document.documentElement.dataset.theme as ThemeName) || 'default';
      setThemeName(next);
    };
    const observer = new MutationObserver(handler);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    handler();
    return () => observer.disconnect();
  }, []);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      const settings = getTimezoneSettings();
      setTimezone(settings.timezone);
      setOffsetMinutes(settings.offsetMinutes);
      
      // Convert total minutes to hours and minutes for UI
      const hours = Math.floor(Math.abs(settings.offsetMinutes) / 60);
      const mins = Math.abs(settings.offsetMinutes) % 60;
      setOffsetHours(settings.offsetMinutes >= 0 ? hours : -hours);
      setOffsetMins(mins);
    }
  }, [isOpen]);

  const handleSave = () => {
    // Convert hours and minutes back to total minutes
    const totalMinutes = offsetHours * 60 + offsetMins;
    setTimezoneSettings({ timezone, offsetMinutes: totalMinutes });
    onClose();
    // Trigger a page refresh or emit an event to update all formatters
    window.dispatchEvent(new CustomEvent('timezone-settings-changed'));
  };

  const handleOffsetHoursChange = (value: number) => {
    setOffsetHours(value);
    setOffsetMinutes(value * 60 + offsetMins);
  };

  const handleOffsetMinsChange = (value: number) => {
    setOffsetMins(value);
    setOffsetMinutes(offsetHours * 60 + value);
  };

  if (!isOpen) return null;

  return (
    <div className={isNeo ? 'fixed inset-0 bg-black/50 flex items-center justify-center z-50' : 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'}>
      <div className={isNeo ? 'bg-card text-foreground rounded-lg p-6 w-full max-w-md mx-4 border-2 border-border shadow-theme-lg' : 'bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4'}>
        <div className={isNeo ? 'flex items-center justify-between mb-4 border-b border-border pb-3' : 'flex items-center justify-between mb-4'}>
          <h2 className={isNeo ? 'text-lg font-semibold text-foreground flex items-center' : 'text-lg font-semibold text-gray-900 dark:text-white flex items-center'}>
            <svg className={isNeo ? 'w-5 h-5 mr-2 text-primary' : 'w-5 h-5 mr-2'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Timezone Settings
          </h2>
          <button
            onClick={onClose}
            className={isNeo ? 'text-muted-foreground hover:text-destructive' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Timezone Selection */}
          <div>
            <label htmlFor="timezone-select" className={isNeo ? 'block text-sm font-medium text-foreground mb-2' : 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'}>
              Timezone
            </label>
            <select
              id="timezone-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={isNeo ? 'w-full px-3 py-2 border border-border rounded-md bg-card text-foreground focus:ring-2 focus:ring-primary focus:border-primary' : 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          {/* Offset Adjustment */}
          <div>
            <label className={isNeo ? 'block text-sm font-medium text-foreground mb-2' : 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'}>
              Additional Offset (for controller time correction)
            </label>
            <div className="flex items-center space-x-2">
              <div className="flex items-center">
                <label htmlFor="offset-hours" className={isNeo ? 'text-sm text-muted-foreground mr-1' : 'text-sm text-gray-600 dark:text-gray-400 mr-1'}>
                  Hours:
                </label>
                <input
                  id="offset-hours"
                  type="number"
                  min="-12"
                  max="12"
                  value={offsetHours}
                  onChange={(e) => handleOffsetHoursChange(parseInt(e.target.value) || 0)}
                  className={isNeo ? 'w-16 px-2 py-1 border border-border rounded bg-card text-foreground text-center focus:ring-2 focus:ring-primary focus:border-primary' : 'w-16 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500'}
                />
              </div>
              <div className="flex items-center">
                <label htmlFor="offset-mins" className={isNeo ? 'text-sm text-muted-foreground mr-1' : 'text-sm text-gray-600 dark:text-gray-400 mr-1'}>
                  Minutes:
                </label>
                <input
                  id="offset-mins"
                  type="number"
                  min="0"
                  max="59"
                  value={offsetMins}
                  onChange={(e) => handleOffsetMinsChange(parseInt(e.target.value) || 0)}
                  className={isNeo ? 'w-16 px-2 py-1 border border-border rounded bg-card text-foreground text-center focus:ring-2 focus:ring-primary focus:border-primary' : 'w-16 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500'}
                />
              </div>
            </div>
            <p className={isNeo ? 'text-xs text-muted-foreground mt-1' : 'text-xs text-gray-500 dark:text-gray-400 mt-1'}>
              Use positive values if your controller time is behind, negative if ahead.
              <br />
              Current offset: {offsetMinutes >= 0 ? '+' : ''}{Math.floor(offsetMinutes / 60)}:{Math.abs(offsetMinutes % 60).toString().padStart(2, '0')}
            </p>
          </div>

          {/* Preview */}
          <div className={isNeo ? 'bg-muted rounded p-3 border border-border' : 'bg-gray-50 dark:bg-gray-700 rounded p-3'}>
            <p className={isNeo ? 'text-sm text-muted-foreground mb-1' : 'text-sm text-gray-600 dark:text-gray-400 mb-1'}>Preview:</p>
            <p className={isNeo ? 'text-sm font-mono text-foreground' : 'text-sm font-mono text-gray-900 dark:text-white'}>
              {new Date().toLocaleString('de-DE', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
              {offsetMinutes !== 0 && (
                <span className={isNeo ? 'text-info' : 'text-blue-600 dark:text-blue-400'}>
                  {' → '}
                  {new Date(Date.now() + offsetMinutes * 60 * 1000).toLocaleString('de-DE', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className={isNeo ? 'px-4 py-2 text-foreground bg-muted rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 transition-colors' : 'px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors'}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={isNeo ? 'px-4 py-2 bg-primary text-primary-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 transition-colors' : 'px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors'}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimezoneSettingsModal;
