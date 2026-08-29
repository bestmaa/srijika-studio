import type { SrijikaProjectArchitectureGraphModel } from './project-architecture-graph';

export interface SrijikaProjectArchitectureWebviewModel {
  nonce: string;
  graph: SrijikaProjectArchitectureGraphModel;
}

export function renderSrijikaProjectArchitectureWebview(
  model: SrijikaProjectArchitectureWebviewModel,
): string {
  const graphJson = JSON.stringify(model.graph).replaceAll('<', '\\u003c');
  const escapeHtml = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const adoptionSummary = model.graph.adoption
    ? `<span class="stat">adoption ${escapeHtml(model.graph.adoption.status)}</span><span class="stat">${model.graph.adoption.summary.governed} governed</span><span class="stat">${model.graph.adoption.summary.pending} pending</span><span class="stat">${model.graph.adoption.summary.blocked} blocked</span><span class="stat">${model.graph.adoption.summary.excluded} excluded</span>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${model.nonce}'; script-src 'nonce-${model.nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style nonce="${model.nonce}">
    :root { color-scheme: light dark; --node-width: 224px; }
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.45 var(--vscode-font-family); }
    button, input { font: inherit; }
    button { border: 0; border-radius: 4px; padding: 7px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 18px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground); }
    h1 { margin: 0; font-size: 18px; } h2 { margin: 0 0 9px; font-size: 14px; } h3 { margin: 14px 0 5px; font-size: 12px; }
    .subtitle, small, .muted { color: var(--vscode-descriptionForeground); }
    .actions, .toolbar, .legend, .stats { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
    .toolbar { padding: 9px 18px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .toolbar input[type=search] { width: min(350px, 36vw); padding: 7px 9px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
    .toolbar label { display: inline-flex; align-items: center; gap: 5px; }
    .zoom { min-width: 45px; text-align: center; color: var(--vscode-descriptionForeground); }
    .stat { padding: 4px 8px; border-radius: 12px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 11px; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: calc(100vh - 111px); }
    .canvas-shell { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
    .legend { padding: 8px 13px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .line { width: 20px; height: 2px; background: var(--vscode-descriptionForeground); }
    .line.import { background: var(--vscode-textLink-foreground); }
    .line.shared { background: var(--vscode-testing-iconPassed); }
    .line.cross { height: 0; border-top: 2px dashed var(--vscode-notificationsWarningIcon-foreground); }
    .line.forbidden { height: 0; border-top: 3px dashed var(--vscode-notificationsErrorIcon-foreground); }
    #canvas-scroll { position: relative; overflow: auto; background-image: radial-gradient(var(--vscode-panel-border) 1px, transparent 1px); background-size: 20px 20px; }
    #graph { display: block; min-width: 100%; min-height: 100%; }
    .edge { fill: none; stroke-width: 1.6; opacity: .75; }
    .edge.hierarchy { stroke: var(--vscode-descriptionForeground); opacity: .38; }
    .edge.same-owner { stroke: var(--vscode-textLink-foreground); }
    .edge.shared { stroke: var(--vscode-testing-iconPassed); stroke-width: 2; }
    .edge.cross-owner { stroke: var(--vscode-notificationsWarningIcon-foreground); stroke-dasharray: 7 5; stroke-width: 2; }
    .edge.forbidden { stroke: var(--vscode-notificationsErrorIcon-foreground); stroke-dasharray: 5 4; stroke-width: 3; opacity: .95; }
    .node { cursor: pointer; }
    .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-panel-border); stroke-width: 1.5; rx: 8; }
    .node.app rect { fill: var(--vscode-button-background); stroke: var(--vscode-focusBorder); }
    .node.group rect { fill: var(--vscode-sideBarSectionHeader-background); stroke: var(--vscode-textLink-foreground); }
    .node.owner rect { stroke: var(--vscode-textLink-foreground); }
    .node.file rect { fill: var(--vscode-input-background); }
    .node.shared rect { stroke: var(--vscode-testing-iconPassed); }
    .node.cross rect { stroke: var(--vscode-notificationsWarningIcon-foreground); }
    .node.violating rect { stroke: var(--vscode-notificationsErrorIcon-foreground); stroke-width: 3; }
    .node.selected rect { stroke: var(--vscode-focusBorder); stroke-width: 3; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent)); }
    .node text { pointer-events: none; fill: var(--vscode-foreground); }
    .node.app text { fill: var(--vscode-button-foreground); }
    .node .title { font-size: 12px; font-weight: 700; }
    .node .meta { fill: var(--vscode-descriptionForeground); font-size: 9.5px; }
    .node.app .meta { fill: var(--vscode-button-foreground); opacity: .8; }
    .node .count { fill: var(--vscode-badge-background); }
    .node .count-text { fill: var(--vscode-badge-foreground); font-size: 9px; text-anchor: middle; }
    .canvas-footer { padding: 7px 13px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 11px; }
    aside { overflow: auto; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .panel { padding: 14px; border-bottom: 1px solid var(--vscode-panel-border); }
    .tag { display: inline-block; margin: 2px 3px 2px 0; padding: 2px 6px; border-radius: 9px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 10px; }
    code { display: block; overflow-wrap: anywhere; padding: 3px 0; color: var(--vscode-textPreformat-foreground); font-size: 11px; }
    .file-card { margin: 8px 0; padding: 9px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editor-background); }
    .file-card strong, .connection strong { display: block; overflow-wrap: anywhere; }
    .file-card button { margin-top: 5px; padding: 4px 7px; font-size: 10px; }
    .list { margin: 5px 0; padding-left: 18px; }
    .list li { margin: 5px 0; overflow-wrap: anywhere; }
    .connection { margin: 6px 0; padding-left: 8px; border-left: 2px solid var(--vscode-textLink-foreground); }
    .violations { margin: 0; padding: 0; list-style: none; }
    .violations button { display: block; width: 100%; margin: 6px 0; padding: 8px; text-align: left; color: var(--vscode-foreground); background: var(--vscode-inputValidation-errorBackground); border-left: 3px solid var(--vscode-inputValidation-errorBorder); }
    .healthy { color: var(--vscode-testing-iconPassed); }
    @media (max-width: 900px) { .workspace { grid-template-columns: 1fr; } aside { display: none; } }
  </style>
</head>
<body>
  <header>
    <div><h1>Structure Graph</h1><div class="subtitle">${escapeHtml(model.graph.projectName)} · ${escapeHtml(model.graph.entry)}</div></div>
    <div class="actions"><button id="refresh">Refresh graph</button><button id="select-project" class="secondary">Switch project</button></div>
  </header>
  <div class="toolbar">
    <input id="search" type="search" placeholder="Find Feature, Slot, Part, Connector, Hook, UI…" />
    <label><input id="dependencies" type="checkbox" checked /> Import edges</label>
    <label><input id="violations-only" type="checkbox" /> Violations only</label>
    <button id="collapse" class="secondary">Collapse files</button>
    <button id="zoom-out" class="secondary">−</button><span id="zoom-label" class="zoom">100%</span><button id="zoom-in" class="secondary">+</button>
    <div class="stats">${adoptionSummary}<span class="stat">${model.graph.stats.owners} owners</span><span class="stat">${model.graph.stats.files} files</span><span class="stat">${model.graph.stats.imports} imports</span><span class="stat">${model.graph.stats.unresolvedImports} unresolved</span><span class="stat">${model.graph.stats.violations} violations</span></div>
  </div>
  <main class="workspace">
    <section class="canvas-shell">
      <div class="legend"><span><i class="line"></i>contains</span><span><i class="line import"></i>imports</span><span><i class="line shared"></i>shared boundary</span><span><i class="line cross"></i>cross-owner</span><span><i class="line forbidden"></i>rule violation</span></div>
      <div id="canvas-scroll"><svg id="graph" role="img" aria-label="Srijika current workspace ownership and import graph"></svg></div>
      <div class="canvas-footer">Click an owner to expand its files. Click a file to inspect incoming/outgoing imports, named exports, capability and exact architecture findings. Red edges and nodes are validator evidence.</div>
    </section>
    <aside>
      <section id="details" class="panel"><h2>Architecture detail</h2><p class="muted">Select App, Feature, Slot, Part, Shared owner, Connector, Hook, Store, or UI.</p></section>
      <section class="panel"><h2>Cross verification</h2><div id="violations"></div></section>
    </aside>
  </main>
  <script nonce="${model.nonce}">
    const vscode = acquireVsCodeApi();
    const model = ${graphJson};
    const saved = vscode.getState() || {};
    const svg = document.getElementById('graph');
    const details = document.getElementById('details');
    const violationsElement = document.getElementById('violations');
    const expandedOwners = new Set(saved.expandedOwners || []);
    let selectedId = saved.selectedId || 'app';
    let zoom = typeof saved.zoom === 'number' ? saved.zoom : 1;
    const ns = 'http://www.w3.org/2000/svg';
    const nodeMap = () => new Map(model.nodes.map((node) => [node.id, node]));
    const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    const truncate = (value, length = 30) => value.length > length ? value.slice(0, length - 1) + '…' : value;
    const element = (name, attributes = {}) => { const value = document.createElementNS(ns, name); for (const [key, attribute] of Object.entries(attributes)) value.setAttribute(key, String(attribute)); return value; };
    const persist = () => vscode.setState({ expandedOwners: [...expandedOwners], selectedId, zoom });
    const childrenOf = (ownerId) => model.nodes.filter((node) => node.parentId === ownerId && node.kind === 'file');
    const nodeViolations = (node) => model.violations.filter((violation) => node.violationIds.includes(violation.id));
    const ancestors = (node, map) => { const ids = []; let current = node; while (current?.parentId) { ids.push(current.parentId); current = map.get(current.parentId); } return ids; };
    const visibleNodes = () => {
      const map = nodeMap();
      const search = document.getElementById('search').value.trim().toLowerCase();
      const violationsOnly = document.getElementById('violations-only').checked;
      const base = model.nodes.filter((node) => node.kind !== 'file' || !node.ownerId || expandedOwners.has(node.ownerId) || Boolean(search) || violationsOnly);
      if (!search && !violationsOnly) return base;
      const include = new Set(['app']);
      for (const node of base) {
        const haystack = [node.label, node.subtitle, node.relativePath || '', node.capability || '', ...node.exports, ...node.imports.map((item) => item.specifier)].join(' ').toLowerCase();
        const matchesSearch = !search || haystack.includes(search);
        const matchesViolation = !violationsOnly || node.violationIds.length > 0;
        if (matchesSearch && matchesViolation) {
          include.add(node.id);
          for (const id of ancestors(node, map)) include.add(id);
          if (node.kind === 'owner' && search) for (const child of childrenOf(node.id)) include.add(child.id);
        }
      }
      return base.filter((node) => include.has(node.id));
    };
    const depthOf = (node, map, cache) => { if (cache.has(node.id)) return cache.get(node.id); const depth = node.parentId && map.has(node.parentId) ? depthOf(map.get(node.parentId), map, cache) + 1 : 0; cache.set(node.id, depth); return depth; };
    const connectionsFor = (node) => model.edges.filter((edge) => edge.kind !== 'hierarchy' && (edge.source === node.id || edge.target === node.id));
    const showDetails = (node) => {
      if (!node) return;
      const violations = nodeViolations(node);
      const files = node.kind === 'owner' ? childrenOf(node.id) : [];
      const connections = connectionsFor(node);
      const importList = node.imports.map((item) => '<li><strong>' + escapeHtml(item.specifier) + '</strong><small>' + escapeHtml(item.kind + (item.resolvedPath ? ' · ' + item.resolvedPath : item.packageName ? ' · ' + item.packageName : '')) + '</small></li>').join('');
      const exportList = node.exports.map((name) => '<span class="tag">' + escapeHtml(name) + '</span>').join('');
      const fileCards = files.map((file) => '<div class="file-card"><strong>' + escapeHtml(file.label) + '</strong><small>' + escapeHtml(file.capability || 'unknown') + '</small><code>' + escapeHtml(file.relativePath || '') + '</code><button data-open-file="' + escapeHtml(file.relativePath || '') + '" class="secondary">Open file</button></div>').join('');
      const connectionList = connections.map((edge) => { const outgoing = edge.source === node.id; const other = model.nodes.find((candidate) => candidate.id === (outgoing ? edge.target : edge.source)); return '<div class="connection"><strong>' + (outgoing ? '→ ' : '← ') + escapeHtml(other?.label || 'Unknown') + '</strong><small>' + escapeHtml(edge.kind + ' · ' + edge.label) + '</small></div>'; }).join('');
      details.innerHTML = '<h2>' + escapeHtml(node.label) + '</h2><span class="tag">' + escapeHtml(node.kind) + '</span>' + (node.ownerKind ? '<span class="tag">' + escapeHtml(node.ownerKind) + '</span>' : '') + (node.capability ? '<span class="tag">' + escapeHtml(node.capability) + '</span>' : '') + '<p class="muted">' + escapeHtml(node.subtitle) + '</p>' + (node.relativePath ? '<h3>Workspace file</h3><code>' + escapeHtml(node.relativePath) + '</code><button data-open-file="' + escapeHtml(node.relativePath) + '" class="secondary">Open file</button>' : '') + (node.kind === 'owner' ? '<h3>Owned files · ' + files.length + '</h3>' + fileCards : '') + (connectionList ? '<h3>Connections</h3>' + connectionList : '') + (importList ? '<h3>Imports</h3><ul class="list">' + importList + '</ul>' : '') + '<h3>Exports</h3>' + (exportList || '<p class="muted">No named export detected.</p>') + (violations.length ? '<h3>Violations</h3><ul class="list">' + violations.map((item) => '<li><strong>' + escapeHtml(item.ruleId || item.code) + '</strong><br>' + escapeHtml(item.message) + '<br><small>' + escapeHtml(item.guidance) + '</small></li>').join('') + '</ul>' : '');
      details.querySelectorAll('[data-open-file]').forEach((button) => button.addEventListener('click', () => vscode.postMessage({ type: 'openFile', relativePath: button.dataset.openFile })));
    };
    const renderViolations = () => {
      if (!model.violations.length) { violationsElement.innerHTML = '<p class="healthy">No Srijika architecture violation.</p>'; return; }
      violationsElement.innerHTML = '<ul class="violations">' + model.violations.map((item) => '<li><button data-violation="' + escapeHtml(item.id) + '"><strong>' + escapeHtml(item.severity.toUpperCase() + ' · ' + (item.ruleId || item.code)) + '</strong><small>' + escapeHtml(item.message) + '</small></button></li>').join('') + '</ul>';
      violationsElement.querySelectorAll('[data-violation]').forEach((button) => button.addEventListener('click', () => { const violation = model.violations.find((item) => item.id === button.dataset.violation); if (violation?.nodeIds[0]) { selectedId = violation.nodeIds[0]; for (const id of violation.nodeIds) { const node = nodeMap().get(id); if (node?.ownerId) expandedOwners.add(node.ownerId); } render(); } }));
    };
    const render = () => {
      const nodes = visibleNodes();
      const map = new Map(nodes.map((node) => [node.id, node]));
      const depthCache = new Map(); const layers = new Map();
      for (const node of nodes) { const depth = depthOf(node, map, depthCache); layers.set(depth, [...(layers.get(depth) || []), node]); }
      for (const layer of layers.values()) layer.sort((left, right) => (left.kind + left.label).localeCompare(right.kind + right.label));
      const positions = new Map(); let maxRows = 1;
      for (const [depth, layer] of layers) { maxRows = Math.max(maxRows, layer.length); layer.forEach((node, index) => positions.set(node.id, { x: 35 + depth * 300, y: 35 + index * 94 })); }
      const width = Math.max(920, (Math.max(...layers.keys(), 0) + 1) * 300 + 45); const height = Math.max(560, maxRows * 94 + 55);
      svg.replaceChildren(); svg.setAttribute('width', String(width * zoom)); svg.setAttribute('height', String(height * zoom)); svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      const defs = element('defs');
      for (const id of ['hierarchy', 'same-owner', 'shared', 'cross-owner', 'forbidden']) { const marker = element('marker', { id: 'arrow-' + id, markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto', markerUnits: 'strokeWidth' }); marker.append(element('path', { d: 'M0,0 L0,6 L8,3 z', fill: 'currentColor' })); defs.append(marker); }
      svg.append(defs);
      const showDependencies = document.getElementById('dependencies').checked;
      for (const edge of model.edges) {
        if (edge.kind !== 'hierarchy' && !showDependencies) continue;
        const source = positions.get(edge.source); const target = positions.get(edge.target); if (!source || !target) continue;
        const startX = source.x + 224; const startY = source.y + 32; const endX = target.x; const endY = target.y + 32; const bend = Math.max(45, Math.abs(endX - startX) / 2);
        const path = element('path', { d: 'M ' + startX + ' ' + startY + ' C ' + (startX + bend) + ' ' + startY + ', ' + (endX - bend) + ' ' + endY + ', ' + endX + ' ' + endY, class: 'edge ' + edge.kind, 'marker-end': 'url(#arrow-' + edge.kind + ')' }); const title = element('title'); title.textContent = edge.label || edge.kind; path.append(title); svg.append(path);
      }
      for (const node of nodes) {
        const position = positions.get(node.id); if (!position) continue;
        const cross = model.edges.some((edge) => (edge.kind === 'cross-owner' || edge.kind === 'forbidden') && (edge.source === node.id || edge.target === node.id));
        const classes = ['node', node.kind, node.ownerKind?.startsWith('shared-') ? 'shared' : '', cross ? 'cross' : '', node.violationIds.length ? 'violating' : '', selectedId === node.id ? 'selected' : ''].filter(Boolean).join(' ');
        const group = element('g', { class: classes, transform: 'translate(' + position.x + ' ' + position.y + ')', tabindex: 0, role: 'button', 'aria-label': node.label + ' ' + node.subtitle }); group.append(element('rect', { width: 224, height: 64 }));
        const title = element('text', { x: 12, y: 23, class: 'title' }); title.textContent = truncate(node.label); group.append(title); const meta = element('text', { x: 12, y: 43, class: 'meta' }); meta.textContent = truncate(node.subtitle, 36); group.append(meta);
        if (node.kind === 'owner') { const count = childrenOf(node.id).length; group.append(element('rect', { x: 187, y: 9, width: 27, height: 18, rx: 9, class: 'count' })); const countText = element('text', { x: 200.5, y: 22, class: 'count-text' }); countText.textContent = String(count); group.append(countText); }
        const select = () => { selectedId = node.id; if (node.kind === 'owner') expandedOwners.has(node.id) ? expandedOwners.delete(node.id) : expandedOwners.add(node.id); persist(); render(); }; group.addEventListener('click', select); group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }); svg.append(group);
      }
      showDetails(nodeMap().get(selectedId) || nodeMap().get('app')); document.getElementById('zoom-label').textContent = Math.round(zoom * 100) + '%'; persist();
    };
    document.getElementById('search').addEventListener('input', render);
    document.getElementById('dependencies').addEventListener('change', render);
    document.getElementById('violations-only').addEventListener('change', render);
    document.getElementById('collapse').addEventListener('click', () => { expandedOwners.clear(); render(); });
    document.getElementById('zoom-out').addEventListener('click', () => { zoom = Math.max(.5, zoom - .1); render(); });
    document.getElementById('zoom-in').addEventListener('click', () => { zoom = Math.min(1.8, zoom + .1); render(); });
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('select-project').addEventListener('click', () => vscode.postMessage({ type: 'selectProject' }));
    renderViolations(); render();
  </script>
</body>
</html>`;
}
