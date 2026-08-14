import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('extension documentation encoding', () => {
  it('keeps the packaged README ASCII-safe for every VS Code host', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    expect([...readme].every((character) => (character.codePointAt(0) ?? 0) <= 0x7f)).toBe(true);
  });
});
