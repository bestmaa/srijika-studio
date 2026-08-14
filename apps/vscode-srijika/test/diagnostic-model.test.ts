import { describe, expect, it } from 'vitest';

import type { SrijikaDiagnostic } from '@srijika/tsx-compiler';

import {
  diagnosticToEditorDiagnostic,
  positionAt,
  sourceSpanToRange,
} from '../src/diagnostic-model';

describe('Srijika diagnostic editor conversion', () => {
  it('maps UTF-16 offsets across CRLF lines exactly', () => {
    const source = 'const avatar = "😀";\r\nprops.name';
    const start = source.indexOf('props.name');

    expect(positionAt(source, start)).toEqual({ line: 1, character: 0 });
    expect(positionAt(source, source.indexOf('\r') + 1)).toEqual({
      line: 0,
      character: source.indexOf('\r') + 1,
    });
    expect(
      sourceSpanToRange(source, {
        start,
        end: start + 'props.name'.length,
      }),
    ).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 10 },
    });
  });

  it('preserves diagnostic metadata and converts quick-fix edits', () => {
    const source = [
      'interface ProfileProps {',
      '  image: string;',
      '}',
      'const value = props.name;',
    ].join('\n');
    const usageStart = source.indexOf('props.name');
    const insertionPoint = source.indexOf('\n}');
    const diagnostic: SrijikaDiagnostic = {
      code: 'SRIJIKA1001',
      severity: 'error',
      message: 'Property "name" is not declared in ProfileProps.',
      fileName: 'Profile.ui.tsx',
      span: {
        start: usageStart,
        end: usageStart + 'props.name'.length,
        line: 4,
        column: 15,
      },
      quickFixes: [
        {
          title: 'Add name: string to ProfileProps',
          kind: 'add-missing-prop',
          edits: [
            {
              start: insertionPoint,
              end: insertionPoint,
              newText: '\n  name: string;',
            },
          ],
          data: { propPath: ['name'], suggestedType: 'string' },
        },
      ],
    };

    expect(diagnosticToEditorDiagnostic(source, diagnostic)).toEqual({
      code: 'SRIJIKA1001',
      severity: 'error',
      message: 'Property "name" is not declared in ProfileProps.',
      range: {
        start: { line: 3, character: 14 },
        end: { line: 3, character: 24 },
      },
      quickFixes: [
        {
          title: 'Add name: string to ProfileProps',
          kind: 'add-missing-prop',
          edits: [
            {
              range: {
                start: { line: 1, character: 16 },
                end: { line: 1, character: 16 },
              },
              newText: '\n  name: string;',
            },
          ],
        },
      ],
    });
  });

  it('clamps malformed source spans without producing reversed ranges', () => {
    expect(sourceSpanToRange('abc', { start: 50, end: -10 })).toEqual({
      start: { line: 0, character: 3 },
      end: { line: 0, character: 3 },
    });
  });
});
