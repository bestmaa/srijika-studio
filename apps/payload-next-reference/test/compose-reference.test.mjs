import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const composeFile = path.join(appRoot, 'compose.yaml');

function run(argumentsToDocker, environment, options = {}) {
  return execFileSync('docker', argumentsToDocker, {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout ?? 15 * 60 * 1000,
  });
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'srijika-payload-compose-'));
const postgresPasswordFile = path.join(temporaryDirectory, 'postgres-password.txt');
const payloadSecretFile = path.join(temporaryDirectory, 'payload-secret.txt');
await writeFile(postgresPasswordFile, '0f36e8a6f24648f2bb9caed7b7a818b7\n', { mode: 0o600 });
await writeFile(payloadSecretFile, 'f6b1ac030ff447719be8b70ce9f6d81a\n', { mode: 0o600 });

const environment = {
  POSTGRES_PASSWORD_FILE: postgresPasswordFile,
  PAYLOAD_SECRET_FILE: payloadSecretFile,
};

try {
  const rendered = JSON.parse(
    run(['compose', '-f', composeFile, 'config', '--format', 'json'], environment, {
      capture: true,
    }),
  );
  const { postgres, migrate, web } = rendered.services;
  assert.match(postgres.image, /^postgres:17\.6-bookworm@sha256:[a-f0-9]{64}$/u);
  assert(postgres.healthcheck?.test, 'PostgreSQL must expose a readiness healthcheck.');
  assert(postgres.volumes.some((volume) => volume.target === '/var/lib/postgresql/data'));
  assert.equal(migrate.depends_on.postgres.condition, 'service_healthy');
  assert.equal(web.depends_on.migrate.condition, 'service_completed_successfully');
  assert.equal(web.depends_on.postgres.condition, 'service_healthy');
  assert.equal(web.read_only, true);
  assert(web.healthcheck?.test, 'The web service must expose a database-backed healthcheck.');
  assert(web.volumes.some((volume) => volume.target === '/opt/runtime/media'));
  assert.deepEqual(
    Object.keys(web.environment)
      .filter((name) => /PASSWORD|SECRET/u.test(name))
      .sort(),
    ['DATABASE_PASSWORD_FILE', 'PAYLOAD_SECRET_FILE'],
  );

  const dockerfile = await readFile(path.join(appRoot, 'deploy/Dockerfile'), 'utf8');
  assert.match(dockerfile, /node:22\.13\.0-bookworm-slim@sha256:[a-f0-9]{64}/u);
  assert.match(dockerfile, /--frozen-lockfile/u);
  assert.match(dockerfile, /typecheck[\s\S]+test[\s\S]+build/u);
  assert.match(dockerfile, /USER root/u);
  assert.doesNotMatch(dockerfile, /apps\/studio|packages\/mcp-server|packages\/cli|src-tauri/u);
  const baselineMigration = await readFile(
    path.join(appRoot, 'src/migrations/20260829_201814.ts'),
    'utf8',
  );
  assert.match(baselineMigration, /CREATE TABLE "posts"/u);
  assert.match(baselineMigration, /CREATE UNIQUE INDEX "posts_slug_idx"/u);
  assert(
    baselineMigration.indexOf('CREATE TABLE "posts"') <
      baselineMigration.indexOf('CREATE UNIQUE INDEX "posts_slug_idx"'),
    'The baseline must create the posts table before its slug index.',
  );
  const runtime = await readFile(path.join(appRoot, 'deploy/container-runtime.mjs'), 'utf8');
  assert.match(runtime, /Error running migration/u);
  assert.match(runtime, /process\.setuid\('node'\)/u);

  if (process.env.SRIJIKA_RUN_COMPOSE_SMOKE === '1') {
    const port = await availablePort();
    const projectName = `srijika-payload-${process.pid}-${Date.now()}`.toLowerCase();
    const smokeEnvironment = {
      ...environment,
      PAYLOAD_IMAGE: `${projectName}:local`,
      PAYLOAD_WEB_PORT: String(port),
    };
    const composeArguments = ['compose', '--project-name', projectName, '-f', composeFile];
    try {
      run([...composeArguments, 'up', '--build', '--detach', '--wait', 'web'], smokeEnvironment);
      const migration = JSON.parse(
        run([...composeArguments, 'ps', '--all', '--format', 'json', 'migrate'], smokeEnvironment, {
          capture: true,
        }),
      );
      assert.equal(migration.ExitCode, 0, 'The migration service must finish successfully.');
      run(
        [
          ...composeArguments,
          'exec',
          '-T',
          'web',
          'node',
          'deploy/container-runtime.mjs',
          'inventory',
        ],
        smokeEnvironment,
      );
      const identity = run(
        [
          ...composeArguments,
          'exec',
          '-T',
          'web',
          'node',
          'deploy/container-runtime.mjs',
          'identity',
        ],
        smokeEnvironment,
        { capture: true },
      ).trim();
      assert.equal(identity, '1000:1000', 'Runtime commands must relinquish root privileges.');
      const token = `persist-${Date.now()}`;
      run(
        [
          ...composeArguments,
          'exec',
          '-T',
          'web',
          'node',
          'deploy/container-runtime.mjs',
          'storage-write',
          token,
        ],
        smokeEnvironment,
      );
      run(
        [...composeArguments, 'up', '--detach', '--wait', '--force-recreate', 'web'],
        smokeEnvironment,
      );
      run(
        [
          ...composeArguments,
          'exec',
          '-T',
          'web',
          'node',
          'deploy/container-runtime.mjs',
          'storage-read',
          token,
        ],
        smokeEnvironment,
      );
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ready' });
    } finally {
      try {
        run([...composeArguments, 'ps', '--all'], smokeEnvironment);
        run([...composeArguments, 'logs', '--no-color', 'migrate', 'web'], smokeEnvironment);
      } catch {
        // Preserve the original smoke-test failure; diagnostics are best effort.
      }
      run(
        [...composeArguments, 'down', '--volumes', '--remove-orphans', '--rmi', 'local'],
        smokeEnvironment,
        {
          timeout: 5 * 60 * 1000,
        },
      );
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('Payload Compose reference contracts passed.');
