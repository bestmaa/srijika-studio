import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { payloadRuntimeEnvironment } from '../src/server/environment';

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PAYLOAD_REFERENCE_MODE: 'live',
  DATABASE_URL: 'postgresql://payload:private@postgres:5432/payload',
  PAYLOAD_SECRET: '5c1d369dcd8e47f6a79a7b31e47cae89',
  PAYLOAD_UPLOADS_DIR: path.resolve('/opt/runtime/media'),
};

describe('Payload production environment', () => {
  it('requires production database and signing secrets', () => {
    expect(() => payloadRuntimeEnvironment({ NODE_ENV: 'production' })).toThrow(
      'Production requires DATABASE_URL and PAYLOAD_SECRET',
    );
  });

  it.each(['short', 'replace-with-a-real-production-secret-value'])(
    'rejects an unsafe production signing secret: %s',
    (payloadSecret) => {
      expect(() =>
        payloadRuntimeEnvironment({ ...productionEnvironment, PAYLOAD_SECRET: payloadSecret }),
      ).toThrow('at least 32 non-placeholder characters');
    },
  );

  it('rejects malformed database and upload locations', () => {
    expect(() =>
      payloadRuntimeEnvironment({ ...productionEnvironment, DATABASE_URL: 'sqlite:///payload.db' }),
    ).toThrow('PostgreSQL');
    expect(() =>
      payloadRuntimeEnvironment({ ...productionEnvironment, PAYLOAD_UPLOADS_DIR: './media' }),
    ).toThrow('must be an absolute path');
  });

  it('accepts explicit production values without changing them', () => {
    expect(payloadRuntimeEnvironment(productionEnvironment)).toEqual({
      databaseUrl: productionEnvironment['DATABASE_URL'],
      payloadSecret: productionEnvironment['PAYLOAD_SECRET'],
      uploadsDirectory: productionEnvironment['PAYLOAD_UPLOADS_DIR'],
    });
  });

  it('keeps mock evidence independent from production credentials', () => {
    const runtime = payloadRuntimeEnvironment({
      NODE_ENV: 'production',
      PAYLOAD_REFERENCE_MODE: 'mock',
    });
    expect(runtime.databaseUrl).toMatch(/^postgresql:/u);
    expect(typeof runtime.payloadSecret).toBe('string');
  });
});
