import { createServer, type RequestListener } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SrijikaBridgeClient,
  descriptorCandidates,
} from '../../packages/mcp-server/src/bridge-client';
import type { SrijikaBridgeError } from '../../packages/mcp-server/src/bridge-client';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function listen(
  handler: RequestListener,
): Promise<{ endpoint: string; server: ReturnType<typeof createServer> }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  return { endpoint: `http://127.0.0.1:${address.port}`, server };
}

async function descriptor(
  endpoint: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'srijika-bridge-client-'));
  const path = join(directory, 'codex-bridge-v1.json');
  await writeFile(
    path,
    JSON.stringify({
      protocolVersion: '1.0',
      endpoint,
      token: 'a'.repeat(64),
      pid: process.pid,
      instanceId: 'studio-test-instance',
      healthPath: '/v1/health',
      ...overrides,
    }),
  );
  return path;
}

describe('SrijikaBridgeClient', () => {
  it('discovers platform-specific user-private descriptor locations', () => {
    expect(
      descriptorCandidates({
        operatingSystem: 'linux',
        homeDirectory: '/home/srijika',
        environment: {},
      }),
    ).toEqual(['/home/srijika/.local/share/studio.srijika.desktop/codex-bridge-v1.json']);
    expect(
      descriptorCandidates({
        operatingSystem: 'win32',
        homeDirectory: 'C:\\Users\\srijika',
        environment: { LOCALAPPDATA: 'C:\\Users\\srijika\\AppData\\Local' },
      }),
    ).toEqual([
      'C:\\Users\\srijika\\AppData\\Local\\studio.srijika.desktop\\codex-bridge-v1.json',
      '\\\\wsl.localhost\\Ubuntu\\home\\srijika\\.local\\share\\studio.srijika.desktop\\codex-bridge-v1.json',
    ]);
    expect(
      descriptorCandidates({
        operatingSystem: 'win32',
        homeDirectory: 'C:\\Users\\different-name',
        environment: {
          SRIJIKA_STUDIO_WSL_DISTRO: 'Ubuntu-24.04',
          SRIJIKA_STUDIO_WSL_USER: 'srijika',
        },
      }),
    ).toEqual([
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\srijika\\.local\\share\\studio.srijika.desktop\\codex-bridge-v1.json',
    ]);
  });

  it('authenticates a loopback RPC call without putting the token in its JSON body', async () => {
    const observed: { authorization?: string; body?: unknown } = {};
    const { endpoint } = await listen((request, response) => {
      observed.authorization = request.headers.authorization;
      if (request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            protocolVersion: '1.0',
            instanceId: 'studio-test-instance',
            pid: process.pid,
            frontendReady: true,
          }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        observed.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            protocolVersion: '1.0',
            requestId: 'request_server_owned',
            result: { revision: 4 },
          }),
        );
      });
    });
    const client = new SrijikaBridgeClient({ descriptorPath: await descriptor(endpoint) });

    await expect(client.call('srijika.getProjectSummary', { compact: true })).resolves.toEqual({
      revision: 4,
    });
    expect(observed.authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(observed.body).toEqual({
      protocolVersion: '1.0',
      method: 'srijika.getProjectSummary',
      params: { compact: true },
    });
    expect(JSON.stringify(observed.body)).not.toContain('a'.repeat(64));
  });

  it('rejects non-loopback descriptors before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new SrijikaBridgeClient({
      descriptorPath: await descriptor('https://example.com'),
      fetchImpl,
    });

    await expect(client.call('srijika.getCapabilities')).rejects.toMatchObject({
      code: 'unsafe_bridge_endpoint',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a stable retryable error when Studio has no descriptor', async () => {
    const client = new SrijikaBridgeClient({
      descriptorPath: join(tmpdir(), `missing-srijika-${Date.now()}.json`),
    });

    await expect(client.call('srijika.getCapabilities')).rejects.toEqual(
      expect.objectContaining<SrijikaBridgeError>({
        code: 'studio_not_running',
        retryable: true,
      }),
    );
  });

  it('falls through an implicitly discovered stale descriptor to a healthy candidate', async () => {
    let staleHealthChecks = 0;
    let healthyRpcCalls = 0;
    const stale = await listen((_request, response) => {
      staleHealthChecks += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          protocolVersion: '1.0',
          instanceId: 'different-instance',
          pid: process.pid,
          frontendReady: true,
        }),
      );
    });
    const healthy = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.method === 'GET') {
        response.end(
          JSON.stringify({
            ok: true,
            protocolVersion: '1.0',
            instanceId: 'studio-test-instance',
            pid: process.pid,
            frontendReady: true,
          }),
        );
        return;
      }
      healthyRpcCalls += 1;
      response.end(
        JSON.stringify({
          ok: true,
          protocolVersion: '1.0',
          requestId: 'fallback-request',
          result: { selectedPageId: 'page_home' },
        }),
      );
    });
    const stalePath = await descriptor(stale.endpoint);
    const healthyPath = await descriptor(healthy.endpoint);
    const client = new SrijikaBridgeClient({ discoveryPaths: [stalePath, healthyPath] });

    await expect(client.call('srijika.getProjectSummary')).resolves.toEqual({
      selectedPageId: 'page_home',
    });
    expect(staleHealthChecks).toBe(1);
    expect(healthyRpcCalls).toBe(1);
  });

  it('does not bypass a stale explicit descriptor or a malformed implicit descriptor', async () => {
    let healthyRequests = 0;
    const stale = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          protocolVersion: '1.0',
          instanceId: 'old-instance',
          pid: process.pid,
          frontendReady: true,
        }),
      );
    });
    const healthy = await listen((_request, response) => {
      healthyRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
    const stalePath = await descriptor(stale.endpoint);
    const healthyPath = await descriptor(healthy.endpoint);

    await expect(
      new SrijikaBridgeClient({
        descriptorPath: stalePath,
        discoveryPaths: [healthyPath],
      }).call('srijika.getCapabilities'),
    ).rejects.toMatchObject({ code: 'stale_bridge_descriptor' });
    expect(healthyRequests).toBe(0);

    const malformedDirectory = await mkdtemp(join(tmpdir(), 'srijika-malformed-descriptor-'));
    const malformedPath = join(malformedDirectory, 'codex-bridge-v1.json');
    await writeFile(malformedPath, '{invalid json');
    await expect(
      new SrijikaBridgeClient({
        discoveryPaths: [malformedPath, healthyPath],
      }).call('srijika.getCapabilities'),
    ).rejects.toMatchObject({ code: 'invalid_bridge_descriptor' });
    expect(healthyRequests).toBe(0);
  });
});
