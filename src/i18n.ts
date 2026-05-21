import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import deCommon from './locales/de/common.json';

const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';

const supportedLngs = ['en', 'de'] as const;
type SupportedLng = typeof supportedLngs[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon },
      de: { common: deCommon },
    },
    fallbackLng: 'en',
    supportedLngs: Array.from(supportedLngs),
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    debug: isDev,
    saveMissing: isDev,
    detection: {
      order: ['localStorage', 'navigator', 'querystring', 'cookie'],
      caches: ['localStorage'],
      lookupQuerystring: 'lng',
      lookupCookie: 'i18next',
      lookupLocalStorage: 'i18nextLng',
    },
  });

// Dev: log missing keys
if (isDev) {
  i18n.on('missingKey', (lngs, ns, key) => {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] Missing key: ${ns}:${key} (lngs: ${lngs})`);
  });
}

// Enforce supported languages and fallback when needed
const resolved = i18n.resolvedLanguage as string | undefined;
if (!resolved || !supportedLngs.includes(resolved as SupportedLng)) {
  i18n.changeLanguage('en').catch(() => {});
}

export default i18n;


