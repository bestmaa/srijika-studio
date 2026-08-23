import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import '@srijika/core-components/styles.css';

import {
  applyAppearanceToElement,
  loadAppearancePreferences,
  resolveColorScheme,
} from './lib/appearance';
import './styles/app.css';
import './styles/appearance.css';
import './styles/code-first.css';

const root = document.getElementById('root');
if (!root) throw new Error('Srijika Studio root element was not found');

const initialAppearance = loadAppearancePreferences();
const initialScheme = resolveColorScheme(
  initialAppearance.mode,
  window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true,
);
applyAppearanceToElement(document.documentElement, initialAppearance, initialScheme);

const RouteApp = window.location.pathname.startsWith('/preview')
  ? lazy(async () => {
      const module = await import('./app/PreviewApp');
      return { default: module.PreviewApp };
    })
  : lazy(async () => {
      const module = await import('./app/StudioApp');
      return { default: module.StudioApp };
    });

createRoot(root).render(
  <StrictMode>
    <Suspense
      fallback={
        <main className="app-loading-shell" role="status" aria-live="polite">
          Loading Srijika Studio…
        </main>
      }
    >
      <RouteApp />
    </Suspense>
  </StrictMode>,
);
