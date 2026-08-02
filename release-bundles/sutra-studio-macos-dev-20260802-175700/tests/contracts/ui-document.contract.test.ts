import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertUiDocument,
  createBlankDocument,
  validateSutraProject,
  validateUiDocument,
  type EventSignature,
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

  it('accepts custom connector references as inert value expressions', () => {
    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected element root');
    document.symbols['connector_input'] = {
      id: 'connector_input',
      name: 'connectorInput',
      displayName: 'Connector input',
      provider: 'state',
      valueType: 'string',
      required: true,
    };
    root.visible = {
      kind: 'customCodeReference',
      moduleId: 'visibility_connector',
      exportName: 'isVisible',
      args: [{ kind: 'reference', symbolId: 'connector_input', path: [] }],
    };

    expect(validateUiDocument(document)).toMatchObject({ valid: true, errors: [] });
  });

  it('rejects the removed registered-call expression shape', () => {
    const document = createBlankDocument();
    const legacyDocument = structuredClone(document) as unknown as {
      nodes: Record<string, { visible: unknown }>;
    };
    legacyDocument.nodes[document.rootNodeId]!.visible = {
      kind: 'registeredCall',
      functionId: 'legacy_function',
      args: [],
    };

    const result = validateUiDocument(legacyDocument);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts recursive value shapes without changing the format version', () => {
    const document = createBlankDocument();
    const valueShape = {
      kind: 'array',
      item: {
        kind: 'object',
        additionalProperties: false,
        fields: {
          id: { required: true, shape: { kind: 'string' } },
          profile: {
            required: true,
            shape: {
              kind: 'object',
              additionalProperties: false,
              fields: {
                title: { required: true, shape: { kind: 'string' } },
              },
            },
          },
        },
      },
    } as const;
    document.publicProps['items'] = {
      symbolId: 'prop_items',
      name: 'items',
      displayName: 'Items',
      valueType: 'array',
      valueShape,
      required: true,
    };
    document.symbols['prop_items'] = {
      id: 'prop_items',
      name: 'items',
      displayName: 'Items',
      provider: 'prop',
      valueType: 'array',
      valueShape,
      required: true,
    };

    const result = validateUiDocument(JSON.parse(JSON.stringify(document)));

    expect(document.formatVersion).toBe(1);
    expect(result).toMatchObject({ valid: true, errors: [] });
  });

  it('accepts optional event signatures while preserving legacy format-1 events', () => {
    const legacyDocument = createBlankDocument();
    legacyDocument.publicProps['onChange'] = {
      symbolId: 'event_change',
      name: 'onChange',
      displayName: 'On change',
      valueType: 'event',
      required: false,
    };
    legacyDocument.symbols['event_change'] = {
      id: 'event_change',
      name: 'onChange',
      displayName: 'On change',
      provider: 'event',
      valueType: 'event',
      required: false,
    };

    expect(validateUiDocument(legacyDocument)).toMatchObject({ valid: true, errors: [] });

    const emptySignatureDocument = structuredClone(legacyDocument);
    emptySignatureDocument.publicProps['onChange']!.eventSignature = { payload: null };
    emptySignatureDocument.symbols['event_change']!.eventSignature = { payload: null };
    expect(validateUiDocument(emptySignatureDocument)).toMatchObject({ valid: true, errors: [] });

    const signature: EventSignature = {
      payload: {
        name: 'value',
        shape: {
          kind: 'object',
          additionalProperties: false,
          fields: {
            text: { required: true, shape: { kind: 'string' } },
          },
        },
      },
    };
    const signedDocument = structuredClone(emptySignatureDocument);
    signedDocument.publicProps['onChange']!.eventSignature = structuredClone(signature);
    signedDocument.symbols['event_change']!.eventSignature = structuredClone(signature);

    expect(signedDocument.formatVersion).toBe(1);
    expect(validateUiDocument(signedDocument)).toMatchObject({ valid: true, errors: [] });

    const malformed = structuredClone(signedDocument) as unknown as {
      publicProps: Record<string, { eventSignature: { unexpected: boolean } }>;
    };
    malformed.publicProps['onChange']!.eventSignature.unexpected = true;
    expect(validateUiDocument(malformed).valid).toBe(false);
  });

  it('rejects malformed recursive value shapes', () => {
    const document = createBlankDocument();
    document.publicProps['items'] = {
      symbolId: 'prop_items',
      name: 'items',
      displayName: 'Items',
      valueType: 'array',
      required: true,
      valueShape: { kind: 'array', item: { kind: 'string' } },
    };
    const malformed = structuredClone(document) as unknown as {
      publicProps: Record<string, { valueShape: Record<string, unknown> }>;
    };
    malformed.publicProps['items']!.valueShape['unexpected'] = true;

    expect(validateUiDocument(malformed).valid).toBe(false);
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
