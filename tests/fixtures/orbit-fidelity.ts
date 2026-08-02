import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import {
  validateUiDocument,
  type ElementNode,
  type LiteralValue,
  type RepeatNode,
  type StyleProperties,
  type UiDocument,
  type ValueExpression,
} from '@sutra/contracts';

const fixtureUrl = new URL('./orbit-fidelity.sutra.json.gz.b64', import.meta.url);

function literal(value: LiteralValue): ValueExpression {
  return { kind: 'literal', value };
}

function reference(symbolId: string, path: string[]): ValueExpression {
  return { kind: 'reference', symbolId, path };
}

function element(document: UiDocument, nodeId: string): ElementNode {
  const node = document.nodes[nodeId];
  if (!node || node.kind !== 'element') throw new Error(`Expected Orbit element ${nodeId}`);
  return node;
}

function repeat(document: UiDocument, nodeId: string): RepeatNode {
  const node = document.nodes[nodeId];
  if (!node || node.kind !== 'repeat') throw new Error(`Expected Orbit repeat ${nodeId}`);
  return node;
}

function createElement(
  id: string,
  name: string,
  componentId: string,
  props: Record<string, ValueExpression>,
  style: StyleProperties,
): ElementNode {
  return {
    id,
    name,
    kind: 'element',
    componentId,
    componentVersion: 1,
    props,
    events: {},
    slots: {},
    classRefs: [],
    style: { base: style },
    visible: literal(true),
    locked: false,
  };
}

/**
 * The compressed document is the original screenshot-to-Sutra result. These
 * deterministic adjustments make it a permanent fidelity specimen: the
 * source viewport and measured regions match the 1586x992 Orbit reference,
 * while charts, icons, progress and avatars exercise reusable primitives
 * instead of font-dependent Unicode drawings.
 */
function applyReferenceFidelityTuning(document: UiDocument): UiDocument {
  const tuned = structuredClone(document);

  const root = element(tuned, 'root');
  Object.assign(root.style.base, {
    backgroundColor: '#0a0f17',
    backgroundImage: 'radial-gradient(circle at 52% -18%, rgba(90,68,160,.10), transparent 52%)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  });

  const sidebar = element(tuned, 'sidebar');
  sidebar.style.base.padding = { top: 24, right: 16, bottom: 35, left: 14 };
  sidebar.style.base.backgroundImage =
    'linear-gradient(180deg, rgba(13,18,28,.98), rgba(10,15,23,.98))';

  const header = element(tuned, 'top_header');
  header.style.base.height = { mode: 'fixed', value: 77, unit: 'px' };

  const dashboard = element(tuned, 'dashboard_content');
  dashboard.style.base.gap = 14;
  dashboard.style.base.padding = { top: 23, right: 28, bottom: 32, left: 25 };

  const heading = element(tuned, 'workspace_heading_row');
  heading.style.base.minHeight = 94;

  const headingCopy = element(tuned, 'workspace_copy');
  headingCopy.style.base.width = { mode: 'fill' };

  const newProject = element(tuned, 'new_project_button');
  newProject.style.base.width = { mode: 'fixed', value: 178, unit: 'px' };
  newProject.style.base.backgroundImage =
    'linear-gradient(135deg, rgba(122,80,255,1), rgba(100,62,232,1))';

  const statsGrid = element(tuned, 'stats_grid');
  statsGrid.style.base.gap = 18;

  const chartsGrid = element(tuned, 'charts_grid');
  Object.assign(chartsGrid.style.base, {
    gap: 16,
    gridTemplateColumns: '1fr 1fr',
  });
  for (const id of ['activity_panel', 'progress_panel']) {
    element(tuned, id).style.base.height = { mode: 'fixed', value: 277, unit: 'px' };
  }

  const bottomGrid = element(tuned, 'bottom_grid');
  Object.assign(bottomGrid.style.base, {
    gap: 16,
    gridTemplateColumns: '1.32fr 1fr',
    margin: { top: 1, right: 0, bottom: 0, left: 0 },
  });
  for (const id of ['recent_projects_panel', 'team_activity_panel']) {
    element(tuned, id).style.base.height = { mode: 'fixed', value: 317, unit: 'px' };
  }

  const storageCard = element(tuned, 'storage_card');
  storageCard.style.base.height = { mode: 'fixed', value: 172, unit: 'px' };
  const sidebarBottom = element(tuned, 'sidebar_bottom');
  sidebarBottom.style.base.gap = 25;
  const profileCard = element(tuned, 'profile_card');
  profileCard.style.base.height = { mode: 'fixed', value: 103, unit: 'px' };

  const search = element(tuned, 'search_input');
  Object.assign(search, {
    componentId: 'sutra.container',
    props: { as: literal('div'), ariaLabel: literal('Search projects') },
    slots: { children: ['search_icon', 'search_placeholder'] },
  });
  Object.assign(search.style.base, {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    gap: 14,
    padding: { top: 0, right: 16, bottom: 0, left: 16 },
  });
  tuned.nodes['search_icon'] = createElement(
    'search_icon',
    'Search Icon',
    'sutra.icon',
    {
      name: literal('search'),
      label: literal(''),
      size: literal(20),
      strokeWidth: literal(2),
    },
    { color: '#8f97a6' },
  );
  tuned.nodes['search_placeholder'] = createElement(
    'search_placeholder',
    'Search Placeholder',
    'sutra.text',
    { text: literal('Search projects') },
    { color: '#aeb4bf', fontSize: 15, lineHeight: 1.2 },
  );

  const headerActions = element(tuned, 'header_actions');
  headerActions.style.base.justifyContent = 'end';
  headerActions.style.base.width = { mode: 'fill' };

  const notification = element(tuned, 'notification_button');
  Object.assign(notification, {
    componentId: 'sutra.icon',
    props: {
      name: literal('bell'),
      label: literal('Notifications'),
      size: literal(27),
      strokeWidth: literal(1.8),
    },
    slots: {},
  });
  Object.assign(notification.style.base, {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'center',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  const brandMark = element(tuned, 'brand_mark');
  Object.assign(brandMark.style.base, {
    backgroundColor: 'transparent',
    borderWidth: 0,
    boxShadow: 'none',
    height: { mode: 'fixed', value: 44, unit: 'px' },
    width: { mode: 'fixed', value: 44, unit: 'px' },
  });
  const brandGlyph = element(tuned, 'brand_glyph');
  Object.assign(brandGlyph, {
    componentId: 'sutra.icon',
    props: {
      name: literal('hexagon'),
      label: literal('Orbit'),
      size: literal(42),
      strokeWidth: literal(3),
    },
    slots: {},
  });
  Object.assign(brandGlyph.style.base, { color: '#7650ff' });

  const navItems = [
    ['nav_overview', 'Overview', 'home', true],
    ['nav_projects', 'Projects', 'folder', false],
    ['nav_analytics', 'Analytics', 'chart', false],
    ['nav_team', 'Team', 'users', false],
  ] as const;
  for (const [id, label, iconName, selected] of navItems) {
    const nav = element(tuned, id);
    Object.assign(nav, {
      componentId: 'sutra.container',
      props: { as: literal('div'), ariaLabel: literal(label) },
      slots: { children: [`${id}_icon`, `${id}_label`] },
    });
    Object.assign(nav.style.base, {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'row',
      gap: 16,
      justifyContent: 'start',
      padding: { top: 0, right: 18, bottom: 0, left: 16 },
    });
    tuned.nodes[`${id}_icon`] = createElement(
      `${id}_icon`,
      `${label} Icon`,
      'sutra.icon',
      {
        name: literal(iconName),
        label: literal(''),
        size: literal(23),
        strokeWidth: literal(1.9),
      },
      { color: selected ? '#9b7cff' : '#c4c8d2' },
    );
    tuned.nodes[`${id}_label`] = createElement(
      `${id}_label`,
      `${label} Label`,
      'sutra.text',
      { text: literal(label) },
      { color: selected ? '#9b7cff' : '#c4c8d2', fontSize: 16, fontWeight: 500 },
    );
  }

  for (const [id, size, status] of [
    ['header_avatar', 42, 'none'],
    ['profile_image', 46, 'online'],
  ] as const) {
    const avatar = element(tuned, id);
    const currentSource = avatar.props['src'] ?? literal('');
    const currentAlt = avatar.props['alt'] ?? literal('Avatar');
    Object.assign(avatar, {
      componentId: 'sutra.avatar',
      props: {
        src: currentSource,
        alt: currentAlt,
        fallback: literal('AJ'),
        size: literal(size),
        status: literal(status),
      },
      slots: {},
    });
  }

  const profileChevron = element(tuned, 'profile_chevron');
  Object.assign(profileChevron, {
    componentId: 'sutra.icon',
    props: {
      name: literal('chevron-down'),
      label: literal('Open profile menu'),
      size: literal(18),
      strokeWidth: literal(2),
    },
    slots: {},
  });

  const storageTrack = element(tuned, 'storage_track');
  Object.assign(storageTrack, {
    componentId: 'sutra.progress',
    props: {
      value: literal(68),
      max: literal(100),
      label: literal('68 percent of storage used'),
      fillColor: literal('#704cff'),
      trackColor: literal('#252c37'),
    },
    slots: {},
  });
  storageTrack.style.base.width = { mode: 'fill' };

  const stats = repeat(tuned, 'stats_repeat');
  if (stats.source.kind === 'literal' && Array.isArray(stats.source.value)) {
    const icons = ['briefcase', 'check-circle', 'users', 'clock'];
    stats.source.value = stats.source.value.map((value, index) => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const cyan = index === 1 || index === 3;
      return {
        ...item,
        icon: icons[index] ?? 'activity',
        iconStyle: cyan
          ? {
              backgroundColor: '#12485a',
              borderColor: '#17657a',
              boxShadow: '0 0 22px rgba(32,198,232,.14)',
            }
          : {
              backgroundColor: '#332766',
              borderColor: '#56439b',
              boxShadow: '0 0 22px rgba(112,75,255,.14)',
            },
        trendStyle: { color: index === 3 ? '#ff504f' : '#53d38b' },
      };
    });
  }
  const statSymbol = tuned.symbols['stat_item'];
  const statShape = statSymbol?.valueShape;
  if (statShape?.kind === 'object') {
    statShape.fields['trendStyle'] = {
      required: true,
      shape: {
        kind: 'object',
        fields: {
          color: { required: true, shape: { kind: 'string' } },
        },
        additionalProperties: false,
      },
    };
    statShape.fields['iconStyle'] = {
      required: true,
      shape: {
        kind: 'object',
        fields: {
          backgroundColor: { required: true, shape: { kind: 'string' } },
          borderColor: { required: true, shape: { kind: 'string' } },
          boxShadow: { required: true, shape: { kind: 'string' } },
        },
        additionalProperties: false,
      },
    };
  }
  const statIcon = element(tuned, 'stat_icon_text_template');
  Object.assign(statIcon, {
    componentId: 'sutra.icon',
    props: {
      name: reference('stat_item', ['icon']),
      label: literal(''),
      size: literal(25),
      strokeWidth: literal(1.9),
    },
    slots: {},
  });
  const statCard = element(tuned, 'stat_card_template');
  statCard.slots['children'] = ['stat_top_template', 'stat_trend_positive'];
  statCard.style.base.backgroundImage =
    'linear-gradient(145deg, rgba(18,25,35,.98), rgba(15,22,32,.98))';
  const statIconShell = element(tuned, 'stat_icon_template');
  statIconShell.props['style'] = reference('stat_item', ['iconStyle']);
  const statTrend = element(tuned, 'stat_trend_positive');
  statTrend.props['style'] = reference('stat_item', ['trendStyle']);

  const activityChart = element(tuned, 'plot_copy');
  Object.assign(activityChart, {
    componentId: 'sutra.chart',
    name: 'Project Activity Lines',
    props: {
      chartType: literal('line'),
      curve: literal('smooth'),
      data: literal([
        [30, 50, 40, 70, 30, 50, 48],
        [15, 28, 22, 42, 17, 27, 34],
      ]),
      colors: literal(['#704bff', '#20c6e8']),
      label: literal('Projects created and tasks completed over seven days'),
      showGrid: literal(true),
      strokeWidth: literal(3),
      innerRadius: literal(58),
    },
    slots: {},
  });
  Object.assign(activityChart.style.base, {
    display: 'block',
    flexGrow: 1,
    height: { mode: 'fixed', value: 150, unit: 'px' },
    minHeight: 0,
    width: { mode: 'fill' },
  });

  const dayLabels = element(tuned, 'days_label');
  const dayIds = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => `day_${day}`);
  Object.assign(dayLabels, {
    componentId: 'sutra.grid',
    props: { columns: literal(7) },
    slots: { children: dayIds },
  });
  Object.assign(dayLabels.style.base, {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    padding: { top: 0, right: 0, bottom: 0, left: 36 },
    width: { mode: 'percent', value: 100 },
  });
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((label, index) => {
    const id = dayIds[index]!;
    tuned.nodes[id] = createElement(
      id,
      `${label} Label`,
      'sutra.text',
      { text: literal(label) },
      { color: '#8e95a2', fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap' },
    );
  });

  const donut = element(tuned, 'donut_ring');
  donut.slots['children'] = ['donut_chart', 'donut_value', 'donut_label'];
  Object.assign(donut.style.base, {
    backgroundColor: 'transparent',
    borderWidth: 0,
    boxShadow: 'none',
    height: { mode: 'fixed', value: 230, unit: 'px' },
    flexShrink: 0,
    minHeight: 0,
    position: 'relative',
    width: { mode: 'fixed', value: 230, unit: 'px' },
  });
  const progressBody = element(tuned, 'progress_body');
  Object.assign(progressBody.style.base, { gap: 38, justifyContent: 'start' });
  tuned.nodes['donut_chart'] = createElement(
    'donut_chart',
    'Task Donut Chart',
    'sutra.chart',
    {
      chartType: literal('donut'),
      data: literal([94, 56, 34]),
      colors: literal(['#704bff', '#20c6e8', '#e24388']),
      label: literal('Task progress: 94 completed, 56 in progress, 34 todo'),
      showGrid: literal(false),
      strokeWidth: literal(3),
      innerRadius: literal(60),
    },
    {
      display: 'block',
      height: { mode: 'percent', value: 100 },
      left: 0,
      position: 'absolute',
      top: 0,
      width: { mode: 'percent', value: 100 },
      zIndex: 0,
    },
  );
  Object.assign(element(tuned, 'donut_value').style.base, {
    left: 0,
    position: 'absolute',
    textAlign: 'center',
    top: 86,
    width: { mode: 'percent', value: 100 },
    zIndex: 1,
  });
  Object.assign(element(tuned, 'donut_label').style.base, {
    left: 0,
    position: 'absolute',
    textAlign: 'center',
    top: 126,
    width: { mode: 'percent', value: 100 },
    zIndex: 1,
  });

  for (const [id, label, value, color] of [
    ['completed_row', 'Completed', '94 (51%)', '#704bff'],
    ['inprogress_row', 'In progress', '56 (30%)', '#20c6e8'],
    ['todo_row', 'Todo', '34 (19%)', '#e24388'],
  ] as const) {
    const row = element(tuned, id);
    Object.assign(row, {
      componentId: 'sutra.container',
      props: { as: literal('div'), ariaLabel: literal(`${label} ${value}`) },
      slots: { children: [`${id}_label`, `${id}_value`] },
    });
    Object.assign(row.style.base, {
      alignItems: 'center',
      borderWidth: 0,
      display: 'flex',
      flexDirection: 'row',
      height: { mode: 'fixed', value: 56, unit: 'px' },
      justifyContent: 'space-between',
      minHeight: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      width: { mode: 'percent', value: 100 },
    });
    tuned.nodes[`${id}_label`] = createElement(
      `${id}_label`,
      `${label} Legend`,
      'sutra.text',
      { text: literal(`●  ${label}`) },
      { color, fontSize: 14, whiteSpace: 'nowrap' },
    );
    tuned.nodes[`${id}_value`] = createElement(
      `${id}_value`,
      `${label} Value`,
      'sutra.text',
      { text: literal(value) },
      { color: '#f0f1f5', fontSize: 14, whiteSpace: 'nowrap' },
    );
  }

  const progressLegend = element(tuned, 'progress_legend');
  progressLegend.slots['children'] = [
    'completed_row',
    'progress_divider_1',
    'inprogress_row',
    'progress_divider_2',
    'todo_row',
  ];
  for (const id of ['progress_divider_1', 'progress_divider_2']) {
    tuned.nodes[id] = createElement(
      id,
      'Progress Legend Divider',
      'sutra.divider',
      {
        orientation: literal('horizontal'),
        color: literal('#2a323e'),
        thickness: literal(1),
      },
      { width: { mode: 'percent', value: 100 } },
    );
  }

  const projects = repeat(tuned, 'projects_repeat');
  if (projects.source.kind === 'literal' && Array.isArray(projects.source.value)) {
    const icons = ['upload', 'layout-dashboard', 'chart', 'cube'];
    const iconStyles = [
      { backgroundColor: '#6845ee' },
      { backgroundColor: '#16b8d5' },
      { backgroundColor: '#df3d82' },
      { backgroundColor: '#f4b81d' },
    ];
    projects.source.value = projects.source.value.map((value, index) => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return {
        ...item,
        icon: icons[index] ?? 'cube',
        iconStyle: iconStyles[index] ?? { backgroundColor: '#6845ee' },
      };
    });
  }
  const projectSymbol = tuned.symbols['project_item'];
  const projectShape = projectSymbol?.valueShape;
  if (projectShape?.kind === 'object') {
    projectShape.fields['iconStyle'] = {
      required: true,
      shape: {
        kind: 'object',
        fields: {
          backgroundColor: { required: true, shape: { kind: 'string' } },
        },
        additionalProperties: false,
      },
    };
  }
  const projectIconShell = element(tuned, 'project_icon_template');
  projectIconShell.props['style'] = reference('project_item', ['iconStyle']);
  const projectIcon = element(tuned, 'project_icon_text_template');
  Object.assign(projectIcon, {
    componentId: 'sutra.icon',
    props: {
      name: reference('project_item', ['icon']),
      label: literal(''),
      size: literal(20),
      strokeWidth: literal(1.9),
    },
    slots: {},
  });

  for (const [id, tone, backgroundColor, borderColor, color] of [
    ['project_status_track', 'success', '#102f26', '#17643f', '#4add8d'],
    ['project_status_progress', 'info', '#102f3a', '#13758b', '#37c8e5'],
    ['project_status_risk', 'warning', '#362a0e', '#805a00', '#ffc64d'],
  ] as const) {
    const status = element(tuned, id);
    Object.assign(status, {
      componentId: 'sutra.badge',
      props: {
        label: reference('project_item', ['status']),
        tone: literal(tone),
        dot: literal(false),
      },
      slots: {},
    });
    Object.assign(status.style.base, {
      flexGrow: 0,
      padding: { top: 6, right: 11, bottom: 6, left: 11 },
      borderRadius: 999,
      backgroundColor,
      borderColor,
      borderWidth: 1,
      color,
      lineHeight: 1,
    });
  }

  const activityAvatar = element(tuned, 'activity_avatar_template');
  Object.assign(activityAvatar, {
    componentId: 'sutra.avatar',
    props: {
      src: reference('activity_item', ['avatar']),
      alt: reference('activity_item', ['name']),
      fallback: literal('A'),
      size: literal(42),
      status: literal('online'),
    },
    slots: {},
  });

  // Replaced structural/content nodes must not remain as disconnected AST
  // records: the document graph deliberately enforces one reachable parent.
  for (const nodeId of [
    'storage_fill',
    'trend_color_if',
    'stat_trend_negative',
    'grid_line_1',
    'spark_purple',
    'grid_line_2',
    'spark_cyan',
    'grid_line_3',
  ]) {
    delete tuned.nodes[nodeId];
  }

  const result = validateUiDocument(tuned);
  if (!result.valid || !result.value) {
    throw new Error(`Tuned Orbit fidelity fixture is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function loadOrbitFidelityDocument(): UiDocument {
  const encoded = readFileSync(fixtureUrl, 'utf8').replace(/\s+/g, '');
  const value: unknown = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
  const result = validateUiDocument(value);
  if (!result.valid || !result.value) {
    throw new Error(`Orbit fidelity fixture is invalid: ${JSON.stringify(result.errors)}`);
  }
  return applyReferenceFidelityTuning(result.value);
}
