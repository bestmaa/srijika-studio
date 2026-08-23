import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';

import type { Browser, BrowserContext, Response } from 'playwright';

import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import { getReactMigrationStatus, scanReactMigrationSource } from './react-migration.js';

const MAX_ROUTES = 64;
const MAX_VIEWPORTS = 6;
const MAX_ROUTE_SOURCE_BYTES = 1024 * 1024;
const MAX_ROUTE_SOURCE_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_TARGET_FILES = 4_096;
const MAX_TARGET_BYTES = 64 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_DOM_ELEMENTS = 10_000;
const MAX_DOM_TEXT_BYTES = 64 * 1024;
const NAVIGATION_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 10 * 60_000;
const MAX_PIXEL_MISMATCH_RATIO = 0.02;
const MAX_MEAN_PIXEL_DELTA = 0.02;
const EVIDENCE_ROOT = '.srijika/migrations/react/evidence/browser-parity';
const LATEST_MANIFEST_PATH = '.srijika/migrations/react/browser-parity-latest.json';

export interface ReactMigrationParityViewport {
  name: 'mobile' | 'tablet' | 'desktop' | 'wide';
  width: number;
  height: number;
}

export interface CaptureReactMigrationBrowserParityRequest {
  target: string;
  /** Allow dependency downloads when an offline install cannot hydrate either runtime. */
  includeInstall?: boolean;
}

export interface ReactMigrationParityServerBinding {
  host: '127.0.0.1';
  port: number;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
  command: readonly string[];
  cwdKind: 'temporary-source-copy' | 'target-root';
}

export interface ReactMigrationBrowserDomTrace {
  finalPath: string;
  title: string;
  text: string;
  headings: readonly string[];
  links: readonly string[];
  buttons: readonly string[];
  inputs: readonly { type: string; name: string; placeholder: string }[];
  landmarks: Readonly<Record<string, number>>;
  elementCount: number;
}

export interface ReactMigrationBrowserSideCapture {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: readonly string[];
  dom: ReactMigrationBrowserDomTrace;
  domSha256: string;
  screenshotPath: string;
  screenshotSha256: string;
  screenshotBytes: number;
  screenshotWidth: number;
  screenshotHeight: number;
  consoleErrors: readonly string[];
  pageErrors: readonly string[];
  requestErrors: readonly string[];
}

export interface ReactMigrationBrowserParityCase {
  route: string;
  viewport: ReactMigrationParityViewport;
  source: ReactMigrationBrowserSideCapture;
  target: ReactMigrationBrowserSideCapture;
  redirectsEqual: boolean;
  domEqual: boolean;
  pixelMismatchRatio: number;
  meanPixelDelta: number;
  passed: boolean;
  errors: readonly string[];
}

export interface ReactMigrationBrowserParityManifest {
  schema: 'srijika-react-browser-parity-v1';
  capturedAt: string;
  sourceRoot: string;
  targetRoot: string;
  sourceSnapshotSha256: string;
  targetSnapshotSha256: string;
  includeInstall: boolean;
  servers: {
    source: ReactMigrationParityServerBinding;
    target: ReactMigrationParityServerBinding;
  };
  routes: readonly string[];
  viewports: readonly ReactMigrationParityViewport[];
  cases: readonly ReactMigrationBrowserParityCase[];
  thresholds: {
    maximumPixelMismatchRatio: number;
    maximumMeanPixelDelta: number;
  };
  totalCaptureBytes: number;
  evidenceDirectory: string;
  errors: readonly string[];
  passed: boolean;
  manifestSha256: string;
}

const defaultViewports: readonly ReactMigrationParityViewport[] = Object.freeze([
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]);

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function loopbackBaseUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label} must be a valid loopback HTTP(S) URL.`, { cause: error });
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(hostname) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(`${label} must be an unauthenticated loopback HTTP(S) URL without a fragment.`);
  }
  return url;
}

function isLoopbackUrl(value: string): boolean {
  try {
    loopbackBaseUrl(value, 'Navigation URL');
    return true;
  } catch {
    return false;
  }
}

function normalizeRoute(value: string): string | undefined {
  const withoutQuery = value.trim().split(/[?#]/u, 1)[0] ?? '';
  if (!withoutQuery || /^(?:https?:|mailto:|tel:|javascript:)/iu.test(withoutQuery))
    return undefined;
  let route = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  route = route.replace(/\/?:[A-Za-z_$][\w$]*\??/gu, '/srijika-parity');
  route = route.replace(/\*+$/gu, 'srijika-parity').replace(/\/{2,}/gu, '/');
  if (route.includes('..') || route.length > 512) return undefined;
  return route.length > 1 ? route.replace(/\/+$/gu, '') : '/';
}

async function deriveEngineRoutes(target: string): Promise<readonly string[]> {
  const session = await getReactMigrationStatus(target);
  const sourceFileSystem = await SrijikaProjectFileSystem.open(session.sourceRoot);
  const routes = new Set<string>(['/']);
  let totalBytes = 0;
  const routeSources = session.plan.ownership
    .filter((decision) => decision.routeEntrypoint)
    .map((decision) => decision.sourcePath)
    .sort();
  const patterns = [
    /\bpath\s*[:=]\s*["'`]([^"'`]+)["'`]/gu,
    /\b(?:navigate|redirect|replace)\s*\(\s*["'`]([^"'`]+)["'`]/gu,
  ];
  for (const sourcePath of routeSources) {
    const file = await sourceFileSystem.readText(sourcePath, MAX_ROUTE_SOURCE_BYTES);
    totalBytes += file.size;
    if (totalBytes > MAX_ROUTE_SOURCE_TOTAL_BYTES) {
      throw new Error('Route discovery exceeds the 8 MiB source safety limit.');
    }
    for (const pattern of patterns) {
      for (const match of file.source.matchAll(pattern)) {
        const route = normalizeRoute(match[1] ?? '');
        if (route) routes.add(route);
        if (routes.size > MAX_ROUTES) {
          throw new Error(`Route discovery exceeds the ${MAX_ROUTES}-route safety limit.`);
        }
      }
    }
  }
  if (session.inventory.semanticRoutesPresent && routes.size === 1 && routeSources.length > 0) {
    throw new Error(
      'Semantic routes are present, but the engine could not derive any concrete route paths.',
    );
  }
  return Object.freeze([...routes].sort());
}

function validateViewports(
  values: readonly ReactMigrationParityViewport[] | undefined,
): readonly ReactMigrationParityViewport[] {
  const viewports = values ? [...values] : [...defaultViewports];
  if (viewports.length < 2 || viewports.length > MAX_VIEWPORTS) {
    throw new Error(`Browser parity requires 2 to ${MAX_VIEWPORTS} viewports.`);
  }
  const names = new Set<string>();
  const dimensions = new Set<string>();
  for (const viewport of viewports) {
    if (
      !['mobile', 'tablet', 'desktop', 'wide'].includes(viewport.name) ||
      !Number.isSafeInteger(viewport.width) ||
      !Number.isSafeInteger(viewport.height) ||
      viewport.width < 240 ||
      viewport.width > 3840 ||
      viewport.height < 240 ||
      viewport.height > 2160 ||
      names.has(viewport.name) ||
      dimensions.has(`${viewport.width}x${viewport.height}`)
    ) {
      throw new Error(
        'Parity viewports require unique canonical names and dimensions from 240x240 to 3840x2160.',
      );
    }
    names.add(viewport.name);
    dimensions.add(`${viewport.width}x${viewport.height}`);
  }
  const widths = viewports.map((viewport) => viewport.width);
  if (Math.min(...widths) > 480 || Math.max(...widths) < 1_024) {
    throw new Error('Browser parity must include both a mobile-width and desktop-width viewport.');
  }
  return Object.freeze(viewports.sort((left, right) => left.name.localeCompare(right.name)));
}

async function readBoundedBinary(
  fileSystem: SrijikaProjectFileSystem,
  relativePath: string,
  maximumBytes: number,
): Promise<Buffer> {
  const before = await fileSystem.inspectRegularFile(relativePath);
  if (before.size > maximumBytes)
    throw new Error(`${relativePath} exceeds the browser parity byte limit.`);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(fileSystem.resolve(relativePath), constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size)
      throw new Error(`${relativePath} changed while opening.`);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await fileSystem.inspectRegularFile(relativePath);
    if (offset !== bytes.length || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
      throw new Error(`${relativePath} changed while reading.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function currentTargetSnapshot(target: string): Promise<string> {
  const fileSystem = await SrijikaProjectFileSystem.open(target);
  const files = await fileSystem.walkFiles([''], {
    maximumFiles: MAX_TARGET_FILES,
    maximumEntries: 32_768,
    maximumDirectories: 4_096,
    maximumDepth: 32,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: false,
    stopAtNestedProjectRoots: false,
    acceptFile: () => true,
  });
  let totalBytes = 0;
  const records: string[] = [];
  for (const file of files) {
    const bytes = await readBoundedBinary(fileSystem, file.relativePath, 4 * 1024 * 1024);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TARGET_BYTES)
      throw new Error('Target snapshot exceeds the 64 MiB safety limit.');
    records.push(`${file.relativePath}\0${bytes.byteLength}\0${sha256(bytes)}`);
  }
  return sha256(records.join('\n'));
}

function ensureContained(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Browser parity evidence must remain inside the target project.');
  }
}

async function createEvidenceDirectory(
  targetRoot: string,
): Promise<{ relativePath: string; absolutePath: string }> {
  const canonicalRoot = await realpath(resolve(targetRoot));
  const captureId = `${Date.now()}-${randomUUID()}`;
  const relativePath = `${EVIDENCE_ROOT}/${captureId}`;
  const absolutePath = resolve(canonicalRoot, ...relativePath.split('/'));
  ensureContained(canonicalRoot, absolutePath);
  await mkdir(absolutePath, { recursive: true });
  const canonicalEvidence = await realpath(absolutePath);
  if (canonicalEvidence !== absolutePath)
    throw new Error('Browser parity evidence path must not contain symlinks.');
  return { relativePath, absolutePath };
}

function redirectPaths(response: Response | null): readonly string[] {
  if (!response) return [];
  const urls: string[] = [];
  let request = response.request();
  while (request) {
    urls.push(new URL(request.url()).pathname + new URL(request.url()).search);
    const previous = request.redirectedFrom();
    if (!previous) break;
    request = previous;
  }
  return Object.freeze(urls.reverse());
}

async function captureSide(
  context: BrowserContext,
  baseUrl: URL,
  route: string,
  viewport: ReactMigrationParityViewport,
  deadline: number,
  evidenceDirectory: { relativePath: string; absolutePath: string },
  fileStem: string,
): Promise<{ capture: ReactMigrationBrowserSideCapture; png: Buffer }> {
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2_048));
  });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 2_048)));
  page.on('requestfailed', (request) => {
    requestErrors.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`.slice(
        0,
        2_048,
      ),
    );
  });
  const requestedUrl = new URL(route.replace(/^\//u, ''), `${baseUrl.href.replace(/\/*$/u, '/')}`)
    .href;
  let response: Response | null;
  try {
    const timeout = Math.min(NAVIGATION_TIMEOUT_MS, deadline - Date.now());
    if (timeout < 1) throw new Error('Browser parity exceeded its 10-minute session limit.');
    response = await page.goto(requestedUrl, {
      waitUntil: 'networkidle',
      timeout,
    });
  } catch (error) {
    await page.close();
    throw new Error(
      `Navigation failed for ${requestedUrl}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const finalUrl = page.url();
  if (!isLoopbackUrl(finalUrl)) {
    await page.close();
    throw new Error(`Navigation escaped loopback: ${finalUrl}`);
  }
  const dom = await page.evaluate(
    ({ maximumElements, maximumTextBytes }) => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? '').replace(/\s+/gu, ' ').trim();
      const all = [...document.body.querySelectorAll('*')];
      const text = normalize(document.body.innerText);
      const encoder = new TextEncoder();
      if (all.length > maximumElements) throw new Error('DOM element safety limit exceeded.');
      if (encoder.encode(text).byteLength > maximumTextBytes)
        throw new Error('DOM text safety limit exceeded.');
      const localLink = (value: string): string => {
        const url = new URL(value, window.location.href);
        return url.origin === window.location.origin
          ? `${url.pathname}${url.search}`
          : `[external]${url.host}${url.pathname}`;
      };
      return {
        finalPath: `${window.location.pathname}${window.location.search}`,
        title: normalize(document.title),
        text,
        headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
          .slice(0, 512)
          .map((node) => normalize(node.textContent)),
        links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
          .slice(0, 512)
          .map((node) => localLink(node.href))
          .sort(),
        buttons: [...document.querySelectorAll('button,[role="button"]')]
          .slice(0, 512)
          .map((node) => normalize(node.getAttribute('aria-label') || node.textContent)),
        inputs: [...document.querySelectorAll<HTMLInputElement>('input,textarea,select')]
          .slice(0, 512)
          .map((node) => ({
            type: node.getAttribute('type') ?? node.tagName.toLowerCase(),
            name: node.getAttribute('name') ?? '',
            placeholder: node.getAttribute('placeholder') ?? '',
          })),
        landmarks: Object.fromEntries(
          ['header', 'nav', 'main', 'aside', 'footer', 'form', 'section'].map((tag) => [
            tag,
            document.querySelectorAll(tag).length,
          ]),
        ),
        elementCount: all.length,
      };
    },
    { maximumElements: MAX_DOM_ELEMENTS, maximumTextBytes: MAX_DOM_TEXT_BYTES },
  );
  const png = Buffer.from(await page.screenshot({ fullPage: false, animations: 'disabled' }));
  await page.close();
  if (png.byteLength > MAX_SCREENSHOT_BYTES)
    throw new Error(`${requestedUrl} screenshot exceeds 8 MiB.`);
  const screenshotPath = `${evidenceDirectory.relativePath}/${fileStem}.png`;
  await writeFile(join(evidenceDirectory.absolutePath, `${fileStem}.png`), png, { flag: 'wx' });
  return {
    capture: {
      requestedUrl,
      finalUrl,
      status: response?.status() ?? 0,
      redirects: redirectPaths(response),
      dom,
      domSha256: sha256(stableJson(dom)),
      screenshotPath,
      screenshotSha256: sha256(png),
      screenshotBytes: png.byteLength,
      screenshotWidth: viewport.width,
      screenshotHeight: viewport.height,
      consoleErrors: Object.freeze(consoleErrors),
      pageErrors: Object.freeze(pageErrors),
      requestErrors: Object.freeze(requestErrors),
    },
    png,
  };
}

async function comparePixels(
  context: BrowserContext,
  source: Buffer,
  target: Buffer,
): Promise<{ mismatchRatio: number; meanDelta: number }> {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ({ sourceBase64, targetBase64 }) => {
        const load = async (base64: string): Promise<HTMLImageElement> => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          return image;
        };
        const [left, right] = await Promise.all([load(sourceBase64), load(targetBase64)]);
        if (left.width !== right.width || left.height !== right.height) {
          return { mismatchRatio: 1, meanDelta: 1 };
        }
        const canvas = document.createElement('canvas');
        canvas.width = left.width;
        canvas.height = left.height;
        const drawing = canvas.getContext('2d', { willReadFrequently: true });
        if (!drawing) throw new Error('Canvas 2D context is unavailable.');
        drawing.drawImage(left, 0, 0);
        const leftPixels = drawing.getImageData(0, 0, left.width, left.height).data;
        drawing.clearRect(0, 0, left.width, left.height);
        drawing.drawImage(right, 0, 0);
        const rightPixels = drawing.getImageData(0, 0, right.width, right.height).data;
        let mismatched = 0;
        let delta = 0;
        const pixels = left.width * left.height;
        for (let index = 0; index < leftPixels.length; index += 4) {
          const red = Math.abs(leftPixels[index]! - rightPixels[index]!);
          const green = Math.abs(leftPixels[index + 1]! - rightPixels[index + 1]!);
          const blue = Math.abs(leftPixels[index + 2]! - rightPixels[index + 2]!);
          const alpha = Math.abs(leftPixels[index + 3]! - rightPixels[index + 3]!);
          const maximum = Math.max(red, green, blue, alpha);
          if (maximum > 24) mismatched += 1;
          delta += red + green + blue + alpha;
        }
        return {
          mismatchRatio: mismatched / pixels,
          meanDelta: delta / (pixels * 4 * 255),
        };
      },
      { sourceBase64: source.toString('base64'), targetBase64: target.toString('base64') },
    );
  } finally {
    await page.close();
  }
}

interface PlaywrightRuntime {
  chromium: {
    launch(options: { headless: boolean }): Promise<Browser>;
  };
}

async function importPlaywright(): Promise<PlaywrightRuntime> {
  const packageName = 'playwright';
  try {
    return (await import(packageName)) as PlaywrightRuntime;
  } catch (error) {
    throw new Error(
      'Browser parity requires the optional Playwright runtime. Install it with `npm install playwright`, then run `npx playwright install chromium`.',
      { cause: error },
    );
  }
}

function publicManifestHash(
  manifest: Omit<ReactMigrationBrowserParityManifest, 'manifestSha256'>,
): string {
  return sha256(stableJson(manifest));
}

function assertManifestSemantics(manifest: ReactMigrationBrowserParityManifest): void {
  if (
    !Array.isArray(manifest.routes) ||
    manifest.routes.length < 1 ||
    manifest.routes.length > MAX_ROUTES ||
    new Set(manifest.routes).size !== manifest.routes.length ||
    manifest.routes.some((route) => typeof route !== 'string' || normalizeRoute(route) !== route)
  ) {
    throw new Error('Browser parity manifest routes are invalid.');
  }
  const viewports = validateViewports(manifest.viewports);
  if (
    !Array.isArray(manifest.cases) ||
    manifest.cases.length !== manifest.routes.length * viewports.length ||
    manifest.thresholds?.maximumPixelMismatchRatio !== MAX_PIXEL_MISMATCH_RATIO ||
    manifest.thresholds?.maximumMeanPixelDelta !== MAX_MEAN_PIXEL_DELTA ||
    !Number.isSafeInteger(manifest.totalCaptureBytes) ||
    manifest.totalCaptureBytes < 1 ||
    manifest.totalCaptureBytes > MAX_CAPTURE_BYTES ||
    !new RegExp(`^${EVIDENCE_ROOT.replaceAll('/', '\\/')}\\/[0-9]+-[0-9a-f-]+$`, 'u').test(
      manifest.evidenceDirectory,
    )
  ) {
    throw new Error('Browser parity manifest bounds or thresholds are invalid.');
  }
  const cases: readonly ReactMigrationBrowserParityCase[] = manifest.cases;
  const bindings = [manifest.servers?.source, manifest.servers?.target];
  for (const binding of bindings) {
    if (
      !binding ||
      binding.host !== '127.0.0.1' ||
      !Number.isSafeInteger(binding.port) ||
      binding.port < 1 ||
      binding.port > 65_535 ||
      !['pnpm', 'npm', 'yarn', 'bun'].includes(binding.packageManager) ||
      !Array.isArray(binding.command) ||
      binding.command.length < 2 ||
      binding.command.length > 16 ||
      binding.command.some((entry) => typeof entry !== 'string' || entry.length > 512)
    ) {
      throw new Error('Browser parity server binding is invalid.');
    }
    const [expectedExecutable, expectedArgs] = viteCommand(binding.packageManager, binding.port);
    if (stableJson(binding.command) !== stableJson([expectedExecutable, ...expectedArgs])) {
      throw new Error('Browser parity server command is not the canonical engine Vite command.');
    }
  }
  if (
    manifest.servers.source.port === manifest.servers.target.port ||
    manifest.servers.source.cwdKind !== 'temporary-source-copy' ||
    manifest.servers.target.cwdKind !== 'target-root' ||
    typeof manifest.includeInstall !== 'boolean'
  ) {
    throw new Error('Browser parity source and target server identities are invalid.');
  }
  const caseKeys = new Set<string>();
  for (const parityCase of cases) {
    const viewport = viewports.find(
      (candidate) =>
        candidate.name === parityCase.viewport?.name &&
        candidate.width === parityCase.viewport?.width &&
        candidate.height === parityCase.viewport?.height,
    );
    const key = `${parityCase.route}\0${parityCase.viewport?.name ?? ''}`;
    if (!manifest.routes.includes(parityCase.route) || !viewport || caseKeys.has(key)) {
      throw new Error('Browser parity manifest contains an unknown or duplicate case.');
    }
    caseKeys.add(key);
    if (
      !Number.isFinite(parityCase.pixelMismatchRatio) ||
      !Number.isFinite(parityCase.meanPixelDelta) ||
      parityCase.pixelMismatchRatio < 0 ||
      parityCase.pixelMismatchRatio > 1 ||
      parityCase.meanPixelDelta < 0 ||
      parityCase.meanPixelDelta > 1 ||
      !Array.isArray(parityCase.errors)
    ) {
      throw new Error('Browser parity manifest comparison metrics are invalid.');
    }
    for (const [capture, binding] of [
      [parityCase.source, manifest.servers.source],
      [parityCase.target, manifest.servers.target],
    ] as const) {
      const requested = capture ? new URL(capture.requestedUrl) : undefined;
      const final = capture ? new URL(capture.finalUrl) : undefined;
      if (
        !capture ||
        !isLoopbackUrl(capture.requestedUrl) ||
        !isLoopbackUrl(capture.finalUrl) ||
        requested?.hostname !== binding.host ||
        Number(requested.port) !== binding.port ||
        requested.pathname !== parityCase.route ||
        final?.hostname !== binding.host ||
        Number(final.port) !== binding.port ||
        !Number.isSafeInteger(capture.status) ||
        capture.status < 0 ||
        capture.status > 599 ||
        !capture.dom ||
        capture.domSha256 !== sha256(stableJson(capture.dom)) ||
        capture.dom.elementCount < 0 ||
        capture.dom.elementCount > MAX_DOM_ELEMENTS ||
        capture.screenshotWidth !== viewport.width ||
        capture.screenshotHeight !== viewport.height ||
        !Number.isSafeInteger(capture.screenshotBytes) ||
        capture.screenshotBytes < 1 ||
        capture.screenshotBytes > MAX_SCREENSHOT_BYTES ||
        !Array.isArray(capture.consoleErrors) ||
        !Array.isArray(capture.pageErrors) ||
        !Array.isArray(capture.requestErrors) ||
        !Array.isArray(capture.redirects)
      ) {
        throw new Error('Browser parity manifest capture metadata is invalid.');
      }
    }
    const redirectsEqual =
      stableJson(parityCase.source.redirects) === stableJson(parityCase.target.redirects);
    const domEqual = parityCase.source.domSha256 === parityCase.target.domSha256;
    if (parityCase.redirectsEqual !== redirectsEqual || parityCase.domEqual !== domEqual) {
      throw new Error('Browser parity comparison flags are inconsistent with captured evidence.');
    }
    const capturesHealthy = [parityCase.source, parityCase.target].every(
      (capture) =>
        capture.status >= 200 &&
        capture.status < 400 &&
        capture.dom.text.length > 0 &&
        capture.dom.elementCount >= 2 &&
        capture.consoleErrors.length === 0 &&
        capture.pageErrors.length === 0 &&
        capture.requestErrors.length === 0,
    );
    const shouldPass =
      parityCase.errors.length === 0 &&
      capturesHealthy &&
      redirectsEqual &&
      domEqual &&
      parityCase.pixelMismatchRatio <= MAX_PIXEL_MISMATCH_RATIO &&
      parityCase.meanPixelDelta <= MAX_MEAN_PIXEL_DELTA;
    if (parityCase.passed !== shouldPass) {
      throw new Error('Browser parity case pass state is inconsistent with engine thresholds.');
    }
  }
  const shouldPass =
    Array.isArray(manifest.errors) &&
    manifest.errors.length === 0 &&
    cases.every((parityCase) => parityCase.passed);
  if (manifest.passed !== shouldPass) {
    throw new Error('Browser parity manifest pass state is inconsistent with its cases.');
  }
}

async function persistManifest(
  targetRoot: string,
  evidenceDirectory: { relativePath: string; absolutePath: string },
  manifest: ReactMigrationBrowserParityManifest,
): Promise<void> {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(evidenceDirectory.absolutePath, 'manifest.json'), serialized, {
    flag: 'wx',
  });
  const latest = resolve(targetRoot, ...LATEST_MANIFEST_PATH.split('/'));
  ensureContained(resolve(targetRoot), latest);
  const latestDirectory = resolve(latest, '..');
  await mkdir(latestDirectory, { recursive: true });
  if ((await realpath(latestDirectory)) !== latestDirectory) {
    throw new Error('Browser parity manifest path must not contain symlinks.');
  }
  const temporary = `${latest}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, { flag: 'wx' });
  try {
    await rename(temporary, latest);
  } finally {
    await rm(temporary, { force: true });
  }
}

type SupportedPackageManager = ReactMigrationParityServerBinding['packageManager'];

async function packageManagerFor(root: string): Promise<SupportedPackageManager> {
  for (const [lockfile, manager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ] as const) {
    try {
      const metadata = await lstat(join(root, lockfile));
      if (metadata.isFile() && !metadata.isSymbolicLink()) return manager;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  try {
    const fileSystem = await SrijikaProjectFileSystem.open(root);
    const packageJson = JSON.parse(
      (await fileSystem.readText('package.json', 1024 * 1024)).source,
    ) as {
      packageManager?: unknown;
    };
    if (typeof packageJson.packageManager === 'string') {
      const declared = packageJson.packageManager.split('@', 1)[0];
      if (declared && ['pnpm', 'npm', 'yarn', 'bun'].includes(declared)) {
        return declared as SupportedPackageManager;
      }
    }
  } catch {
    // A missing declaration falls through to npm; malformed project metadata fails at migration scan.
  }
  return 'npm';
}

function installCommand(
  manager: SupportedPackageManager,
  hasLockfile: boolean,
  includeInstall: boolean,
): readonly [string, readonly string[]] {
  const offline = includeInstall ? [] : ['--offline'];
  if (manager === 'pnpm') {
    return [
      'pnpm',
      ['install', ...(hasLockfile ? ['--frozen-lockfile'] : []), '--ignore-scripts', ...offline],
    ];
  }
  if (manager === 'npm') {
    return [
      'npm',
      [
        hasLockfile ? 'ci' : 'install',
        '--ignore-scripts',
        ...(hasLockfile ? [] : ['--package-lock=false']),
        ...offline,
      ],
    ];
  }
  if (manager === 'yarn') {
    return [
      'yarn',
      ['install', ...(hasLockfile ? ['--immutable'] : []), '--mode=skip-build', ...offline],
    ];
  }
  return [
    'bun',
    ['install', ...(hasLockfile ? ['--frozen-lockfile'] : []), '--ignore-scripts', ...offline],
  ];
}

function parityProcessEnvironment(): NodeJS.ProcessEnv {
  const userLocalBin = process.env['HOME'] ? join(process.env['HOME'], '.local', 'bin') : undefined;
  return {
    ...process.env,
    ...(userLocalBin
      ? {
          PATH: [userLocalBin, process.env['PATH']]
            .filter((value): value is string => Boolean(value))
            .join(delimiter),
        }
      : {}),
    CI: '1',
    BROWSER: 'none',
    NO_UPDATE_NOTIFIER: '1',
  };
}

async function runBoundedCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      env: parityProcessEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      if (output.length < 64 * 1024)
        output += chunk.toString('utf8').slice(0, 64 * 1024 - output.length);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`${executable} exceeded its bounded install timeout.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectPromise(new Error(`Could not start ${executable}.`, { cause: error }));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new Error(
            `${executable} ${args.join(' ')} failed (${code ?? signal ?? 'unknown'}): ${output.trim()}`,
          ),
        );
    });
  });
}

async function ensureRuntimeDependencies(
  root: string,
  includeInstall: boolean,
): Promise<SupportedPackageManager> {
  const manager = await packageManagerFor(root);
  try {
    const modules = await lstat(join(root, 'node_modules'));
    if (modules.isDirectory() && !modules.isSymbolicLink()) return manager;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const lockNames: Readonly<Record<SupportedPackageManager, readonly string[]>> = {
    pnpm: ['pnpm-lock.yaml'],
    npm: ['package-lock.json'],
    yarn: ['yarn.lock'],
    bun: ['bun.lock', 'bun.lockb'],
  };
  const hasLockfile = (
    await Promise.all(
      lockNames[manager].map(async (name) => {
        try {
          return (await lstat(join(root, name))).isFile();
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
          throw error;
        }
      }),
    )
  ).some(Boolean);
  const [executable, args] = installCommand(manager, hasLockfile, includeInstall);
  try {
    await runBoundedCommand(executable, args, root, 5 * 60_000);
  } catch (error) {
    if (!includeInstall) {
      throw new Error(
        'Offline dependency hydration failed. Retry browser parity with includeInstall enabled to permit package downloads.',
        { cause: error },
      );
    }
    throw error;
  }
  return manager;
}

async function createVerifiedSourceRuntimeCopy(
  target: string,
): Promise<{ root: string; sourceSnapshotSha256: string }> {
  const session = await getReactMigrationStatus(target);
  if (
    session.inventory.packageDependencyRecords.some((dependency) => dependency.unsafeLocalReference)
  ) {
    throw new Error(
      'Browser parity cannot execute a source with unsafe local or workspace package references.',
    );
  }
  const sourceFileSystem = await SrijikaProjectFileSystem.open(session.sourceRoot);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'srijika-react-parity-source-'));
  try {
    for (const file of session.inventory.files) {
      const bytes = await readBoundedBinary(sourceFileSystem, file.relativePath, 4 * 1024 * 1024);
      const destination = join(temporaryRoot, ...file.relativePath.split('/'));
      await mkdir(resolve(destination, '..'), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    const copied = await scanReactMigrationSource(temporaryRoot);
    if (copied.snapshotSha256 !== session.inventory.snapshotSha256) {
      throw new Error(
        'Temporary source runtime copy does not match the migration source snapshot.',
      );
    }
    return { root: temporaryRoot, sourceSnapshotSha256: copied.snapshotSha256 };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function allocateLoopbackPort(excluded?: number): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = await new Promise<number>((resolvePromise, rejectPromise) => {
      const server = createServer();
      server.once('error', rejectPromise);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          rejectPromise(new Error('Could not allocate a loopback parity port.'));
          return;
        }
        server.close((error) => (error ? rejectPromise(error) : resolvePromise(address.port)));
      });
    });
    if (port !== excluded) return port;
  }
  throw new Error('Could not allocate distinct source and target parity ports.');
}

function viteCommand(
  manager: SupportedPackageManager,
  port: number,
): readonly [string, readonly string[]] {
  const viteArgs = ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  if (manager === 'pnpm') return ['pnpm', ['exec', ...viteArgs]];
  if (manager === 'npm') return ['npx', ['--no-install', ...viteArgs]];
  if (manager === 'yarn') return ['yarn', ['exec', ...viteArgs]];
  return ['bunx', ['--no-install', ...viteArgs]];
}

interface RunningParityServer {
  child: ChildProcess;
  binding: ReactMigrationParityServerBinding;
  baseUrl: URL;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
}

function launchParityServer(
  root: string,
  manager: SupportedPackageManager,
  port: number,
  cwdKind: ReactMigrationParityServerBinding['cwdKind'],
): RunningParityServer {
  const [executable, args] = viteCommand(manager, port);
  const child = spawn(executable, args, {
    cwd: root,
    detached: process.platform !== 'win32',
    env: parityProcessEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let capturedOutput = '';
  const append = (chunk: Buffer): void => {
    if (capturedOutput.length < 64 * 1024)
      capturedOutput += chunk.toString('utf8').slice(0, 64 * 1024 - capturedOutput.length);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise);
      child.once('exit', (code, signal) => resolvePromise({ code, signal }));
    },
  );
  return {
    child,
    binding: {
      host: '127.0.0.1',
      port,
      packageManager: manager,
      command: Object.freeze([executable, ...args]),
      cwdKind,
    },
    baseUrl: new URL(`http://127.0.0.1:${port}/`),
    exited,
    output: () => capturedOutput,
  };
}

async function waitForParityServer(server: RunningParityServer): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const outcome = await Promise.race([
      server.exited.then((exit) => ({ kind: 'exit' as const, exit })),
      fetch(server.baseUrl, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })
        .then((response) => ({ kind: 'response' as const, response }))
        .catch(() => ({ kind: 'retry' as const })),
    ]);
    if (outcome.kind === 'response' && outcome.response.status < 500) return;
    if (outcome.kind === 'exit') {
      throw new Error(
        `Parity server exited before becoming healthy (${outcome.exit.code ?? outcome.exit.signal ?? 'unknown'}): ${server.output().trim()}`,
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(
    `Parity server did not become healthy within 30 seconds: ${server.output().trim()}`,
  );
}

async function stopParityServer(server: RunningParityServer | undefined): Promise<void> {
  if (!server?.child.pid || server.child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn('taskkill', ['/PID', String(server.child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => resolvePromise());
      killer.once('exit', () => resolvePromise());
    });
    return;
  }
  try {
    process.kill(-server.child.pid, 'SIGTERM');
  } catch {
    return;
  }
  const stopped = await Promise.race([
    server.exited.then(() => true),
    new Promise<false>((resolvePromise) => setTimeout(() => resolvePromise(false), 5_000)),
  ]);
  if (!stopped) {
    try {
      process.kill(-server.child.pid, 'SIGKILL');
    } catch {
      // The server exited between the bounded waits.
    }
    await Promise.race([
      server.exited.catch(() => undefined),
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
    ]);
  }
}

/** Captures parity from engine-launched source-copy and target runtimes. */
export async function captureReactMigrationBrowserParity(
  request: CaptureReactMigrationBrowserParityRequest,
): Promise<ReactMigrationBrowserParityManifest> {
  const session = await getReactMigrationStatus(request.target);
  const routes = await deriveEngineRoutes(request.target);
  const viewports = validateViewports(undefined);
  const beforeSource = await scanReactMigrationSource(session.sourceRoot);
  if (beforeSource.snapshotSha256 !== session.inventory.snapshotSha256) {
    throw new Error('React source changed after the migration session was created.');
  }
  const targetSnapshotSha256 = await currentTargetSnapshot(session.targetRoot);
  const playwright = await importPlaywright();
  const temporarySource = await createVerifiedSourceRuntimeCopy(session.targetRoot);
  const includeInstall = request.includeInstall === true;
  let sourceServer: RunningParityServer | undefined;
  let targetServer: RunningParityServer | undefined;
  let browser: Browser | undefined;
  let evidenceDirectory: { relativePath: string; absolutePath: string } | undefined;
  try {
    const sourceManager = await ensureRuntimeDependencies(temporarySource.root, includeInstall);
    const targetManager = await ensureRuntimeDependencies(session.targetRoot, includeInstall);
    const sourcePort = await allocateLoopbackPort();
    const targetPort = await allocateLoopbackPort(sourcePort);
    sourceServer = launchParityServer(
      temporarySource.root,
      sourceManager,
      sourcePort,
      'temporary-source-copy',
    );
    targetServer = launchParityServer(session.targetRoot, targetManager, targetPort, 'target-root');
    await Promise.all([waitForParityServer(sourceServer), waitForParityServer(targetServer)]);
    evidenceDirectory = await createEvidenceDirectory(session.targetRoot);
    browser = await playwright.chromium.launch({ headless: true });
    const cases: ReactMigrationBrowserParityCase[] = [];
    const manifestErrors: string[] = [];
    let totalCaptureBytes = 0;
    const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
    for (const route of routes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          serviceWorkers: 'block',
        });
        await context.route('**/*', async (intercepted) => {
          const requestUrl = intercepted.request().url();
          if (!isLoopbackUrl(requestUrl) && !/^(?:data|blob):/u.test(requestUrl)) {
            await intercepted.abort('blockedbyclient');
            return;
          }
          await intercepted.continue();
        });
        try {
          const token = sha256(`${route}\0${viewport.name}`).slice(0, 16);
          const source = await captureSide(
            context,
            sourceServer.baseUrl,
            route,
            viewport,
            deadline,
            evidenceDirectory,
            `${token}.source`,
          );
          const target = await captureSide(
            context,
            targetServer.baseUrl,
            route,
            viewport,
            deadline,
            evidenceDirectory,
            `${token}.target`,
          );
          totalCaptureBytes += source.png.byteLength + target.png.byteLength;
          if (totalCaptureBytes > MAX_CAPTURE_BYTES)
            throw new Error('Browser captures exceed the 64 MiB session limit.');
          const pixels = await comparePixels(context, source.png, target.png);
          const redirectsEqual =
            stableJson(source.capture.redirects) === stableJson(target.capture.redirects);
          const domEqual = source.capture.domSha256 === target.capture.domSha256;
          const errors: string[] = [];
          for (const [side, capture] of [
            ['source', source.capture],
            ['target', target.capture],
          ] as const) {
            if (capture.status < 200 || capture.status >= 400)
              errors.push(`${side} returned HTTP ${capture.status}.`);
            if (!capture.dom.text || capture.dom.elementCount < 2)
              errors.push(`${side} rendered empty or root-only content.`);
            if (capture.consoleErrors.length > 0)
              errors.push(`${side} emitted console errors: ${capture.consoleErrors.join(' | ')}`);
            if (capture.pageErrors.length > 0)
              errors.push(`${side} emitted page errors: ${capture.pageErrors.join(' | ')}`);
            if (capture.requestErrors.length > 0)
              errors.push(`${side} emitted request errors: ${capture.requestErrors.join(' | ')}`);
          }
          if (!redirectsEqual) errors.push('Source and target redirect chains differ.');
          if (!domEqual) errors.push('Source and target semantic DOM traces differ.');
          if (pixels.mismatchRatio > MAX_PIXEL_MISMATCH_RATIO)
            errors.push(
              `Pixel mismatch ratio ${pixels.mismatchRatio.toFixed(6)} exceeds ${MAX_PIXEL_MISMATCH_RATIO}.`,
            );
          if (pixels.meanDelta > MAX_MEAN_PIXEL_DELTA)
            errors.push(
              `Mean pixel delta ${pixels.meanDelta.toFixed(6)} exceeds ${MAX_MEAN_PIXEL_DELTA}.`,
            );
          cases.push({
            route,
            viewport,
            source: source.capture,
            target: target.capture,
            redirectsEqual,
            domEqual,
            pixelMismatchRatio: pixels.mismatchRatio,
            meanPixelDelta: pixels.meanDelta,
            passed: errors.length === 0,
            errors: Object.freeze(errors),
          });
        } finally {
          await context.close();
        }
      }
    }
    const afterSource = await scanReactMigrationSource(session.sourceRoot);
    if (afterSource.snapshotSha256 !== beforeSource.snapshotSha256) {
      manifestErrors.push('React source changed during browser parity capture.');
    }
    const afterTargetSnapshotSha256 = await currentTargetSnapshot(session.targetRoot);
    if (afterTargetSnapshotSha256 !== targetSnapshotSha256) {
      manifestErrors.push('Converted target changed during browser parity capture.');
    }
    for (const parityCase of cases) {
      for (const error of parityCase.errors) {
        manifestErrors.push(`${parityCase.route} at ${parityCase.viewport.name}: ${error}`);
      }
    }
    const withoutHash: Omit<ReactMigrationBrowserParityManifest, 'manifestSha256'> = {
      schema: 'srijika-react-browser-parity-v1',
      capturedAt: new Date().toISOString(),
      sourceRoot: session.sourceRoot,
      targetRoot: session.targetRoot,
      sourceSnapshotSha256: beforeSource.snapshotSha256,
      targetSnapshotSha256,
      includeInstall,
      servers: {
        source: sourceServer.binding,
        target: targetServer.binding,
      },
      routes,
      viewports,
      cases: Object.freeze(cases),
      thresholds: {
        maximumPixelMismatchRatio: MAX_PIXEL_MISMATCH_RATIO,
        maximumMeanPixelDelta: MAX_MEAN_PIXEL_DELTA,
      },
      totalCaptureBytes,
      evidenceDirectory: evidenceDirectory.relativePath,
      errors: Object.freeze(manifestErrors),
      passed:
        manifestErrors.length === 0 &&
        cases.length === routes.length * viewports.length &&
        cases.every((entry) => entry.passed),
    };
    const manifest = Object.freeze({
      ...withoutHash,
      manifestSha256: publicManifestHash(withoutHash),
    });
    await persistManifest(session.targetRoot, evidenceDirectory, manifest);
    return manifest;
  } catch (error) {
    if (evidenceDirectory)
      await rm(evidenceDirectory.absolutePath, { recursive: true, force: true });
    if (
      error instanceof Error &&
      /browserType\.launch|executable doesn't exist|Failed to launch/iu.test(error.message)
    ) {
      throw new Error(
        'Chromium could not start for browser parity. Run `npx playwright install chromium` and retry.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await Promise.allSettled([
      ...(browser ? [browser.close()] : []),
      stopParityServer(targetServer),
      stopParityServer(sourceServer),
    ]);
    await rm(temporarySource.root, { recursive: true, force: true });
  }
}

/** Revalidates engine-written parity evidence against current source, target, and artifact bytes. */
export async function loadReactMigrationBrowserParity(
  target: string,
): Promise<ReactMigrationBrowserParityManifest> {
  const session = await getReactMigrationStatus(target);
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const serialized = await fileSystem.readText(LATEST_MANIFEST_PATH, 4 * 1024 * 1024);
  const manifest = JSON.parse(serialized.source) as ReactMigrationBrowserParityManifest;
  if (manifest.schema !== 'srijika-react-browser-parity-v1')
    throw new Error('Unsupported browser parity manifest schema.');
  const { manifestSha256, ...withoutHash } = manifest;
  if (publicManifestHash(withoutHash) !== manifestSha256)
    throw new Error('Browser parity manifest hash is invalid.');
  assertManifestSemantics(manifest);
  if (
    manifest.sourceRoot !== session.sourceRoot ||
    manifest.targetRoot !== session.targetRoot ||
    manifest.sourceSnapshotSha256 !== session.inventory.snapshotSha256 ||
    manifest.targetSnapshotSha256 !== (await currentTargetSnapshot(session.targetRoot))
  ) {
    throw new Error('Browser parity manifest is stale for the current migration source or target.');
  }
  let captureBytes = 0;
  for (const parityCase of manifest.cases) {
    for (const capture of [parityCase.source, parityCase.target]) {
      if (!capture.screenshotPath.startsWith(`${manifest.evidenceDirectory}/`)) {
        throw new Error('Browser parity artifact escaped its engine evidence directory.');
      }
      const bytes = await readBoundedBinary(
        fileSystem,
        capture.screenshotPath,
        MAX_SCREENSHOT_BYTES,
      );
      captureBytes += bytes.byteLength;
      if (
        bytes.byteLength !== capture.screenshotBytes ||
        sha256(bytes) !== capture.screenshotSha256 ||
        bytes.byteLength < 24 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.readUInt32BE(16) !== capture.screenshotWidth ||
        bytes.readUInt32BE(20) !== capture.screenshotHeight
      ) {
        throw new Error(
          `Browser parity artifact ${capture.screenshotPath} failed integrity verification.`,
        );
      }
    }
  }
  if (captureBytes !== manifest.totalCaptureBytes || captureBytes > MAX_CAPTURE_BYTES) {
    throw new Error('Browser parity artifact byte total is invalid.');
  }
  return Object.freeze(manifest);
}
