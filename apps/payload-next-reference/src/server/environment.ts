import path from 'node:path';

const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/srijika_payload';
const LOCAL_PAYLOAD_SECRET = 'local-reference-secret-change-before-deploy';
const PLACEHOLDER_SECRET = /replace|change-before|example|placeholder/iu;

export interface PayloadRuntimeEnvironment {
  databaseUrl: string;
  payloadSecret: string;
  uploadsDirectory: string;
}

function validatedDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.', { cause: error });
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.pathname.slice(1)
  ) {
    throw new Error('DATABASE_URL must include a PostgreSQL host, user, and database name.');
  }
  return value;
}

export function payloadRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): PayloadRuntimeEnvironment {
  const evidenceMode = environment['PAYLOAD_REFERENCE_MODE'] === 'mock';
  const production = environment['NODE_ENV'] === 'production' && !evidenceMode;
  const databaseUrl = environment['DATABASE_URL'] ?? LOCAL_DATABASE_URL;
  const payloadSecret = environment['PAYLOAD_SECRET'] ?? LOCAL_PAYLOAD_SECRET;
  const uploadsDirectory =
    environment['PAYLOAD_UPLOADS_DIR'] ?? path.resolve(process.cwd(), 'media');

  validatedDatabaseUrl(databaseUrl);
  if (production && (!environment['DATABASE_URL'] || !environment['PAYLOAD_SECRET'])) {
    throw new Error('Production requires DATABASE_URL and PAYLOAD_SECRET from runtime secrets.');
  }
  if (production && (payloadSecret.length < 32 || PLACEHOLDER_SECRET.test(payloadSecret))) {
    throw new Error('Production PAYLOAD_SECRET must be at least 32 non-placeholder characters.');
  }
  if (!path.isAbsolute(uploadsDirectory)) {
    throw new Error('PAYLOAD_UPLOADS_DIR must be an absolute path.');
  }
  return { databaseUrl, payloadSecret, uploadsDirectory };
}
