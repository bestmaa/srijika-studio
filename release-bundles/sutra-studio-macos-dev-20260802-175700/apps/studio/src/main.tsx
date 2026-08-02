import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@sutra/core-components/styles.css';

import { PreviewApp } from './app/PreviewApp';
import { AppearanceProvider } from './app/AppearanceProvider';
import { StudioApp } from './app/StudioApp';
import {
  applyAppearanceToElement,
  loadAppearancePreferences,
  resolveColorScheme,
} from './lib/appearance';
import './styles/app.css';
import './styles/appearance.css';

const root = document.getElementById('root');
if (!root) throw new Error('Sutra Studio root element was not found');

const initialAppearance = loadAppearancePreferences();
const initialScheme = resolveColorScheme(
  initialAppearance.mode,
  window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true,
);
applyAppearanceToElement(document.documentElement, initialAppearance, initialScheme);

createRoot(root).render(
  <StrictMode>
    {window.location.pathname.startsWith('/preview') ? (
      <AppearanceProvider>
        <PreviewApp />
      </AppearanceProvider>
    ) : (
      <StudioApp />
    )}
  </StrictMode>,
);
