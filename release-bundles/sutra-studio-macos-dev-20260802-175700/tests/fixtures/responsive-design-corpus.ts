import {
  createBlankDocument,
  literal,
  type ElementNode,
  type StyleProperties,
  type UiDocument,
} from '@sutra/contracts';

import { componentRegistry } from '../../apps/studio/src/lib/registry';
import { studioTemplateById } from '../../apps/studio/src/lib/templates';

export const RESPONSIVE_CORPUS_VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1180, height: 820 },
  wide: { width: 1728, height: 1117 },
} as const;

export type ResponsiveCorpusViewport = keyof typeof RESPONSIVE_CORPUS_VIEWPORTS;

export interface ResponsiveCorpusFrame {
  id: string;
  title: string;
  archetype:
    | 'dashboard'
    | 'video-feed'
    | 'inbox'
    | 'commerce'
    | 'settings'
    | 'kanban'
    | 'finance'
    | 'social'
    | 'mobile-banking'
    | 'landing';
  /** Honest provenance: these are not Figma API imports. */
  source: 'built-in-reference' | 'derived-stress-fixture';
  referenceFrame: { width: number; height: number };
  layoutNodeId: string;
  expectedColumns: Record<ResponsiveCorpusViewport, number>;
  createDocument: () => UiDocument;
}

function requiredTemplate(templateId: string, pageId: string): UiDocument {
  const template = studioTemplateById(templateId);
  if (!template) throw new Error(`Missing corpus template ${templateId}`);
  return template.createDocument(pageId);
}

interface StressFrameSpec {
  id: string;
  name: string;
  desktopColumns: number;
  tabletColumns: number;
  wideColumns: number;
  desktopShell?: string;
  tabletShell?: string;
  mobileMaxWidth?: number;
}

function attachElement(
  document: UiDocument,
  parentId: string,
  componentId: string,
  id: string,
  name: string,
  style: StyleProperties,
): ElementNode {
  const node = componentRegistry.require(componentId).createNode(id);
  if (node.kind !== 'element') throw new Error(`${componentId} must create an element`);
  node.name = name;
  node.style.base = { ...node.style.base, ...style };
  const parent = document.nodes[parentId];
  if (!parent || parent.kind !== 'element') throw new Error(`Missing corpus parent ${parentId}`);
  const children = parent.slots['children'];
  if (!children) throw new Error(`Corpus parent ${parentId} has no children slot`);
  children.push(id);
  document.nodes[id] = node;
  return node;
}

function createStressFrame(spec: StressFrameSpec): UiDocument {
  const document = createBlankDocument(`corpus_${spec.id}`, spec.name);
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Corpus root must be an element');
  root.style = {
    base: {
      ...root.style.base,
      width: { mode: 'percent', value: 100 },
      minHeight: 820,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      gap: 18,
      overflow: 'auto',
      backgroundColor: '#10131a',
    },
    breakpoints: {
      tablet: {
        minHeight: 0,
        padding: { top: 18, right: 18, bottom: 18, left: 18 },
        overflowX: 'hidden',
        overflowY: 'auto',
      },
      mobile: {
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
      },
      wide: {
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
      },
    },
  };

  const shell = attachElement(
    document,
    'root',
    'sutra.container',
    `${spec.id}_shell`,
    `${spec.name} Shell`,
    {
      display: spec.desktopShell ? 'grid' : 'flex',
      ...(spec.desktopShell ? { gridTemplateColumns: spec.desktopShell } : {}),
      width: { mode: 'percent', value: 100 },
      maxWidth: spec.mobileMaxWidth ?? 1680,
      alignSelf: 'center',
      minWidth: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 18,
      borderWidth: 0,
      backgroundColor: 'transparent',
    },
  );
  shell.props['as'] = literal('section');
  shell.style.breakpoints = {
    tablet: {
      ...(spec.desktopShell
        ? { gridTemplateColumns: spec.tabletShell ?? '72px minmax(0, 1fr)' }
        : {}),
      gap: 14,
    },
    mobile: {
      ...(spec.desktopShell ? { gridTemplateColumns: 'minmax(0, 1fr)' } : {}),
      gap: 12,
    },
  };

  if (spec.desktopShell) {
    const rail = attachElement(
      document,
      shell.id,
      'sutra.container',
      `${spec.id}_rail`,
      `${spec.name} Rail`,
      {
        minHeight: 640,
        padding: { top: 18, right: 12, bottom: 18, left: 12 },
        backgroundColor: '#171c26',
        borderColor: '#28303d',
        borderWidth: 1,
        borderRadius: 12,
      },
    );
    rail.style.breakpoints = {
      tablet: { padding: { top: 12, right: 8, bottom: 12, left: 8 } },
      mobile: { display: 'none' },
    };
  }

  const main = attachElement(
    document,
    shell.id,
    'sutra.container',
    `${spec.id}_main`,
    `${spec.name} Main`,
    {
      width: { mode: 'fill' },
      minWidth: 0,
      padding: { top: 18, right: 18, bottom: 18, left: 18 },
      gap: 18,
      backgroundColor: '#151a23',
      borderColor: '#28303d',
      borderWidth: 1,
      borderRadius: 12,
    },
  );
  main.style.breakpoints = {
    mobile: {
      width: { mode: 'percent', value: 100 },
      padding: { top: 14, right: 14, bottom: 14, left: 14 },
    },
  };

  const grid = attachElement(
    document,
    main.id,
    'sutra.grid',
    `${spec.id}_layout`,
    `${spec.name} Responsive Layout`,
    {
      display: 'grid',
      width: { mode: 'percent', value: 100 },
      minWidth: 0,
      gridTemplateColumns: `repeat(${spec.desktopColumns}, minmax(0, 1fr))`,
      gap: 16,
    },
  );
  grid.props['columns'] = literal(spec.desktopColumns);
  grid.props['columnsTemplate'] = literal(`repeat(${spec.desktopColumns}, minmax(0, 1fr))`);
  grid.style.breakpoints = {
    tablet: {
      gridTemplateColumns: `repeat(${spec.tabletColumns}, minmax(0, 1fr))`,
      gap: 14,
    },
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 },
    wide: {
      gridTemplateColumns: `repeat(${spec.wideColumns}, minmax(0, 1fr))`,
      gap: 20,
    },
  };

  for (let index = 0; index < Math.max(spec.desktopColumns * 2, 6); index += 1) {
    attachElement(
      document,
      grid.id,
      'sutra.container',
      `${spec.id}_block_${index}`,
      `${spec.name} Block ${index + 1}`,
      {
        minWidth: 0,
        minHeight: 116,
        padding: { top: 14, right: 14, bottom: 14, left: 14 },
        backgroundColor: index % 2 === 0 ? '#1b2230' : '#1e2533',
        borderColor: '#303a49',
        borderWidth: 1,
        borderRadius: 10,
        overflow: 'hidden',
      },
    );
  }

  return document;
}

export const responsiveDesignCorpus: readonly ResponsiveCorpusFrame[] = [
  {
    id: 'orbit-dashboard-reference',
    title: 'Orbit analytics dashboard',
    archetype: 'dashboard',
    source: 'built-in-reference',
    referenceFrame: { width: 1180, height: 820 },
    layoutNodeId: 'orbit_metrics',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 4, wide: 4 },
    createDocument: () => requiredTemplate('analytics-dashboard', 'corpus_orbit_dashboard'),
  },
  {
    id: 'youtube-video-feed-reference',
    title: 'YouTube-style video feed',
    archetype: 'video-feed',
    source: 'built-in-reference',
    referenceFrame: { width: 1180, height: 820 },
    layoutNodeId: 'yt_video_grid',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 3, wide: 4 },
    createDocument: () => requiredTemplate('youtube-home', 'corpus_video_feed'),
  },
  {
    id: 'command-inbox-stress',
    title: 'Command inbox split view',
    archetype: 'inbox',
    source: 'derived-stress-fixture',
    referenceFrame: { width: 1440, height: 1024 },
    layoutNodeId: 'inbox_layout',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 3, wide: 4 },
    createDocument: () =>
      createStressFrame({
        id: 'inbox',
        name: 'Command Inbox',
        desktopColumns: 3,
        tabletColumns: 2,
        wideColumns: 4,
        desktopShell: '248px minmax(0, 1fr)',
      }),
  },
  {
    id: 'northstar-commerce-reference',
    title: 'Northstar editorial commerce',
    archetype: 'commerce',
    source: 'built-in-reference',
    referenceFrame: { width: 1180, height: 820 },
    layoutNodeId: 'shop_grid',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 4, wide: 4 },
    createDocument: () => requiredTemplate('commerce-storefront', 'corpus_commerce'),
  },
  {
    id: 'account-settings-reference',
    title: 'Account settings workspace',
    archetype: 'settings',
    source: 'built-in-reference',
    referenceFrame: { width: 1180, height: 820 },
    layoutNodeId: 'settings_form',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 2, wide: 2 },
    createDocument: () => requiredTemplate('account-settings', 'corpus_settings'),
  },
  {
    id: 'delivery-kanban-stress',
    title: 'Delivery kanban board',
    archetype: 'kanban',
    source: 'derived-stress-fixture',
    referenceFrame: { width: 1366, height: 900 },
    layoutNodeId: 'kanban_layout',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 4, wide: 5 },
    createDocument: () =>
      createStressFrame({
        id: 'kanban',
        name: 'Delivery Kanban',
        desktopColumns: 4,
        tabletColumns: 2,
        wideColumns: 5,
        desktopShell: '220px minmax(0, 1fr)',
      }),
  },
  {
    id: 'treasury-finance-stress',
    title: 'Treasury finance overview',
    archetype: 'finance',
    source: 'derived-stress-fixture',
    referenceFrame: { width: 1440, height: 960 },
    layoutNodeId: 'finance_layout',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 3, wide: 4 },
    createDocument: () =>
      createStressFrame({
        id: 'finance',
        name: 'Treasury Finance',
        desktopColumns: 3,
        tabletColumns: 2,
        wideColumns: 4,
        desktopShell: '236px minmax(0, 1fr)',
      }),
  },
  {
    id: 'creator-social-stress',
    title: 'Creator social workspace',
    archetype: 'social',
    source: 'derived-stress-fixture',
    referenceFrame: { width: 1280, height: 900 },
    layoutNodeId: 'social_layout',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 3, wide: 3 },
    createDocument: () =>
      createStressFrame({
        id: 'social',
        name: 'Creator Social',
        desktopColumns: 3,
        tabletColumns: 2,
        wideColumns: 3,
        desktopShell: '220px minmax(0, 1fr) 284px',
        tabletShell: '72px minmax(0, 1fr)',
      }),
  },
  {
    id: 'pocket-bank-stress',
    title: 'Pocket mobile banking',
    archetype: 'mobile-banking',
    source: 'derived-stress-fixture',
    referenceFrame: { width: 390, height: 844 },
    layoutNodeId: 'banking_layout',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 2, wide: 2 },
    createDocument: () =>
      createStressFrame({
        id: 'banking',
        name: 'Pocket Banking',
        desktopColumns: 2,
        tabletColumns: 2,
        wideColumns: 2,
        mobileMaxWidth: 480,
      }),
  },
  {
    id: 'mira-landing-reference',
    title: 'Mira campaign landing page',
    archetype: 'landing',
    source: 'built-in-reference',
    referenceFrame: { width: 1180, height: 820 },
    layoutNodeId: 'portfolio_grid',
    expectedColumns: { mobile: 1, tablet: 2, desktop: 2, wide: 2 },
    createDocument: () => requiredTemplate('creative-portfolio', 'corpus_landing'),
  },
] as const;
