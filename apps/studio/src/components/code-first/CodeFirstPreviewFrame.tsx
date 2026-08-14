import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { UiDocument } from '@srijika/contracts';
import coreComponentsCss from '@srijika/core-components/styles.css?inline';
import { SrijikaRenderer } from '@srijika/react-renderer';

import type {
  CodeProjectPreviewAsset,
  CodeProjectPreviewStylesheet,
} from '../../lib/project-service';
import { componentRegistry } from '../../lib/registry';

const PREVIEW_FRAME_SOURCE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'unsafe-inline'">
    <style id="srijika-core-styles"></style>
    <style id="srijika-project-styles"></style>
    <style id="srijika-editor-styles"></style>
  </head>
  <body>
    <div id="srijika-code-preview-root"></div>
  </body>
</html>`;

const EDITOR_CSS = `
html,
body,
#srijika-code-preview-root {
  min-height: 100%;
}

html {
  background: #f7f8fb;
}

body {
  margin: 0;
}

[data-srijika-selected='true'] {
  outline: 2px solid #6366f1 !important;
  outline-offset: 2px;
}
`;

export interface CodeFirstPreviewFrameProps {
  document: UiDocument;
  selectedNodeId: string;
  stylesheets: readonly CodeProjectPreviewStylesheet[];
  assets: readonly CodeProjectPreviewAsset[];
  symbols: Readonly<Record<string, unknown>>;
  stale: boolean;
  onSelectNode: (nodeId: string) => void;
}

function combinedProjectCss(stylesheets: readonly CodeProjectPreviewStylesheet[]): string {
  return stylesheets
    .map(
      (stylesheet) =>
        `/* Srijika preview source: ${stylesheet.relativePath.replaceAll('*/', '* /')} */\n${stylesheet.source}`,
    )
    .join('\n\n');
}

export function CodeFirstPreviewFrame({
  document,
  selectedNodeId,
  stylesheets,
  assets,
  symbols,
  stale,
  onSelectNode,
}: CodeFirstPreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const projectCss = useMemo(() => combinedProjectCss(stylesheets), [stylesheets]);
  const assetUrls = useMemo(
    () =>
      new Map(
        assets.map((asset) => [
          asset.publicPath,
          `data:${asset.mediaType};charset=utf-8,${encodeURIComponent(asset.source)}`,
        ]),
      ),
    [assets],
  );

  useLayoutEffect(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return;
    frameDocument.open();
    frameDocument.write(PREVIEW_FRAME_SOURCE);
    frameDocument.close();
    const coreStyle = frameDocument.getElementById('srijika-core-styles');
    const editorStyle = frameDocument.getElementById('srijika-editor-styles');
    if (coreStyle) coreStyle.textContent = coreComponentsCss;
    if (editorStyle) editorStyle.textContent = EDITOR_CSS;
    setPortalRoot(frameDocument.getElementById('srijika-code-preview-root'));
  }, []);

  useLayoutEffect(() => {
    const projectStyle =
      iframeRef.current?.contentDocument?.getElementById('srijika-project-styles');
    if (projectStyle) projectStyle.textContent = projectCss;
  }, [projectCss]);

  useLayoutEffect(() => {
    if (!portalRoot) return;
    const applyAssetUrls = (): void => {
      for (const image of portalRoot.querySelectorAll<HTMLImageElement>('img[src]')) {
        const publicPath = image.dataset['srijikaPreviewPublicPath'] ?? image.getAttribute('src');
        if (!publicPath) continue;
        const assetUrl = assetUrls.get(publicPath);
        if (!assetUrl || image.getAttribute('src') === assetUrl) continue;
        image.dataset['srijikaPreviewPublicPath'] = publicPath;
        image.setAttribute('src', assetUrl);
      }
    };
    applyAssetUrls();
    const observer = new MutationObserver(applyAssetUrls);
    observer.observe(portalRoot, {
      attributes: true,
      attributeFilter: ['src'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [assetUrls, portalRoot]);

  return (
    <div
      className={`code-first-preview-stage${stale ? ' is-stale' : ''}`}
      data-preview-stylesheets={stylesheets.map((stylesheet) => stylesheet.relativePath).join(',')}
    >
      <iframe
        ref={iframeRef}
        className="code-first-preview-frame"
        title="Styled Srijika UI preview"
        sandbox="allow-same-origin"
      />
      {portalRoot &&
        createPortal(
          <SrijikaRenderer
            document={document}
            registry={componentRegistry}
            mode="edit"
            selectedNodeId={selectedNodeId}
            symbols={symbols}
            viewportWidth={900}
            onSelectNode={onSelectNode}
          />,
          portalRoot,
        )}
    </div>
  );
}
