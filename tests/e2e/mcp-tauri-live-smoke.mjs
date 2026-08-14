import assert from 'node:assert/strict';
import { access, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const driverUrl = process.env.SRIJIKA_TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444';
const application =
  process.env.SRIJIKA_TAURI_APPLICATION ?? resolve(repositoryRoot, 'target/release/srijika-studio');
const bundle = resolve(repositoryRoot, 'plugins/srijika-studio/mcp-server/srijika-mcp.mjs');
const descriptorPath =
  process.env.SRIJIKA_STUDIO_BRIDGE_DESCRIPTOR ??
  join(homedir(), '.local/share/studio.srijika.desktop/codex-bridge-v1.json');
const keepApplicationOpen = process.env.SRIJIKA_KEEP_OPEN === '1';
const screenshotPath =
  process.env.SRIJIKA_MCP_TAURI_SCREENSHOT ??
  resolve(repositoryRoot, 'test-results/mcp-tauri-live-final.png');
const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitFor(description, probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false && value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(80);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`,
    lastError ? { cause: lastError } : undefined,
  );
}

async function driverCommand(method, path, body) {
  const response = await fetch(`${driverUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload.value;
}

async function assertDriverReady() {
  const response = await fetch(`${driverUrl}/status`);
  const payload = await response.json();
  assert.equal(response.ok, true, `Tauri driver status failed: ${JSON.stringify(payload)}`);
  assert.equal(
    payload.value?.ready,
    true,
    `Tauri driver is not ready: ${payload.value?.message ?? JSON.stringify(payload)}`,
  );
}

async function readReadyDescriptor() {
  return waitFor(
    'authenticated Srijika frontend bridge',
    async () => {
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
      assert.equal(descriptor.protocolVersion, '1.0');
      assert.match(descriptor.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(descriptor.token, /^[a-f0-9]{64}$/);
      assert.equal(typeof descriptor.instanceId, 'string');
      assert.equal(typeof descriptor.pid, 'number');
      const healthResponse = await fetch(
        new URL(descriptor.healthPath ?? '/v1/health', `${descriptor.endpoint}/`),
        {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${descriptor.token}`,
          },
        },
      );
      const health = await healthResponse.json();
      if (!healthResponse.ok || health.frontendReady !== true) return undefined;
      assert.equal(health.instanceId, descriptor.instanceId);
      assert.equal(health.pid, descriptor.pid);
      assert.equal(Object.hasOwn(health, 'token'), false, 'health response leaked bridge token');
      return descriptor;
    },
    15_000,
  );
}

async function verifyBridgeStopped(expectedDescriptor) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(descriptorPath);
    } catch (error) {
      if (error?.code === 'ENOENT') return 'removed-by-studio';
      throw error;
    }
    await sleep(80);
  }

  const remaining = JSON.parse(await readFile(descriptorPath, 'utf8'));
  if (remaining.instanceId !== expectedDescriptor.instanceId) return 'replaced-by-new-instance';

  assert.throws(
    () => process.kill(expectedDescriptor.pid, 0),
    (error) => error?.code === 'ESRCH',
    `Studio PID ${expectedDescriptor.pid} still exists after WebDriver closed its session`,
  );
  await assert.rejects(
    fetch(new URL(remaining.healthPath ?? '/v1/health', `${remaining.endpoint}/`), {
      headers: { authorization: `Bearer ${remaining.token}` },
      signal: AbortSignal.timeout(750),
    }),
    'stale bridge endpoint unexpectedly remained reachable',
  );

  const finalDescriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
  assert.equal(
    finalDescriptor.instanceId,
    expectedDescriptor.instanceId,
    'descriptor ownership changed before stale cleanup',
  );
  assert.equal(finalDescriptor.pid, expectedDescriptor.pid);
  await unlink(descriptorPath);
  await assert.rejects(access(descriptorPath), (error) => error?.code === 'ENOENT');
  return 'stale-verified-and-removed-after-webdriver-termination';
}

function toolResult(response, toolName) {
  assert.notEqual(response.isError, true, `${toolName} failed: ${JSON.stringify(response)}`);
  assert.equal(response.structuredContent?.ok, true, `${toolName} returned no success envelope`);
  return response.structuredContent.result;
}

async function callTool(client, name, args) {
  return toolResult(await client.callTool({ name, arguments: args }), name);
}

await access(application);
await access(bundle);
await assertDriverReady();

const session = await driverCommand('POST', '/session', {
  capabilities: {
    alwaysMatch: {
      browserName: 'wry',
      'tauri:options': { application },
    },
  },
});
const sessionId = session.sessionId;
const sessionPath = `/session/${sessionId}`;
let client;
let transport;
let transportStderr = '';
let descriptor;
let successSummary;

async function elements(selector) {
  return driverCommand('POST', `${sessionPath}/elements`, {
    using: 'css selector',
    value: selector,
  });
}

async function execute(script, args = []) {
  return driverCommand('POST', `${sessionPath}/execute/sync`, { script, args });
}

async function waitForCanvasNode(nodeId, expected, timeoutMs = 5_000) {
  return waitFor(
    `${expected ? 'rendered' : 'removed'} canvas node ${nodeId}`,
    async () => {
      const result = await execute(
        `const frame = document.querySelector('iframe[title="Srijika DOM design surface"]');
         const node = frame?.contentDocument?.querySelector('[data-srijika-node="${nodeId}"]');
         return node ? { exists: true, text: node.textContent ?? '' } : { exists: false, text: '' };`,
      );
      return result.exists === expected ? result : undefined;
    },
    timeoutMs,
  );
}

try {
  await waitFor('Srijika Studio shell', async () => (await elements('.studio-shell')).length === 1);
  descriptor = await readReadyDescriptor();
  if (process.platform !== 'win32') {
    const descriptorMode = (await stat(descriptorPath)).mode & 0o777;
    assert.equal(descriptorMode, 0o600, 'bridge descriptor must be user-private');
  }

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      SRIJIKA_STUDIO_BRIDGE_DESCRIPTOR: descriptorPath,
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => {
    transportStderr += chunk.toString('utf8');
  });
  client = new Client({ name: 'srijika-tauri-live-smoke', version: '1.0.0' });
  await client.connect(transport);

  const listedTools = await client.listTools();
  for (const requiredTool of [
    'srijika_get_project_summary',
    'srijika_get_page_outline',
    'srijika_get_node',
    'srijika_apply_operations',
    'srijika_validate_document',
    'srijika_undo',
    'srijika_redo',
  ]) {
    assert(
      listedTools.tools.some(({ name }) => name === requiredTool),
      `MCP bundle did not expose ${requiredTool}`,
    );
  }

  const capabilities = await callTool(client, 'srijika_get_capabilities', {});
  assert.equal(capabilities.protocolVersion, '1.0');
  assert.equal(capabilities.runtime.transport, 'authenticated-loopback');

  const summary = await callTool(client, 'srijika_get_project_summary', { includePages: true });
  assert(summary.pages.length > 0, 'running Studio returned no pages');
  const pageId = summary.project.entryPageId;
  const initialPage = summary.pages.find((page) => page.id === pageId);
  assert(initialPage, `entry page ${pageId} was missing from project summary`);

  const initialOutline = await callTool(client, 'srijika_get_page_outline', {
    pageId,
    maxDepth: 8,
    maxNodes: 500,
  });
  assert.equal(initialOutline.revision, initialPage.revision);
  assert(initialOutline.nodes.some(({ id }) => id === initialOutline.rootNodeId));
  const initialRoot = await callTool(client, 'srijika_get_node', {
    pageId,
    nodeId: initialOutline.rootNodeId,
  });
  assert.equal(initialRoot.node.id, initialOutline.rootNodeId);

  const uniqueSuffix = `${Date.now().toString(36)}_${process.pid}`;
  const containerId = `mcp_live_container_${uniqueSuffix}`;
  const headingId = `mcp_live_heading_${uniqueSuffix}`;
  const headingText = `MCP live round trip ${uniqueSuffix}`;
  const mutation = await callTool(client, 'srijika_apply_operations', {
    pageId,
    expectedRevision: initialOutline.revision,
    operations: [
      {
        kind: 'insertComponent',
        operationId: 'live-container',
        id: containerId,
        parentId: initialOutline.rootNodeId,
        componentId: 'srijika.container',
        name: 'MCP Live Container',
        style: {
          gap: 8,
          padding: { top: 12, right: 12, bottom: 12, left: 12 },
        },
      },
      {
        kind: 'insertComponent',
        operationId: 'live-heading',
        id: headingId,
        parentId: containerId,
        componentId: 'srijika.heading',
        name: 'MCP Live Heading',
        props: {
          text: { kind: 'literal', value: headingText },
          level: { kind: 'literal', value: 2 },
        },
      },
    ],
  });
  assert.equal(mutation.ok, true, JSON.stringify(mutation));
  assert.equal(mutation.previousRevision, initialOutline.revision);
  assert.equal(mutation.revision, initialOutline.revision + 1);
  assert.equal(mutation.appliedOperationCount, 2);

  const mutatedHeading = await callTool(client, 'srijika_get_node', {
    pageId,
    nodeId: headingId,
  });
  assert.equal(mutatedHeading.parent.nodeId, containerId);
  assert.deepEqual(mutatedHeading.node.props.text, { kind: 'literal', value: headingText });
  const renderedMutation = await waitForCanvasNode(headingId, true);
  assert.match(renderedMutation.text, new RegExp(headingText));

  const validation = await callTool(client, 'srijika_validate_document', { pageId });
  assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
  assert.equal(validation.revision, mutation.revision);
  assert.equal(
    validation.diagnostics.some(({ severity }) => severity === 'error'),
    false,
    JSON.stringify(validation.diagnostics),
  );

  const undo = await callTool(client, 'srijika_undo', {
    pageId,
    expectedRevision: mutation.revision,
  });
  assert.equal(undo.ok, true, JSON.stringify(undo));
  assert.equal(undo.changed, true);
  assert.equal(undo.revision, initialOutline.revision);
  await waitForCanvasNode(headingId, false);
  const undoneOutline = await callTool(client, 'srijika_get_page_outline', {
    pageId,
    maxDepth: 8,
    maxNodes: 500,
  });
  assert.equal(
    undoneOutline.nodes.some(({ id }) => id === headingId),
    false,
  );

  const redo = await callTool(client, 'srijika_redo', {
    pageId,
    expectedRevision: undo.revision,
  });
  assert.equal(redo.ok, true, JSON.stringify(redo));
  assert.equal(redo.changed, true);
  assert.equal(redo.revision, mutation.revision);
  const renderedRedo = await waitForCanvasNode(headingId, true);
  assert.match(renderedRedo.text, new RegExp(headingText));

  const finalValidation = await callTool(client, 'srijika_validate_document', { pageId });
  assert.equal(finalValidation.ok, true, JSON.stringify(finalValidation.diagnostics));
  assert.equal(finalValidation.revision, redo.revision);
  const bridgeLabel = await execute(
    "return document.querySelector('.status-bridge')?.textContent?.trim() ?? '';",
  );
  assert.equal(bridgeLabel, 'Codex connected');

  const screenshot = await driverCommand('GET', `${sessionPath}/screenshot`);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, Buffer.from(screenshot, 'base64'));

  successSummary = {
    application,
    bundle,
    descriptorPath,
    stdioHandshake: 'passed',
    authenticatedHealth: 'passed',
    projectRead: 'passed',
    atomicMutation: 'passed',
    nativeRender: 'passed',
    validation: 'passed',
    undo: 'passed',
    redo: 'passed',
    finalRevision: redo.revision,
    screenshot: screenshotPath,
    keptOpen: keepApplicationOpen,
  };
} catch (error) {
  if (transportStderr) process.stderr.write(`Srijika MCP transport stderr:\n${transportStderr}\n`);
  throw error;
} finally {
  await client?.close().catch(() => undefined);
  if (!keepApplicationOpen) {
    await driverCommand('DELETE', sessionPath).catch(() => undefined);
    if (descriptor && successSummary) {
      successSummary.descriptorShutdown = await verifyBridgeStopped(descriptor);
    }
  }
}

if (successSummary) console.log(JSON.stringify(successSummary));
