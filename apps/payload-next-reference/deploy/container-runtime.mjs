import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv[2] ?? 'serve';
const runtimeRoot = process.cwd();
const uploadsDirectory = process.env.PAYLOAD_UPLOADS_DIR ?? path.join(runtimeRoot, 'media');
const unsafeSecret = /replace|change-before|example|placeholder/iu;

async function secretFromFile(variableName) {
  const fileName = process.env[`${variableName}_FILE`];
  if (!fileName || !path.isAbsolute(fileName)) {
    throw new Error(`${variableName}_FILE must name an absolute mounted secret file.`);
  }
  const metadata = await stat(fileName);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 16_384) {
    throw new Error(`${variableName}_FILE must be a non-empty bounded regular file.`);
  }
  const value = (await readFile(fileName, 'utf8')).trim();
  if (value.length < 32 || unsafeSecret.test(value)) {
    throw new Error(`${variableName} must contain at least 32 non-placeholder characters.`);
  }
  return value;
}

function requiredName(variableName, fallback) {
  const value = process.env[variableName] ?? fallback;
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u.test(value)) {
    throw new Error(`${variableName} must be a portable database identifier.`);
  }
  return value;
}

async function configureProductionEnvironment() {
  if (process.env.PAYLOAD_REFERENCE_MODE === 'mock') {
    throw new Error('PAYLOAD_REFERENCE_MODE=mock is forbidden in the production container.');
  }
  const databasePassword = await secretFromFile('DATABASE_PASSWORD');
  const payloadSecret = await secretFromFile('PAYLOAD_SECRET');
  const host = process.env.DATABASE_HOST ?? 'postgres';
  const port = Number(process.env.DATABASE_PORT ?? '5432');
  if (
    !/^[A-Za-z0-9.-]{1,253}$/u.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error('DATABASE_HOST and DATABASE_PORT must identify a bounded database endpoint.');
  }
  const databaseUrl = new URL('postgresql://localhost');
  databaseUrl.hostname = host;
  databaseUrl.port = String(port);
  databaseUrl.username = requiredName('DATABASE_USER', 'payload');
  databaseUrl.password = databasePassword;
  databaseUrl.pathname = `/${requiredName('DATABASE_NAME', 'payload')}`;
  if (!path.isAbsolute(uploadsDirectory)) {
    throw new Error('PAYLOAD_UPLOADS_DIR must be absolute.');
  }
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = databaseUrl.href;
  process.env.PAYLOAD_SECRET = payloadSecret;
  process.env.PAYLOAD_UPLOADS_DIR = uploadsDirectory;
}

async function runChild(modulePath, argumentsToChild, { inspectOutput = false } = {}) {
  await access(modulePath, constants.R_OK);
  const child = spawn(process.execPath, [modulePath, ...argumentsToChild], {
    env: process.env,
    stdio: inspectOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  let inspectedOutput = '';
  if (inspectOutput) {
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on('data', (chunk) => {
        destination.write(chunk);
        if (inspectedOutput.length < 1_048_576) inspectedOutput += chunk.toString();
      });
    }
  }
  let forcedStop;
  const forward = (signal) => {
    if (child.exitCode !== null) return;
    child.kill(signal);
    forcedStop ??= setTimeout(() => child.kill('SIGKILL'), 25_000);
    forcedStop.unref();
  };
  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (forcedStop) clearTimeout(forcedStop);
  if (result.code !== 0 || result.signal) {
    throw new Error(
      `Child process failed${result.signal ? ` with ${result.signal}` : ` with exit ${result.code}`}.`,
    );
  }
  return inspectedOutput;
}

async function healthcheck() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? '3000'}/api/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Health endpoint returned ${response.status}.`);
  } finally {
    clearTimeout(timeout);
  }
}

function storageToken() {
  const token = process.argv[3] ?? '';
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(token)) throw new Error('Storage token is invalid.');
  return token;
}

async function writeStorageProbe() {
  const token = storageToken();
  await mkdir(uploadsDirectory, { recursive: true });
  const target = path.join(uploadsDirectory, '.compose-storage-probe');
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

async function readStorageProbe() {
  const token = storageToken();
  const value = (
    await readFile(path.join(uploadsDirectory, '.compose-storage-probe'), 'utf8')
  ).trim();
  if (value !== token) throw new Error('Persistent media storage did not retain the probe value.');
}

try {
  if (mode === 'healthcheck') {
    await healthcheck();
  } else if (mode === 'storage-write') {
    await writeStorageProbe();
  } else if (mode === 'storage-read') {
    await readStorageProbe();
  } else if (mode === 'inventory') {
    for (const forbidden of ['apps/studio', 'packages/mcp-server', 'packages/cli', 'src-tauri']) {
      try {
        await access(path.join(runtimeRoot, forbidden));
        throw new Error(`Production image contains forbidden tooling path: ${forbidden}`);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  } else if (mode === 'migrate') {
    await configureProductionEnvironment();
    const output = await runChild(
      path.join(runtimeRoot, 'node_modules/payload/bin.js'),
      ['migrate'],
      {
        inspectOutput: true,
      },
    );
    if (output.includes('Error running migration')) {
      throw new Error('Payload reported a migration failure without a failing process exit code.');
    }
  } else if (mode === 'serve') {
    await configureProductionEnvironment();
    await runChild(path.join(runtimeRoot, 'node_modules/next/dist/bin/next'), [
      'start',
      '--hostname',
      process.env.HOSTNAME ?? '0.0.0.0',
      '--port',
      process.env.PORT ?? '3000',
    ]);
  } else {
    throw new Error(`Unknown production container mode: ${mode}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
