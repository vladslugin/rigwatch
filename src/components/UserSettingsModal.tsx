import * as React from 'react';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useAuth } from '../hooks/useAuth';
import { USER_ROLE_CONFIGS } from '../types/auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useNotificationHelpers } from '../store/useRigStore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { commandQueue } from '../utils/commandQueue';
import { useTheme, AVAILABLE_THEMES, type ThemeMode } from '../hooks/useTheme';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCategories?: () => void;
  onOpenAdminPanel?: () => void;
}

/**
 * Tab keys are stable identifiers — used for state and i18n lookups. Each tab
 * holds a self-contained bento grid with related settings, so the user can
 * scan the dashboard-style cards in one glance instead of scrolling through
 * one long stack.
 */
type SettingsTab = 'profile' | 'appearance' | 'display' | 'data';

/**
 * Trimmed font roster. The previous implementation listed 14 system fonts —
 * an artefact from an early "let me change everything" iteration that nobody
 * actually uses. Keep just enough variety: a default sans-serif, a clean
 * mono for power users who want command output to align, and the system
 * default. Switching is a one-off taste preference, not a daily lever.
 */
const FONT_OPTIONS = [
  { id: 'system-ui', labelKey: 'userSettings.appearance.fontSystem', stack: 'system-ui' },
  { id: 'inter', labelKey: 'userSettings.appearance.fontInter', stack: "Inter, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" },
  { id: 'mono', labelKey: 'userSettings.appearance.fontMono', stack: "'JetBrains Mono', Consolas, 'Courier New', monospace" },
] as const;

const isSystemFont = (value: string) => !value || value === 'system-ui';
const matchFontId = (stored: string): typeof FONT_OPTIONS[number]['id'] => {
  if (isSystemFont(stored)) return 'system-ui';
  if (stored.includes('JetBrains Mono') || stored.includes('Courier') || stored.includes('Mono')) return 'mono';
  return 'inter';
};

// ─── Reusable bento card ────────────────────────────────────────────────
const BentoCard: React.FC<{
  title?: React.ReactNode;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, description, className = '', children }) => (
  <section
    className={`relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-theme-sm transition-shadow ${className}`}
  >
    {(title || icon) && (
      <header className="flex items-center gap-2">
        {icon ? <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-primary">{icon}</div> : null}
        {title ? <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4> : null}
      </header>
    )}
    <div className="flex-1">{children}</div>
    {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
  </section>
);

// ─── Compact icon set ────────────────────────────────────────────────────
const Icons = {
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21l3-3m0 0l-1-7 7-7 1 8-7 6zm0 0l-3 3" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h13M3 12h7M3 18h13M14 4v4M11 10v4M14 16v4" />
    </svg>
  ),
  database: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7c0-1.66 3.58-3 8-3s8 1.34 8 3M4 7c0 1.66 3.58 3 8 3s8-1.34 8-3M4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  ),
  signOut: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 3v1M12 20v1M3 12h1M20 12h1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path strokeLinecap="round" d="M8 20h8M12 16v4" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
    </svg>
  ),
  reset: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  ),
};

// ────────────────────────────────────────────────────────────────────────
const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenCategories,
}) => {
  const { t } = useTranslation();
  const { user, signOut, updateUserLanguage } = useAuth();
  const { showSuccess } = useNotificationHelpers();
  const {
    resetColors,
    resetPositions,
    resetFavorites,
    resetParameterSettings,
    exportSettings,
    importSettings,
    getUserPreferences,
    saveUserPreferences,
  } = useLocalSettings();
  const { mode: themeMode, themeName, setThemeMode, setColorTheme, currentThemeInfo } = useTheme();

  useEscapeKey(onClose, { enabled: isOpen });

  // ─── State ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [unfavoriteOpacity, setUnfavoriteOpacity] = useState<number>(0.7);
  const [simplificationMode, setSimplificationMode] = useState<boolean>(false);
  const [newDesign, setNewDesign] = useState<boolean>(false);
  const [decimalSeparatorMode, setDecimalSeparatorMode] = useState<boolean>(false);
  const [fontFamily, setFontFamily] = useState<string>('system-ui');
  const [commandDelay, setCommandDelay] = useState<number>(500);

  // Reset to default tab on each open so closing+reopening doesn't dump the
  // user back inside a deep settings tab they were just exploring.
  useEffect(() => {
    if (isOpen) setActiveTab('profile');
  }, [isOpen]);

  // ─── Side-effect helpers ─────────────────────────────────────────────
  const applyFontFamily = useCallback((stack: string) => {
    if (isSystemFont(stack)) {
      document.documentElement.style.removeProperty('--custom-font-family');
      document.body.style.fontFamily = '';
    } else {
      document.documentElement.style.setProperty('--custom-font-family', stack);
      document.body.style.fontFamily = stack;
    }
  }, []);

  const handleFontChange = useCallback(
    (id: typeof FONT_OPTIONS[number]['id']) => {
      const found = FONT_OPTIONS.find((option) => option.id === id);
      if (!found) return;
      const stack = found.stack;
      setFontFamily(stack);
      if (isSystemFont(stack)) {
        localStorage.removeItem('rigwatch-font-family');
      } else {
        localStorage.setItem('rigwatch-font-family', stack);
      }
      applyFontFamily(stack);
    },
    [applyFontFamily],
  );

  const handleDecimalSeparatorChange = useCallback((useComma: boolean) => {
    setDecimalSeparatorMode(useComma);
    localStorage.setItem('rigwatch-decimal-separator', useComma.toString());
    window.dispatchEvent(new CustomEvent('decimalSeparatorChanged', { detail: { useComma } }));
  }, []);

  const handleOpacityChange = useCallback(
    (value: number) => {
      setUnfavoriteOpacity(value);
      const prefs = getUserPreferences();
      saveUserPreferences({ ...prefs, unfavoriteOpacity: value });
      window.dispatchEvent(new CustomEvent('userPreferencesChanged', { detail: { unfavoriteOpacity: value } }));
    },
    [getUserPreferences, saveUserPreferences],
  );

  const handleCommandDelayChange = useCallback(
    (value: number) => {
      setCommandDelay(value);
      const prefs = getUserPreferences();
      saveUserPreferences({ ...prefs, commandDelay: value });
      commandQueue.setDefaultDelay(value);
    },
    [getUserPreferences, saveUserPreferences],
  );

  const handleSimplificationModeChange = useCallback(
    async (enabled: boolean) => {
      // forceSimpleMode set by an admin overrides the local toggle. We bail
      // before mutating any local state so the UI can reflect the lock.
      if (user?.forceSimpleMode === true) return;
      setSimplificationMode(enabled);
      const prefs = getUserPreferences();
      saveUserPreferences({ ...prefs, simplificationMode: enabled });
      window.dispatchEvent(new CustomEvent('userPreferencesChanged', { detail: { simplificationMode: enabled } }));
      try {
        if (user && firestoreDB) {
          const userRef = doc(firestoreDB, 'users', user.uid);
          await setDoc(userRef, { simple_mode: enabled }, { merge: true });
        }
      } catch (error) {
        console.error('[UserSettings] Failed to save simple_mode to Firestore:', error);
      }
    },
    [getUserPreferences, saveUserPreferences, user],
  );

  const handleNewDesignChange = useCallback(
    (enabled: boolean) => {
      setNewDesign(enabled);
      const prefs = getUserPreferences();
      saveUserPreferences({ ...prefs, newDesign: enabled });
      window.dispatchEvent(new CustomEvent('userPreferencesChanged', { detail: { newDesign: enabled } }));
    },
    [getUserPreferences, saveUserPreferences],
  );

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      onClose();
    } catch (error) {
      console.error('[UserSettings] Sign out error:', error);
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut, onClose]);

  const handleReset = useCallback(async (key: string, fn: () => boolean) => {
    setIsResetting(key);
    try {
      fn();
    } catch (error) {
      console.error(`[UserSettings] Error resetting ${key}:`, error);
    } finally {
      setIsResetting(null);
    }
  }, []);

  const handleExportSettings = useCallback(() => {
    try {
      const settings = exportSettings();
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rigwatch-settings-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[UserSettings] Failed to export settings:', error);
    }
  }, [exportSettings]);

  const handleImportSettings = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const settings = JSON.parse(e.target?.result as string);
          if (importSettings(settings)) {
            window.location.reload();
          }
        } catch (error) {
          console.error('[UserSettings] Failed to import settings:', error);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },
    [importSettings],
  );

  // ─── Initial load ────────────────────────────────────────────────────
  useEffect(() => {
    const prefs = getUserPreferences();
    setUnfavoriteOpacity(prefs.unfavoriteOpacity || 0.3);
    setSimplificationMode(prefs.simplificationMode || false);
    setNewDesign(prefs.newDesign || false);
    const savedCommandDelay = prefs.commandDelay ?? 500;
    setCommandDelay(savedCommandDelay);
    commandQueue.setDefaultDelay(savedCommandDelay);
    const savedFontFamily = localStorage.getItem('rigwatch-font-family');
    if (savedFontFamily) {
      setFontFamily(savedFontFamily);
      applyFontFamily(savedFontFamily);
    }
    const savedDecimalSeparator = localStorage.getItem('rigwatch-decimal-separator');
    if (savedDecimalSeparator === 'true') setDecimalSeparatorMode(true);
  }, [getUserPreferences, applyFontFamily]);

  useEffect(() => {
    let isCancelled = false;
    const loadRemote = async () => {
      try {
        if (!user || !firestoreDB) return;
        if (user.forceSimpleMode === true) {
          if (!isCancelled) {
            setSimplificationMode(true);
            const prefs = getUserPreferences();
            saveUserPreferences({ ...prefs, simplificationMode: true });
            window.dispatchEvent(new CustomEvent('userPreferencesChanged', { detail: { simplificationMode: true } }));
          }
          return;
        }
        const userRef = doc(firestoreDB, 'users', user.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? (snap.data() as any) : null;
        const remoteValue = data?.simple_mode;
        if ((remoteValue === true || remoteValue === false) && !isCancelled) {
          setSimplificationMode(remoteValue);
          const prefs = getUserPreferences();
          saveUserPreferences({ ...prefs, simplificationMode: remoteValue });
          window.dispatchEvent(new CustomEvent('userPreferencesChanged', { detail: { simplificationMode: remoteValue } }));
        }
      } catch (error) {
        console.error('[UserSettings] Failed to load simple_mode from Firestore:', error);
      }
    };
    loadRemote();
    return () => {
      isCancelled = true;
    };
  }, [user, getUserPreferences, saveUserPreferences]);

  const currentFontId = useMemo(() => matchFontId(fontFamily), [fontFamily]);

  if (!isOpen) return null;

  // ─── Subcomponents (inline; keeps state lifting trivial) ─────────────

  const renderProfileTab = () => {
    if (!user) return null;
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <BentoCard className="md:col-span-2" icon={Icons.user} title={t('userSettings.profile.identity')}>
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="h-12 w-12 object-cover" />
                ) : (
                  Icons.user
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-status-online" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {user.displayName || user.email?.split('@')[0]}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              <div className="mt-1.5 inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: USER_ROLE_CONFIGS[user.role].color }}
                />
                <span
                  className="text-xs font-medium"
                  style={{ color: USER_ROLE_CONFIGS[user.role].color }}
                >
                  {USER_ROLE_CONFIGS[user.role].name}
                </span>
              </div>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          icon={Icons.signOut}
          title={t('userSettings.profile.session')}
          description={t('userSettings.profile.signOutDesc') as string}
        >
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSigningOut ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
            ) : (
              Icons.signOut
            )}
            {isSigningOut ? t('userSettings.account.signingOut') : t('userSettings.account.signOut')}
          </button>
        </BentoCard>

        <BentoCard className="md:col-span-3" title={t('userSettings.profile.languageTitle')}>
          <div className="flex gap-2">
            {(['de', 'en'] as const).map((lng) => {
              const isActive = (i18n.resolvedLanguage || i18n.language) === lng;
              return (
                <button
                  key={lng}
                  type="button"
                  onClick={async () => {
                    await i18n.changeLanguage(lng);
                    updateUserLanguage(lng).catch(() => {});
                    showSuccess(t('actions.updated'));
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/40 text-foreground hover:bg-muted'
                  }`}
                >
                  <span className="text-lg leading-none">{lng === 'de' ? '🇩🇪' : '🇬🇧'}</span>
                  {lng === 'de' ? t('language.german') : t('language.english')}
                </button>
              );
            })}
          </div>
        </BentoCard>
      </div>
    );
  };

  const renderAppearanceTab = () => {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <BentoCard
          className="md:col-span-2"
          icon={Icons.sun}
          title={t('userSettings.appearance.themeMode')}
        >
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'light' as ThemeMode, label: t('userSettings.appearance.themeModeLight'), icon: Icons.sun },
              { id: 'dark' as ThemeMode, label: t('userSettings.appearance.themeModeDark'), icon: Icons.moon },
              { id: 'system' as ThemeMode, label: t('userSettings.appearance.themeModeSystem'), icon: Icons.monitor },
            ]).map(({ id, label, icon }) => {
              const isActive = themeMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemeMode(id)}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              );
            })}
          </div>
        </BentoCard>

        <BentoCard
          icon={Icons.brush}
          title={t('userSettings.appearance.colorTheme')}
          description={currentThemeInfo.description}
        >
          <div className="space-y-1.5">
            {AVAILABLE_THEMES.map((theme) => {
              const isActive = themeName === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setColorTheme(theme.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent bg-muted/40 text-foreground hover:bg-muted'
                  }`}
                >
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full border border-border/60"
                    style={{ backgroundColor: theme.previewColor }}
                  />
                  <span className="flex-1 text-left">{theme.name}</span>
                  {isActive ? <span className="text-primary">{Icons.check}</span> : null}
                </button>
              );
            })}
          </div>
        </BentoCard>

        <BentoCard
          title={t('userSettings.appearance.fontFamily')}
          description={t('userSettings.appearance.fontDesc') as string}
        >
          <div className="grid grid-cols-1 gap-1.5">
            {FONT_OPTIONS.map((option) => {
              const isActive = currentFontId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleFontChange(option.id)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent bg-muted/40 text-foreground hover:bg-muted'
                  }`}
                  style={{ fontFamily: option.stack }}
                >
                  <span>{t(option.labelKey)}</span>
                  {isActive ? <span className="text-primary">{Icons.check}</span> : null}
                </button>
              );
            })}
          </div>
        </BentoCard>
      </div>
    );
  };

  const renderDisplayTab = () => {
    const opacityPct = Math.round(unfavoriteOpacity * 100);
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {/* Easyradar */}
        <BentoCard
          icon={Icons.sliders}
          title="Easyradar"
          description={
            user?.forceSimpleMode
              ? (t('userSettings.display.easyradarLocked') as string)
              : (t('userSettings.display.easyradarDesc') as string)
          }
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">
              {simplificationMode ? t('userSettings.display.on') : t('userSettings.display.off')}
              {user?.forceSimpleMode ? (
                <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                  {t('userSettings.display.locked')}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => handleSimplificationModeChange(!simplificationMode)}
              disabled={user?.forceSimpleMode === true}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card ${
                user?.forceSimpleMode
                  ? `cursor-not-allowed opacity-50 ${simplificationMode ? 'bg-primary' : 'bg-border'}`
                  : simplificationMode
                  ? 'bg-primary'
                  : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  simplificationMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </BentoCard>

        {/* New Design (Beta) — wraps Standard mode in the new sidebar shell. */}
        <BentoCard
          icon={Icons.sliders}
          title={t('userSettings.display.newDesignTitle', 'Neues Design (Beta)')}
          description={
            t(
              'userSettings.display.newDesignDesc',
              'Aktiviert das neue Sidebar-Layout. Das klassische Layout bleibt der Standard.',
            ) as string
          }
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">
              {newDesign ? t('userSettings.display.on') : t('userSettings.display.off')}
            </span>
            <button
              type="button"
              onClick={() => handleNewDesignChange(!newDesign)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card ${
                newDesign ? 'bg-primary' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  newDesign ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </BentoCard>

        {/* Decimal Separator */}
        <BentoCard
          title={t('userSettings.display.decimalTitle')}
          description={t('userSettings.display.decimalDesc') as string}
        >
          <div className="grid grid-cols-2 gap-1.5">
            {([false, true] as const).map((useComma) => {
              const isActive = decimalSeparatorMode === useComma;
              return (
                <button
                  key={String(useComma)}
                  type="button"
                  onClick={() => handleDecimalSeparatorChange(useComma)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span className="font-mono">{useComma ? '3,14' : '3.14'}</span>
                  {isActive ? <span className="text-primary">{Icons.check}</span> : null}
                </button>
              );
            })}
          </div>
        </BentoCard>

        {/* Opacity (Deckkraft) */}
        <BentoCard
          title={t('userSettings.display.opacityTitle')}
          description={t('userSettings.display.opacityDesc') as string}
        >
          <div className="flex items-center gap-3">
            {/* Live preview: faded sample card next to a normal one. Numbers
                update in step with the slider so the dealer sees what 30 %
                or 70 % actually looks like before committing. */}
            <div className="flex flex-shrink-0 gap-1">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-[10px] font-semibold text-primary">
                ★
              </span>
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/60 text-[10px] font-semibold text-muted-foreground"
                style={{ opacity: unfavoriteOpacity }}
              >
                ★
              </span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.8"
              step="0.05"
              value={unfavoriteOpacity}
              onChange={(event) => handleOpacityChange(parseFloat(event.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary"
            />
            <span className="w-10 text-right font-mono text-xs text-muted-foreground">
              {opacityPct}%
            </span>
          </div>
        </BentoCard>

        {/* Command Delay (Befehlsverzögerung) */}
        <BentoCard
          title={t('userSettings.display.delayTitle')}
          description={t('userSettings.display.delayDesc') as string}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{t('userSettings.display.delayFast')}</span>
            <input
              type="range"
              min="100"
              max="2000"
              step="100"
              value={commandDelay}
              onChange={(event) => handleCommandDelayChange(parseInt(event.target.value, 10))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary"
            />
            <span className="text-xs text-muted-foreground">{t('userSettings.display.delaySlow')}</span>
            <span className="w-14 text-right font-mono text-xs text-muted-foreground">
              {commandDelay}ms
            </span>
          </div>
        </BentoCard>
      </div>
    );
  };

  const renderDataTab = () => {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {/* Categories — full row */}
        <BentoCard
          className="md:col-span-2"
          icon={Icons.folder}
          title={t('userSettings.data.categoriesTitle')}
          description={t('userSettings.data.categoriesDesc') as string}
        >
          <button
            type="button"
            onClick={onOpenCategories}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {Icons.folder}
            {t('userSettings.management.manageCategories')}
          </button>
        </BentoCard>

        {/* Reset block */}
        <BentoCard
          className="md:col-span-2"
          icon={Icons.reset}
          title={t('userSettings.data.resetTitle')}
          description={t('userSettings.data.resetDesc') as string}
        >
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'colors', fn: resetColors, label: t('userSettings.reset.colors') },
                { key: 'positions', fn: resetPositions, label: t('userSettings.reset.positions') },
                { key: 'favorites', fn: resetFavorites, label: t('userSettings.reset.favorites') },
                { key: 'parameter settings', fn: resetParameterSettings, label: t('userSettings.reset.visibility') },
              ] as const
            ).map(({ key, fn, label }) => {
              const isBusy = isResetting === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleReset(key, fn)}
                  disabled={isResetting !== null}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                  ) : (
                    Icons.reset
                  )}
                  {label}
                </button>
              );
            })}
          </div>
        </BentoCard>

        {/* Backup */}
        <BentoCard
          className="md:col-span-2"
          icon={Icons.database}
          title={t('userSettings.data.backupTitle')}
          description={t('userSettings.data.backupDesc') as string}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleExportSettings}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {Icons.download}
              {t('userSettings.backup.export')}
            </button>
            <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted">
              {Icons.upload}
              {t('userSettings.backup.import')}
              <input type="file" accept=".json" onChange={handleImportSettings} className="hidden" />
            </label>
          </div>
        </BentoCard>
      </div>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────
  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: t('userSettings.tabs.profile'), icon: Icons.user },
    { id: 'appearance', label: t('userSettings.tabs.appearance'), icon: Icons.brush },
    { id: 'display', label: t('userSettings.tabs.display'), icon: Icons.sliders },
    { id: 'data', label: t('userSettings.tabs.data'), icon: Icons.database },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-theme-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-settings-title"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 id="user-settings-title" className="text-base font-semibold text-foreground">
              {t('userSettings.title')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('actions.close') as string}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <nav
          className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-border px-3 pt-2"
          role="tablist"
          aria-label={t('userSettings.title') as string}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tab-panel-${tab.id}`}
                className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={isActive ? 'text-primary' : 'text-muted-foreground'}>{tab.icon}</span>
                {tab.label}
                {isActive ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-t bg-primary" />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Tab content */}
        <div
          className="flex-1 overflow-y-auto bg-muted/20 p-4"
          role="tabpanel"
          id={`tab-panel-${activeTab}`}
        >
          {activeTab === 'profile' && renderProfileTab()}
          {activeTab === 'appearance' && renderAppearanceTab()}
          {activeTab === 'display' && renderDisplayTab()}
          {activeTab === 'data' && renderDataTab()}
        </div>
      </div>
    </div>
  );
};

export default UserSettingsModal;
