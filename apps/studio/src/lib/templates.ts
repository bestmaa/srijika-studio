import {
  createBlankDocument,
  literal,
  validateUiDocument,
  type ElementNode,
  type EventSignature,
  type LiteralValue,
  type PublicProp,
  type StyleProperties,
  type SymbolDeclaration,
  type UiDocument,
  type UiNode,
  type ValueExpression,
  type ValueShape,
  type ValueType,
} from '@srijika/contracts';

import { componentRegistry } from './registry';

export type TemplateCategory = 'Media' | 'Dashboard' | 'Commerce' | 'Marketing' | 'Product';

export interface StudioTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  accent: string;
  createDocument: (pageId?: string) => UiDocument;
}

type ParentSlot = 'children' | 'whenTrue' | 'whenFalse';
type TemplateBreakpoint = 'mobile' | 'tablet' | 'wide';
type TemplateBreakpoints = Partial<Record<TemplateBreakpoint, StyleProperties>>;

interface ElementOptions {
  props?: Record<string, ValueExpression>;
  style?: StyleProperties;
  slot?: ParentSlot;
}

export const ref = (symbolId: string, path: string[] = []): ValueExpression => ({
  kind: 'reference',
  symbolId,
  path,
});

export const spacing = (vertical: number, horizontal = vertical) => ({
  top: vertical,
  right: horizontal,
  bottom: vertical,
  left: horizontal,
});

export class TemplateBuilder {
  readonly document: UiDocument;

  constructor(pageId: string, name: string, style: StyleProperties) {
    this.document = createBlankDocument(pageId, name);
    const root = this.document.nodes[this.document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Template Page root is missing');
    root.name = name;
    root.locked = true;
    root.style.base = {
      ...root.style.base,
      width: { mode: 'percent', value: 100 },
      height: { mode: 'percent', value: 100 },
      ...style,
    };
  }

  private attach(parentId: string, childId: string, slot: ParentSlot): void {
    const parent = this.document.nodes[parentId];
    if (!parent) throw new Error(`Missing template parent ${parentId}`);
    if (parent.kind === 'element') {
      const children = parent.slots[slot];
      if (!children) throw new Error(`Element ${parentId} has no ${slot} slot`);
      children.push(childId);
      return;
    }
    if (parent.kind === 'repeat' && slot === 'children') {
      parent.children.push(childId);
      return;
    }
    if (parent.kind === 'if' && (slot === 'whenTrue' || slot === 'whenFalse')) {
      parent[slot].push(childId);
      return;
    }
    throw new Error(`Node ${parentId} cannot receive ${slot}`);
  }

  /**
   * Keep the reference-frame geometry in `style.base` and layer only the
   * viewport-specific differences here. Named breakpoints are resolved by the
   * renderer in desktop-first order (tablet before mobile).
   */
  responsive(nodeId: string, breakpoints: TemplateBreakpoints): void {
    const node = this.document.nodes[nodeId];
    if (!node || node.kind !== 'element') {
      throw new Error(`Responsive template node ${nodeId} must be an element`);
    }
    node.style.breakpoints = {
      ...node.style.breakpoints,
      ...breakpoints,
    };
  }

  element(
    parentId: string,
    componentId: string,
    id: string,
    name: string,
    options: ElementOptions = {},
  ): ElementNode {
    const created = componentRegistry.require(componentId).createNode(id);
    if (created.kind !== 'element') throw new Error(`${componentId} must create an element`);
    created.name = name;
    created.props = { ...created.props, ...options.props };
    created.style.base = { ...created.style.base, ...options.style };
    this.document.nodes[id] = created;
    this.attach(parentId, id, options.slot ?? 'children');
    return created;
  }

  container(
    parentId: string,
    id: string,
    name: string,
    style: StyleProperties,
    as: string = 'div',
    slot?: ParentSlot,
  ): ElementNode {
    return this.element(parentId, 'srijika.container', id, name, {
      props: { as: literal(as) },
      style,
      ...(slot ? { slot } : {}),
    });
  }

  stack(
    parentId: string,
    id: string,
    name: string,
    style: StyleProperties = {},
    slot?: ParentSlot,
  ): ElementNode {
    return this.element(parentId, 'srijika.stack', id, name, {
      style,
      ...(slot ? { slot } : {}),
    });
  }

  grid(
    parentId: string,
    id: string,
    name: string,
    columns: number,
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.grid', id, name, {
      props: { columns: literal(columns) },
      style,
    });
  }

  text(
    parentId: string,
    id: string,
    name: string,
    value: string | ValueExpression,
    style: StyleProperties = {},
    slot?: ParentSlot,
  ): ElementNode {
    return this.element(parentId, 'srijika.text', id, name, {
      props: { text: typeof value === 'string' ? literal(value) : value },
      style,
      ...(slot ? { slot } : {}),
    });
  }

  heading(
    parentId: string,
    id: string,
    name: string,
    value: string | ValueExpression,
    level: number,
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.heading', id, name, {
      props: {
        text: typeof value === 'string' ? literal(value) : value,
        level: literal(level),
      },
      style,
    });
  }

  button(
    parentId: string,
    id: string,
    name: string,
    label: string | ValueExpression,
    variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary',
    style: StyleProperties = {},
    slot?: ParentSlot,
  ): ElementNode {
    return this.element(parentId, 'srijika.button', id, name, {
      props: {
        label: typeof label === 'string' ? literal(label) : label,
        variant: literal(variant),
      },
      style,
      ...(slot ? { slot } : {}),
    });
  }

  image(
    parentId: string,
    id: string,
    name: string,
    src: string | ValueExpression,
    alt: string | ValueExpression,
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.image', id, name, {
      props: {
        src: typeof src === 'string' ? literal(src) : src,
        alt: typeof alt === 'string' ? literal(alt) : alt,
        fit: literal('cover'),
        loading: literal('lazy'),
      },
      style,
    });
  }

  input(
    parentId: string,
    id: string,
    name: string,
    label: string,
    placeholder: string,
    type: string = 'text',
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.input', id, name, {
      props: {
        label: literal(label),
        placeholder: literal(placeholder),
        type: literal(type),
      },
      style,
    });
  }

  icon(
    parentId: string,
    id: string,
    name: string,
    iconName: string | ValueExpression,
    size = 24,
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.icon', id, name, {
      props: {
        name: typeof iconName === 'string' ? literal(iconName) : iconName,
        label: literal(''),
        size: literal(size),
        strokeWidth: literal(1.9),
      },
      style,
    });
  }

  divider(
    parentId: string,
    id: string,
    name: string,
    color = '#29313d',
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.divider', id, name, {
      props: {
        orientation: literal('horizontal'),
        color: literal(color),
        thickness: literal(1),
      },
      style,
    });
  }

  progress(
    parentId: string,
    id: string,
    name: string,
    value: number,
    label: string,
    fillColor = '#704bff',
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.progress', id, name, {
      props: {
        value: literal(value),
        max: literal(100),
        label: literal(label),
        fillColor: literal(fillColor),
        trackColor: literal('#252c37'),
      },
      style,
    });
  }

  badge(
    parentId: string,
    id: string,
    name: string,
    label: string | ValueExpression,
    tone: 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger',
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.badge', id, name, {
      props: {
        label: typeof label === 'string' ? literal(label) : label,
        tone: literal(tone),
        dot: literal(false),
      },
      style,
    });
  }

  avatar(
    parentId: string,
    id: string,
    name: string,
    fallback: string,
    size: number,
    status: 'none' | 'online' | 'away' | 'busy' | 'offline' = 'none',
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.avatar', id, name, {
      props: {
        src: literal(''),
        alt: literal(name),
        fallback: literal(fallback),
        size: literal(size),
        status: literal(status),
      },
      style,
    });
  }

  chart(
    parentId: string,
    id: string,
    name: string,
    chartType: 'line' | 'bar' | 'donut',
    data: LiteralValue,
    colors: string[],
    label: string,
    style: StyleProperties = {},
  ): ElementNode {
    return this.element(parentId, 'srijika.chart', id, name, {
      props: {
        chartType: literal(chartType),
        data: literal(data),
        colors: literal(colors),
        label: literal(label),
        showGrid: literal(chartType !== 'donut'),
        strokeWidth: literal(3),
        innerRadius: literal(60),
        curve: literal(chartType === 'line' ? 'smooth' : 'linear'),
      },
      style,
    });
  }

  publicValue(
    name: string,
    valueType: ValueType,
    defaultValue: LiteralValue,
    valueShape?: ValueShape,
  ): string {
    const symbolId = `prop_${name}`;
    const declaration: SymbolDeclaration = {
      id: symbolId,
      name,
      displayName: name.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()),
      provider: 'prop',
      valueType,
      ...(valueShape ? { valueShape } : {}),
      required: false,
      defaultValue,
    };
    const prop: PublicProp = {
      symbolId,
      name,
      displayName: declaration.displayName,
      valueType,
      ...(valueShape ? { valueShape } : {}),
      required: false,
      defaultValue,
    };
    this.document.symbols[symbolId] = declaration;
    this.document.publicProps[name] = prop;
    return symbolId;
  }

  publicEvent(name: string, signature: EventSignature): string {
    const symbolId = `event_${name}`;
    const displayName = name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (value) => value.toUpperCase());
    this.document.symbols[symbolId] = {
      id: symbolId,
      name,
      displayName,
      provider: 'event',
      valueType: 'event',
      eventSignature: signature,
      required: false,
    };
    this.document.publicProps[name] = {
      symbolId,
      name,
      displayName,
      valueType: 'event',
      eventSignature: signature,
      required: false,
    };
    return symbolId;
  }

  bindClick(node: ElementNode, eventSymbolId: string, argument?: ValueExpression): void {
    node.events['onClick'] = ref(eventSymbolId);
    if (argument) {
      node.eventArguments = {
        ...node.eventArguments,
        onClick: { kind: 'expression', expression: argument },
      };
    }
  }

  repeat(
    parentId: string,
    id: string,
    name: string,
    source: ValueExpression,
    itemShape: ValueShape,
  ): { id: string; itemSymbolId: string; indexSymbolId: string } {
    const itemSymbolId = `${id}_item`;
    const indexSymbolId = `${id}_index`;
    const node: UiNode = {
      kind: 'repeat',
      id,
      name,
      source,
      itemSymbolId,
      indexSymbolId,
      children: [],
    };
    this.document.nodes[id] = node;
    this.document.symbols[itemSymbolId] = {
      id: itemSymbolId,
      name: 'item',
      displayName: 'Current item',
      provider: 'repeatItem',
      valueType: itemShape.kind,
      valueShape: itemShape,
      required: true,
    };
    this.document.symbols[indexSymbolId] = {
      id: indexSymbolId,
      name: 'index',
      displayName: 'Current index',
      provider: 'repeatIndex',
      valueType: 'number',
      required: true,
    };
    this.attach(parentId, id, 'children');
    return { id, itemSymbolId, indexSymbolId };
  }

  condition(parentId: string, id: string, name: string, condition: ValueExpression): string {
    const node: UiNode = {
      kind: 'if',
      id,
      name,
      condition,
      whenTrue: [],
      whenFalse: [],
    };
    this.document.nodes[id] = node;
    this.attach(parentId, id, 'children');
    return id;
  }
}

const videoThumbnails = [
  'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80',
];

function createYouTubeTemplate(pageId = 'template_youtube'): UiDocument {
  const b = new TemplateBuilder(pageId, 'YouTube Home', {
    minHeight: 820,
    backgroundColor: '#ffffff',
    color: '#0f0f0f',
    overflow: 'auto',
  });
  const openVideo = b.publicEvent('onOpenVideo', {
    payload: { name: 'videoId', shape: { kind: 'string' } },
  });
  const search = b.publicEvent('onSearch', { payload: null });
  const signedIn = b.publicValue('isSignedIn', 'boolean', true, { kind: 'boolean' });
  const subscriptions = b.publicValue(
    'subscriptions',
    'array',
    ['Srijika Creators', 'Design Weekly', 'Rust Systems'],
    { kind: 'array', item: { kind: 'string' } },
  );

  b.container(
    'root',
    'yt_header',
    'Top Header',
    {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: { mode: 'percent', value: 100 },
      minHeight: 64,
      padding: spacing(10, 20),
      gap: 20,
      backgroundColor: '#ffffff',
      borderColor: '#ededed',
      borderWidth: 1,
    },
    'header',
  );
  b.stack('yt_header', 'yt_brand', 'Brand', {
    flexDirection: 'row',
    alignItems: 'center',
    width: { mode: 'hug' },
    gap: 9,
  });
  b.text('yt_brand', 'yt_menu', 'Menu Icon', '☰', { color: '#0f0f0f', fontSize: 24 });
  b.heading('yt_brand', 'yt_logo', 'YouTube Logo', '▶ YouTube', 2, {
    color: '#0f0f0f',
    fontSize: 20,
    fontWeight: 800,
  });
  b.stack('yt_header', 'yt_search_group', 'Search Group', {
    flexDirection: 'row',
    alignItems: 'center',
    width: { mode: 'percent', value: 52 },
    gap: 8,
  });
  b.input('yt_search_group', 'yt_search', 'Search Input', '', 'Search', 'search', {
    width: { mode: 'fill' },
    gap: 0,
  });
  const searchButton = b.button(
    'yt_search_group',
    'yt_search_button',
    'Search Button',
    '⌕',
    'secondary',
    { borderRadius: 20, width: { mode: 'fixed', value: 52, unit: 'px' } },
  );
  b.bindClick(searchButton, search);
  b.stack('yt_header', 'yt_header_actions', 'Header Actions', {
    flexDirection: 'row',
    alignItems: 'center',
    width: { mode: 'hug' },
    gap: 8,
  });
  b.button('yt_header_actions', 'yt_create', 'Create Button', '+ Create', 'secondary', {
    borderRadius: 20,
  });
  b.button('yt_header_actions', 'yt_notifications', 'Notifications', '♢', 'ghost', {
    borderRadius: 20,
  });

  b.container('root', 'yt_body', 'YouTube Body', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'stretch',
    width: { mode: 'percent', value: 100 },
    minHeight: 756,
    padding: spacing(0),
    gap: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: '#ffffff',
  });
  b.container(
    'yt_body',
    'yt_sidebar',
    'Navigation Sidebar',
    {
      display: 'flex',
      flexDirection: 'column',
      width: { mode: 'fixed', value: 214, unit: 'px' },
      flexShrink: 0,
      minHeight: 756,
      padding: spacing(14, 10),
      gap: 5,
      borderWidth: 0,
      borderRadius: 0,
      backgroundColor: '#ffffff',
    },
    'aside',
  );
  ['⌂  Home', '▷  Shorts', '▣  Subscriptions'].forEach((label, index) => {
    b.button(
      'yt_sidebar',
      `yt_nav_${index}`,
      `${label.trim()} Nav`,
      label,
      index === 0 ? 'secondary' : 'ghost',
      {
        width: { mode: 'percent', value: 100 },
        borderRadius: 10,
        textAlign: 'left',
      },
    );
  });
  b.text('yt_sidebar', 'yt_subscriptions_label', 'Subscriptions Label', 'SUBSCRIPTIONS', {
    color: '#606060',
    fontSize: 11,
    fontWeight: 700,
    margin: spacing(12, 8),
  });
  const repeat = b.repeat(
    'yt_sidebar',
    'yt_subscription_repeat',
    'Subscription List',
    ref(subscriptions),
    { kind: 'string' },
  );
  b.text(repeat.id, 'yt_subscription_name', 'Subscription Name', ref(repeat.itemSymbolId), {
    color: '#303030',
    fontSize: 13,
    padding: spacing(7, 9),
  });
  const account = b.condition('yt_sidebar', 'yt_account_if', 'Signed-in navigation', ref(signedIn));
  b.text(
    account,
    'yt_account_you',
    'You Label',
    'YOU',
    { fontSize: 11, fontWeight: 800 },
    'whenTrue',
  );
  b.button(
    account,
    'yt_history',
    'History',
    '↶  History',
    'ghost',
    {
      width: { mode: 'percent', value: 100 },
      textAlign: 'left',
    },
    'whenTrue',
  );
  const signedOut = b.text(
    account,
    'yt_sign_in_copy',
    'Sign-in Prompt',
    'Sign in to like videos and subscribe.',
    { color: '#606060', fontSize: 12 },
    'whenFalse',
  );
  signedOut.visible = literal(true);

  b.container(
    'yt_body',
    'yt_content',
    'Video Feed',
    {
      display: 'flex',
      flexDirection: 'column',
      width: { mode: 'fill' },
      flexGrow: 1,
      minWidth: 0,
      minHeight: 756,
      padding: spacing(18, 24),
      gap: 26,
      borderWidth: 0,
      borderRadius: 0,
      backgroundColor: '#ffffff',
    },
    'main',
  );
  b.stack('yt_content', 'yt_categories', 'Topic Chips', {
    flexDirection: 'row',
    alignItems: 'center',
    width: { mode: 'percent', value: 100 },
    gap: 8,
    overflow: 'hidden',
  });
  ['All', 'Podcasts', 'Design', 'News', 'AI', 'Music', 'Gaming', 'Mixes', 'Architecture'].forEach(
    (label, index) => {
      b.button(
        'yt_categories',
        `yt_chip_${index}`,
        `${label} Topic`,
        label,
        index === 0 ? 'primary' : 'secondary',
        { borderRadius: 9, fontSize: 12 },
      );
    },
  );
  b.grid('yt_content', 'yt_video_grid', 'Recommended Videos', 3, { gap: 18 });
  const titles = [
    'Build a polished visual editor from first principles',
    'Exploring remote islands no one talks about',
    'How design systems scale from zero to millions',
    'A cinematic guide to better product storytelling',
    'Inside the tools powering modern creative teams',
    'The calm workspace tour for focused builders',
  ];
  titles.forEach((title, index) => {
    const card = b.container('yt_video_grid', `yt_card_${index}`, `Video Card ${index + 1}`, {
      display: 'flex',
      flexDirection: 'column',
      width: { mode: 'percent', value: 100 },
      padding: spacing(0),
      gap: 10,
      borderWidth: 0,
      borderRadius: 12,
      backgroundColor: '#ffffff',
      overflow: 'hidden',
    });
    b.image(
      card.id,
      `yt_thumb_${index}`,
      `Video Thumbnail ${index + 1}`,
      videoThumbnails[index]!,
      title,
      {
        height: { mode: 'fixed', value: 158, unit: 'px' },
        borderRadius: 12,
      },
    );
    b.heading(card.id, `yt_title_${index}`, `Video Title ${index + 1}`, title, 3, {
      color: '#0f0f0f',
      fontSize: 15,
      fontWeight: 650,
      overflowWrap: 'break-word',
    });
    b.text(
      card.id,
      `yt_meta_${index}`,
      `Video Metadata ${index + 1}`,
      `Srijika Channel · ${index + 1}.2M views · ${index + 2} days ago`,
      {
        color: '#606060',
        fontSize: 12,
      },
    );
    const watch = b.button(
      card.id,
      `yt_watch_${index}`,
      `Watch Video ${index + 1}`,
      'Watch',
      'ghost',
      {
        width: { mode: 'hug' },
        fontSize: 12,
      },
    );
    b.bindClick(watch, openVideo, literal(`video-${index + 1}`));
  });
  b.stack('yt_content', 'yt_shorts_heading', 'Shorts Heading Row', {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  });
  b.heading('yt_shorts_heading', 'yt_shorts_title', 'Shorts Title', '◆ Shorts', 2, {
    fontSize: 21,
    color: '#0f0f0f',
  });
  b.grid('yt_content', 'yt_shorts_grid', 'Short Videos', 4, { gap: 14 });
  videoThumbnails.slice(2, 6).forEach((src, index) => {
    const short = b.stack('yt_shorts_grid', `yt_short_${index}`, `Short ${index + 1}`, {
      gap: 8,
    });
    b.image(
      short.id,
      `yt_short_image_${index}`,
      `Short Image ${index + 1}`,
      src,
      `Short ${index + 1}`,
      {
        height: { mode: 'fixed', value: 240, unit: 'px' },
        borderRadius: 12,
      },
    );
    b.text(
      short.id,
      `yt_short_text_${index}`,
      `Short Caption ${index + 1}`,
      `Creative idea #${index + 1}`,
      {
        color: '#0f0f0f',
        fontSize: 13,
        fontWeight: 650,
      },
    );
  });

  // Reference frame: 1180 px. Tablet preserves the two-rail information
  // architecture with a compact rail; mobile removes the rail and stacks the
  // feed. Wide screens gain density instead of stretching three cards.
  b.responsive('root', {
    tablet: { overflowX: 'hidden', overflowY: 'auto' },
    mobile: { minHeight: 0 },
  });
  b.responsive('yt_header', {
    tablet: { padding: spacing(10, 14), gap: 12 },
    mobile: { padding: spacing(8, 10), gap: 8, minHeight: 56 },
  });
  b.responsive('yt_brand', {
    mobile: { width: { mode: 'fixed', value: 34, unit: 'px' }, overflow: 'hidden', flexShrink: 0 },
  });
  b.responsive('yt_logo', { mobile: { display: 'none' } });
  b.responsive('yt_search_group', {
    tablet: { width: { mode: 'fill' }, minWidth: 0 },
    mobile: { width: { mode: 'fill' }, flexGrow: 1, gap: 4 },
  });
  b.responsive('yt_search_button', {
    mobile: { width: { mode: 'fixed', value: 42, unit: 'px' } },
  });
  b.responsive('yt_header_actions', { mobile: { display: 'none' } });
  b.responsive('yt_body', {
    wide: { justifyContent: 'center' },
    mobile: { minHeight: 0 },
  });
  b.responsive('yt_sidebar', {
    tablet: { width: { mode: 'fixed', value: 154, unit: 'px' }, padding: spacing(12, 8) },
    mobile: { display: 'none' },
  });
  b.responsive('yt_content', {
    tablet: { padding: spacing(16), gap: 20 },
    mobile: { minHeight: 0, padding: spacing(14, 12), gap: 18 },
    wide: { maxWidth: 1680 },
  });
  b.responsive('yt_categories', {
    tablet: { overflowX: 'auto', overflowY: 'hidden' },
  });
  b.responsive('yt_video_grid', {
    tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 18 },
    wide: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 20 },
  });
  b.responsive('yt_shorts_grid', {
    tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
    mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  });
  for (let index = 0; index < 6; index += 1) {
    b.responsive(`yt_thumb_${index}`, {
      mobile: { height: { mode: 'fixed', value: 210, unit: 'px' } },
    });
  }
  for (let index = 0; index < 4; index += 1) {
    b.responsive(`yt_short_image_${index}`, {
      mobile: { height: { mode: 'fixed', value: 188, unit: 'px' } },
    });
  }
  return b.document;
}

function createDashboardTemplate(pageId = 'template_dashboard'): UiDocument {
  const b = new TemplateBuilder(pageId, 'Orbit Analytics', {
    minHeight: 992,
    backgroundColor: '#0a0f17',
    backgroundImage: 'radial-gradient(circle at 55% -25%, rgba(112,75,255,.12), transparent 48%)',
    color: '#f2f4f8',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    padding: spacing(0),
    gap: 0,
    overflow: 'auto',
  });
  const showGrowth = b.publicValue('showGrowth', 'boolean', true, { kind: 'boolean' });
  const activity = b.publicValue(
    'activity',
    'array',
    [
      'Sarah Chen completed a task',
      'Daniel Kim commented on Analytics Dashboard',
      'Maya Patel uploaded Q2 campaign assets.zip',
      'James Wilson created Customer Feedback Portal',
    ],
    {
      kind: 'array',
      item: { kind: 'string' },
    },
  );
  const openReport = b.publicEvent('onOpenReport', { payload: null });

  b.element('root', 'srijika.grid', 'orbit_shell', 'Orbit Application Shell', {
    props: {
      columns: literal(2),
      columnsTemplate: literal('264px minmax(0, 1fr)'),
      rowsTemplate: literal('minmax(992px, 1fr)'),
      ariaLabel: literal('Orbit analytics dashboard'),
    },
    style: {
      display: 'grid',
      width: { mode: 'percent', value: 100 },
      minHeight: 992,
      gap: 0,
    },
  });

  b.container(
    'orbit_shell',
    'orbit_sidebar',
    'Navigation Sidebar',
    {
      minHeight: 992,
      padding: { top: 24, right: 16, bottom: 35, left: 14 },
      gap: 26,
      backgroundColor: '#0d121c',
      backgroundImage: 'linear-gradient(180deg, rgba(13,18,28,.98), rgba(10,15,23,.98))',
      borderColor: '#27303c',
      borderWidth: 1,
      borderRadius: 0,
      overflow: 'hidden',
    },
    'aside',
  );
  b.stack('orbit_sidebar', 'orbit_brand', 'Orbit Brand', {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: { mode: 'hug' },
    padding: { top: 0, right: 10, bottom: 0, left: 10 },
  });
  b.icon('orbit_brand', 'orbit_brand_icon', 'Orbit Mark', 'hexagon', 42, {
    color: '#7650ff',
    filter: 'drop-shadow(0 0 12px rgba(112,75,255,.3))',
  });
  b.heading('orbit_brand', 'orbit_brand_name', 'Orbit Name', 'Orbit', 2, {
    color: '#f5f6fa',
    fontSize: 30,
    fontWeight: 720,
    lineHeight: 1,
  });

  b.stack('orbit_sidebar', 'orbit_navigation', 'Primary Navigation', { gap: 8 });
  const navItems = [
    ['overview', 'Overview', 'home', true],
    ['projects', 'Projects', 'folder', false],
    ['analytics', 'Analytics', 'chart', false],
    ['team', 'Team', 'users', false],
  ] as const;
  navItems.forEach(([key, label, iconName, selected]) => {
    b.container('orbit_navigation', `orbit_nav_${key}`, `${label} Navigation`, {
      height: { mode: 'fixed', value: 52, unit: 'px' },
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      padding: { top: 0, right: 18, bottom: 0, left: 16 },
      backgroundColor: selected ? '#211c38' : 'transparent',
      borderColor: selected ? '#2c2448' : 'transparent',
      borderWidth: selected ? 1 : 0,
      borderRadius: 8,
    });
    b.icon(`orbit_nav_${key}`, `orbit_nav_${key}_icon`, `${label} Icon`, iconName, 22, {
      color: selected ? '#9b7cff' : '#b9c0cb',
    });
    b.text(`orbit_nav_${key}`, `orbit_nav_${key}_label`, `${label} Label`, label, {
      color: selected ? '#a68bff' : '#c4c9d2',
      fontSize: 16,
      fontWeight: selected ? 600 : 450,
    });
  });

  b.stack('orbit_sidebar', 'orbit_sidebar_spacer', 'Sidebar Spacer', {
    flexGrow: 1,
    minHeight: 40,
  });
  b.stack('orbit_sidebar', 'orbit_sidebar_bottom', 'Sidebar Account Area', { gap: 24 });
  b.container('orbit_sidebar_bottom', 'orbit_storage_card', 'Storage Card', {
    minHeight: 172,
    padding: { top: 18, right: 16, bottom: 0, left: 16 },
    gap: 13,
    backgroundColor: '#101721',
    borderColor: '#2a3441',
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  });
  b.heading('orbit_storage_card', 'orbit_storage_title', 'Storage Title', 'Storage', 3, {
    color: '#f0f2f6',
    fontSize: 15,
    fontWeight: 650,
  });
  b.text('orbit_storage_card', 'orbit_storage_copy', 'Storage Usage', '68.4 GB of 100 GB used', {
    color: '#929aa8',
    fontSize: 13,
  });
  b.stack('orbit_storage_card', 'orbit_storage_progress_row', 'Storage Progress Row', {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  });
  b.progress(
    'orbit_storage_progress_row',
    'orbit_storage_progress',
    'Storage Used',
    68,
    '68 percent of storage used',
    '#704bff',
    {
      height: { mode: 'fixed', value: 10, unit: 'px' },
      flexGrow: 1,
      borderRadius: 999,
    },
  );
  b.text('orbit_storage_progress_row', 'orbit_storage_percent', 'Storage Percent', '68%', {
    color: '#f0f2f6',
    fontSize: 13,
    fontWeight: 650,
  });
  b.divider('orbit_storage_card', 'orbit_storage_divider', 'Storage Divider', '#29313d', {
    margin: { top: 1, right: -16, bottom: 0, left: -16 },
  });
  b.stack('orbit_storage_card', 'orbit_upgrade_row', 'Upgrade Plan Row', {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  b.text('orbit_upgrade_row', 'orbit_upgrade_label', 'Upgrade Label', 'Upgrade plan', {
    color: '#b6bdc8',
    fontSize: 13,
  });
  b.icon('orbit_upgrade_row', 'orbit_upgrade_icon', 'Upgrade Arrow', 'chevron-right', 18, {
    color: '#b6bdc8',
  });

  b.container('orbit_sidebar_bottom', 'orbit_profile_card', 'Profile Card', {
    minHeight: 103,
    padding: spacing(16),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#101721',
    borderColor: '#2a3441',
    borderWidth: 1,
    borderRadius: 12,
  });
  b.avatar(
    'orbit_profile_card',
    'orbit_profile_avatar',
    'Alex Johnson Avatar',
    'AJ',
    46,
    'online',
    {
      backgroundColor: '#433175',
    },
  );
  b.stack('orbit_profile_card', 'orbit_profile_copy', 'Profile Copy', {
    flexGrow: 1,
    gap: 4,
    minWidth: 0,
  });
  b.text('orbit_profile_copy', 'orbit_profile_name', 'Profile Name', 'Alex Johnson', {
    color: '#f1f3f7',
    fontSize: 14,
    fontWeight: 650,
  });
  b.text('orbit_profile_copy', 'orbit_profile_email', 'Profile Email', 'alex@orbit.com', {
    color: '#8f97a5',
    fontSize: 12,
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  });
  b.icon('orbit_profile_card', 'orbit_profile_chevron', 'Profile Menu', 'chevron-down', 18, {
    color: '#aab1bd',
  });

  b.stack('orbit_shell', 'orbit_main', 'Dashboard Main', {
    minWidth: 0,
    minHeight: 992,
    gap: 0,
    backgroundColor: 'transparent',
  });
  b.container(
    'orbit_main',
    'orbit_top_header',
    'Top Header',
    {
      height: { mode: 'fixed', value: 77, unit: 'px' },
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: { top: 0, right: 29, bottom: 0, left: 36 },
      gap: 24,
      backgroundColor: 'rgba(12,17,26,.88)',
      backdropFilter: 'blur(14px)',
      borderColor: '#27303c',
      borderWidth: 1,
      borderRadius: 0,
    },
    'header',
  );
  b.container('orbit_top_header', 'orbit_search', 'Project Search', {
    width: { mode: 'fixed', value: 480, unit: 'px' },
    height: { mode: 'fixed', value: 42, unit: 'px' },
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: { top: 0, right: 16, bottom: 0, left: 16 },
    backgroundColor: '#111923',
    borderColor: '#2b3541',
    borderWidth: 1,
    borderRadius: 8,
  });
  b.icon('orbit_search', 'orbit_search_icon', 'Search Icon', 'search', 20, { color: '#87909f' });
  b.text('orbit_search', 'orbit_search_placeholder', 'Search Placeholder', 'Search projects', {
    color: '#9aa2af',
    fontSize: 15,
  });
  b.stack('orbit_top_header', 'orbit_header_actions', 'Header Actions', {
    width: { mode: 'hug' },
    flexDirection: 'row',
    alignItems: 'center',
    gap: 26,
  });
  b.icon('orbit_header_actions', 'orbit_notification_icon', 'Notifications', 'bell', 27, {
    color: '#c7ccd5',
  });
  b.avatar('orbit_header_actions', 'orbit_header_avatar', 'Alex Header Avatar', 'AJ', 42, 'none', {
    backgroundColor: '#4c3977',
    borderColor: '#cfd3da',
    borderWidth: 2,
  });

  b.container(
    'orbit_main',
    'orbit_content',
    'Workspace Overview',
    {
      minWidth: 0,
      padding: { top: 23, right: 28, bottom: 36, left: 25 },
      gap: 14,
      backgroundColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
    },
    'main',
  );
  b.stack('orbit_content', 'orbit_heading_row', 'Workspace Heading Row', {
    minHeight: 94,
    flexDirection: 'row',
    alignItems: 'start',
    justifyContent: 'space-between',
    gap: 24,
  });
  b.stack('orbit_heading_row', 'orbit_heading_copy', 'Workspace Heading Copy', { gap: 4 });
  b.text('orbit_heading_copy', 'orbit_eyebrow', 'Workspace Label', 'WORKSPACE OVERVIEW', {
    color: '#8f6cff',
    fontSize: 12,
    fontWeight: 750,
    letterSpacing: 0.4,
  });
  b.heading('orbit_heading_copy', 'orbit_title', 'Dashboard Title', 'Good morning, Alex', 1, {
    color: '#f5f6fa',
    fontSize: 36,
    fontWeight: 740,
    lineHeight: 1.08,
  });
  b.text(
    'orbit_heading_copy',
    'orbit_subtitle',
    'Dashboard Subtitle',
    'Here is what is happening across your projects.',
    { color: '#929aa7', fontSize: 15 },
  );
  const newProject = b.button(
    'orbit_heading_row',
    'orbit_new_project',
    'New Project',
    '+  New project',
    'primary',
    {
      width: { mode: 'fixed', value: 178, unit: 'px' },
      height: { mode: 'fixed', value: 50, unit: 'px' },
      borderRadius: 9,
      backgroundColor: '#704bff',
      backgroundImage: 'linear-gradient(135deg, #7c55ff, #6540e8)',
      boxShadow: '0 10px 24px rgba(101,64,232,.2)',
      fontSize: 16,
      fontWeight: 650,
    },
  );
  b.bindClick(newProject, openReport);

  b.grid('orbit_content', 'orbit_metrics', 'Metric Cards', 4, {
    gap: 18,
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  });
  const statRepeat = b.repeat(
    'orbit_metrics',
    'orbit_metric_repeat',
    'Metric Card Repeat',
    literal([
      {
        label: 'Active projects',
        value: '12',
        trend: '↗ 20% vs last month',
        icon: 'briefcase',
        positive: true,
      },
      {
        label: 'Tasks completed',
        value: '184',
        trend: '↗ 15% vs last month',
        icon: 'check-circle',
        positive: true,
      },
      {
        label: 'Team members',
        value: '24',
        trend: '↗ 9% vs last month',
        icon: 'users',
        positive: true,
      },
      {
        label: 'Weekly hours',
        value: '326',
        trend: '↘ 8% vs last week',
        icon: 'clock',
        positive: false,
      },
    ]),
    {
      kind: 'object',
      fields: {
        label: { shape: { kind: 'string' }, required: true },
        value: { shape: { kind: 'string' }, required: true },
        trend: { shape: { kind: 'string' }, required: true },
        icon: { shape: { kind: 'string' }, required: true },
        positive: { shape: { kind: 'boolean' }, required: true },
      },
      additionalProperties: false,
    },
  );
  b.container(statRepeat.id, 'orbit_metric_card', 'Metric Card', {
    minHeight: 124,
    padding: spacing(18),
    gap: 12,
    backgroundColor: '#111923',
    backgroundImage: 'linear-gradient(145deg, rgba(18,25,35,.98), rgba(15,22,32,.98))',
    borderColor: '#293440',
    borderWidth: 1,
    borderRadius: 9,
    boxShadow: '0 16px 38px rgba(0,0,0,.08)',
  });
  b.stack('orbit_metric_card', 'orbit_metric_top', 'Metric Summary', {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  });
  b.container('orbit_metric_top', 'orbit_metric_icon_shell', 'Metric Icon Shell', {
    width: { mode: 'fixed', value: 54, unit: 'px' },
    height: { mode: 'fixed', value: 54, unit: 'px' },
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#332766',
    borderColor: '#56439b',
    borderWidth: 1,
    borderRadius: 12,
  });
  b.icon(
    'orbit_metric_icon_shell',
    'orbit_metric_icon',
    'Metric Icon',
    ref(statRepeat.itemSymbolId, ['icon']),
    25,
    { color: '#f2efff' },
  );
  b.stack('orbit_metric_top', 'orbit_metric_copy', 'Metric Copy', { gap: 3, minWidth: 0 });
  b.text(
    'orbit_metric_copy',
    'orbit_metric_label',
    'Metric Label',
    ref(statRepeat.itemSymbolId, ['label']),
    { color: '#9ca4b1', fontSize: 14 },
  );
  b.heading(
    'orbit_metric_copy',
    'orbit_metric_value',
    'Metric Value',
    ref(statRepeat.itemSymbolId, ['value']),
    2,
    { color: '#f5f6fa', fontSize: 30, fontWeight: 700, lineHeight: 1 },
  );
  const metricTrend = b.condition(
    'orbit_metric_card',
    'orbit_metric_trend_condition',
    'Metric Trend Tone',
    ref(statRepeat.itemSymbolId, ['positive']),
  );
  b.text(
    metricTrend,
    'orbit_metric_trend_positive',
    'Positive Metric Trend',
    ref(statRepeat.itemSymbolId, ['trend']),
    { color: '#53d38b', fontSize: 12, fontWeight: 600 },
    'whenTrue',
  );
  b.text(
    metricTrend,
    'orbit_metric_trend_negative',
    'Negative Metric Trend',
    ref(statRepeat.itemSymbolId, ['trend']),
    { color: '#ff5959', fontSize: 12, fontWeight: 600 },
    'whenFalse',
  );

  const panelStyle: StyleProperties = {
    height: { mode: 'fixed', value: 277, unit: 'px' },
    padding: spacing(18),
    gap: 12,
    backgroundColor: '#101721',
    borderColor: '#293440',
    borderWidth: 1,
    borderRadius: 9,
    overflow: 'hidden',
  };
  b.grid('orbit_content', 'orbit_charts', 'Analytics Charts', 2, {
    gap: 16,
    gridTemplateColumns: '1fr 1fr',
  });
  b.container('orbit_charts', 'orbit_activity_panel', 'Project Activity Panel', panelStyle);
  b.stack('orbit_activity_panel', 'orbit_activity_header', 'Project Activity Header', {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  });
  b.heading(
    'orbit_activity_header',
    'orbit_activity_title',
    'Activity Chart Title',
    'Project activity',
    2,
    {
      color: '#f3f4f7',
      fontSize: 17,
      fontWeight: 650,
    },
  );
  b.badge(
    'orbit_activity_header',
    'orbit_activity_range',
    'Chart Range',
    'Last 7 days',
    'neutral',
    {
      padding: { top: 7, right: 11, bottom: 7, left: 11 },
      borderRadius: 8,
      color: '#b7bdc8',
      fontSize: 12,
    },
  );
  b.stack('orbit_activity_panel', 'orbit_activity_legend', 'Activity Legend', {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  });
  b.badge(
    'orbit_activity_legend',
    'orbit_projects_legend',
    'Projects Legend',
    'Projects created',
    'primary',
    {
      padding: { top: 4, right: 8, bottom: 4, left: 8 },
      borderRadius: 999,
      fontSize: 11,
    },
  );
  b.badge(
    'orbit_activity_legend',
    'orbit_tasks_legend',
    'Tasks Legend',
    'Tasks completed',
    'info',
    {
      padding: { top: 4, right: 8, bottom: 4, left: 8 },
      borderRadius: 999,
      fontSize: 11,
    },
  );
  b.chart(
    'orbit_activity_panel',
    'orbit_activity_chart',
    'Project Activity Lines',
    'line',
    [
      [30, 50, 40, 70, 30, 50, 48],
      [15, 28, 22, 42, 17, 27, 34],
    ],
    ['#704bff', '#20c6e8'],
    'Projects created and tasks completed over seven days',
    {
      width: { mode: 'percent', value: 100 },
      height: { mode: 'fixed', value: 132, unit: 'px' },
      minHeight: 0,
      color: '#5b6471',
    },
  );
  b.grid('orbit_activity_panel', 'orbit_day_labels', 'Chart Day Labels', 7, {
    gap: 0,
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  });
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day, index) =>
    b.text('orbit_day_labels', `orbit_day_${index}`, `${day} Label`, day, {
      color: '#858e9c',
      fontSize: 10,
      textAlign: 'center',
    }),
  );
  const growth = b.condition(
    'orbit_activity_panel',
    'dash_growth_if',
    'Growth Insight',
    ref(showGrowth),
  );
  b.text(
    growth,
    'dash_growth_true',
    'Growth Message',
    'Growth is 18% ahead of target.',
    { color: '#53d38b', fontSize: 11 },
    'whenTrue',
  );
  b.text(
    growth,
    'dash_growth_false',
    'No Growth Message',
    'Growth comparison is hidden.',
    { color: '#8f97a5', fontSize: 11 },
    'whenFalse',
  );

  b.container('orbit_charts', 'orbit_progress_panel', 'Task Progress Panel', panelStyle);
  b.heading(
    'orbit_progress_panel',
    'orbit_progress_title',
    'Task Progress Title',
    'Task progress',
    2,
    {
      color: '#f3f4f7',
      fontSize: 17,
      fontWeight: 650,
    },
  );
  b.stack('orbit_progress_panel', 'orbit_progress_body', 'Task Progress Body', {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 24,
    flexGrow: 1,
  });
  b.container('orbit_progress_body', 'orbit_donut_shell', 'Task Donut Shell', {
    width: { mode: 'fixed', value: 190, unit: 'px' },
    height: { mode: 'fixed', value: 190, unit: 'px' },
    minHeight: 0,
    position: 'relative',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
  });
  b.chart(
    'orbit_donut_shell',
    'orbit_task_donut',
    'Task Donut Chart',
    'donut',
    [94, 56, 34],
    ['#704bff', '#20c6e8', '#e24388'],
    'Task progress: 94 completed, 56 in progress and 34 todo',
    {
      position: 'absolute',
      top: 0,
      left: 0,
      width: { mode: 'percent', value: 100 },
      height: { mode: 'percent', value: 100 },
    },
  );
  b.heading('orbit_donut_shell', 'orbit_donut_value', 'Total Tasks', '184', 2, {
    position: 'absolute',
    top: 66,
    left: 0,
    width: { mode: 'percent', value: 100 },
    color: '#f5f6fa',
    fontSize: 31,
    textAlign: 'center',
  });
  b.text('orbit_donut_shell', 'orbit_donut_label', 'Total Tasks Label', 'Total tasks', {
    position: 'absolute',
    top: 105,
    left: 0,
    width: { mode: 'percent', value: 100 },
    color: '#8f97a5',
    fontSize: 13,
    textAlign: 'center',
  });
  b.stack('orbit_progress_body', 'orbit_progress_legend', 'Task Progress Legend', {
    width: { mode: 'fill' },
    gap: 0,
  });
  [
    ['completed', 'Completed', '94 (51%)', 'primary'],
    ['progress', 'In progress', '56 (30%)', 'info'],
    ['todo', 'Todo', '34 (19%)', 'danger'],
  ].forEach(([key, label, value, tone], index) => {
    if (index > 0) {
      b.divider('orbit_progress_legend', `orbit_${key}_divider`, `${label} Divider`);
    }
    b.stack('orbit_progress_legend', `orbit_${key}_row`, `${label} Row`, {
      minHeight: 49,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    });
    b.badge(
      `orbit_${key}_row`,
      `orbit_${key}_badge`,
      `${label} Badge`,
      label!,
      tone as 'primary' | 'info' | 'danger',
      { padding: { top: 4, right: 8, bottom: 4, left: 8 }, borderRadius: 999, fontSize: 11 },
    );
    b.text(`orbit_${key}_row`, `orbit_${key}_value`, `${label} Value`, value!, {
      color: '#e7e9ee',
      fontSize: 13,
      whiteSpace: 'nowrap',
    });
  });

  b.grid('orbit_content', 'orbit_bottom_grid', 'Project And Team Panels', 2, {
    gap: 16,
    gridTemplateColumns: '1.32fr 1fr',
  });
  const bottomPanelStyle: StyleProperties = {
    height: { mode: 'fixed', value: 317, unit: 'px' },
    padding: spacing(18),
    gap: 10,
    backgroundColor: '#101721',
    borderColor: '#293440',
    borderWidth: 1,
    borderRadius: 9,
    overflow: 'hidden',
  };
  b.container(
    'orbit_bottom_grid',
    'orbit_projects_panel',
    'Recent Projects Panel',
    bottomPanelStyle,
  );
  b.heading(
    'orbit_projects_panel',
    'orbit_projects_title',
    'Recent Projects Title',
    'Recent projects',
    2,
    {
      color: '#f3f4f7',
      fontSize: 17,
      fontWeight: 650,
    },
  );
  b.element(
    'orbit_projects_panel',
    'srijika.grid',
    'orbit_projects_header',
    'Project Table Header',
    {
      props: {
        columns: literal(4),
        columnsTemplate: literal('minmax(0, 1.55fr) minmax(95px, .8fr) 58px 88px'),
      },
      style: { display: 'grid', alignItems: 'center', gap: 12, padding: spacing(0, 10) },
    },
  );
  ['Project', 'Progress', 'Members', 'Status'].forEach((label, index) =>
    b.text('orbit_projects_header', `orbit_projects_header_${index}`, `${label} Header`, label, {
      color: '#8d96a4',
      fontSize: 10,
      textAlign: index > 1 ? 'center' : 'left',
    }),
  );
  b.divider('orbit_projects_panel', 'orbit_projects_header_divider', 'Project Header Divider');
  const projects = [
    ['website', 'Orbit Website Redesign', 'Website', 78, 'upload', 'On track', 'success', 'SC'],
    [
      'mobile',
      'Mobile App Development',
      'Mobile',
      62,
      'layout-dashboard',
      'In progress',
      'info',
      'DK',
    ],
    ['analytics', 'Analytics Dashboard', 'Internal Tool', 45, 'chart', 'At risk', 'warning', 'MP'],
    ['marketing', 'Marketing Campaign', 'Marketing', 92, 'cube', 'On track', 'success', 'JW'],
  ] as const;
  projects.forEach(([key, project, type, progress, iconName, status, tone, members], index) => {
    b.element('orbit_projects_panel', 'srijika.grid', `orbit_project_${key}`, `${project} Row`, {
      props: {
        columns: literal(4),
        columnsTemplate: literal('minmax(0, 1.55fr) minmax(95px, .8fr) 58px 88px'),
      },
      style: {
        display: 'grid',
        minHeight: 49,
        alignItems: 'center',
        gap: 12,
        padding: spacing(0, 2),
      },
    });
    b.stack(`orbit_project_${key}`, `orbit_project_${key}_identity`, `${project} Identity`, {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    });
    b.container(
      `orbit_project_${key}_identity`,
      `orbit_project_${key}_icon_shell`,
      `${project} Icon Shell`,
      {
        width: { mode: 'fixed', value: 38, unit: 'px' },
        height: { mode: 'fixed', value: 38, unit: 'px' },
        minHeight: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          index === 1 ? '#0b7892' : index === 2 ? '#c72e70' : index === 3 ? '#e4a900' : '#6842ee',
        borderWidth: 0,
        borderRadius: 8,
      },
    );
    b.icon(
      `orbit_project_${key}_icon_shell`,
      `orbit_project_${key}_icon`,
      `${project} Icon`,
      iconName,
      19,
      { color: '#ffffff' },
    );
    b.stack(`orbit_project_${key}_identity`, `orbit_project_${key}_copy`, `${project} Copy`, {
      minWidth: 0,
      gap: 2,
    });
    b.text(`orbit_project_${key}_copy`, `orbit_project_${key}_name`, `${project} Name`, project, {
      color: '#e8eaf0',
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    b.text(`orbit_project_${key}_copy`, `orbit_project_${key}_type`, `${project} Type`, type, {
      color: '#818b99',
      fontSize: 10,
    });
    b.stack(`orbit_project_${key}`, `orbit_project_${key}_progress_cell`, `${project} Progress`, {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    });
    b.text(
      `orbit_project_${key}_progress_cell`,
      `orbit_project_${key}_percent`,
      `${project} Percent`,
      `${progress}%`,
      { color: '#e2e5ea', fontSize: 11, width: { mode: 'fixed', value: 27, unit: 'px' } },
    );
    b.progress(
      `orbit_project_${key}_progress_cell`,
      `orbit_project_${key}_progress`,
      `${project} Progress Bar`,
      progress,
      `${project} ${progress} percent complete`,
      '#704bff',
      { height: { mode: 'fixed', value: 7, unit: 'px' }, flexGrow: 1, borderRadius: 999 },
    );
    b.avatar(
      `orbit_project_${key}`,
      `orbit_project_${key}_members`,
      `${project} Members`,
      members,
      28,
      'online',
      { justifySelf: 'center', backgroundColor: '#433175', fontSize: 9 },
    );
    b.badge(
      `orbit_project_${key}`,
      `orbit_project_${key}_status`,
      `${project} Status`,
      status,
      tone,
      {
        justifySelf: 'center',
        padding: { top: 5, right: 8, bottom: 5, left: 8 },
        borderRadius: 999,
        fontSize: 10,
      },
    );
  });

  b.container('orbit_bottom_grid', 'orbit_team_panel', 'Team Activity Panel', bottomPanelStyle);
  b.heading('orbit_team_panel', 'orbit_team_title', 'Team Activity Title', 'Team activity', 2, {
    color: '#f3f4f7',
    fontSize: 17,
    fontWeight: 650,
  });
  const activityRepeat = b.repeat(
    'orbit_team_panel',
    'dash_activity_repeat',
    'Activity Feed',
    ref(activity),
    { kind: 'string' },
  );
  b.stack(activityRepeat.id, 'dash_activity_row', 'Activity Row', { gap: 8 });
  b.stack('dash_activity_row', 'dash_activity_content', 'Activity Content', {
    minHeight: 53,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  });
  b.avatar('dash_activity_content', 'dash_activity_avatar', 'Activity Avatar', 'A', 40, 'online', {
    backgroundColor: '#4a386d',
  });
  b.text(
    'dash_activity_content',
    'dash_activity_item',
    'Activity Item',
    ref(activityRepeat.itemSymbolId),
    {
      color: '#d5d9e0',
      fontSize: 12,
      lineHeight: 1.35,
      flexGrow: 1,
    },
  );
  b.text('dash_activity_content', 'dash_activity_time', 'Activity Time', 'Recently', {
    color: '#7f8997',
    fontSize: 10,
    whiteSpace: 'nowrap',
  });
  b.divider('dash_activity_row', 'dash_activity_divider', 'Activity Divider');

  // Orbit keeps the supplied 1180 px geometry untouched. At tablet the rail
  // becomes icon-only, while mobile removes it from grid flow and stacks every
  // analytical region. Wide caps the readable content measure.
  b.responsive('root', {
    tablet: { overflowX: 'hidden', overflowY: 'auto' },
    mobile: { minHeight: 0 },
  });
  b.responsive('orbit_shell', {
    tablet: {
      gridTemplateColumns: '84px minmax(0, 1fr)',
      minHeight: 0,
    },
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)' },
    wide: {
      gridTemplateColumns: '280px minmax(0, 1fr)',
      maxWidth: 1720,
      alignSelf: 'center',
    },
  });
  b.responsive('orbit_sidebar', {
    tablet: { minHeight: 0, padding: spacing(18, 10), gap: 20 },
    mobile: { display: 'none' },
  });
  b.responsive('orbit_brand', {
    tablet: {
      width: { mode: 'percent', value: 100 },
      padding: spacing(0),
      justifyContent: 'center',
    },
  });
  b.responsive('orbit_brand_name', { tablet: { display: 'none' } });
  b.responsive('orbit_sidebar_bottom', { tablet: { display: 'none' } });
  for (const [key] of navItems) {
    b.responsive(`orbit_nav_${key}`, {
      tablet: { padding: spacing(0), justifyContent: 'center', gap: 0 },
    });
    b.responsive(`orbit_nav_${key}_label`, { tablet: { display: 'none' } });
  }
  b.responsive('orbit_main', { mobile: { minHeight: 0 } });
  b.responsive('orbit_top_header', {
    tablet: { padding: spacing(0, 18), gap: 16 },
    mobile: { height: { mode: 'fixed', value: 64, unit: 'px' }, padding: spacing(0, 12), gap: 10 },
  });
  b.responsive('orbit_search', {
    tablet: { width: { mode: 'fill' }, maxWidth: 520 },
    mobile: { width: { mode: 'fill' }, minWidth: 0 },
  });
  b.responsive('orbit_header_actions', { mobile: { gap: 10 } });
  b.responsive('orbit_notification_icon', { mobile: { display: 'none' } });
  b.responsive('orbit_content', {
    tablet: { padding: spacing(20), gap: 16 },
    mobile: { padding: spacing(16, 12), gap: 14 },
    wide: { width: { mode: 'percent', value: 100 }, maxWidth: 1440, alignSelf: 'center' },
  });
  b.responsive('orbit_heading_row', {
    mobile: { minHeight: 0, flexDirection: 'column', alignItems: 'stretch', gap: 16 },
  });
  b.responsive('orbit_title', { mobile: { fontSize: 29, overflowWrap: 'anywhere' } });
  b.responsive('orbit_subtitle', { mobile: { fontSize: 13, overflowWrap: 'break-word' } });
  b.responsive('orbit_new_project', {
    mobile: {
      width: { mode: 'percent', value: 100 },
      height: { mode: 'fixed', value: 46, unit: 'px' },
    },
  });
  b.responsive('orbit_metrics', {
    tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 },
  });
  b.responsive('orbit_charts', {
    tablet: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 },
  });
  b.responsive('orbit_progress_panel', {
    mobile: { height: { mode: 'hug' }, minHeight: 430, overflow: 'visible' },
  });
  b.responsive('orbit_progress_body', {
    mobile: { flexDirection: 'column', justifyContent: 'start', gap: 14 },
  });
  b.responsive('orbit_donut_shell', {
    mobile: {
      width: { mode: 'fixed', value: 164, unit: 'px' },
      height: { mode: 'fixed', value: 164, unit: 'px' },
    },
  });
  b.responsive('orbit_bottom_grid', {
    tablet: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 },
  });
  b.responsive('orbit_projects_panel', {
    tablet: { overflowX: 'auto', overflowY: 'hidden' },
    mobile: { height: { mode: 'hug' }, overflowX: 'hidden', overflowY: 'visible' },
  });
  b.responsive('orbit_projects_header', { mobile: { display: 'none' } });
  for (const [key] of projects) {
    b.responsive(`orbit_project_${key}`, {
      mobile: {
        gridTemplateColumns: 'minmax(0, 1fr)',
        alignItems: 'stretch',
        gap: 9,
        padding: spacing(10, 0),
      },
    });
    b.responsive(`orbit_project_${key}_members`, { mobile: { justifySelf: 'start' } });
    b.responsive(`orbit_project_${key}_status`, { mobile: { justifySelf: 'start' } });
  }
  b.responsive('orbit_team_panel', {
    mobile: { height: { mode: 'hug' }, overflow: 'visible' },
  });
  b.responsive('dash_activity_content', {
    mobile: { alignItems: 'start', flexWrap: 'wrap' },
  });
  b.responsive('dash_activity_time', { mobile: { width: { mode: 'percent', value: 100 } } });
  return b.document;
}

const productImages = [
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=700&q=80',
];

function createCommerceTemplate(pageId = 'template_commerce'): UiDocument {
  const b = new TemplateBuilder(pageId, 'Northstar Store', {
    minHeight: 820,
    backgroundColor: '#f6f3ed',
    color: '#1c251f',
    overflow: 'auto',
  });
  const addToCart = b.publicEvent('onAddToCart', {
    payload: { name: 'productId', shape: { kind: 'string' } },
  });
  b.container(
    'root',
    'shop_header',
    'Store Header',
    {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: { mode: 'percent', value: 100 },
      padding: spacing(18, 34),
      backgroundColor: '#f6f3ed',
      borderWidth: 0,
      borderRadius: 0,
    },
    'header',
  );
  b.heading('shop_header', 'shop_logo', 'Store Logo', 'NORTHSTAR', 2, {
    color: '#1c251f',
    fontSize: 18,
    fontWeight: 800,
  });
  b.stack('shop_header', 'shop_nav', 'Store Navigation', {
    flexDirection: 'row',
    gap: 18,
    width: { mode: 'hug' },
  });
  ['New', 'Living', 'Wear', 'Stories'].forEach((label, index) =>
    b.button('shop_nav', `shop_nav_${index}`, `${label} Link`, label, 'ghost', { fontSize: 13 }),
  );
  b.button('shop_header', 'shop_cart', 'Cart Button', 'Bag · 2', 'secondary', {
    borderRadius: 18,
  });
  b.container(
    'root',
    'shop_hero',
    'Store Hero',
    {
      minHeight: 315,
      padding: spacing(46, 52),
      gap: 16,
      backgroundColor: '#24493a',
      borderWidth: 0,
      borderRadius: 0,
      justifyContent: 'center',
    },
    'section',
  );
  b.text('shop_hero', 'shop_kicker', 'Hero Kicker', 'THE CONSIDERED HOME', {
    color: '#d5e8d8',
    fontSize: 12,
    fontWeight: 800,
  });
  b.heading('shop_hero', 'shop_title', 'Hero Title', 'Objects for slower, better days.', 1, {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: 650,
    maxWidth: 620,
  });
  b.text(
    'shop_hero',
    'shop_copy',
    'Hero Copy',
    'A small collection of durable pieces, chosen for everyday rituals.',
    {
      color: '#d5e8d8',
      fontSize: 16,
      maxWidth: 540,
    },
  );
  b.button('shop_hero', 'shop_cta', 'Shop Collection', 'Shop the collection', 'secondary', {
    borderRadius: 22,
  });
  b.container(
    'root',
    'shop_products',
    'Product Section',
    {
      padding: spacing(34),
      gap: 22,
      backgroundColor: '#f6f3ed',
      borderWidth: 0,
      borderRadius: 0,
    },
    'section',
  );
  b.stack('shop_products', 'shop_products_heading', 'Product Heading', {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  });
  b.heading('shop_products_heading', 'shop_featured', 'Featured Title', 'Featured pieces', 2, {
    color: '#1c251f',
    fontSize: 25,
  });
  b.text('shop_products_heading', 'shop_count', 'Product Count', '04 products', {
    color: '#657068',
    fontSize: 12,
  });
  b.grid('shop_products', 'shop_grid', 'Product Grid', 4, { gap: 16 });
  ['Field Watch', 'Everyday Runner', 'Oak Lounge', 'Stone Brewer'].forEach((name, index) => {
    const product = b.stack('shop_grid', `product_${index}`, `Product ${name}`, { gap: 8 });
    b.image(product.id, `product_image_${index}`, `${name} Image`, productImages[index]!, name, {
      height: { mode: 'fixed', value: 205, unit: 'px' },
      borderRadius: 8,
    });
    b.heading(product.id, `product_name_${index}`, `${name} Name`, name, 3, {
      color: '#1c251f',
      fontSize: 15,
    });
    b.text(product.id, `product_price_${index}`, `${name} Price`, `$${89 + index * 45}`, {
      color: '#657068',
      fontSize: 13,
    });
    const add = b.button(
      product.id,
      `product_add_${index}`,
      `Add ${name}`,
      'Add to bag',
      'primary',
      {
        width: { mode: 'percent', value: 100 },
        borderRadius: 8,
      },
    );
    b.bindClick(add, addToCart, literal(`product-${index + 1}`));
  });

  b.responsive('root', {
    tablet: { overflowX: 'hidden', overflowY: 'auto' },
    mobile: { minHeight: 0 },
  });
  b.responsive('shop_header', {
    tablet: { padding: spacing(16, 22) },
    mobile: { flexWrap: 'wrap', padding: spacing(14), gap: 10 },
  });
  b.responsive('shop_nav', {
    tablet: { gap: 10 },
    mobile: {
      order: 3,
      width: { mode: 'percent', value: 100 },
      overflowX: 'auto',
      overflowY: 'hidden',
    },
  });
  for (let index = 0; index < 4; index += 1) {
    b.responsive(`shop_nav_${index}`, { mobile: { flexShrink: 0 } });
  }
  b.responsive('shop_hero', {
    tablet: { padding: spacing(38, 32) },
    mobile: { minHeight: 300, padding: spacing(30, 20), gap: 14 },
  });
  b.responsive('shop_title', { mobile: { fontSize: 32, overflowWrap: 'break-word' } });
  b.responsive('shop_products', {
    tablet: { padding: spacing(24) },
    mobile: { padding: spacing(22, 14), gap: 18 },
    wide: { width: { mode: 'percent', value: 100 }, maxWidth: 1600, alignSelf: 'center' },
  });
  b.responsive('shop_grid', {
    tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 20 },
  });
  for (let index = 0; index < 4; index += 1) {
    b.responsive(`product_image_${index}`, {
      mobile: { height: { mode: 'fixed', value: 260, unit: 'px' } },
    });
  }
  return b.document;
}

function createPortfolioTemplate(pageId = 'template_portfolio'): UiDocument {
  const b = new TemplateBuilder(pageId, 'Mira Creative Portfolio', {
    minHeight: 820,
    padding: spacing(26, 34),
    gap: 42,
    backgroundColor: '#111113',
    color: '#f6f4ef',
    overflow: 'auto',
  });
  const contact = b.publicEvent('onContact', { payload: null });
  b.stack('root', 'portfolio_nav', 'Portfolio Navigation', {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  });
  b.heading('portfolio_nav', 'portfolio_brand', 'Creator Name', 'MIRA / 24', 2, {
    color: '#f6f4ef',
    fontSize: 15,
    fontWeight: 800,
  });
  b.text(
    'portfolio_nav',
    'portfolio_availability',
    'Availability',
    'Available for select projects',
    {
      color: '#a5a29b',
      fontSize: 12,
    },
  );
  b.container('root', 'portfolio_hero', 'Portfolio Hero', {
    minHeight: 350,
    padding: spacing(42),
    gap: 22,
    backgroundColor: '#232127',
    borderColor: '#343139',
    borderWidth: 1,
    borderRadius: 18,
    justifyContent: 'center',
  });
  b.text('portfolio_hero', 'portfolio_kicker', 'Hero Kicker', 'INDEPENDENT DESIGNER · BERLIN', {
    color: '#d7ff64',
    fontSize: 12,
    fontWeight: 800,
  });
  b.heading(
    'portfolio_hero',
    'portfolio_title',
    'Hero Statement',
    'I turn complex products into clear, memorable experiences.',
    1,
    {
      color: '#f6f4ef',
      fontSize: 48,
      fontWeight: 600,
      maxWidth: 870,
    },
  );
  const hello = b.button(
    'portfolio_hero',
    'portfolio_contact',
    'Contact Action',
    'Start a conversation ↗',
    'primary',
    {
      borderRadius: 22,
    },
  );
  b.bindClick(hello, contact);
  b.stack('root', 'portfolio_work_heading', 'Selected Work Heading', {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'end',
  });
  b.heading('portfolio_work_heading', 'portfolio_work_title', 'Selected Work', 'Selected work', 2, {
    color: '#f6f4ef',
    fontSize: 28,
  });
  b.text('portfolio_work_heading', 'portfolio_work_year', 'Work Year', '2022—2026', {
    color: '#a5a29b',
    fontSize: 12,
  });
  b.grid('root', 'portfolio_grid', 'Project Grid', 2, { gap: 18 });
  (
    [
      ['Atlas Finance', 'Product strategy · Interface', '#5148e5'],
      ['Common Ground', 'Identity · Digital platform', '#bf5f39'],
      ['Mono House', 'Commerce · Art direction', '#347c68'],
      ['Field Notes', 'Editorial · Interaction', '#7a5a9d'],
    ] as const
  ).forEach(([title, meta, color], index) => {
    b.container('portfolio_grid', `portfolio_project_${index}`, `Project ${title}`, {
      minHeight: 220,
      padding: spacing(24),
      gap: 90,
      backgroundColor: color,
      borderWidth: 0,
      borderRadius: 14,
      justifyContent: 'space-between',
    });
    b.text(
      `portfolio_project_${index}`,
      `portfolio_project_num_${index}`,
      'Project Number',
      `0${index + 1}`,
      {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 800,
      },
    );
    b.stack(`portfolio_project_${index}`, `portfolio_project_copy_${index}`, 'Project Copy', {
      gap: 5,
    });
    b.heading(
      `portfolio_project_copy_${index}`,
      `portfolio_project_title_${index}`,
      'Project Title',
      title,
      3,
      {
        color: '#ffffff',
        fontSize: 24,
      },
    );
    b.text(
      `portfolio_project_copy_${index}`,
      `portfolio_project_meta_${index}`,
      'Project Services',
      meta,
      {
        color: '#f3f1ed',
        fontSize: 12,
      },
    );
  });

  b.responsive('root', {
    tablet: { padding: spacing(24), gap: 34, overflowX: 'hidden', overflowY: 'auto' },
    mobile: { minHeight: 0, padding: spacing(18, 14), gap: 28 },
    wide: { padding: spacing(38, 52) },
  });
  b.responsive('portfolio_nav', {
    mobile: { flexDirection: 'column', alignItems: 'start', gap: 8 },
    wide: { width: { mode: 'percent', value: 100 }, maxWidth: 1500, alignSelf: 'center' },
  });
  b.responsive('portfolio_hero', {
    tablet: { padding: spacing(34) },
    mobile: { minHeight: 320, padding: spacing(24, 20), gap: 18 },
    wide: { width: { mode: 'percent', value: 100 }, maxWidth: 1500, alignSelf: 'center' },
  });
  b.responsive('portfolio_title', {
    tablet: { fontSize: 40 },
    mobile: { fontSize: 31, overflowWrap: 'anywhere' },
  });
  b.responsive('portfolio_work_heading', {
    mobile: { flexDirection: 'column', alignItems: 'start', gap: 8 },
    wide: { width: { mode: 'percent', value: 100 }, maxWidth: 1500, alignSelf: 'center' },
  });
  b.responsive('portfolio_grid', {
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 },
    wide: {
      width: { mode: 'percent', value: 100 },
      maxWidth: 1500,
      alignSelf: 'center',
      gap: 22,
    },
  });
  return b.document;
}

function createSettingsTemplate(pageId = 'template_settings'): UiDocument {
  const b = new TemplateBuilder(pageId, 'Account Settings', {
    minHeight: 820,
    backgroundColor: '#f4f6f8',
    color: '#18212b',
    overflow: 'auto',
  });
  const save = b.publicEvent('onSave', { payload: null });
  b.container(
    'root',
    'settings_header',
    'Settings Header',
    {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing(16, 28),
      width: { mode: 'percent', value: 100 },
      backgroundColor: '#ffffff',
      borderColor: '#dce1e7',
      borderWidth: 1,
      borderRadius: 0,
    },
    'header',
  );
  b.heading('settings_header', 'settings_logo', 'Product Name', 'Srijika Cloud', 2, {
    color: '#18212b',
    fontSize: 18,
  });
  b.text('settings_header', 'settings_user', 'Current User', 'Avery Morgan · Pro', {
    color: '#65717e',
    fontSize: 13,
  });
  b.container('root', 'settings_body', 'Settings Body', {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: { mode: 'percent', value: 100 },
    minHeight: 755,
    padding: spacing(24),
    gap: 24,
    backgroundColor: '#f4f6f8',
    borderWidth: 0,
    borderRadius: 0,
  });
  b.container(
    'settings_body',
    'settings_sidebar',
    'Settings Navigation',
    {
      width: { mode: 'fixed', value: 230, unit: 'px' },
      flexShrink: 0,
      padding: spacing(16),
      gap: 6,
      backgroundColor: '#ffffff',
      borderColor: '#dce1e7',
      borderWidth: 1,
      borderRadius: 12,
    },
    'aside',
  );
  b.text('settings_sidebar', 'settings_nav_label', 'Navigation Label', 'WORKSPACE SETTINGS', {
    color: '#8b96a3',
    fontSize: 10,
    fontWeight: 800,
    margin: spacing(4, 7),
  });
  ['Profile', 'Security', 'Notifications', 'Billing', 'Integrations'].forEach((label, index) =>
    b.button(
      'settings_sidebar',
      `settings_nav_${index}`,
      `${label} Navigation`,
      label,
      index === 0 ? 'primary' : 'ghost',
      {
        width: { mode: 'percent', value: 100 },
        textAlign: 'left',
        borderRadius: 8,
      },
    ),
  );
  b.container(
    'settings_body',
    'settings_panel',
    'Profile Settings Panel',
    {
      width: { mode: 'fill' },
      flexGrow: 1,
      minWidth: 0,
      padding: spacing(28),
      gap: 24,
      backgroundColor: '#ffffff',
      borderColor: '#dce1e7',
      borderWidth: 1,
      borderRadius: 12,
    },
    'main',
  );
  b.stack('settings_panel', 'settings_title_group', 'Settings Title', { gap: 5 });
  b.heading('settings_title_group', 'settings_title', 'Profile Title', 'Profile details', 1, {
    color: '#18212b',
    fontSize: 27,
  });
  b.text(
    'settings_title_group',
    'settings_description',
    'Profile Description',
    'Update how your identity appears across the workspace.',
    {
      color: '#65717e',
      fontSize: 14,
    },
  );
  b.grid('settings_panel', 'settings_form', 'Profile Form', 2, { gap: 16 });
  b.input('settings_form', 'settings_first_name', 'First Name', 'First name', 'Avery');
  b.input('settings_form', 'settings_last_name', 'Last Name', 'Last name', 'Morgan');
  b.input(
    'settings_form',
    'settings_email',
    'Email Address',
    'Email address',
    'avery@example.com',
    'email',
  );
  b.input(
    'settings_form',
    'settings_phone',
    'Phone Number',
    'Phone number',
    '+91 90000 00000',
    'tel',
  );
  b.container('settings_panel', 'settings_preferences', 'Preference Card', {
    padding: spacing(18),
    gap: 16,
    backgroundColor: '#f8fafb',
    borderColor: '#e3e7ec',
    borderWidth: 1,
    borderRadius: 10,
  });
  b.heading(
    'settings_preferences',
    'settings_preferences_title',
    'Preferences Title',
    'Email preferences',
    2,
    {
      color: '#18212b',
      fontSize: 17,
    },
  );
  b.stack('settings_preferences', 'settings_preference_row', 'Preference Row', {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  });
  b.text(
    'settings_preference_row',
    'settings_preference_copy',
    'Preference Copy',
    'Product updates and weekly insights',
    {
      color: '#46515d',
      fontSize: 13,
    },
  );
  b.button(
    'settings_preference_row',
    'settings_toggle',
    'Preference Toggle',
    'Enabled',
    'secondary',
    {
      borderRadius: 18,
    },
  );
  const saveButton = b.button(
    'settings_panel',
    'settings_save',
    'Save Changes',
    'Save changes',
    'primary',
    {
      width: { mode: 'hug' },
      borderRadius: 8,
    },
  );
  b.bindClick(saveButton, save);

  b.responsive('root', {
    tablet: { overflowX: 'hidden', overflowY: 'auto' },
    mobile: { minHeight: 0 },
  });
  b.responsive('settings_header', {
    tablet: { padding: spacing(14, 20) },
    mobile: { padding: spacing(13, 14) },
  });
  b.responsive('settings_user', { mobile: { display: 'none' } });
  b.responsive('settings_body', {
    tablet: { padding: spacing(16), gap: 16 },
    mobile: { minHeight: 0, flexDirection: 'column', padding: spacing(12), gap: 12 },
    wide: { width: { mode: 'percent', value: 100 }, maxWidth: 1440, alignSelf: 'center' },
  });
  b.responsive('settings_sidebar', {
    tablet: { width: { mode: 'fixed', value: 190, unit: 'px' }, padding: spacing(12) },
    mobile: {
      width: { mode: 'percent', value: 100 },
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing(9),
      gap: 6,
      overflowX: 'auto',
      overflowY: 'hidden',
    },
  });
  b.responsive('settings_nav_label', { mobile: { display: 'none' } });
  for (let index = 0; index < 5; index += 1) {
    b.responsive(`settings_nav_${index}`, {
      mobile: { width: { mode: 'hug' }, flexShrink: 0, whiteSpace: 'nowrap' },
    });
  }
  b.responsive('settings_panel', {
    tablet: { padding: spacing(22), gap: 20 },
    mobile: { width: { mode: 'percent', value: 100 }, padding: spacing(18, 14), gap: 18 },
  });
  b.responsive('settings_title', { mobile: { fontSize: 23 } });
  b.responsive('settings_description', { mobile: { overflowWrap: 'break-word' } });
  b.responsive('settings_form', {
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 },
  });
  b.responsive('settings_preference_row', {
    mobile: { flexDirection: 'column', alignItems: 'start', gap: 12 },
  });
  b.responsive('settings_save', {
    mobile: { width: { mode: 'percent', value: 100 } },
  });
  return b.document;
}

export const studioTemplates: readonly StudioTemplate[] = [
  {
    id: 'youtube-home',
    name: 'YouTube Home',
    description: 'Video navigation, search, topic chips, feed cards, Repeat and If/Else.',
    category: 'Media',
    accent: '#ff0033',
    createDocument: createYouTubeTemplate,
  },
  {
    id: 'analytics-dashboard',
    name: 'Orbit Analytics',
    description: 'Dark SaaS dashboard with metrics, insight conditions and repeated activity.',
    category: 'Dashboard',
    accent: '#2f81f7',
    createDocument: createDashboardTemplate,
  },
  {
    id: 'commerce-storefront',
    name: 'Northstar Store',
    description: 'Editorial commerce landing page with product cards and typed cart actions.',
    category: 'Commerce',
    accent: '#24493a',
    createDocument: createCommerceTemplate,
  },
  {
    id: 'creative-portfolio',
    name: 'Mira Portfolio',
    description: 'Bold dark portfolio with project grid and contact action.',
    category: 'Marketing',
    accent: '#d7ff64',
    createDocument: createPortfolioTemplate,
  },
  {
    id: 'account-settings',
    name: 'Account Settings',
    description: 'Application settings shell demonstrating navigation and typed Inputs.',
    category: 'Product',
    accent: '#6556e8',
    createDocument: createSettingsTemplate,
  },
] as const;

export function studioTemplateById(templateId: string): StudioTemplate | undefined {
  return studioTemplates.find((template) => template.id === templateId);
}

const customTemplateStorageKey = 'srijika-studio.custom-templates.v1';

export interface SavedStudioTemplate {
  id: string;
  name: string;
  savedAt: string;
  document: UiDocument;
}

type TemplateStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSavedTemplates(
  storage: TemplateStorage = window.localStorage,
): SavedStudioTemplate[] {
  try {
    const serialized = storage.getItem(customTemplateStorageKey);
    if (!serialized) return [];
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const record = candidate as Partial<SavedStudioTemplate>;
      const result = validateUiDocument(record.document);
      return typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.savedAt === 'string' &&
        result.valid &&
        result.value
        ? [{ id: record.id, name: record.name, savedAt: record.savedAt, document: result.value }]
        : [];
    });
  } catch {
    return [];
  }
}

export function saveStudioTemplate(
  source: UiDocument,
  storage: TemplateStorage = window.localStorage,
  now: Date = new Date(),
): SavedStudioTemplate {
  const existing = loadSavedTemplates(storage);
  const suffix = now
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const saved: SavedStudioTemplate = {
    id: `custom-${suffix}-${existing.length + 1}`,
    name: source.name,
    savedAt: now.toISOString(),
    document: structuredClone(source),
  };
  storage.setItem(customTemplateStorageKey, JSON.stringify([saved, ...existing].slice(0, 24)));
  return saved;
}

export function removeSavedTemplate(
  templateId: string,
  storage: TemplateStorage = window.localStorage,
): void {
  const remaining = loadSavedTemplates(storage).filter((template) => template.id !== templateId);
  storage.setItem(customTemplateStorageKey, JSON.stringify(remaining));
}

export function createSavedTemplateDocument(
  template: SavedStudioTemplate,
  pageId: string,
): UiDocument {
  const document = structuredClone(template.document);
  document.id = pageId;
  document.revision = 0;
  return document;
}
