import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertUiDocument,
  createBlankDocument,
  validateSutraProject,
  validateUiDocument,
} from '@sutra/contracts';

const identifierArbitrary = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'), {
    minLength: 0,
    maxLength: 31,
  })
  .map((tail) => `P${tail.join('')}`);

describe('UI document schema contract', () => {
  it('accepts documents created by the public blank-document factory', () => {
    const document = createBlankDocument();

    const result = validateUiDocument(document);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.value).toBe(document);
  });

  it('round-trips canonical documents through JSON without semantic loss', () => {
    fc.assert(
      fc.property(identifierArbitrary, identifierArbitrary, (id, name) => {
        const document = createBlankDocument(id, name);
        const reloaded: unknown = JSON.parse(JSON.stringify(document));
        const result = validateUiDocument(reloaded);

        expect(result.valid).toBe(true);
        expect(result.value).toEqual(document);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects unknown fields and unsupported format versions', () => {
    const document = createBlankDocument();

    expect(
      validateUiDocument({ ...document, unexpected: true }).errors.some(
        (error) => error.keyword === 'additionalProperties',
      ),
    ).toBe(true);
    expect(validateUiDocument({ ...document, formatVersion: 999 }).valid).toBe(false);
  });

  it('provides a useful assertion error for malformed documents', () => {
    const malformed = { formatVersion: 1, id: 'page' };

    expect(() => assertUiDocument(malformed)).toThrow(/Invalid Sutra UI document:/);
  });
});

describe('project schema contract', () => {
  it('validates a pinned, reproducible frontend toolchain', () => {
    const project = {
      formatVersion: 1,
      id: 'sutra_project',
      name: 'Sutra Project',
      entryPageId: 'page_home',
      pages: ['page_home'],
      components: [],
      toolchain: {
        node: '22.22.1',
        packageManager: 'pnpm',
        packageManagerVersion: '11.18.0',
        vite: '8.2.0',
      },
    };

    expect(validateSutraProject(project)).toMatchObject({ valid: true, errors: [] });
    expect(
      validateSutraProject({
        ...project,
        toolchain: { ...project.toolchain, packageManager: 'npm' },
      }).valid,
    ).toBe(false);
  });
});
