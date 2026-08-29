import type { SrijikaProjectFileMap } from './types.js';

export const SRIJIKA_NEXT_LIVE_PREVIEW_VERSION = 'srijika-next-live-preview-v1' as const;

const sourceFile = (source: string): string => `${source.trim()}\n`;

export function createSrijikaNextLivePreviewFileMap(
  appRoot: 'app' | 'src/app',
): SrijikaProjectFileMap {
  const instrumentationPath =
    appRoot === 'src/app' ? 'src/instrumentation-client.ts' : 'instrumentation-client.ts';
  return Object.freeze({
    'src/srijika/next-preview-loader.cjs': sourceFile(String.raw`
// @srijika-next-live-preview-v1
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

module.exports = function srijikaNextPreviewLoader(source) {
  if (process.env.NODE_ENV !== 'development') return source;
  const root = this.rootContext;
  const resource = path.resolve(this.resourcePath);
  const relativePath = path.relative(root, resource).replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) return source;
  const config = JSON.parse(fs.readFileSync(path.join(root, 'srijika.config.json'), 'utf8'));
  const architecture = config.architecture ?? {};
  const roots = [architecture.featuresRoot ?? 'src/features', architecture.sharedRoot ?? 'src/shared'];
  const suffix = architecture.uiSuffix ?? '.ui.tsx';
  if (
    !relativePath.endsWith(suffix) ||
    (relativePath !== config.entry && !roots.some((ownerRoot) => relativePath.startsWith(ownerRoot + '/')))
  ) return source;
  const sourceFile = ts.createSourceFile(resource, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const insertions = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const existing = node.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'data-srijika-source',
      );
      if (!existing) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        insertions.push({
          offset: node.tagName.end,
          text: ' data-srijika-source="' + relativePath + ':' + (location.line + 1) + ':' + (location.character + 1) + '"',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return insertions
    .sort((left, right) => right.offset - left.offset)
    .reduce((result, insertion) => result.slice(0, insertion.offset) + insertion.text + result.slice(insertion.offset), source);
};
`),
    [instrumentationPath]: sourceFile(String.raw`
// @srijika-next-live-preview-v1
const SOURCE_ATTRIBUTE = 'data-srijika-source';
const SELECT_MESSAGE = 'srijika:preview-select';
const SELECTED_MESSAGE = 'srijika:preview-selected-source';
const RUNTIME_STATE_MESSAGE = 'srijika:preview-runtime-state';
const HIT_TEST_MESSAGE = 'srijika:preview-hit-test';
const DROP_TARGET_MESSAGE = 'srijika:preview-drop-target';

if (process.env.NODE_ENV === 'development' && window.parent !== window) {
  let selected: string | null = null;
  const send = (message: Record<string, unknown>) => window.parent.postMessage(message, '*');
  const markerElement = (marker: string | null) => {
    if (!marker) return null;
    return [...document.querySelectorAll<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']')].find(
      (element) => element.dataset['srijikaSource'] === marker || element.dataset['srijikaSource']?.startsWith(marker + ':'),
    ) ?? null;
  };
  const highlight = () => {
    document.querySelectorAll<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']').forEach((element) => {
      element.style.removeProperty('outline');
      element.style.removeProperty('outline-offset');
    });
    const element = markerElement(selected);
    if (element) {
      element.style.outline = '2px solid #7c6cff';
      element.style.outlineOffset = '2px';
    }
    return element;
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null) return;
    const message = event.data as Record<string, unknown>;
    if (message['version'] !== 1) return;
    if (message['type'] === SELECTED_MESSAGE && (typeof message['uiSource'] === 'string' || message['uiSource'] === null)) {
      selected = message['uiSource'];
      send({
        type: RUNTIME_STATE_MESSAGE,
        version: 1,
        state: selected && !highlight() ? 'error' : 'ready',
        uiSource: selected,
        ...(selected && !markerElement(selected) ? { error: 'The selected UI is not rendered by this Next route.' } : {}),
      });
    }
    const x = message['x'];
    const y = message['y'];
    if (message['type'] === HIT_TEST_MESSAGE && typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']');
      send({ type: DROP_TARGET_MESSAGE, version: 1, source: element?.dataset['srijikaSource'] ?? null });
    }
  });
  document.addEventListener('click', (event) => {
    const element = (event.target as Element | null)?.closest<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']');
    const source = element?.dataset['srijikaSource'];
    if (source) send({ type: SELECT_MESSAGE, version: 1, source });
  }, true);
}
`),
  });
}
