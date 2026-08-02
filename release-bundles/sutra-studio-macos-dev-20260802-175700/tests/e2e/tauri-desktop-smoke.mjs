import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const driverUrl = process.env.SUTRA_TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const application =
  process.env.SUTRA_TAURI_APPLICATION ?? resolve(repositoryRoot, 'target/release/sutra-studio');
const keepApplicationOpen = process.env.SUTRA_KEEP_OPEN === '1';
const screenshotPath =
  process.env.SUTRA_TAURI_SCREENSHOT ??
  resolve(repositoryRoot, 'test-results/tauri-desktop-final.png');
const designInspectorScreenshotPath = resolve(
  repositoryRoot,
  'test-results/tauri-design-inspector-final.png',
);
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
const sessionId = session.sessionId;
const sessionPath = `/session/${sessionId}`;

async function element(using, value) {
  return command('POST', `${sessionPath}/element`, { using, value });
}

async function elements(using, value) {
  return command('POST', `${sessionPath}/elements`, { using, value });
}

async function waitForElements(selector, count, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const matches = await elements('css selector', selector);
    if (matches.length === count) return matches;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  const matches = await elements('css selector', selector);
  throw new Error(`Expected ${count} matches for ${selector}, received ${matches.length}`);
}

async function click(target) {
  await command('POST', `${sessionPath}/element/${target[webElementKey]}/click`, {});
}

async function clearAndType(target, text) {
  await scrollIntoView(target);
  const targetPath = `${sessionPath}/element/${target[webElementKey]}`;
  await command('POST', `${targetPath}/clear`, {});
  await command('POST', `${targetPath}/value`, { text, value: [...text] });
}

async function text(target) {
  return command('GET', `${sessionPath}/element/${target[webElementKey]}/text`);
}

async function attribute(target, name) {
  return command('GET', `${sessionPath}/element/${target[webElementKey]}/attribute/${name}`);
}

async function rect(target) {
  return command('GET', `${sessionPath}/element/${target[webElementKey]}/rect`);
}

async function switchToFrame(target) {
  await command('POST', `${sessionPath}/frame`, { id: target });
}

async function switchToParentDocument() {
  await command('POST', `${sessionPath}/frame`, { id: null });
}

async function scrollIntoView(target) {
  await command('POST', `${sessionPath}/execute/sync`, {
    script: 'arguments[0].scrollIntoView({ block: "center", inline: "center" });',
    args: [target],
  });
}

async function drag(source, target, targetOffset = { x: 0, y: 0 }) {
  await scrollIntoView(source);
  await scrollIntoView(target);
  await command('POST', `${sessionPath}/actions`, {
    actions: [
      {
        type: 'pointer',
        id: 'desktop-mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 0,
            origin: { [webElementKey]: source[webElementKey] },
            x: 0,
            y: 0,
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 250 },
          {
            type: 'pointerMove',
            duration: 700,
            origin: { [webElementKey]: target[webElementKey] },
            x: targetOffset.x,
            y: targetOffset.y,
          },
          { type: 'pause', duration: 250 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await command('DELETE', `${sessionPath}/actions`);
}

try {
  await waitForElements('.studio-shell', 1);
  let source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Home Page/);
  assert.match(source, /Page identity/);
  assert.doesNotMatch(source, /[\u0900-\u097f]/u);

  assert.equal((await elements('css selector', "input[aria-label='Min height']")).length, 1);
  assert.equal((await elements('css selector', "input[aria-label='Gap']")).length, 0);
  assert.equal((await elements('css selector', "input[aria-label='Box shadow']")).length, 0);
  await click(await element('css selector', "button[aria-label='Add design property']"));
  await click(await element('css selector', "button[aria-label='Add Gap']"));
  await clearAndType(await element('css selector', "input[aria-label='Gap']"), '24');
  const nativeRootGap = await command('POST', `${sessionPath}/execute/sync`, {
    script:
      'const frame = document.querySelector("iframe[title=\\"Sutra DOM design surface\\"]"); const root = frame?.contentDocument?.querySelector("[data-sutra-component=\\"sutra.page\\"]"); return root ? getComputedStyle(root).gap : null;',
    args: [],
  });
  assert.equal(nativeRootGap, '24px');
  await click(await element('css selector', "button[aria-label='Remove Gap']"));
  assert.equal((await elements('css selector', "input[aria-label='Gap']")).length, 0);

  await click(await element('css selector', "button[aria-label='New page']"));
  await clearAndType(
    await element('css selector', "input[aria-label='New page name']"),
    'Desktop Test Page',
  );
  await click(await element('xpath', "//button[normalize-space()='Create']"));
  source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Desktop Test Page/);
  assert.match(source, /Width/);
  assert.match(source, /100%/);

  const containerButton = await element(
    'xpath',
    "//button[contains(@class,'component-tile') and normalize-space()='Container']",
  );
  await click(containerButton);

  const designIframe = await element('css selector', "iframe[title='Sutra DOM design surface']");
  const iframeRect = await rect(designIframe);
  const nearTop = { x: 0, y: Math.round(-iframeRect.height / 2 + 85) };
  await drag(containerButton, designIframe, nearTop);

  await switchToFrame(designIframe);
  await waitForElements("[data-sutra-component='sutra.container']", 2);
  const [nestedContainer] = await waitForElements(
    "[data-sutra-component='sutra.container'] [data-sutra-component='sutra.container']",
    1,
  );
  assert.equal(await attribute(nestedContainer, 'data-sutra-selected'), 'true');
  await switchToParentDocument();

  const textButton = await element(
    'xpath',
    "//button[contains(@class,'component-tile') and normalize-space()='Text']",
  );
  await drag(textButton, designIframe, nearTop);

  await switchToFrame(designIframe);
  const [canvasText] = await waitForElements(
    "[data-sutra-component='sutra.container'] [data-sutra-component='sutra.container'] > [data-sutra-component='sutra.text']",
    1,
  );
  assert.equal(await attribute(canvasText, 'data-sutra-selected'), 'true');
  await switchToParentDocument();
  assert.match(
    await text(await element('css selector', "aside[aria-label='Inspector']")),
    /SELECTED COMPONENT[\s\S]*Text/,
  );

  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  await clearAndType(await element('css selector', "textarea[aria-label='Text']"), 'Desktop text');
  await switchToFrame(designIframe);
  assert.equal(await text(canvasText), 'Desktop text');
  await switchToParentDocument();

  await click(
    await element(
      'xpath',
      "//*[@role='tree' and @aria-label='Page content hierarchy']//*[@role='treeitem'][1]",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  await clearAndType(
    await element('css selector', "input[aria-label='New public prop name']"),
    'title',
  );
  await click(await element('css selector', "button[aria-label='Add public prop']"));

  await click(
    await element(
      'xpath',
      "//button[contains(@class,'component-tile') and normalize-space()='Heading']",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  await click(
    await element(
      'xpath',
      "//select[@aria-label='Text value source']/option[contains(normalize-space(.),'title')]",
    ),
  );

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='JSX']"));
  let code = await text(await element('css selector', '.code-panel code'));
  assert.match(code, /function DesktopTestPage/);
  assert.match(code, /title\?: string/);
  assert.match(code, /\{props\.title\}/);
  assert.match(code, /Desktop text/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='JSON']"));
  code = await text(await element('css selector', '.code-panel code'));
  assert.match(code, /"name": "Desktop Test Page"/);
  assert.match(code, /"name": "title"/);
  assert.match(code, /"componentId": "sutra\.heading"/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='UI']"));
  await click(await element('css selector', "button[aria-label='Delete Heading']"));
  const remountedDesignIframe = await element(
    'css selector',
    "iframe[title='Sutra DOM design surface']",
  );
  await switchToFrame(remountedDesignIframe);
  await waitForElements("[data-sutra-component='sutra.heading']", 0);
  const [selectedPageRoot] = await waitForElements("[data-sutra-component='sutra.page']", 1);
  assert.equal(await attribute(selectedPageRoot, 'data-sutra-selected'), 'true');
  await switchToParentDocument();
  assert.match(
    await text(await element('css selector', "aside[aria-label='Inspector']")),
    /SELECTED PAGE/,
  );

  await click(await element('css selector', "button[title='Reset demo']"));
  const demoDesignIframe = await element(
    'css selector',
    "iframe[title='Sutra DOM design surface']",
  );
  await switchToFrame(demoDesignIframe);
  const [demoPrice] = await waitForElements("[data-sutra-node='price_label']", 1);
  assert.equal(await text(demoPrice), '₹499.00');
  await switchToParentDocument();

  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  await clearAndType(
    await element('css selector', "input[aria-label='New public prop name']"),
    'quantity',
  );
  await click(await element('css selector', "button[aria-label='Add public prop']"));
  await click(
    await element(
      'css selector',
      "select[aria-label='Type for props.quantity'] option[value='number']",
    ),
  );
  assert.equal(
    await text(
      await element('css selector', "select[aria-label='Type for props.quantity'] option:checked"),
    ),
    'number',
  );
  assert.equal(
    await attribute(
      await element('css selector', "input[aria-label='Design value for props.quantity']"),
      'type',
    ),
    'number',
  );

  await click(
    await element(
      'css selector',
      "select[aria-label='Type for props.priceLabel'] option[value='number']",
    ),
  );
  assert.equal(
    await text(
      await element(
        'css selector',
        "select[aria-label='Type for props.priceLabel'] option:checked",
      ),
    ),
    'string',
  );
  const typeChangeError = await command('POST', `${sessionPath}/execute/sync`, {
    script: "return document.querySelector('.file-status.is-error')?.textContent ?? '';",
    args: [],
  });
  assert.match(
    typeChangeError,
    /Could not apply this change[\s\S]*expects string, received number/,
  );

  await clearAndType(
    await element('css selector', "input[aria-label='Design value for props.priceLabel']"),
    '₹1,299.00',
  );
  await switchToFrame(demoDesignIframe);
  assert.equal(await text(demoPrice), '₹1,299.00');
  await switchToParentDocument();

  await click(
    await element(
      'xpath',
      "//*[@role='treeitem'][.//*[contains(@class,'tree-name') and normalize-space()='Price Label Heading']]",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  const selectedTextSource = await text(
    await element('css selector', "select[aria-label='Text value source'] option:checked"),
  );
  assert.match(selectedTextSource, /priceLabel/);
  assert.doesNotMatch(selectedTextSource, /Function|Runtime/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='JSX']"));
  code = await text(await element('css selector', '.code-panel code'));
  assert.match(code, /import \{ sutraStyle \} from '@sutra\/react-renderer'/);
  assert.match(code, /\{props\.priceLabel\}/);
  assert.match(code, /quantity\?: number/);
  assert.match(code, /sutraStyle\(props\.cardStyle\)/);
  assert.doesNotMatch(code, /registeredCall|formatPrice|runtimeFunctions/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='UI']"));
  await click(
    await element(
      'xpath',
      "//*[@role='tree' and @aria-label='Page content hierarchy']//*[@role='treeitem'][1]",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));

  await clearAndType(
    await element('css selector', "input[aria-label='New public prop name']"),
    'onValueChange',
  );
  await click(await element('css selector', "button[aria-label='Add public prop']"));

  const eventTypeSelect = await element(
    'css selector',
    "select[aria-label='Type for props.onValueChange']",
  );
  assert.equal(await attribute(eventTypeSelect, 'disabled'), null);
  await scrollIntoView(eventTypeSelect);
  await click(
    await element(
      'css selector',
      "select[aria-label='Type for props.onValueChange'] option[value='event']",
    ),
  );
  assert.equal(
    await text(
      await element(
        'css selector',
        "select[aria-label='Type for props.onValueChange'] option:checked",
      ),
    ),
    'event',
  );

  const payloadModeSelect = await element(
    'css selector',
    "select[aria-label='Payload mode for props.onValueChange']",
  );
  await scrollIntoView(payloadModeSelect);
  await click(
    await element(
      'css selector',
      "select[aria-label='Payload mode for props.onValueChange'] option[value='payload']",
    ),
  );
  await clearAndType(
    await element('css selector', "input[aria-label='Event payload name for props.onValueChange']"),
    'value',
  );
  const payloadTypeSelect = await element(
    'css selector',
    "select[aria-label='Event payload type for props.onValueChange']",
  );
  await scrollIntoView(payloadTypeSelect);
  await click(
    await element(
      'css selector',
      "select[aria-label='Event payload type for props.onValueChange'] option[value='string']",
    ),
  );
  assert.equal(
    await attribute(
      await element(
        'css selector',
        "input[aria-label='Event payload name for props.onValueChange']",
      ),
      'value',
    ),
    'value',
  );
  assert.equal(
    await attribute(
      await element('css selector', "input[aria-label='Return type for props.onValueChange']"),
      'value',
    ),
    'void',
  );

  await click(
    await element(
      'xpath',
      "//button[contains(@class,'component-tile') and normalize-space()='Input']",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(3)'));
  const onChangeAction = await element('css selector', "select[aria-label='On change action']");
  await scrollIntoView(onChangeAction);
  await click(
    await element(
      'xpath',
      "//select[@aria-label='On change action']/option[contains(normalize-space(.),'onValueChange')]",
    ),
  );
  assert.match(
    await text(
      await element('css selector', "select[aria-label='On change action'] option:checked"),
    ),
    /onValueChange[\s\S]*\(value: string\) => void/,
  );

  await click(
    await element(
      'xpath',
      "//*[@role='tree' and @aria-label='Page content hierarchy']//*[@role='treeitem'][1]",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  const boundPayloadTypeSelect = await element(
    'css selector',
    "select[aria-label='Event payload type for props.onValueChange']",
  );
  await scrollIntoView(boundPayloadTypeSelect);
  await click(
    await element(
      'css selector',
      "select[aria-label='Event payload type for props.onValueChange'] option[value='number']",
    ),
  );
  assert.equal(
    await text(
      await element(
        'css selector',
        "select[aria-label='Event payload type for props.onValueChange'] option:checked",
      ),
    ),
    'string',
  );
  const incompatibleEventError = await command('POST', `${sessionPath}/execute/sync`, {
    script: "return document.querySelector('.file-status.is-error')?.textContent ?? '';",
    args: [],
  });
  assert.match(
    incompatibleEventError,
    /Could not apply this change[\s\S]*Event onChange payload is incompatible with onValueChange/,
  );

  await click(
    await element(
      'xpath',
      "//*[@role='treeitem'][.//*[contains(@class,'tree-name') and normalize-space()='Input']]",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(3)'));
  assert.match(
    await text(
      await element('css selector', "select[aria-label='On change action'] option:checked"),
    ),
    /onValueChange[\s\S]*\(value: string\) => void/,
  );

  await click(
    await element(
      'xpath',
      "//*[@role='tree' and @aria-label='Page content hierarchy']//*[@role='treeitem'][1]",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));

  await clearAndType(
    await element('css selector', "input[aria-label='New public prop name']"),
    'onCount',
  );
  await click(await element('css selector', "button[aria-label='Add public prop']"));
  await click(
    await element(
      'css selector',
      "select[aria-label='Type for props.onCount'] option[value='event']",
    ),
  );
  const countPayloadMode = await element(
    'css selector',
    "select[aria-label='Payload mode for props.onCount']",
  );
  await scrollIntoView(countPayloadMode);
  await click(
    await element(
      'css selector',
      "select[aria-label='Payload mode for props.onCount'] option[value='payload']",
    ),
  );
  await clearAndType(
    await element('css selector', "input[aria-label='Event payload name for props.onCount']"),
    'count',
  );
  const countPayloadType = await element(
    'css selector',
    "select[aria-label='Event payload type for props.onCount']",
  );
  await scrollIntoView(countPayloadType);
  await click(
    await element(
      'css selector',
      "select[aria-label='Event payload type for props.onCount'] option[value='number']",
    ),
  );

  await click(
    await element(
      'xpath',
      "//button[contains(@class,'component-tile') and normalize-space()='Button']",
    ),
  );
  await click(await element('css selector', '.inspector-tabs button:nth-child(3)'));
  const onClickAction = await element('css selector', "select[aria-label='On click action']");
  await scrollIntoView(onClickAction);
  await click(
    await element(
      'xpath',
      "//select[@aria-label='On click action']/option[contains(normalize-space(.),'onCount')]",
    ),
  );
  assert.equal(
    await text(
      await element('css selector', "select[aria-label='On click argument source'] option:checked"),
    ),
    'Literal value',
  );
  assert.equal(
    await attribute(
      await element(
        'css selector',
        "select[aria-label='On click argument source'] option[value='eventPayload']",
      ),
      'disabled',
    ),
    'true',
  );
  await clearAndType(
    await element('css selector', "input[aria-label='On click literal argument']"),
    '5',
  );
  assert.equal(
    await attribute(
      await element('css selector', "input[aria-label='On click literal argument']"),
      'value',
    ),
    '5',
  );

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='JSX']"));
  code = await text(await element('css selector', '.code-panel code'));
  assert.match(code, /onCount\?: \(count: number\) => void/);
  assert.match(code, /onClick=\{\(\) => props\.onCount\?\.\(5\)\}/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='JSON']"));
  code = await text(await element('css selector', '.code-panel code'));
  assert.match(code, /"eventArguments"/);
  assert.match(code, /"expression"[\s\S]*"kind": "literal"[\s\S]*"value": 5/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='UI']"));

  await command('POST', `${sessionPath}/execute/sync`, {
    script: "localStorage.removeItem('sutra-studio.custom-templates.v1');",
    args: [],
  });
  await click(await element('xpath', "//button[normalize-space()='Templates']"));
  await waitForElements('.template-card', 5);
  await click(
    await element(
      'xpath',
      "//article[contains(@class,'template-card')][.//h3[normalize-space()='YouTube Home']]//button[normalize-space()='Use template']",
    ),
  );
  source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Loaded YouTube Home template/);

  let templateDesignIframe = await element(
    'css selector',
    "iframe[title='Sutra DOM design surface']",
  );
  await switchToFrame(templateDesignIframe);
  await waitForElements("[data-sutra-node^='yt_card_']", 6);
  await waitForElements("[data-sutra-component='sutra.image']", 10);
  const templateImageSources = await command('POST', `${sessionPath}/execute/sync`, {
    script:
      "return Array.from(document.querySelectorAll('[data-sutra-component=\"sutra.image\"]')).map((image) => image.getAttribute('src'));",
    args: [],
  });
  assert.equal(templateImageSources.length, 10);
  assert.ok(
    templateImageSources.every((value) => value?.startsWith('https://images.unsplash.com/')),
  );

  const templateTitle = await element('css selector', "[data-sutra-node='yt_title_0']");
  await click(templateTitle);
  assert.equal(await attribute(templateTitle, 'data-sutra-selected'), 'true');
  await switchToParentDocument();
  const railBounds = await command('POST', `${sessionPath}/execute/sync`, {
    script: `
      const overflowFor = (containerSelector, childSelector) => {
        const container = document.querySelector(containerSelector).getBoundingClientRect();
        const children = Array.from(document.querySelectorAll(childSelector));
        return Math.max(
          0,
          ...children.map((child) => {
            const bounds = child.getBoundingClientRect();
            return Math.max(container.left - bounds.left, bounds.right - container.right);
          }),
        );
      };
      const leftRail = document.querySelector('.left-rail').getBoundingClientRect();
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      return {
        paletteOverflow: overflowFor('.left-panel', '.component-tile'),
        hierarchyOverflow: overflowFor('.hierarchy-panel', '.tree-row'),
        railWorkspaceOverlap: leftRail.right - workspace.left,
      };
    `,
    args: [],
  });
  assert.ok(
    railBounds.paletteOverflow <= 0.5,
    `Palette crossed the left rail by ${railBounds.paletteOverflow}px`,
  );
  assert.ok(
    railBounds.hierarchyOverflow <= 0.5,
    `Hierarchy crossed the left rail by ${railBounds.hierarchyOverflow}px`,
  );
  assert.ok(
    railBounds.railWorkspaceOverlap <= 0.5,
    `Left rail overlapped the workspace by ${railBounds.railWorkspaceOverlap}px`,
  );
  assert.equal(
    await attribute(
      await element('css selector', "aside[aria-label='Inspector'] input#node-name"),
      'value',
    ),
    'Video Title 1',
  );
  const selectedHierarchyTitle = await element(
    'xpath',
    "//*[@role='treeitem'][@aria-selected='true'][.//*[contains(@class,'tree-name') and normalize-space()='Video Title 1']]",
  );
  assert.equal(await attribute(selectedHierarchyTitle, 'aria-selected'), 'true');

  await click(await element('css selector', '.inspector-tabs button:nth-child(2)'));
  await clearAndType(
    await element('css selector', "input[aria-label='New instance prop name']"),
    'data-testid',
  );
  await click(await element('css selector', "button[aria-label='Add instance prop']"));
  await clearAndType(
    await element('css selector', "input[aria-label='data-testid']"),
    'desktop-video-title',
  );

  templateDesignIframe = await element('css selector', "iframe[title='Sutra DOM design surface']");
  await switchToFrame(templateDesignIframe);
  await waitForElements("[data-testid='desktop-video-title']", 1);
  await switchToParentDocument();

  await click(await element('css selector', '.inspector-tabs button:nth-child(3)'));
  assert.equal(
    await text(
      await element('css selector', "select[aria-label='New instance event port'] option:checked"),
    ),
    'onClick · no payload',
  );
  await click(await element('xpath', "//button[normalize-space()='Add event']"));
  await click(
    await element(
      'xpath',
      "//select[@aria-label='Click action']/option[contains(normalize-space(.),'onOpenVideo')]",
    ),
  );
  await clearAndType(
    await element('css selector', "input[aria-label='Click literal argument']"),
    'desktop-video-1',
  );

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='JSX']"));
  code = await text(await element('css selector', '.code-panel code'));
  assert.match(code, /"data-testid": "desktop-video-title"/);
  assert.match(code, /onClick=\{\(\) => props\.onOpenVideo\?\.\("desktop-video-1"\)\}/);

  await click(await element('xpath', "//*[@role='tab' and normalize-space()='UI']"));
  await click(await element('xpath', "//button[normalize-space()='File']"));
  await click(
    await element('xpath', "//*[@role='menuitem'][.//span[normalize-space()='Save as template']]"),
  );
  source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Saved YouTube Home to My templates/);

  await click(await element('xpath', "//button[normalize-space()='Templates']"));
  await waitForElements('.saved-template-row', 1);
  source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /My templates[\s\S]*YouTube Home/);
  await click(await element('css selector', "button[aria-label='Close templates']"));
  await click(await element('css selector', '.inspector-tabs button:nth-child(3)'));

  const screenshot = await command('GET', `${sessionPath}/screenshot`);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, Buffer.from(screenshot, 'base64'));

  await click(await element('css selector', "[role='treeitem']"));
  await click(await element('css selector', '.inspector-tabs button:nth-child(1)'));
  await waitForElements("button[aria-label='Add design property']", 1);
  assert.equal((await elements('css selector', "input[aria-label='Box shadow']")).length, 0);
  source = await command('GET', `${sessionPath}/source`);
  assert.match(source, /Only properties stored on this layer are shown/);
  const designInspectorScreenshot = await command('GET', `${sessionPath}/screenshot`);
  await writeFile(designInspectorScreenshotPath, Buffer.from(designInspectorScreenshot, 'base64'));

  console.log(
    JSON.stringify({
      application,
      pageCreation: 'passed',
      nestedDragAndDrop: 'passed',
      contextualInspector: 'passed',
      declaredPropBinding: 'passed',
      generatedViews: 'passed',
      deletion: 'passed',
      directPropStyleDemo: 'passed',
      publicPropTypeChange: 'passed',
      eventPropDefinitionAndBinding: 'passed',
      incompatibleEventEditRollback: 'passed',
      literalNumberArgumentMapping: 'passed',
      templatesGallery: 'passed',
      youtubeTemplateDesktopRender: 'passed',
      hierarchyInspectorSynchronization: 'passed',
      typedInstanceProp: 'passed',
      normalizedInstanceEventAndArgument: 'passed',
      savedTemplateWorkflow: 'passed',
      screenshot: screenshotPath,
      designInspectorScreenshot: designInspectorScreenshotPath,
      englishOnly: 'passed',
      keptOpen: keepApplicationOpen,
    }),
  );
} finally {
  if (!keepApplicationOpen) {
    await command('DELETE', sessionPath).catch(() => undefined);
  }
}
