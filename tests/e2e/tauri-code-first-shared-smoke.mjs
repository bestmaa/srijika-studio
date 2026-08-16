import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const driverUrl = process.env.SRIJIKA_TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const application =
  process.env.SRIJIKA_TAURI_APPLICATION ?? resolve(repositoryRoot, 'target/release/srijika-studio');
const screenshotPath =
  process.env.SRIJIKA_TAURI_SCREENSHOT ??
  resolve(repositoryRoot, 'test-results/tauri-code-first-shared.png');
const webElementKey = 'element-6066-11e4-a52e-4f735466cecf';

async function command(method, path, body) {
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

const session = await command('POST', '/session', {
  capabilities: {
    alwaysMatch: {
      browserName: 'wry',
      'tauri:options': { application },
    },
  },
});
const sessionPath = `/session/${session.sessionId}`;

async function elements(using, value) {
  return command('POST', `${sessionPath}/elements`, { using, value });
}

async function element(using, value) {
  return command('POST', `${sessionPath}/element`, { using, value });
}

async function click(target) {
  await command('POST', `${sessionPath}/element/${target[webElementKey]}/click`, {});
}

async function waitFor(selector, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const matches = await elements('css selector', selector);
    if (matches.length > 0) return matches[0];
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

try {
  await waitFor('.code-first-shell');
  assert.equal((await elements('css selector', '.studio-shell')).length, 0);

  let source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Srijika Studio/);
  assert.match(source, /Desktop · real folders/);

  const structureButton = await element(
    'xpath',
    "//button[@aria-label='Open structure guide' or normalize-space()='Structure']",
  );
  await click(structureButton);
  await waitFor("[role='dialog'][aria-labelledby='srijika-structure-title']");

  await click(await element('css selector', '#srijika-guide-tab-shared'));
  await waitFor('#srijika-guide-shared');
  source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Shared has three shapes—no freehand fourth shape/);
  assert.match(source, /Shared UI Primitive/);
  assert.match(source, /Shared Widget/);
  assert.match(source, /Shared Headless Capability/);
  assert.match(source, /Types alone are not a capability/);
  assert.match(source, /Two Parts → promote it to their Slot/);
  assert.match(source, /Two Slots → promote it to their Feature/);
  assert.match(source, /Two Features → promote it to Shared/);

  const screenshot = await command('GET', `${sessionPath}/screenshot`);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, Buffer.from(screenshot, 'base64'));

  console.log(
    JSON.stringify({
      application,
      nativeCodeFirstShell: 'passed',
      strictSharedShapes: 'passed',
      promotionLadder: 'passed',
      screenshot: screenshotPath,
    }),
  );
} finally {
  await command('DELETE', sessionPath).catch(() => undefined);
}
