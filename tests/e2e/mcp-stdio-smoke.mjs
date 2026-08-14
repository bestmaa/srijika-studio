import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const bundle = join(workspace, 'plugins/srijika-studio/mcp-server/srijika-mcp.mjs');
const useWindowsLauncher = process.argv.includes('--windows');
const temporary = await mkdtemp(join(tmpdir(), 'srijika-mcp-stdio-'));
const descriptorPath = join(temporary, 'codex-bridge-v1.json');
const token = 'b'.repeat(64);
const instanceId = 'stdio-smoke-instance';
const observed = [];

const bridge = createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${token}`);
  response.setHeader('content-type', 'application/json');
  if (request.method === 'GET' && request.url === '/v1/health') {
    response.end(
      JSON.stringify({
        ok: true,
        protocolVersion: '1.0',
        instanceId,
        pid: process.pid,
        frontendReady: true,
      }),
    );
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/rpc') {
    response.writeHead(404);
    response.end('{}');
    return;
  }
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    observed.push(body);
    response.end(
      JSON.stringify({
        ok: true,
        protocolVersion: '1.0',
        requestId: 'mock-request-1',
        result: {
          protocolVersion: '1.0',
          toolVersion: '0.1.0',
          frontendReady: true,
        },
      }),
    );
  });
});

await new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve));
const address = bridge.address();
if (!address || typeof address === 'string') throw new Error('Bridge did not bind TCP');
await mkdir(dirname(descriptorPath), { recursive: true });
await writeFile(
  descriptorPath,
  JSON.stringify({
    schemaVersion: 1,
    protocolVersion: '1.0',
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    instanceId,
    pid: process.pid,
    appName: 'Srijika Studio smoke',
    appVersion: '0.1.0',
    startedAtUnixMs: Date.now(),
    healthPath: '/v1/health',
  }),
);

const windowsPath = (path) => execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim();
const windowsLauncherSource =
  process.env['SRIJIKA_STUDIO_MCP_WINDOWS_LAUNCHER'] ??
  join(workspace, 'plugins/srijika-studio/scripts/run-mcp.cmd');
const windowsLauncher = useWindowsLauncher
  ? windowsLauncherSource.startsWith('/')
    ? windowsPath(windowsLauncherSource)
    : windowsLauncherSource
  : '';
const transport = new StdioClientTransport({
  command: useWindowsLauncher ? 'cmd.exe' : process.execPath,
  args: useWindowsLauncher ? ['/d', '/s', '/c', windowsLauncher] : [bundle],
  cwd: useWindowsLauncher ? '/mnt/c/Users/beste' : workspace,
  env: {
    ...process.env,
    ...(useWindowsLauncher
      ? {
          WSLENV: [process.env.WSLENV, 'SRIJIKA_STUDIO_BRIDGE_DESCRIPTOR']
            .filter(Boolean)
            .join(':'),
        }
      : {}),
    SRIJIKA_STUDIO_BRIDGE_DESCRIPTOR: useWindowsLauncher
      ? windowsPath(descriptorPath)
      : descriptorPath,
  },
  stderr: 'pipe',
});
let transportStderr = '';
transport.stderr?.on('data', (chunk) => {
  transportStderr += chunk.toString('utf8');
});
const client = new Client({ name: 'srijika-stdio-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 21);
  assert(tools.tools.some(({ name }) => name === 'srijika_get_code_project'));
  assert(tools.tools.some(({ name }) => name === 'srijika_apply_code_structure'));
  assert(tools.tools.some(({ name }) => name === 'srijika_apply_operations'));
  assert(tools.tools.some(({ name }) => name === 'srijika_analyze_repetitions'));
  assert(tools.tools.some(({ name }) => name === 'srijika_get_generated_code'));
  assert(tools.tools.some(({ name }) => name === 'srijika_get_layout_snapshot'));
  assert(tools.tools.some(({ name }) => name === 'srijika_capture_preview'));
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 5);
  assert(resources.resources.some(({ uri }) => uri === 'srijika://docs/code-first-architecture'));

  const result = await client.callTool({ name: 'srijika_get_capabilities', arguments: {} });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.deepEqual(result.structuredContent, {
    ok: true,
    result: { protocolVersion: '1.0', toolVersion: '0.1.0', frontendReady: true },
  });
  assert.deepEqual(observed, [
    { protocolVersion: '1.0', method: 'srijika.getCapabilities', params: {} },
  ]);
  process.stdout.write(
    `Srijika MCP ${useWindowsLauncher ? 'Windows launcher' : 'stdio bundle'} smoke passed\n`,
  );
} catch (error) {
  if (transportStderr) {
    process.stderr.write(`Srijika MCP transport stderr:\n${transportStderr}\n`);
  }
  throw error;
} finally {
  await client.close().catch(() => undefined);
  await new Promise((resolve, reject) =>
    bridge.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(temporary, { recursive: true, force: true });
}
