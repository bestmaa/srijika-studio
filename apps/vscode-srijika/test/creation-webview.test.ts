import { describe, expect, it } from 'vitest';

import { resolveSrijikaStructureOwner } from '@srijika/architecture-rules';
import { SRIJIKA_CREATION_ACTION_LABELS } from '../src/creation-presentation';
import { renderSrijikaCreationWebview } from '../src/creation-webview';
import { buildSrijikaOwnershipCreationPlan } from '../src/ownership-creation';

describe('Srijika visual creation form', () => {
  it('renders required and optional controls for a new owner with an exact preview', () => {
    const owner = resolveSrijikaStructureOwner('src/features');
    if (!owner) throw new Error('Expected features root');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
    });
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Features',
      ownerFiles: [],
      childActions: [
        {
          action: 'feature',
          ...SRIJIKA_CREATION_ACTION_LABELS.feature,
        },
      ],
      selectedMode: 'childOwner',
      selectedOwnerActions: [],
      selectedChildAction: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
      plan,
      nonce: 'audit-nonce',
    });
    expect(html).toContain('UI + Connector · Required');
    expect(html).toContain('Hook gateway');
    expect(html).toContain('Business Logic');
    expect(html).toContain('src/features/dashboard/Dashboard.connector.tsx');
    expect(html).toContain("script-src 'nonce-audit-nonce'");
    expect(html).not.toContain("'unsafe-inline'");
  });

  it('shows created and missing owner files as a batch checklist without hiding New Slot', () => {
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner) throw new Error('Expected Feature owner');
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Home',
      ownerFiles: [
        {
          role: 'ui',
          label: 'Home UI',
          description: 'Pure React UI source for this owner',
          relativePath: 'src/features/home/Home.ui.tsx',
          exists: true,
          required: true,
        },
        {
          role: 'connector',
          action: 'featureConnector',
          label: 'Feature Connector',
          description: 'Required runtime UI gateway',
          relativePath: 'src/features/home/Home.connector.tsx',
          exists: true,
          required: true,
        },
        {
          role: 'hook',
          action: 'featureHook',
          label: 'Feature Hook gateway',
          description: 'useFeature.ts',
          relativePath: 'src/features/home/useHome.ts',
          exists: false,
          required: false,
        },
      ],
      childActions: [{ action: 'slot', ...SRIJIKA_CREATION_ACTION_LABELS.slot }],
      selectedMode: 'ownerFiles',
      selectedOwnerActions: ['featureHook'],
      selectedChildAction: 'slot',
      name: '',
      optionalCapabilities: [],
      plan: {
        ownerName: 'Home',
        ownerFolder: 'src/features/home',
        files: [{ relativePath: 'src/features/home/useHome.ts', source: '' }],
        updates: [{ relativePath: 'src/features/home/Home.connector.tsx', source: '' }],
      },
      nonce: 'owner-nonce',
    });
    expect(html).toContain('Complete Home files');
    expect(html).toContain('New Slot');
    expect(html).toContain('Home file checklist');
    expect(html).toContain('Select all missing files');
    expect(html).toContain('Created');
    expect(html).toContain('name="owner-action" value="featureHook" checked');
    expect(html).toContain('[safe rewire] src/features/home/Home.connector.tsx');
  });

  it('keeps child path preview client-side so typing does not lose focus', () => {
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner) throw new Error('Expected Feature owner');
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Home',
      ownerFiles: [],
      childActions: [{ action: 'slot', ...SRIJIKA_CREATION_ACTION_LABELS.slot }],
      selectedMode: 'childOwner',
      selectedOwnerActions: [],
      selectedChildAction: 'slot',
      name: '',
      optionalCapabilities: [],
      nonce: 'focus-nonce',
    });
    expect(html).toContain("addEventListener('input', renderChildPreview)");
    expect(html).toContain("model.owner.folder + '/slots/'");
    expect(html).not.toContain('window.location');
  });
});
