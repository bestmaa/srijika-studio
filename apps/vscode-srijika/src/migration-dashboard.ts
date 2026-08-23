import type { ReactMigrationSession } from '@srijika/developer-engine';

export type SrijikaMigrationTargetMode = 'new' | 'current';

export interface SrijikaMigrationConnectorStatus {
  codex: {
    detected: boolean;
    label: string;
  };
  mcp: {
    configured: boolean;
    label: string;
    paths: readonly string[];
  };
}

export interface SrijikaMigrationDashboardModel {
  nonce: string;
  source: string;
  target: string;
  targetMode: SrijikaMigrationTargetMode;
  currentWorkspace?: string;
  busy: boolean;
  activity?: string;
  error?: string;
  session?: ReactMigrationSession;
  connectors: SrijikaMigrationConnectorStatus;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function progressFor(session: ReactMigrationSession | undefined): number {
  if (!session) return 0;
  if (session.phase === 'complete') return 100;
  if (session.phase === 'verifying') return 88;
  const slices = Math.max(session.plan.slices.length, 1);
  const applied = session.appliedSlices.length / slices;
  const verified = session.appliedSlices.filter(({ verified }) => verified).length / slices;
  const value = 18 + applied * 52 + verified * 18;
  return Math.max(8, Math.min(94, Math.round(value)));
}

function connectorBadge(ok: boolean, yes: string, no: string): string {
  return `<span class="badge ${ok ? 'ok' : 'warn'}">${escapeHtml(ok ? yes : no)}</span>`;
}

function renderArchitecture(session: ReactMigrationSession | undefined): string {
  if (!session) {
    return '<p class="empty">Start or resume a migration to see the engine-owned owner tree, file inventory, and dependency slices.</p>';
  }
  const owners = new Map<
    string,
    { kind: string; name: string; path: string; files: number; roles: Set<string> }
  >();
  for (const decision of session.plan.ownership) {
    const owner = owners.get(decision.ownerId) ?? {
      kind: decision.ownerKind,
      name: decision.ownerName,
      path: decision.ownerPath,
      files: 0,
      roles: new Set<string>(),
    };
    owner.files += 1;
    owner.roles.add(decision.role);
    owners.set(decision.ownerId, owner);
  }
  const ownerRows = [...owners.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 80)
    .map(
      ({ kind, name, path, files, roles }) => `<li>
        <span class="tree-line"><span class="tree-icon">◇</span><strong>${escapeHtml(name)}</strong>${connectorBadge(true, kind, kind)}</span>
        <code>${escapeHtml(path)}</code><small>${files} source file(s) · ${escapeHtml([...roles].sort().join(', '))}</small>
      </li>`,
    )
    .join('');
  const categoryCounts = new Map<string, number>();
  for (const file of session.inventory.files) {
    categoryCounts.set(file.category, (categoryCounts.get(file.category) ?? 0) + 1);
  }
  const categories = [...categoryCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([category, count]) =>
        `<span class="metric"><strong>${count}</strong>${escapeHtml(category)}</span>`,
    )
    .join('');
  return `<div class="metrics">${categories}</div>
    <ul class="tree">${ownerRows || '<li>No canonical owner decision is available.</li>'}</ul>
    ${owners.size > 80 ? `<p class="muted">Showing the first 80 of ${owners.size} owners. The persisted session contains the complete plan.</p>` : ''}`;
}

function renderSlices(session: ReactMigrationSession | undefined): string {
  if (!session) return '<p class="empty">No migration session loaded.</p>';
  const applied = new Map(session.appliedSlices.map((slice) => [slice.id, slice]));
  const reviewed = new Set(session.reviewedSlices.map(({ sliceId }) => sliceId));
  return `<ol class="slices">${session.plan.slices
    .map((slice, index) => {
      const appliedSlice = applied.get(slice.id);
      const status = appliedSlice?.verified
        ? 'verified'
        : appliedSlice
          ? 'applied'
          : reviewed.has(slice.id)
            ? 'reviewed'
            : 'pending';
      return `<li><span class="slice-number">${index + 1}</span><span><strong>${escapeHtml(slice.title)}</strong><small>${slice.sourcePaths.length} source file(s) · ${slice.dependencyOwnerIds.length} dependency owner(s)</small><code>${escapeHtml(slice.id)}</code></span>${connectorBadge(status === 'verified', status, status)}</li>`;
    })
    .join('')}</ol>`;
}

function renderBlockers(session: ReactMigrationSession | undefined): string {
  const blockers = [...(session?.plan.unsupported ?? []), ...(session?.verification?.errors ?? [])];
  if (blockers.length === 0) {
    return '<p class="success">No recorded blocker. Final completion still requires every slice and engine-owned verification/parity evidence.</p>';
  }
  return `<ul class="blockers">${blockers
    .slice(0, 40)
    .map((blocker) => `<li>${escapeHtml(blocker)}</li>`)
    .join('')}</ul>`;
}

export function renderSrijikaMigrationDashboard(model: SrijikaMigrationDashboardModel): string {
  const session = model.session;
  const appliedCount = session?.appliedSlices.length ?? 0;
  const verifiedCount = session?.appliedSlices.filter(({ verified }) => verified).length ?? 0;
  const sliceCount = session?.plan.slices.length ?? 0;
  const progress = progressFor(session);
  const clientState = JSON.stringify({
    source: model.source,
    target: model.target,
    targetMode: model.targetMode,
  }).replaceAll('<', '\\u003c');
  const mcpPaths = model.connectors.mcp.paths
    .map((path) => `<code>${escapeHtml(path)}</code>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${model.nonce}'; script-src 'nonce-${model.nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style nonce="${model.nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px/1.45 var(--vscode-font-family); }
    h1 { margin: 3px 0 4px; font-size: 17px; } h2 { margin: 0; font-size: 13px; } p { margin: 5px 0 10px; }
    .eyebrow { color: var(--vscode-textLink-foreground); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .muted, .empty, small { color: var(--vscode-descriptionForeground); }
    .card { margin: 10px 0; padding: 11px; border: 1px solid var(--vscode-panel-border); border-radius: 7px; background: var(--vscode-editor-background); }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    label.field { display: block; margin: 9px 0; font-weight: 700; }
    .input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; margin-top: 4px; }
    input[type=text] { min-width: 0; width: 100%; padding: 6px 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
    input[readonly] { color: var(--vscode-descriptionForeground); }
    .mode { display: flex; gap: 7px; margin: 6px 0; padding: 7px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; cursor: pointer; }
    .mode span, .connector span { min-width: 0; } strong, small, code { display: block; } code { overflow-wrap: anywhere; color: var(--vscode-textPreformat-foreground); font-size: 10px; }
    button { border: 0; border-radius: 2px; padding: 6px 9px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .primary { width: 100%; padding: 8px; font-weight: 700; }
    .badge { display: inline-block; white-space: nowrap; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
    .badge.ok { color: var(--vscode-testing-iconPassed); background: color-mix(in srgb, var(--vscode-testing-iconPassed) 14%, transparent); }
    .badge.warn { color: var(--vscode-notificationsWarningIcon-foreground); background: color-mix(in srgb, var(--vscode-notificationsWarningIcon-foreground) 14%, transparent); }
    .connector { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; padding: 7px 0; border-top: 1px solid var(--vscode-panel-border); }
    .connector:first-of-type { border-top: 0; }
    .progress { height: 6px; overflow: hidden; border-radius: 4px; background: var(--vscode-progressBar-background, var(--vscode-panel-border)); }
    .progress span { display: block; width: ${progress}%; height: 100%; background: var(--vscode-testing-iconPassed); }
    .progress-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; }
    .metrics { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 9px; }
    .metric { min-width: 47px; padding: 5px; border-radius: 4px; text-align: center; background: var(--vscode-textBlockQuote-background); color: var(--vscode-descriptionForeground); font-size: 9px; }
    .metric strong { color: var(--vscode-foreground); font-size: 13px; }
    .tree, .blockers, .slices { margin: 0; padding: 0; list-style: none; }
    .tree li, .slices li { padding: 7px 0; border-top: 1px solid var(--vscode-panel-border); }
    .tree-line { display: flex; align-items: center; gap: 5px; }
    .tree-icon { color: var(--vscode-textLink-foreground); }
    .slices li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 7px; align-items: start; }
    .slice-number { display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; }
    .blockers li { margin: 5px 0; padding-left: 9px; border-left: 2px solid var(--vscode-notificationsErrorIcon-foreground); }
    .success { color: var(--vscode-testing-iconPassed); }
    .error { margin: 9px 0; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
    details > summary { cursor: pointer; font-weight: 700; }
  </style>
</head>
<body>
  <div class="eyebrow">Source-immutable native conversion</div>
  <h1>React → Srijika Migration</h1>
  <p class="muted">Choose a read-only source and a separate target. The source is never modified. Submit creates or resumes one engine-owned migration session.</p>

  <section class="card">
    <h2>1 · Source and target</h2>
    <label class="field">React source (read-only)
      <div class="input-row"><input id="source" type="text" value="${escapeHtml(model.source)}" readonly placeholder="Select the existing React project" /><button id="select-source" class="secondary">Browse</button></div>
    </label>
    <label class="mode"><input type="radio" name="target-mode" value="new"${model.targetMode === 'new' ? ' checked' : ''} /><span><strong>New target folder · Recommended</strong><small>Create or resume a separate Srijika project. You may type a new absolute path.</small></span></label>
    <label class="mode"><input type="radio" name="target-mode" value="current"${model.targetMode === 'current' ? ' checked' : ''}${model.currentWorkspace ? '' : ' disabled'} /><span><strong>Current workspace target</strong><small>Only an eligible empty target or an existing resumable migration is accepted. Existing product files are never overwritten blindly.</small></span></label>
    <label class="field">Srijika target
      <div class="input-row"><input id="target" type="text" value="${escapeHtml(model.target)}"${model.targetMode === 'current' ? ' readonly' : ''} placeholder="Absolute target path" /><button id="select-target" class="secondary"${model.targetMode === 'current' ? ' disabled' : ''}>Browse</button></div>
    </label>
    ${model.currentWorkspace ? `<small>Current workspace: <code>${escapeHtml(model.currentWorkspace)}</code></small>` : '<small>Open a folder to enable the current-workspace target.</small>'}
    ${model.error ? `<div class="error">${escapeHtml(model.error)}</div>` : ''}
    <button id="start" class="primary"${model.busy || !model.source || !model.target ? ' disabled' : ''}>${model.busy ? 'Migration engine is working…' : 'Start / Resume Migration'}</button>
    <div class="actions"><button id="refresh" class="secondary"${model.busy || !model.target ? ' disabled' : ''}>Refresh status</button><button id="verify" class="secondary"${model.busy || !model.target ? ' disabled' : ''}>Run verification</button><button id="open-session" class="secondary"${session ? '' : ' disabled'}>Full session JSON</button><button id="open-target" class="secondary"${!model.target ? ' disabled' : ''}>Open target</button></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>2 · AI and MCP readiness</h2><button id="refresh-connectors" class="secondary">Refresh</button></div>
    <div class="connector"><span><strong>Codex for VS Code</strong><small>${escapeHtml(model.connectors.codex.label)}</small></span>${connectorBadge(model.connectors.codex.detected, 'detected', 'not detected')}</div>
    <div class="connector"><span><strong>Srijika MCP configuration</strong><small>${escapeHtml(model.connectors.mcp.label)}</small>${mcpPaths}</span>${connectorBadge(model.connectors.mcp.configured, 'configured', 'missing')}</div>
    <p class="muted">Detected/configured means the local integration is present; authenticated live connection is confirmed by the MCP client itself.</p>
    <div class="actions"><button id="copy-handoff" class="secondary"${!model.target ? ' disabled' : ''}>Copy Codex handoff</button><button id="open-docs" class="secondary">Open migration guide</button></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>3 · Progress</h2>${session ? connectorBadge(session.phase === 'complete', session.phase, session.phase) : connectorBadge(false, '', 'not started')}</div>
    <div class="progress"><span></span></div>
    <div class="progress-meta"><small>${escapeHtml(model.activity ?? (session ? `Session ${session.id}` : 'Choose folders to begin'))}</small><strong>${progress}%</strong></div>
    ${session ? `<div class="metrics"><span class="metric"><strong>${session.inventory.files.length}</strong>files</span><span class="metric"><strong>${session.plan.ownership.length}</strong>decisions</span><span class="metric"><strong>${appliedCount}/${sliceCount}</strong>applied</span><span class="metric"><strong>${verifiedCount}/${sliceCount}</strong>verified</span></div>` : ''}
  </section>

  <section class="card"><details open><summary>4 · Planned architecture</summary>${renderArchitecture(session)}</details></section>
  <section class="card"><details open><summary>5 · Migration slices</summary>${renderSlices(session)}</details></section>
  <section class="card"><details${session?.phase === 'blocked' ? ' open' : ''}><summary>6 · Blockers and completion gates</summary>${renderBlockers(session)}</details></section>

  <script nonce="${model.nonce}">
    const vscode = acquireVsCodeApi();
    const initial = ${clientState};
    const source = document.getElementById('source');
    const target = document.getElementById('target');
    const send = (type, extra = {}) => vscode.postMessage({ type, source: source.value, target: target.value, targetMode: document.querySelector('input[name=target-mode]:checked')?.value || initial.targetMode, ...extra });
    document.getElementById('select-source').addEventListener('click', () => send('selectSource'));
    document.getElementById('select-target').addEventListener('click', () => send('selectTarget'));
    document.getElementById('start').addEventListener('click', () => send('start'));
    document.getElementById('refresh').addEventListener('click', () => send('status'));
    document.getElementById('verify').addEventListener('click', () => send('verify'));
    document.getElementById('open-target').addEventListener('click', () => send('openTarget'));
    document.getElementById('open-session').addEventListener('click', () => send('openSession'));
    document.getElementById('refresh-connectors').addEventListener('click', () => send('refreshConnectors'));
    document.getElementById('copy-handoff').addEventListener('click', () => send('copyHandoff'));
    document.getElementById('open-docs').addEventListener('click', () => send('openDocs'));
    document.querySelectorAll('input[name=target-mode]').forEach((input) => input.addEventListener('change', () => send('targetMode')));
    target.addEventListener('change', () => vscode.setState({ ...initial, target: target.value }));
  </script>
</body>
</html>`;
}
