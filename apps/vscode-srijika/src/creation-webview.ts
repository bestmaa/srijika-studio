import type {
  SrijikaStructureCreationAction,
  SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';

import type {
  SrijikaOptionalOwnerCapability,
  SrijikaOwnerFileRole,
  SrijikaOwnershipCreationPlan,
} from './ownership-creation';

export interface SrijikaCreationActionPresentation {
  action: SrijikaStructureCreationAction;
  label: string;
  description: string;
}

export interface SrijikaOwnerFilePresentation {
  role: SrijikaOwnerFileRole;
  action?: SrijikaStructureCreationAction;
  label: string;
  description: string;
  relativePath: string;
  exists: boolean;
  required: boolean;
}

export type SrijikaCreationMode = 'ownerFiles' | 'childOwner';

export interface SrijikaCreationWebviewModel {
  owner: SrijikaStructureOwnerContext;
  ownerLabel: string;
  ownerFiles: readonly SrijikaOwnerFilePresentation[];
  childActions: readonly SrijikaCreationActionPresentation[];
  selectedMode: SrijikaCreationMode;
  selectedOwnerActions: readonly SrijikaStructureCreationAction[];
  selectedChildAction?: SrijikaStructureCreationAction;
  name: string;
  optionalCapabilities: readonly SrijikaOptionalOwnerCapability[];
  plan?: SrijikaOwnershipCreationPlan;
  error?: string;
  nonce: string;
}

const OPTIONAL_CAPABILITIES: readonly {
  capability: SrijikaOptionalOwnerCapability;
  title: string;
  description: string;
}[] = [
  { capability: 'hook', title: 'Hook gateway', description: 'React/query/cache lifecycle' },
  { capability: 'store', title: 'Zustand store', description: 'Shared client state' },
  { capability: 'logic', title: 'Business Logic', description: 'Rules and transformations' },
  { capability: 'api', title: 'API', description: 'HTTP request and response boundary' },
  { capability: 'types', title: 'Types', description: 'Owner contracts' },
];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderSrijikaCreationWebview(model: SrijikaCreationWebviewModel): string {
  const selectedChild = model.childActions.find(
    ({ action }) => action === model.selectedChildAction,
  );
  const missingOwnerFiles = model.ownerFiles.filter(({ exists, action }) => !exists && action);
  const selectedOwnerActions = new Set(model.selectedOwnerActions);
  const allMissingSelected =
    missingOwnerFiles.length > 0 &&
    missingOwnerFiles.every(({ action }) => action && selectedOwnerActions.has(action));
  const modeCards = [
    ...(model.ownerFiles.length > 0
      ? [
          `<label class="mode-card${model.selectedMode === 'ownerFiles' ? ' selected' : ''}">
            <input type="radio" name="mode" value="ownerFiles"${model.selectedMode === 'ownerFiles' ? ' checked' : ''} />
            <span><strong>Complete ${escapeHtml(model.ownerLabel)} files</strong><small>${missingOwnerFiles.length === 0 ? 'All owner files are already created' : `${missingOwnerFiles.length} owner file${missingOwnerFiles.length === 1 ? '' : 's'} available to create`}</small></span>
          </label>`,
        ]
      : []),
    ...(selectedChild
      ? [
          `<label class="mode-card${model.selectedMode === 'childOwner' ? ' selected' : ''}">
            <input type="radio" name="mode" value="childOwner"${model.selectedMode === 'childOwner' ? ' checked' : ''} />
            <span><strong>${escapeHtml(selectedChild.label)}</strong><small>${escapeHtml(selectedChild.description)}</small></span>
          </label>`,
        ]
      : []),
  ].join('');
  const ownerFileCards = model.ownerFiles
    .map(({ action, label, description, relativePath, exists, required }) => {
      const selectable = !exists && action !== undefined;
      const checked = exists || (action !== undefined && selectedOwnerActions.has(action));
      const status = exists
        ? 'Created'
        : selectable
          ? required
            ? 'Required · select to create'
            : 'Missing · select to create'
          : 'Required file missing';
      return `<label class="capability-card${exists ? ' created' : ''}${selectable ? ' selectable' : ''}">
        <input type="checkbox" name="owner-action" value="${action ? escapeHtml(action) : ''}"${checked ? ' checked' : ''}${selectable ? '' : ' disabled'} />
        <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small><code>${escapeHtml(relativePath)}</code><em>${escapeHtml(status)}</em></span>
      </label>`;
    })
    .join('');
  const capabilityCards = OPTIONAL_CAPABILITIES.map(
    ({ capability, title, description }) => `<label class="capability-card selectable">
      <input type="checkbox" name="capability" value="${capability}"${model.optionalCapabilities.includes(capability) ? ' checked' : ''} />
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
    </label>`,
  ).join('');
  const previewFiles = [
    ...(model.plan?.files.map(({ relativePath }) => relativePath) ?? []),
    ...(model.plan?.updates.map(({ relativePath }) => `[safe rewire] ${relativePath}`) ?? []),
  ];
  const clientModel = JSON.stringify({
    owner: model.owner,
    selectedMode: model.selectedMode,
    selectedChildAction: model.selectedChildAction,
    previewFiles,
  }).replaceAll('<', '\\u003c');
  const createDisabled =
    model.selectedMode === 'ownerFiles' && model.selectedOwnerActions.length === 0;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${model.nonce}'; script-src 'nonce-${model.nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style nonce="${model.nonce}">
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.45 var(--vscode-font-family); }
    main { max-width: 820px; margin: 0 auto; }
    .eyebrow { color: var(--vscode-textLink-foreground); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 7px 0 4px; font-size: 24px; } p { margin: 0 0 18px; color: var(--vscode-descriptionForeground); }
    fieldset { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin: 16px 0; padding: 14px; }
    legend { padding: 0 7px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)); gap: 8px; }
    .mode-card, .capability-card, .required-card { display: flex; gap: 9px; padding: 10px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-input-background); }
    .mode-card, .capability-card.selectable { cursor: pointer; }
    .mode-card.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .capability-card.created { border-color: var(--vscode-testing-iconPassed); opacity: .82; }
    strong, small, code, em { display: block; } small { color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .capability-card code { margin-top: 5px; color: var(--vscode-textPreformat-foreground); font-size: 11px; overflow-wrap: anywhere; }
    .capability-card em { margin-top: 4px; color: var(--vscode-testing-iconPassed); font-size: 11px; font-style: normal; font-weight: 700; }
    .capability-card:not(.created) em { color: var(--vscode-notificationsWarningIcon-foreground); }
    .select-all { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 12px; font-weight: 700; cursor: pointer; }
    label.name { display: block; margin: 12px 0; font-weight: 700; }
    input[type=text] { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 8px 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    .required-card { border-color: var(--vscode-testing-iconPassed); }
    .error { margin: 12px 0; padding: 10px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
    .hint { color: var(--vscode-descriptionForeground); }
    .preview code { display: block; padding: 7px 9px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-textPreformat-foreground); }
    footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    button { border: 0; padding: 8px 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Srijika ownership-aware creation</div>
    <h1>Add to ${escapeHtml(model.ownerLabel)}</h1>
    <p>Complete this owner's own files, or create its valid child owner. Existing files stay protected.</p>
    ${modeCards ? `<fieldset><legend>Choose the job</legend><div class="grid">${modeCards}</div></fieldset>` : ''}
    ${
      model.selectedMode === 'ownerFiles'
        ? `<fieldset><legend>${escapeHtml(model.ownerLabel)} file checklist</legend>
          ${missingOwnerFiles.length > 0 ? `<label class="select-all"><input id="select-all-owner" type="checkbox"${allMissingSelected ? ' checked' : ''} /> Select all missing files</label>` : '<p class="hint">Everything defined for this owner is already created.</p>'}
          <div class="grid">${ownerFileCards}</div>
        </fieldset>`
        : selectedChild
          ? `<label class="name">New ${selectedChild.action === 'feature' ? 'Feature' : selectedChild.action === 'slot' ? 'Slot' : 'Part'} name<input id="owner-name" type="text" value="${escapeHtml(model.name)}" placeholder="Dashboard" autofocus /></label>
        <fieldset><legend>Include with this new owner</legend><div class="grid"><div class="required-card"><input type="checkbox" checked disabled /><span><strong>UI + Connector · Required</strong><small>Pure UI and its only runtime gateway</small></span></div>${capabilityCards}</div></fieldset>`
          : '<p class="hint">No child owner is valid at this boundary.</p>'
    }
    ${model.error ? `<div class="error">${escapeHtml(model.error)}</div>` : ''}
    <section class="preview"><h3>Exact files and safe rewiring</h3><div id="preview-files">${previewFiles.length > 0 ? previewFiles.map((relativePath) => `<code>${escapeHtml(relativePath)}</code>`).join('') : '<small class="hint">Select missing files, or enter a child owner name, to preview exact paths.</small>'}</div></section>
    <footer><button class="secondary" id="cancel">Cancel</button><button id="create"${createDisabled ? ' disabled' : ''}>Create validated files</button></footer>
  </main>
  <script nonce="${model.nonce}">
    const vscode = acquireVsCodeApi();
    const model = ${clientModel};
    const readState = () => ({
      mode: document.querySelector('input[name=mode]:checked')?.value || model.selectedMode,
      action: model.selectedChildAction,
      ownerActions: [...document.querySelectorAll('input[name=owner-action]:checked:not(:disabled)')].map((input) => input.value),
      name: document.getElementById('owner-name')?.value || '',
      optionalCapabilities: [...document.querySelectorAll('input[name=capability]:checked')].map((input) => input.value),
    });
    const lowerFirst = (value) => value.slice(0, 1).toLowerCase() + value.slice(1);
    const folderName = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
    const fileName = (name, role) => role === 'ui' ? name + '.ui.tsx' : role === 'connector' ? name + '.connector.tsx' : role === 'hook' ? 'use' + name + '.ts' : lowerFirst(name) + '.' + role + '.ts';
    const renderChildPreview = () => {
      const state = readState();
      const container = document.getElementById('preview-files');
      if (!container || state.mode !== 'childOwner' || !['feature', 'slot', 'part'].includes(state.action)) return;
      container.replaceChildren();
      if (!/^[A-Z][A-Za-z0-9]{0,63}$/.test(state.name)) {
        const hint = document.createElement('small');
        hint.className = 'hint';
        hint.textContent = 'Enter a normalized PascalCase name to see exact paths.';
        container.append(hint);
        return;
      }
      const folder = state.action === 'feature'
        ? model.owner.folder + '/' + folderName(state.name)
        : state.action === 'slot'
          ? model.owner.folder + '/slots/' + folderName(state.name)
          : model.owner.folder + '/parts/' + folderName(state.name);
      const selected = new Set(state.optionalCapabilities);
      const roles = ['ui', 'types', 'api', 'logic', 'store', 'hook', 'connector'].filter((role) => role === 'ui' || role === 'connector' || selected.has(role));
      for (const role of roles) {
        const code = document.createElement('code');
        code.textContent = folder + '/' + fileName(state.name, role);
        container.append(code);
      }
    };
    document.querySelectorAll('input[name=mode]').forEach((input) => input.addEventListener('change', () => vscode.postMessage({ type: 'changeMode', ...readState() })));
    document.querySelectorAll('input[name=owner-action]').forEach((input) => input.addEventListener('change', () => vscode.postMessage({ type: 'changeOwnerSelection', ...readState() })));
    document.getElementById('select-all-owner')?.addEventListener('change', (event) => {
      document.querySelectorAll('input[name=owner-action]:not(:disabled)').forEach((input) => { input.checked = event.currentTarget.checked; });
      vscode.postMessage({ type: 'changeOwnerSelection', ...readState() });
    });
    document.getElementById('owner-name')?.addEventListener('input', renderChildPreview);
    document.querySelectorAll('input[name=capability]').forEach((input) => input.addEventListener('change', renderChildPreview));
    document.getElementById('create').addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      vscode.postMessage({ type: 'create', ...readState() });
    });
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    renderChildPreview();
  </script>
</body>
</html>`;
}
