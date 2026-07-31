import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@sutra/core-components/styles.css';

import { PreviewApp } from './app/PreviewApp';
import { StudioApp } from './app/StudioApp';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Sutra Studio root element was not found');

createRoot(root).render(
  <StrictMode>
    {window.location.pathname.startsWith('/preview') ? <PreviewApp /> : <StudioApp />}
  </StrictMode>,
);
