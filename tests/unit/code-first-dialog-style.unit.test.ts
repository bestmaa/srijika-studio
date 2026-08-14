import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const codeFirstCss = readFileSync(
  new URL('../../apps/studio/src/styles/code-first.css', import.meta.url),
  'utf8',
);

describe('code-first creation dialog layout', () => {
  it('keeps the action footer reachable when optional structure fields make the form tall', () => {
    expect(codeFirstCss).toMatch(
      /\.code-first-create-dialog form > footer\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s,
    );
  });
});
