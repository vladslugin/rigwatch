import React from 'react';
import './i18n';
import ReactDOM from 'react-dom/client';
import App from './App';
import DocsFullPage from './components/DocsFullPage';
import './index.css';
import './utils/registerDumpWas';

console.log('HASENRADAR - Modern React Version starting...');

/**
 * Tiny route gate that decides whether to mount the full app (with auth,
 * Firebase, providers, etc.) or just the standalone documentation page.
 *
 * The docs page is intentionally Firebase-free and auth-free — it's pure
 * markdown content that anyone should be able to print or save as PDF,
 * even before logging in.
 */
const Root: React.FC = () => {
  const isDocsRoute =
    typeof window !== 'undefined' && window.location.pathname === '/docs';
  if (isDocsRoute) return <DocsFullPage />;
  return <App />;
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

console.log('React app rendered successfully');
