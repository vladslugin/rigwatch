interface TimezoneSettings {
  timezone: string;
  offsetMinutes: number; // Additional offset in minutes (can be negative)
}

const DEFAULT_TIMEZONE_SETTINGS: TimezoneSettings = {
  timezone: 'Europe/Berlin',
  offsetMinutes: 0
};

const STORAGE_KEY = 'rigwatch-timezone-settings';

export const getTimezoneSettings = (): TimezoneSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        timezone: parsed.timezone || DEFAULT_TIMEZONE_SETTINGS.timezone,
        offsetMinutes: parsed.offsetMinutes || 0
      };
    }
  } catch (error) {
    console.warn('Failed to load timezone settings:', error);
  }
  return DEFAULT_TIMEZONE_SETTINGS;
};

export const setTimezoneSettings = (settings: TimezoneSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save timezone settings:', error);
  }
};

export const formatDateWithUserTimezone = (
  date: Date | number,
  locale: string = 'de-DE',
  options: Intl.DateTimeFormatOptions = {}
): string => {
  const settings = getTimezoneSettings();
  const dateObj = date instanceof Date ? date : new Date(date);
  
  return dateObj.toLocaleString(locale, {
    ...options,
    timeZone: settings.timezone
  });
};

export const formatHistoricalDateWithUserTimezone = (
  date: Date | number,
  locale: string = 'de-DE',
  options: Intl.DateTimeFormatOptions = {}
): string => {
  const settings = getTimezoneSettings();
  const dateObj = date instanceof Date ? date : new Date(date);
  
  // Apply additional offset if set (for historical data only)
  if (settings.offsetMinutes !== 0) {
    const adjustedDate = new Date(dateObj.getTime() + settings.offsetMinutes * 60 * 1000);
    return adjustedDate.toLocaleString(locale, {
      ...options,
      timeZone: settings.timezone
    });
  }
  
  return dateObj.toLocaleString(locale, {
    ...options,
    timeZone: settings.timezone
  });
};

export const COMMON_TIMEZONES = [
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
  { value: 'Europe/Vienna', label: 'Vienna (CET/CEST)' },
  { value: 'Europe/Zurich', label: 'Zurich (CET/CEST)' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'UTC', label: 'UTC' }
];
