import { useEffect } from 'react';

import { CodeFirstStudio } from '../components/code-first/CodeFirstStudio';
import { subscribeCodexBridgeStatus } from '../lib/codex-bridge';
import { AppearanceProvider } from './AppearanceProvider';

export function StudioApp() {
  useEffect(() => subscribeCodexBridgeStatus(() => undefined), []);

  return (
    <AppearanceProvider>
      <CodeFirstStudio />
    </AppearanceProvider>
  );
}
