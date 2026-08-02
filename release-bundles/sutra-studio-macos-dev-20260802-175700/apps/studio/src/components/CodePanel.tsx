import { CheckCircle2, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { generateTsx } from '@sutra/react-codegen';

import { useStudioStore } from '../store/studio-store';

export function CodePanel({ mode }: { mode: 'json' | 'tsx' }) {
  const document = useStudioStore((state) => state.document);
  const [copied, setCopied] = useState(false);
  const content = useMemo(
    () => (mode === 'json' ? JSON.stringify(document, null, 2) : generateTsx(document)),
    [document, mode],
  );

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="code-panel">
      <header>
        <div>
          <span className="eyebrow">LIVE OUTPUT</span>
          <h2>{mode === 'json' ? 'Canonical UI document' : 'Generated TypeScript / TSX'}</h2>
        </div>
        <div className="code-status">
          <span>
            <CheckCircle2 size={14} /> Strict & deterministic
          </span>
          <button className="secondary-button" type="button" onClick={() => void copy()}>
            <Copy size={14} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>
      <pre>
        <code>{content}</code>
      </pre>
    </section>
  );
}
