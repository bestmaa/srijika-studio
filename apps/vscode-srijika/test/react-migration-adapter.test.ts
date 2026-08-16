import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildReactMigrationArguments,
  runReactMigration,
  validateReactMigrationRequest,
} from '../src/react-migration-adapter';

const source = resolve('/workspace/legacy-react');
const target = resolve('/workspace/new-srijika');

describe('React migration engine adapter', () => {
  it('builds the canonical start, status, and verify arguments exactly', () => {
    expect(buildReactMigrationArguments({ operation: 'start', source, target })).toEqual([
      'migrate',
      'react',
      '--source',
      source,
      '--target',
      target,
      '--json',
    ]);
    expect(buildReactMigrationArguments({ operation: 'status', target })).toEqual([
      'migrate',
      'status',
      '--target',
      target,
      '--json',
    ]);
    expect(buildReactMigrationArguments({ operation: 'verify', target })).toEqual([
      'migrate',
      'verify',
      '--target',
      target,
      '--json',
    ]);
  });

  it('rejects equal or nested source/target folders before starting the engine', () => {
    expect(() =>
      validateReactMigrationRequest({
        operation: 'start',
        source,
        target: resolve(source, 'converted'),
      }),
    ).toThrow(/separate, non-overlapping (?:folders|directories)/u);
    expect(() =>
      validateReactMigrationRequest({ operation: 'start', source, target: source }),
    ).toThrow(/source is never modified/u);
  });

  it('cancels before the canonical engine touches either project', async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(
      runReactMigration({ operation: 'status', target }, { signal: cancellation.signal }),
    ).rejects.toThrow(/cancelled/u);
  });
});
