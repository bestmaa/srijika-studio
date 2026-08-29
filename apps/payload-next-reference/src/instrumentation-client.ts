// @srijika-next-live-preview-v1
declare const process: { readonly env: { readonly NODE_ENV?: string } };

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
    return (
      [...document.querySelectorAll<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`)].find(
        (element) =>
          element.dataset['srijikaSource'] === marker ||
          element.dataset['srijikaSource']?.startsWith(`${marker}:`),
      ) ?? null
    );
  };
  const highlight = () => {
    document.querySelectorAll<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`).forEach((element) => {
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
    if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null)
      return;
    const message = event.data as Record<string, unknown>;
    if (message['version'] !== 1) return;
    if (
      message['type'] === SELECTED_MESSAGE &&
      (typeof message['uiSource'] === 'string' || message['uiSource'] === null)
    ) {
      selected = message['uiSource'];
      const rendered = highlight();
      send({
        type: RUNTIME_STATE_MESSAGE,
        version: 1,
        state: selected && !rendered ? 'error' : 'ready',
        uiSource: selected,
        ...(selected && !rendered
          ? { error: 'The selected UI is not rendered by this Next route.' }
          : {}),
      });
    }
    const x = message['x'];
    const y = message['y'];
    if (
      message['type'] === HIT_TEST_MESSAGE &&
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y)
    ) {
      const element = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`);
      send({
        type: DROP_TARGET_MESSAGE,
        version: 1,
        source: element?.dataset['srijikaSource'] ?? null,
      });
    }
  });
  document.addEventListener(
    'click',
    (event) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>(
        `[${SOURCE_ATTRIBUTE}]`,
      );
      const source = element?.dataset['srijikaSource'];
      if (source) send({ type: SELECT_MESSAGE, version: 1, source });
    },
    true,
  );
}
