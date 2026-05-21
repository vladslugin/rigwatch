import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Available color themes
 * To add a new theme:
 * 1. Add the name to this type
 * 2. Add CSS variables in src/styles/themes.css with [data-theme="theme-name"]
 */
export type ThemeName =
  | 'default'           // Standard HASE theme
  | 'neo-brutalism'     // Neo Brutalism - sharp modern style
  | 'web3-modern';      // Web3 Modern - deep dark blue with electric accents

/**
 * Theme mode: light, dark, or system
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Theme configuration saved in localStorage
 */
interface ThemeConfig {
  mode: ThemeMode;
  themeName: ThemeName;
}

/**
 * List of available themes with metadata for UI
 */
export const AVAILABLE_THEMES: { id: ThemeName; name: string; description: string; previewColor: string }[] = [
  { id: 'default', name: 'HASE Standard', description: 'Klassisches Design mit neutralen Farben', previewColor: '#111827' },
  { id: 'neo-brutalism', name: 'Neo Brutalism', description: 'Harte Schatten, keine Rundungen', previewColor: '#ff3333' },
  { id: 'web3-modern', name: 'Web3 Modern', description: 'Tiefes Dunkelblau mit elektrischen Akzenten', previewColor: '#3B82F6' },
];

const STORAGE_KEY = 'rigwatch-theme-config';

/**
 * Hook for managing app themes
 * 
 * Supports:
 * - Multiple color themes (ThemeName)
 * - Light/dark/system modes (ThemeMode)
 * - localStorage persistence
 * - System preference sync
 */
export const useTheme = () => {
  // Get initial config from localStorage
  const getInitialConfig = (): ThemeConfig => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ThemeConfig;
        // Validate
        if (
          ['light', 'dark', 'system'].includes(parsed.mode) &&
          AVAILABLE_THEMES.some(t => t.id === parsed.themeName)
        ) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[useTheme] Failed to load theme config:', e);
    }
    return { mode: 'system', themeName: 'default' };
  };

  // Resolve actual theme (light/dark) based on mode
  const resolveMode = (mode: ThemeMode): 'light' | 'dark' => {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    // system mode
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  const initialConfig = getInitialConfig();
  const [mode, setMode] = useState<ThemeMode>(initialConfig.mode);
  const [themeName, setThemeName] = useState<ThemeName>(initialConfig.themeName);
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>(resolveMode(initialConfig.mode));

  // Apply theme to DOM
  const applyTheme = useCallback((resolvedMode: 'light' | 'dark', themeName: ThemeName) => {
    const root = document.documentElement;
    
    // Temporarily disable transitions for smooth theme switch without "flashes"
    root.classList.add('no-transitions');
    
    // Set mode (light/dark)
    if (resolvedMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    
    // Set color theme
    if (themeName === 'default') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', themeName);
    }
    
    // Restore transitions after small delay
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove('no-transitions');
      });
    });
  }, []);

  // Save config to localStorage
  const saveConfig = useCallback((config: ThemeConfig) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('[useTheme] Failed to save theme config:', e);
    }
  }, []);

  // Listen to system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = () => {
      if (mode === 'system') {
        const newResolved = mediaQuery.matches ? 'dark' : 'light';
        setResolvedMode(newResolved);
        applyTheme(newResolved, themeName);
      }
    };

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mode, themeName, applyTheme]);

  // Apply theme when mode or themeName changes
  useEffect(() => {
    const resolved = resolveMode(mode);
    setResolvedMode(resolved);
    applyTheme(resolved, themeName);
    saveConfig({ mode, themeName });
  }, [mode, themeName, applyTheme, saveConfig]);

  // ═══════════════════════════════════════════════════════════════════
  // API for changing theme
  // ═══════════════════════════════════════════════════════════════════

  /** Set theme mode (light/dark/system) */
  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
  }, []);

  /** Set color theme */
  const setColorTheme = useCallback((newTheme: ThemeName) => {
    setThemeName(newTheme);
  }, []);

  /** Toggle between light and dark */
  const toggleMode = useCallback(() => {
    setMode(prev => {
      const resolved = resolveMode(prev);
      return resolved === 'dark' ? 'light' : 'dark';
    });
  }, []);

  /** Quick mode setters */
  const setLightMode = useCallback(() => setMode('light'), []);
  const setDarkMode = useCallback(() => setMode('dark'), []);
  const setSystemMode = useCallback(() => setMode('system'), []);

  /** Reset to defaults */
  const resetToDefaults = useCallback(() => {
    setMode('system');
    setThemeName('default');
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // Computed values
  // ═══════════════════════════════════════════════════════════════════

  const isDark = resolvedMode === 'dark';
  const isLight = resolvedMode === 'light';
  const isSystemMode = mode === 'system';

  const currentThemeInfo = useMemo(() => 
    AVAILABLE_THEMES.find(t => t.id === themeName) || AVAILABLE_THEMES[0],
    [themeName]
  );

  // ═══════════════════════════════════════════════════════════════════
  // Backward compatibility with old API
  // ═══════════════════════════════════════════════════════════════════

  return {
    // New API
    mode,
    themeName,
    resolvedMode,
    setThemeMode,
    setColorTheme,
    toggleMode,
    resetToDefaults,
    currentThemeInfo,
    availableThemes: AVAILABLE_THEMES,
    
    // Old API (backward compatibility)
    theme: mode,
    setTheme: setThemeMode,
    setLightTheme: setLightMode,
    setDarkTheme: setDarkMode,
    setSystemTheme: setSystemMode,
    toggleTheme: toggleMode,
    isDark,
    isLight,
    isSystem: isSystemMode,
    resolvedTheme: resolvedMode,
  };
};

/**
 * Utility to get CSS theme variable in JavaScript
 * @example const bgColor = getThemeVariable('--background');
 */
export const getThemeVariable = (variableName: string): string => {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
};

/**
 * Utility to set CSS theme variable
 * @example setThemeVariable('--primary', '#ff3333');
 */
export const setThemeVariable = (variableName: string, value: string): void => {
  if (typeof window === 'undefined') return;
  document.documentElement.style.setProperty(variableName, value);
};
