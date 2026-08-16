import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const SELECT_MESSAGE = 'srijika:preview-select';
const SELECTED_MESSAGE = 'srijika:preview-selected-source';
const RUNTIME_STATE_MESSAGE = 'srijika:preview-runtime-state';
const HIT_TEST_MESSAGE = 'srijika:preview-hit-test';
const DROP_TARGET_MESSAGE = 'srijika:preview-drop-target';
const SOURCE_MARKER_PATTERN = /^(.+):(\d+):(\d+)$/;

export type LivePreviewRuntimeStateKind =
  'connecting' | 'loading' | 'ready' | 'error' | 'unsupported';

export interface LivePreviewRuntimeState {
  state: LivePreviewRuntimeStateKind;
  uiSource: string | null;
  error?: string;
}

export interface LivePreviewSourceLocation {
  relativePath: string;
  line: number;
  column: number;
  marker: string;
}

export interface LiveCodeProjectFrameProps {
  url: string;
  selectedSource: string | null;
  uiSuffix: string;
  allowedUiSources: readonly string[];
  onSelectSource: (location: LivePreviewSourceLocation) => void;
  onRuntimeState: (state: LivePreviewRuntimeState) => void;
  dragActive?: boolean;
  onDropComponent?: (componentId: string, targetSource: string | null) => void;
}

interface LivePreviewSourcePolicy {
  uiSuffix: string;
  allowedUiSources: ReadonlySet<string>;
}

function isNormalizedUiSource(value: string, policy: LivePreviewSourcePolicy): boolean {
  if (
    !value ||
    !policy.uiSuffix.startsWith('.') ||
    !policy.uiSuffix.endsWith('.tsx') ||
    policy.uiSuffix.endsWith('.d.tsx') ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    !value.endsWith(policy.uiSuffix)
  ) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length <= 32 &&
    segments.every(
      (segment) =>
        Boolean(segment) &&
        segment !== '.' &&
        segment !== '..' &&
        /^[A-Za-z0-9_. -]+$/.test(segment),
    ) &&
    policy.allowedUiSources.has(value)
  );
}

function parsedSourceLocation(
  source: string,
  policy: LivePreviewSourcePolicy,
): LivePreviewSourceLocation | null {
  const match = SOURCE_MARKER_PATTERN.exec(source);
  if (!match || !isNormalizedUiSource(match[1]!, policy)) return null;
  const line = Number(match[2]);
  const column = Number(match[3]);
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    return null;
  }
  return { relativePath: match[1]!, line, column, marker: source };
}

function selectedUiSource(source: string | null, policy: LivePreviewSourcePolicy): string | null {
  if (source === null) return null;
  if (isNormalizedUiSource(source, policy)) return source;
  return parsedSourceLocation(source, policy)?.relativePath ?? null;
}

function runtimeState(
  value: unknown,
  policy: LivePreviewSourcePolicy,
): LivePreviewRuntimeState | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as {
    type?: unknown;
    version?: unknown;
    state?: unknown;
    uiSource?: unknown;
    error?: unknown;
  };
  if (
    message.type !== RUNTIME_STATE_MESSAGE ||
    message.version !== 1 ||
    (message.state !== 'loading' && message.state !== 'ready' && message.state !== 'error') ||
    typeof message.uiSource !== 'string' ||
    !isNormalizedUiSource(message.uiSource, policy) ||
    (message.error !== undefined && typeof message.error !== 'string')
  ) {
    return null;
  }
  return {
    state: message.state,
    uiSource: message.uiSource,
    ...(message.error ? { error: message.error } : {}),
  };
}

function sourceLocation(
  value: unknown,
  policy: LivePreviewSourcePolicy,
): LivePreviewSourceLocation | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as { type?: unknown; version?: unknown; source?: unknown };
  if (
    message.type !== SELECT_MESSAGE ||
    message.version !== 1 ||
    typeof message.source !== 'string'
  ) {
    return null;
  }
  return parsedSourceLocation(message.source, policy);
}

export function LiveCodeProjectFrame({
  url,
  selectedSource,
  uiSuffix,
  allowedUiSources,
  onSelectSource,
  onRuntimeState,
  dragActive = false,
  onDropComponent,
}: LiveCodeProjectFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runtimeTimeoutRef = useRef<number | null>(null);
  const origin = useMemo(() => new URL(url).origin, [url]);
  const sourcePolicy = useMemo<LivePreviewSourcePolicy>(
    () => ({ uiSuffix, allowedUiSources: new Set(allowedUiSources) }),
    [allowedUiSources, uiSuffix],
  );
  const selectedUiSourcePath = selectedUiSource(selectedSource, sourcePolicy);
  const [dropTargetSource, setDropTargetSource] = useState<string | null>(null);

  const publishSelection = useCallback((): void => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: SELECTED_MESSAGE,
        version: 1,
        source: selectedSource,
        uiSource: selectedUiSourcePath,
      },
      origin,
    );
  }, [origin, selectedSource, selectedUiSourcePath]);

  useLayoutEffect(() => {
    const receiveSelection = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== origin) return;
      const location = sourceLocation(event.data, sourcePolicy);
      if (location) onSelectSource(location);
      const nextRuntimeState = runtimeState(event.data, sourcePolicy);
      if (nextRuntimeState && nextRuntimeState.uiSource === selectedUiSourcePath) {
        if (runtimeTimeoutRef.current !== null) {
          window.clearTimeout(runtimeTimeoutRef.current);
          runtimeTimeoutRef.current = null;
        }
        onRuntimeState(nextRuntimeState);
      }
      const message = event.data as { type?: unknown; version?: unknown; source?: unknown };
      if (
        message?.type === DROP_TARGET_MESSAGE &&
        message.version === 1 &&
        (typeof message.source === 'string' || message.source === null)
      ) {
        if (message.source === null || parsedSourceLocation(message.source, sourcePolicy)) {
          setDropTargetSource(message.source);
        }
      }
    };
    window.addEventListener('message', receiveSelection);
    return () => window.removeEventListener('message', receiveSelection);
  }, [onRuntimeState, onSelectSource, origin, selectedUiSourcePath, sourcePolicy]);

  useEffect(() => {
    if (runtimeTimeoutRef.current !== null) {
      window.clearTimeout(runtimeTimeoutRef.current);
      runtimeTimeoutRef.current = null;
    }
    publishSelection();
    if (selectedUiSourcePath === null) return;
    onRuntimeState({ state: 'connecting', uiSource: selectedUiSourcePath });
    runtimeTimeoutRef.current = window.setTimeout(() => {
      runtimeTimeoutRef.current = null;
      onRuntimeState({
        state: 'unsupported',
        uiSource: selectedUiSourcePath,
        error: 'The running project did not acknowledge live Connector selection.',
      });
    }, 5_000);
    return () => {
      if (runtimeTimeoutRef.current !== null) {
        window.clearTimeout(runtimeTimeoutRef.current);
        runtimeTimeoutRef.current = null;
      }
    };
  }, [onRuntimeState, publishSelection, selectedUiSourcePath]);

  return (
    <div className="code-first-preview-stage" data-preview-runtime="managed-project">
      <iframe
        ref={iframeRef}
        className="code-first-preview-frame"
        title="Live Srijika project preview"
        src={url}
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        onLoad={publishSelection}
      />
      {dragActive && onDropComponent && (
        <div
          className="code-first-live-drop-overlay"
          role="region"
          aria-label="Drop component into live preview"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('application/x-srijika-component')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            const rectangle = event.currentTarget.getBoundingClientRect();
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: HIT_TEST_MESSAGE,
                version: 1,
                x: event.clientX - rectangle.left,
                y: event.clientY - rectangle.top,
              },
              origin,
            );
          }}
          onDrop={(event) => {
            const componentId = event.dataTransfer.getData('application/x-srijika-component');
            if (!componentId) return;
            event.preventDefault();
            onDropComponent(componentId, dropTargetSource ?? selectedSource);
            setDropTargetSource(null);
          }}
        >
          <span>
            {dropTargetSource ? 'Drop into highlighted UI area' : 'Drop into selected UI area'}
          </span>
        </div>
      )}
    </div>
  );
}
