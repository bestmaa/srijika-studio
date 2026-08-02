import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const application =
  process.env.SUTRA_TAURI_APPLICATION ?? resolve(repositoryRoot, 'target/release/sutra-studio');
const bundle = resolve(repositoryRoot, 'plugins/sutra-studio/mcp-server/sutra-mcp.mjs');
const fixturePath = resolve(repositoryRoot, 'tests/fixtures/orbit-fidelity.sutra.json.gz.b64');
const capturePath =
  process.env.SUTRA_ORBIT_CAPTURE ??
  resolve(repositoryRoot, 'test-results/mcp-tauri-orbit-fidelity.png');
const fullscreenCapturePath = resolve(
  repositoryRoot,
  'test-results/tauri-orbit-fullscreen-preview.png',
);
const tauriDriver =
  process.env.SUTRA_TAURI_DRIVER_BIN ?? join(homedir(), '.cargo/bin/tauri-driver');
const xvfbRun = process.env.SUTRA_XVFB_RUN_BIN ?? '/usr/bin/xvfb-run';
const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function fixtureDocument(encoded) {
  return JSON.parse(
    gunzipSync(Buffer.from(encoded.replace(/\s+/g, ''), 'base64')).toString('utf8'),
  );
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a TCP port.');
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitFor(description, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false && value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`,
    lastError ? { cause: lastError } : undefined,
  );
}

function toolResult(response, toolName) {
  assert.notEqual(response.isError, true, `${toolName} failed: ${JSON.stringify(response)}`);
  assert.equal(response.structuredContent?.ok, true, `${toolName} returned no success envelope`);
  return response.structuredContent.result;
}

async function callTool(client, name, args) {
  return toolResult(await client.callTool({ name, arguments: args }), name);
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'capture was not a PNG');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', 'PNG has no IHDR chunk');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
    return;
  }
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), sleep(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

if (process.platform === 'win32') {
  throw new Error('This isolated native harness must run inside Linux/WSL.');
}

for (const requiredPath of [application, bundle, fixturePath, tauriDriver, xvfbRun]) {
  await access(requiredPath);
}

const temporary = await mkdtemp(join(tmpdir(), 'sutra-native-orbit-'));
const descriptorPath = join(temporary, 'bridge/codex-bridge-v1.json');
const driverPort = await availablePort();
const nativePort = await availablePort();
const driverUrl = `http://127.0.0.1:${driverPort}`;
const driver = spawn(
  xvfbRun,
  ['-a', tauriDriver, '--port', String(driverPort), '--native-port', String(nativePort)],
  {
    detached: true,
    env: {
      ...process.env,
      XDG_DATA_HOME: join(temporary, 'xdg-data'),
      XDG_CACHE_HOME: join(temporary, 'xdg-cache'),
      XDG_CONFIG_HOME: join(temporary, 'xdg-config'),
      SUTRA_STUDIO_BRIDGE_DESCRIPTOR: descriptorPath,
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let driverOutput = '';
driver.stdout.on('data', (chunk) => {
  driverOutput += chunk.toString('utf8');
});
driver.stderr.on('data', (chunk) => {
  driverOutput += chunk.toString('utf8');
});

let sessionPath;
let client;
let transport;
let transportStderr = '';
let resultSummary;

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

async function execute(script, args = []) {
  return driverCommand('POST', `${sessionPath}/execute/sync`, { script, args });
}

try {
  await waitFor(
    'isolated tauri-driver',
    async () => {
      if (driver.exitCode !== null) {
        throw new Error(`tauri-driver exited with ${driver.exitCode}: ${driverOutput}`);
      }
      const response = await fetch(`${driverUrl}/status`);
      const payload = await response.json();
      return response.ok && payload.value?.ready === true;
    },
    30_000,
  );

  const session = await driverCommand('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'wry',
        'tauri:options': { application },
      },
    },
  });
  sessionPath = `/session/${session.sessionId}`;
  const mainWindowHandle = await driverCommand('GET', `${sessionPath}/window`);

  await waitFor('Sutra Studio shell', async () => {
    const matches = await driverCommand('POST', `${sessionPath}/elements`, {
      using: 'css selector',
      value: '.studio-shell',
    });
    return matches.length === 1;
  });

  const descriptor = await waitFor('isolated authenticated bridge', async () => {
    const value = JSON.parse(await readFile(descriptorPath, 'utf8'));
    const healthResponse = await fetch(
      new URL(value.healthPath ?? '/v1/health', `${value.endpoint}/`),
      { headers: { authorization: `Bearer ${value.token}` } },
    );
    const health = await healthResponse.json();
    return healthResponse.ok && health.frontendReady === true ? value : undefined;
  });
  assert.equal((await stat(descriptorPath)).mode & 0o777, 0o600);
  assert.equal(descriptor.protocolVersion, '1.0');
  assert.match(descriptor.token, /^[a-f0-9]{64}$/);

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    cwd: repositoryRoot,
    env: { ...process.env, SUTRA_STUDIO_BRIDGE_DESCRIPTOR: descriptorPath },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => {
    transportStderr += chunk.toString('utf8');
  });
  client = new Client({ name: 'sutra-native-orbit-fidelity', version: '1.0.0' });
  await client.connect(transport);

  const toolNames = new Set((await client.listTools()).tools.map(({ name }) => name));
  for (const name of [
    'sutra_apply_operations',
    'sutra_render_preview',
    'sutra_get_layout_snapshot',
    'sutra_capture_preview',
  ]) {
    assert(toolNames.has(name), `MCP bundle did not expose ${name}`);
  }

  const capabilities = await callTool(client, 'sutra_get_capabilities', {});
  assert.equal(capabilities.runtime.transport, 'authenticated-loopback');
  assert.equal(capabilities.runtime.previewCaptureSupported, true);
  assert.equal(capabilities.runtime.layoutInspectionSupported, true);

  const summary = await callTool(client, 'sutra_get_project_summary', { includePages: true });
  const pageId = summary.project.entryPageId;
  const initialPage = summary.pages.find((page) => page.id === pageId);
  assert(initialPage, `entry page ${pageId} was missing`);

  const orbitDocument = fixtureDocument(await readFile(fixturePath, 'utf8'));
  const fixturePageId = orbitDocument.id;
  orbitDocument.id = pageId;
  const replacement = await callTool(client, 'sutra_apply_operations', {
    pageId,
    expectedRevision: initialPage.revision,
    operations: [
      {
        kind: 'replaceDocument',
        operationId: 'load-orbit-fidelity-fixture',
        document: orbitDocument,
      },
    ],
  });
  assert.equal(replacement.ok, true, JSON.stringify(replacement));
  assert.equal(replacement.appliedOperationCount, 1);

  await waitFor('four rendered Orbit stat cards', async () => {
    const state = await execute(`
      const frame = document.querySelector('iframe[title="Sutra DOM design surface"]');
      return {
        cards: frame?.contentDocument?.querySelectorAll('[data-sutra-node="stat_card_template"]').length ?? 0,
        text: frame?.contentDocument?.querySelector('.sutra-edit-surface')?.textContent ?? ''
      };
    `);
    return state.cards === 4 && state.text.includes('Good morning') ? state : undefined;
  });

  const validation = await callTool(client, 'sutra_validate_document', { pageId });
  assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
  assert.equal(
    validation.diagnostics.some(({ severity }) => severity === 'error'),
    false,
    JSON.stringify(validation.diagnostics),
  );

  const preview = await callTool(client, 'sutra_render_preview', {
    pageId,
    viewport: 'desktop',
    width: 1586,
    height: 992,
  });
  assert.deepEqual(preview.viewportSize, { width: 1586, height: 992 });
  assert.equal(preview.customViewport, true);
  assert.equal(preview.captureSupported, true);

  await waitFor('exact 1586x992 native design surface', async () => {
    const dimensions = await execute(`
      const frame = document.querySelector('iframe[title="Sutra DOM design surface"]');
      return frame ? { width: frame.clientWidth, height: frame.clientHeight } : null;
    `);
    return dimensions?.width === 1586 && dimensions?.height === 992 ? dimensions : undefined;
  });

  const layout = await callTool(client, 'sutra_get_layout_snapshot', {
    pageId,
    nodeIds: ['sidebar', 'top_header', 'stat_card_template', 'charts_grid', 'bottom_grid'],
    includeComputedStyles: true,
    maxInstances: 20,
  });
  assert.equal(layout.ok, true, JSON.stringify(layout.diagnostics));
  assert.deepEqual(layout.viewport.requested, { width: 1586, height: 992 });
  assert.deepEqual(layout.viewport.actual, { width: 1586, height: 992 });
  assert.equal(
    layout.diagnostics.some(({ severity }) => severity === 'error'),
    false,
    JSON.stringify(layout.diagnostics),
  );

  const instancesFor = (nodeId) =>
    layout.instances.filter((instance) => instance.nodeId === nodeId);
  const sidebar = instancesFor('sidebar');
  const header = instancesFor('top_header');
  const cards = instancesFor('stat_card_template');
  assert.equal(sidebar.length, 1);
  assert.equal(header.length, 1);
  assert.equal(cards.length, 4);
  assert.deepEqual(
    cards.map(({ instanceIndex, instanceKey }) => ({ instanceIndex, instanceKey })),
    [
      { instanceIndex: 0, instanceKey: 'stat_card_template#1' },
      { instanceIndex: 1, instanceKey: 'stat_card_template#2' },
      { instanceIndex: 2, instanceKey: 'stat_card_template#3' },
      { instanceIndex: 3, instanceKey: 'stat_card_template#4' },
    ],
  );
  assert.equal(sidebar[0].rect.x, 0);
  assert.equal(sidebar[0].rect.width, 264);
  assert.equal(sidebar[0].rect.height, 992);
  assert.equal(header[0].rect.x, 264);
  assert.equal(header[0].rect.y, 0);
  assert.equal(header[0].rect.height, 76);
  assert.equal(new Set(cards.map(({ rect }) => Math.round(rect.y))).size, 1);
  assert(cards.every(({ rect }) => rect.width > 295 && rect.width < 310));
  assert.equal(instancesFor('charts_grid').length, 1);
  assert.equal(instancesFor('bottom_grid').length, 1);

  const captureResponse = await client.callTool({
    name: 'sutra_capture_preview',
    arguments: {
      pageId,
      viewport: 'desktop',
      width: 1586,
      height: 992,
      pixelRatio: 1,
    },
  });
  const capture = toolResult(captureResponse, 'sutra_capture_preview');
  assert.equal(capture.clean, true);
  assert.deepEqual(capture.viewportSize, { width: 1586, height: 992 });
  assert.deepEqual(capture.capture, {
    mimeType: 'image/png',
    width: 1586,
    height: 992,
    pixelRatio: 1,
  });
  assert.equal(
    Object.hasOwn(capture.capture, 'data'),
    false,
    'structured metadata leaked PNG data',
  );

  const imageBlocks = captureResponse.content.filter(({ type }) => type === 'image');
  const textBlocks = captureResponse.content.filter(({ type }) => type === 'text');
  assert.equal(imageBlocks.length, 1, 'capture must return exactly one MCP image block');
  assert.equal(imageBlocks[0].mimeType, 'image/png');
  assert.equal(textBlocks.length, 1, 'capture must return one compact metadata block');
  assert.equal(
    textBlocks[0].text.includes(imageBlocks[0].data),
    false,
    'metadata duplicated base64 PNG',
  );
  assert.doesNotMatch(textBlocks[0].text, /Drop components here|REPEAT|sutra-capture-mode/i);

  const png = Buffer.from(imageBlocks[0].data, 'base64');
  assert.deepEqual(pngDimensions(png), { width: 1586, height: 992 });
  await mkdir(dirname(capturePath), { recursive: true });
  await writeFile(capturePath, png);

  const captureClassWasCleaned = await execute(`
    const frame = document.querySelector('iframe[title="Sutra DOM design surface"]');
    return frame?.contentDocument?.querySelector('.sutra-edit-surface')?.classList.contains('sutra-capture-mode') ?? null;
  `);
  assert.equal(captureClassWasCleaned, false, 'capture mode leaked into the live editor');

  await execute(`
    const button = document.querySelector('button[aria-label="Enter fullscreen preview"]');
    if (!button) throw new Error('Fullscreen preview button is missing');
    button.click();
  `);
  const fullscreenBounds = await waitFor('native fullscreen design preview', async () => {
    const bounds = await execute(`
      const preview = document.querySelector('.fullscreen-preview');
      if (!preview) return null;
      const rect = preview.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        exitVisible: Boolean(document.querySelector('button[aria-label="Exit fullscreen preview"]'))
      };
    `);
    return bounds?.exitVisible ? bounds : undefined;
  });
  assert.deepEqual(
    {
      x: fullscreenBounds.x,
      y: fullscreenBounds.y,
      width: fullscreenBounds.width,
      height: fullscreenBounds.height,
    },
    {
      x: 0,
      y: 0,
      width: fullscreenBounds.viewportWidth,
      height: fullscreenBounds.viewportHeight,
    },
  );
  const fullscreenScreenshot = await driverCommand('GET', `${sessionPath}/screenshot`);
  await writeFile(fullscreenCapturePath, Buffer.from(fullscreenScreenshot, 'base64'));
  await execute(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await waitFor('fullscreen preview to close', async () => {
    return (await execute(`return !document.querySelector('.fullscreen-preview')`)) || undefined;
  });

  await execute(`
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Browser preview')
    );
    if (!button) throw new Error('Browser preview button is missing');
    button.click();
  `);
  const previewWindowHandle = await waitFor('native browser preview window', async () => {
    const handles = await driverCommand('GET', `${sessionPath}/window/handles`);
    return handles.find((handle) => handle !== mainWindowHandle);
  });
  await driverCommand('POST', `${sessionPath}/window`, { handle: previewWindowHandle });
  await waitFor('rendered content in native browser preview', async () => {
    const text = await execute(`return document.body?.textContent ?? ''`);
    return text.includes('Sutra live preview') && text.includes('Good morning') ? text : undefined;
  });
  await driverCommand('DELETE', `${sessionPath}/window`);
  await driverCommand('POST', `${sessionPath}/window`, { handle: mainWindowHandle });

  resultSummary = {
    application,
    bundle,
    isolatedDataHome: join(temporary, 'xdg-data'),
    authenticatedBridge: 'passed',
    fixturePageId,
    isolatedPageId: pageId,
    fixtureNodeCount: Object.keys(orbitDocument.nodes).length,
    exactViewport: preview.viewportSize,
    layoutInstances: layout.returnedInstanceCount,
    repeatInstances: cards.length,
    png: { ...pngDimensions(png), bytes: png.length, path: capturePath },
    editorChrome: 'excluded',
    fullscreenPreview: { bounds: fullscreenBounds, screenshot: fullscreenCapturePath },
    browserPreviewWindow: 'passed',
  };
} catch (error) {
  if (transportStderr) process.stderr.write(`Sutra MCP transport stderr:\n${transportStderr}\n`);
  if (driverOutput) process.stderr.write(`tauri-driver output:\n${driverOutput}\n`);
  throw error;
} finally {
  await client?.close().catch(() => undefined);
  if (sessionPath) await driverCommand('DELETE', sessionPath).catch(() => undefined);
  await stopProcessGroup(driver).catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
}

if (resultSummary) console.log(JSON.stringify(resultSummary));
