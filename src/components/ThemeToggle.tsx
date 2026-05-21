import React, { useState, useRef, useEffect } from 'react';
import { useTheme, AVAILABLE_THEMES, type ThemeName, type ThemeMode } from '../hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  /** Show extended theme selector menu */
  showThemeSelector?: boolean;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  className = '', 
  showLabel = false,
  showThemeSelector = false,
}) => {
  const { 
    mode, 
    themeName, 
    toggleMode, 
    setThemeMode, 
    setColorTheme, 
    isDark,
    currentThemeInfo,
  } = useTheme();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const getIcon = () => {
    if (isDark) {
      // Sun icon switches to light mode
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
        </svg>
      );
    }
    // Moon icon switches to dark mode
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
      </svg>
    );
  };

  const getModeIcon = (m: ThemeMode) => {
    switch (m) {
      case 'light':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        );
      case 'dark':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        );
      case 'system':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const getTooltip = () => isDark ? 'Switch to light mode' : 'Switch to dark mode';

  // Simple light/dark toggle button
  if (!showThemeSelector) {
    return (
      <button
        onClick={toggleMode}
        className={`
          flex items-center justify-center p-2 rounded-lg transition-colors
          text-muted-foreground hover:text-foreground hover:bg-accent
          ${className}
        `}
        title={getTooltip()}
        aria-label={getTooltip()}
      >
        {getIcon()}
        {showLabel && (
          <span className="ml-2 text-sm font-medium">
            {isDark ? 'Dark' : 'Light'}
          </span>
        )}
      </button>
    );
  }

  // Extended menu with theme selection
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        className={`
          flex items-center justify-center p-2 rounded-lg transition-colors
          text-muted-foreground hover:text-foreground hover:bg-accent
          ${className}
        `}
        title="Theme settings"
        aria-label="Theme settings"
        aria-expanded={isMenuOpen}
      >
        {getIcon()}
        {showLabel && (
          <span className="ml-2 text-sm font-medium">
            {currentThemeInfo.name}
          </span>
        )}
        <svg className={`w-3 h-3 ml-1 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isMenuOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-lg shadow-theme-lg z-50 overflow-hidden">
          {/* Theme mode */}
          <div className="p-3 border-b border-border">
            <div className="text-xs font-medium text-muted-foreground mb-2">Mode</div>
            <div className="flex gap-1">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setThemeMode(m)}
                  className={`
                    flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors
                    ${mode === m 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-secondary hover:bg-accent text-foreground'
                    }
                  `}
                >
                  {getModeIcon(m)}
                  <span className="capitalize">{m}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color theme selection */}
          <div className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Color Theme</div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {AVAILABLE_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => {
                    setColorTheme(theme.id);
                    setIsMenuOpen(false);
                  }}
                  className={`
                    w-full text-left px-3 py-2 rounded text-sm transition-colors
                    ${themeName === theme.id 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-accent text-foreground'
                    }
                  `}
                >
                  <div className="font-medium">{theme.name}</div>
                  <div className={`text-xs ${themeName === theme.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {theme.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThemeToggle;
