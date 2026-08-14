import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('editor and preview runtime style parity', () => {
  const canvasCss = source('apps/studio/src/styles/canvas.css');
  const coreComponentsCss = source('packages/core-components/src/styles.css');
  const designFrame = source('apps/studio/src/components/DesignFrame.tsx');

  it('loads the shared component stylesheet into the isolated editor iframe', () => {
    expect(designFrame).toContain(
      "import coreComponentsCss from '@srijika/core-components/styles.css?inline';",
    );
    expect(designFrame).toContain('<style>${coreComponentsCss}\\n${canvasCss}</style>');
  });

  it('keeps Button and Input runtime defaults in the shared stylesheet only', () => {
    expect(coreComponentsCss).toMatch(/^\.srijika-button\s*{/m);
    expect(coreComponentsCss).toMatch(/^\.srijika-field\s*>\s*input\s*{/m);

    expect(canvasCss).not.toMatch(/^\.srijika-button(?:--[^\s{]+)?\s*{/m);
    expect(canvasCss).not.toMatch(/^\.srijika-field\s*>\s*(?:span|input)\s*{/m);
  });
});
