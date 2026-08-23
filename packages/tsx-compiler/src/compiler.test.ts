import { validateUiDocument } from '@srijika/contracts';
import { describe, expect, it } from 'vitest';

import {
  bindSrijikaNodeEvent,
  compileSrijikaTsx,
  insertSrijikaContractMember,
  insertSrijikaJsxElement,
  insertSrijikaNodeProp,
  parseSrijikaContractType,
  printSrijikaContractType,
  replaceSrijikaNodeProp,
  replaceSrijikaTextNode,
} from './index';

function applyEdits(
  source: string,
  edits: readonly { start: number; end: number; newText: string }[],
): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) => `${current.slice(0, edit.start)}${edit.newText}${current.slice(edit.end)}`,
      source,
    );
}

describe('compileSrijikaTsx', () => {
  it('compiles a resolved owner-local type-only props interface', () => {
    const source = `import type { CardUIProps } from './card.types';

export function CardUI(props: CardUIProps) {
  return <button onClick={props.onOpen}>{props.title}</button>;
}`;
    const result = compileSrijikaTsx('Card.ui.tsx', source, {
      resolvedTypeModules: [
        {
          specifier: './card.types',
          fileName: 'Card.types.ts',
          source: `import type { ReactNode } from 'react';
export interface CardUIProps {
  title: string;
  onOpen: () => void;
  footerSlot?: ReactNode;
}`,
          hash: 'card-types-hash',
        },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(result.componentContract).toMatchObject([
      {
        name: 'title',
        kind: 'prop',
        contractSource: {
          kind: 'imported',
          fileName: 'Card.types.ts',
          hash: 'card-types-hash',
        },
      },
      {
        name: 'onOpen',
        kind: 'event',
        contractSource: {
          kind: 'imported',
          fileName: 'Card.types.ts',
          hash: 'card-types-hash',
        },
      },
      {
        name: 'footerSlot',
        kind: 'slot',
        contractSource: {
          kind: 'imported',
          fileName: 'Card.types.ts',
          hash: 'card-types-hash',
        },
      },
    ]);
    expect(
      insertSrijikaContractMember(source, result.sourceMap, {
        kind: 'prop',
        name: 'subtitle',
        required: false,
        dataType: 'string',
      }),
    ).toMatchObject({ ok: false, reason: 'external-props-contract' });
  });

  it('fails closed when an imported props contract is unresolved or not passive', () => {
    const source = `import type { CardUIProps } from './card.types';
export function CardUI(props: CardUIProps) {
  return <div>{props.title}</div>;
}`;
    const unresolved = compileSrijikaTsx('Card.ui.tsx', source);
    expect(
      unresolved.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'SRIJIKA1003' && diagnostic.message.includes('could not be resolved'),
      ),
    ).toBe(true);
    expect(unresolved.diagnostics.flatMap((diagnostic) => diagnostic.quickFixes ?? [])).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create-props-interface' })]),
    );

    const runtimeTypes = compileSrijikaTsx('Card.ui.tsx', source, {
      resolvedTypeModules: [
        {
          specifier: './card.types',
          fileName: 'Card.types.ts',
          source: `export interface CardUIProps { title: string; }
export const runtime = true;`,
        },
      ],
    });
    expect(
      runtimeTypes.diagnostics.some(
        (diagnostic) => diagnostic.code === 'SRIJIKA1003' && diagnostic.message.includes('passive'),
      ),
    ).toBe(true);

    const duplicateInterface = compileSrijikaTsx('Card.ui.tsx', source, {
      resolvedTypeModules: [
        {
          specifier: './card.types',
          fileName: 'Card.types.ts',
          source: `export interface CardUIProps { title: string; }
export interface CardUIProps { subtitle?: string; }`,
        },
      ],
    });
    expect(
      duplicateInterface.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'SRIJIKA1003' && diagnostic.message.includes('exactly one interface'),
      ),
    ).toBe(true);

    const emptyExportMarker = compileSrijikaTsx('Card.ui.tsx', source, {
      resolvedTypeModules: [
        {
          specifier: './card.types',
          fileName: 'Card.types.ts',
          source: `export {};
export interface CardUIProps { title: string; }`,
        },
      ],
    });
    expect(emptyExportMarker.diagnostics).toEqual([]);
  });

  it('accepts an aliased named type import and rejects value imports', () => {
    const types = {
      specifier: './card.types',
      fileName: 'Card.types.ts',
      source: 'export interface PublicCardProps { title: string; }',
    } as const;
    const aliased = compileSrijikaTsx(
      'Card.ui.tsx',
      `import type { PublicCardProps as CardUIProps } from './card.types';
export function CardUI(props: CardUIProps) { return <div>{props.title}</div>; }`,
      { resolvedTypeModules: [types] },
    );
    expect(aliased.diagnostics).toEqual([]);

    const valueImport = compileSrijikaTsx(
      'Card.ui.tsx',
      `import { PublicCardProps as CardUIProps } from './card.types';
export function CardUI(props: CardUIProps) { return <div>{props.title}</div>; }`,
      { resolvedTypeModules: [types] },
    );
    expect(
      valueImport.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'SRIJIKA1003' && diagnostic.message.includes('import type'),
      ),
    ).toBe(true);
  });

  it('compiles typed nested props, intrinsic elements, value ternaries, and structural conditions', () => {
    const source = `
export interface ProfileProps {
  user: {
    name: string;
    image: string;
  };
  isActive: boolean;
}

export function ProfileUI(props: ProfileProps) {
  return (
    <header className={props.isActive ? 'active' : 'inactive'}>
      <nav aria-label="Primary">Home</nav>
      <img src={props.user.image} alt={props.user.name} />
      <h1>{props.user.name}</h1>
      <p>{props.user.name ?? 'Guest'}</p>
      {props.isActive && <span>Online</span>}
    </header>
  );
}`;

    const result = compileSrijikaTsx('Profile.ui.tsx', source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(validateUiDocument(result.document).valid).toBe(true);
    expect(result.document?.nodes['root']).toMatchObject({
      kind: 'element',
      componentId: 'srijika.container',
      props: {
        as: { kind: 'literal', value: 'header' },
        className: { kind: 'conditional' },
      },
    });
    expect(result.document?.publicProps['user']).toMatchObject({
      valueType: 'object',
      valueShape: {
        kind: 'object',
        fields: {
          name: { shape: { kind: 'string' } },
          image: { shape: { kind: 'string' } },
        },
      },
    });
    expect(Object.values(result.document?.nodes ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'if' }),
        expect.objectContaining({ kind: 'element', componentId: 'srijika.heading' }),
        expect.objectContaining({ kind: 'element', componentId: 'srijika.image' }),
      ]),
    );
    const fallbackText = Object.values(result.document?.nodes ?? {}).find(
      (node) => node.kind === 'element' && node.componentId === 'srijika.text',
    );
    expect(fallbackText?.kind === 'element' ? fallbackText.props['text'] : null).toMatchObject({
      kind: 'binary',
      operator: 'coalesce',
    });
    expect(Object.keys(result.sourceMap.nodes).sort()).toEqual(
      Object.keys(result.document?.nodes ?? {}).sort(),
    );
  });

  it('reports an undeclared prop with an applicable source quick fix while preserving preview IR', () => {
    const source = `
export interface ProfileProps {
  name: string;
}

export function ProfileUI(props: ProfileProps) {
  return <img src={props.image} alt={props.name} />;
}`;

    const result = compileSrijikaTsx('Profile.ui.tsx', source);
    const diagnostic = result.diagnostics.find((entry) => entry.code === 'SRIJIKA1004');

    expect(result.document).not.toBeNull();
    expect(validateUiDocument(result.document).valid).toBe(true);
    expect(diagnostic).toMatchObject({
      severity: 'error',
      quickFixes: [
        {
          kind: 'add-missing-prop',
          data: { propPath: ['image'], suggestedType: 'string' },
        },
      ],
    });

    const fixed = applyEdits(source, diagnostic?.quickFixes?.[0]?.edits ?? []);
    expect(compileSrijikaTsx('Profile.ui.tsx', fixed).diagnostics).toEqual([]);
  });

  it('offers a complete props interface fix for an untyped component', () => {
    const source = `
export function WelcomeUI(props) {
  return <h1>{props.name}</h1>;
}`;
    const result = compileSrijikaTsx('Welcome.ui.tsx', source);
    const diagnostic = result.diagnostics.find(
      (entry) =>
        entry.code === 'SRIJIKA1003' &&
        entry.quickFixes?.some((fix) => fix.kind === 'create-props-interface'),
    );
    const fix = diagnostic?.quickFixes?.find((entry) => entry.kind === 'create-props-interface');

    expect(fix?.edits).toHaveLength(2);
    const fixed = applyEdits(source, fix?.edits ?? []);
    expect(fixed).toContain('export interface WelcomeUIProps');
    expect(fixed).toContain('props: WelcomeUIProps');
    expect(compileSrijikaTsx('Welcome.ui.tsx', fixed).diagnostics).toEqual([]);
  });

  it('compiles ReactNode props into explicit structural slot placeholders', () => {
    const source = `
import type { ReactNode } from 'react';

export interface HeaderUIProps {
  title: string;
  menuSlot: ReactNode;
  profileSlot: React.ReactNode;
}

export function HeaderUI(props: HeaderUIProps) {
  return (
    <header>
      <h1>{props.title}</h1>
      {props.menuSlot}
      {props.profileSlot}
    </header>
  );
}`;

    const result = compileSrijikaTsx('Header.ui.tsx', source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(validateUiDocument(result.document).valid).toBe(true);
    expect(result.document?.publicProps).toHaveProperty('title');
    expect(result.document?.publicProps).not.toHaveProperty('menuSlot');
    expect(Object.values(result.document?.nodes ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'slot', slotName: 'menuSlot' }),
        expect.objectContaining({ kind: 'slot', slotName: 'profileSlot' }),
      ]),
    );
  });

  it('reports every declared prop, event, used slot, and unused slot in source order', () => {
    const source = `import type { ReactNode } from 'react';

export interface HeaderUIProps {
  title: string;
  subtitle?: string;
  onProfileClick: () => void;
  menuSlot: ReactNode;
  unusedSlot?: React.ReactNode;
}

export function HeaderUI(props: HeaderUIProps) {
  return (
    <header>
      <h1>{props.title}</h1>
      <button onClick={props.onProfileClick}>Profile</button>
      {props.menuSlot}
    </header>
  );
}`;

    const exactSpan = (snippet: string) => {
      const start = source.indexOf(snippet);
      expect(start).toBeGreaterThanOrEqual(0);
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      return {
        start,
        end: start + snippet.length,
        line: source.slice(0, start).split('\n').length,
        column: start - lineStart + 1,
      };
    };

    const result = compileSrijikaTsx('Header.ui.tsx', source);

    expect(result.diagnostics).toEqual([]);
    expect(result.componentContract).toEqual([
      {
        kind: 'prop',
        name: 'title',
        required: true,
        typeSource: 'string',
        valueShape: { kind: 'string' },
        span: exactSpan('title: string;'),
      },
      {
        kind: 'prop',
        name: 'subtitle',
        required: false,
        typeSource: 'string',
        valueShape: { kind: 'string' },
        span: exactSpan('subtitle?: string;'),
      },
      {
        kind: 'event',
        name: 'onProfileClick',
        required: true,
        typeSource: '() => void',
        eventSignature: { payload: null },
        span: exactSpan('onProfileClick: () => void;'),
      },
      {
        kind: 'slot',
        name: 'menuSlot',
        required: true,
        typeSource: 'ReactNode',
        span: exactSpan('menuSlot: ReactNode;'),
      },
      {
        kind: 'slot',
        name: 'unusedSlot',
        required: false,
        typeSource: 'React.ReactNode',
        span: exactSpan('unusedSlot?: React.ReactNode;'),
      },
    ]);
    expect(Object.keys(result.document?.publicProps ?? {})).toEqual([
      'title',
      'subtitle',
      'onProfileClick',
    ]);
    expect(
      Object.values(result.document?.nodes ?? {})
        .filter((node) => node.kind === 'slot')
        .map((node) => (node.kind === 'slot' ? node.slotName : null)),
    ).toEqual(['menuSlot']);
  });

  it('preserves exact complex TypeScript contract types and derives safe shapes', () => {
    const source = `interface UserProfile {
  id: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}
type Status = 'idle' | 'ready';
export interface DashboardProps {
  user: UserProfile;
  users: ReadonlyArray<UserProfile>;
  status: Status | null;
  payload: ImportedPayload;
  anything: unknown;
  unsafe?: any;
}
export function DashboardUI(props: DashboardProps) {
  return <main><h1>{props.user.id}</h1><p>{props.payload.title}</p></main>;
}`;

    const result = compileSrijikaTsx('Dashboard.ui.tsx', source);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'SRIJIKA1005', severity: 'warning' });
    expect(result.diagnostics[0]?.message).toContain('`any` disables contract safety');
    expect(result.componentContract.map(({ name, typeSource }) => ({ name, typeSource }))).toEqual([
      { name: 'user', typeSource: 'UserProfile' },
      { name: 'users', typeSource: 'ReadonlyArray<UserProfile>' },
      { name: 'status', typeSource: 'Status | null' },
      { name: 'payload', typeSource: 'ImportedPayload' },
      { name: 'anything', typeSource: 'unknown' },
      { name: 'unsafe', typeSource: 'any' },
    ]);
    expect(result.document?.publicProps['user']?.valueShape).toMatchObject({
      kind: 'object',
      fields: {
        id: { required: true, shape: { kind: 'string' } },
        tags: { required: true, shape: { kind: 'array', item: { kind: 'string' } } },
      },
    });
    expect(result.document?.publicProps['users']?.valueShape).toMatchObject({
      kind: 'array',
      item: { kind: 'object' },
    });
    expect(result.document?.publicProps['status']?.valueShape).toEqual({ kind: 'string' });
    expect(result.document?.publicProps['payload']?.valueShape).toEqual({ kind: 'unknown' });
  });

  it('compiles a typed no-payload callback into an event symbol and button binding', () => {
    const source = `
export interface HomeUIProps {
  count: number;
  onIncrement: () => void;
}

export function HomeUI(props: HomeUIProps) {
  return (
    <main>
      <h1>{\`Count \${props.count}\`}</h1>
      <button onClick={props.onIncrement}>Create something</button>
    </main>
  );
}`;

    const result = compileSrijikaTsx('Home.ui.tsx', source);

    expect(result.diagnostics).toEqual([]);
    expect(validateUiDocument(result.document).valid).toBe(true);
    expect(result.document?.publicProps['onIncrement']).toMatchObject({
      symbolId: 'event_onIncrement',
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(result.document?.publicProps['onIncrement']).not.toHaveProperty('valueShape');
    expect(result.document?.symbols['event_onIncrement']).toMatchObject({
      provider: 'event',
      valueType: 'event',
    });
    expect(result.document?.symbols['event_onIncrement']).not.toHaveProperty('valueShape');
    const button = Object.values(result.document?.nodes ?? {}).find(
      (node) => node.kind === 'element' && node.componentId === 'srijika.button',
    );
    expect(button?.kind === 'element' ? button.events['onClick'] : null).toEqual({
      kind: 'reference',
      symbolId: 'event_onIncrement',
      path: [],
    });
  });

  it('supports normalized React events on intrinsic containers', () => {
    const source = `
export interface PanelUIProps {
  onOpen: () => void;
  onKeyboard: (keyEvent: { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean }) => void;
}
export function PanelUI(props: PanelUIProps) {
  return <div tabIndex={0} onClick={props.onOpen} onKeyDown={props.onKeyboard}>Open</div>;
}`;
    const result = compileSrijikaTsx('Panel.ui.tsx', source);
    const root = result.document?.nodes[result.document.rootNodeId];

    expect(result.diagnostics).toEqual([]);
    expect(root?.kind === 'element' ? root.events : null).toEqual({
      onClick: { kind: 'reference', symbolId: 'event_onOpen', path: [] },
      onKeyDown: { kind: 'reference', symbolId: 'event_onKeyboard', path: [] },
    });
    expect(root?.kind === 'element' ? root.instanceEvents : null).toMatchObject({
      onClick: { source: 'click', signature: { payload: null } },
      onKeyDown: { source: 'keyDown' },
    });
    expect(validateUiDocument(result.document).valid).toBe(true);
  });

  it('permits a direct string-value bridge for native text inputs', () => {
    const source = `
export interface SearchUIProps { query: string; onQueryChange: (value: string) => void; }
export function SearchUI(props: SearchUIProps) {
  return <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} />;
}`;
    const result = compileSrijikaTsx('Search.ui.tsx', source);

    expect(result.diagnostics).toEqual([]);
  });

  it('offers Connector-safe fixes for inline event logic', () => {
    const source = `
export interface PanelUIProps { onOpen: () => void; }
export function PanelUI(props: PanelUIProps) {
  return <div onClick={() => {}}>Open</div>;
}`;
    const result = compileSrijikaTsx('Panel.ui.tsx', source);
    const diagnostic = result.diagnostics.find((entry) => entry.code === 'SRIJIKA2003');
    const connect = diagnostic?.quickFixes?.find(
      (fix) => fix.kind === 'bind-event-prop' && fix.data.eventName === 'onOpen',
    );
    const fixed = applyEdits(source, connect?.edits ?? []);

    expect(result.diagnostics.filter((entry) => entry.code === 'SRIJIKA2003')).toHaveLength(1);
    expect(connect?.title).toContain('props.onOpen');
    expect(fixed).toContain('onClick={props.onOpen}');
    expect(compileSrijikaTsx('Panel.ui.tsx', fixed).diagnostics).toEqual([]);
    expect(diagnostic?.quickFixes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'remove-attribute' })]),
    );
  });

  it('can declare and connect a new callback prop from an inline event', () => {
    const source = `
export interface PanelUIProps {}
export function PanelUI(props: PanelUIProps) {
  return <div onClick={() => {}}>Open</div>;
}`;
    const result = compileSrijikaTsx('Panel.ui.tsx', source);
    const fix = result.diagnostics
      .find((entry) => entry.code === 'SRIJIKA2003')
      ?.quickFixes?.find(
        (entry) => entry.kind === 'bind-event-prop' && entry.data.eventName === 'onClick',
      );
    const fixed = applyEdits(source, fix?.edits ?? []);

    expect(fixed).toContain('onClick: () => void;');
    expect(fixed).toContain('onClick={props.onClick}');
    expect(compileSrijikaTsx('Panel.ui.tsx', fixed).diagnostics).toEqual([]);
  });

  it('offers an event-aware quick fix for a missing callback contract', () => {
    const source = `
export interface HomeUIProps {}
export function HomeUI(props: HomeUIProps) {
  return <button onClick={props.onLaunch}>Launch</button>;
}`;
    const result = compileSrijikaTsx('Home.ui.tsx', source);
    const diagnostic = result.diagnostics.find((entry) => entry.code === 'SRIJIKA1004');
    const fixed = applyEdits(source, diagnostic?.quickFixes?.[0]?.edits ?? []);

    expect(diagnostic?.quickFixes?.[0]).toMatchObject({
      kind: 'add-missing-prop',
      data: { propPath: ['onLaunch'], suggestedType: 'event' },
    });
    expect(fixed).toContain('onLaunch: () => void;');
    expect(compileSrijikaTsx('Home.ui.tsx', fixed).diagnostics).toEqual([]);
  });

  it('rejects arbitrary UI logic and unsupported function calls', () => {
    const source = `
export interface BadProps { name: string; }
export function BadUI(props: BadProps) {
  const title = props.name;
  return <h1>{format(title)}</h1>;
}`;

    const result = compileSrijikaTsx('Bad.ui.tsx', source);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['SRIJIKA2003', 'SRIJIKA2004']),
    );
  });
});

describe('insertSrijikaJsxElement', () => {
  const source = `export interface CanvasProps {}
export function CanvasUI(props: CanvasProps) {
  return (
    <main className="canvas">
      <section aria-label="Existing"><p>Before</p></section>
    </main>
  );
}`;

  it('inserts a catalogue element into an exact mapped container and recompiles it', () => {
    const compiled = compileSrijikaTsx('Canvas.ui.tsx', source);
    const section = Object.values(compiled.document?.nodes ?? {}).find(
      (node) => node.kind === 'element' && node.name === 'Section',
    );
    expect(section).toBeDefined();
    const result = insertSrijikaJsxElement(source, compiled.sourceMap, section!.id, {
      tag: 'input',
      attributes: {
        type: 'email',
        name: 'email',
        placeholder: 'Enter email',
        'aria-label': 'Email',
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.source).toContain(
      '<input type={"email"} name={"email"} placeholder={"Enter email"} aria-label={"Email"} />',
    );
    const next = compileSrijikaTsx('Canvas.ui.tsx', result.source);
    expect(next.diagnostics).toEqual([]);
    expect(Object.values(next.document?.nodes ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'element', componentId: 'srijika.input' }),
      ]),
    );
  });

  it('rejects leaf targets, stale maps, and unsafe attributes without changing source', () => {
    const compiled = compileSrijikaTsx('Canvas.ui.tsx', source);
    const paragraph = Object.values(compiled.document?.nodes ?? {}).find(
      (node) => node.kind === 'element' && node.name === 'Paragraph',
    );
    expect(
      insertSrijikaJsxElement(source, compiled.sourceMap, paragraph!.id, {
        tag: 'button',
        text: 'Go',
      }),
    ).toMatchObject({ ok: false, reason: 'not-container' });
    expect(
      insertSrijikaJsxElement(source, compiled.sourceMap, compiled.document!.rootNodeId, {
        tag: 'button',
        attributes: { dangerouslySetInnerHTML: 'nope' },
      }),
    ).toMatchObject({ ok: false, reason: 'unsupported-attribute' });
    expect(
      insertSrijikaJsxElement(`\n${source}`, compiled.sourceMap, compiled.document!.rootNodeId, {
        tag: 'button',
        text: 'Go',
      }),
    ).toMatchObject({ ok: false, reason: 'stale-source-map' });
  });
});

describe('replaceSrijikaTextNode', () => {
  it('edits one plain text element safely and round-trips through the compiler', () => {
    const source = `
export function HeadingUI() {
  return <h1 className="title">Hello</h1>;
}`;
    const compiled = compileSrijikaTsx('Heading.ui.tsx', source);
    const heading = Object.values(compiled.document?.nodes ?? {}).find(
      (node) => node.kind === 'element' && node.componentId === 'srijika.heading',
    );
    if (!heading) throw new Error('Expected compiled heading');

    const replacement = replaceSrijikaTextNode(
      source,
      compiled.sourceMap,
      heading.id,
      'A & <B> {value}',
    );

    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.source).toContain('A &amp; &lt;B&gt; &#123;value&#125;');
    const roundTrip = compileSrijikaTsx('Heading.ui.tsx', replacement.source);
    expect(roundTrip.diagnostics).toEqual([]);
    expect(validateUiDocument(roundTrip.document).valid).toBe(true);
    expect(roundTrip.document?.nodes['root']).toMatchObject({
      kind: 'element',
      props: { text: { kind: 'literal', value: 'A & <B> {value}' } },
    });
  });

  it('rejects stale source maps and expression-backed text', () => {
    const plainSource = `export function PlainUI() { return <p>Hello</p>; }`;
    const plain = compileSrijikaTsx('Plain.ui.tsx', plainSource);
    expect(
      replaceSrijikaTextNode(`\n${plainSource}`, plain.sourceMap, 'root', 'Changed'),
    ).toMatchObject({ ok: false, reason: 'stale-source-map' });

    const expressionSource = `
export interface TitleProps { title: string; }
export function TitleUI(props: TitleProps) { return <h1>{props.title}</h1>; }`;
    const expression = compileSrijikaTsx('Title.ui.tsx', expressionSource);
    expect(
      replaceSrijikaTextNode(expressionSource, expression.sourceMap, 'root', 'Changed'),
    ).toMatchObject({ ok: false, reason: 'not-plain-text' });
  });
});

describe('replaceSrijikaNodeProp', () => {
  it('edits existing string, numeric, and shorthand boolean JSX attributes safely', () => {
    const source = `
export function CardUI() {
  return <section className="hero" aria-label="Hero card" data-count={2} hidden>Card</section>;
}`;
    const compiled = compileSrijikaTsx('Card.ui.tsx', source);
    expect(compiled.diagnostics).toEqual([]);

    const classEdit = replaceSrijikaNodeProp(
      source,
      compiled.sourceMap,
      'root',
      'className',
      'feature',
    );
    expect(classEdit.ok).toBe(true);
    if (!classEdit.ok) return;
    expect(classEdit.source).toContain('className={"feature"}');

    const classCompiled = compileSrijikaTsx('Card.ui.tsx', classEdit.source);
    const countEdit = replaceSrijikaNodeProp(
      classEdit.source,
      classCompiled.sourceMap,
      'root',
      'data-count',
      7,
    );
    expect(countEdit.ok).toBe(true);
    if (!countEdit.ok) return;
    expect(countEdit.source).toContain('data-count={7}');

    const countCompiled = compileSrijikaTsx('Card.ui.tsx', countEdit.source);
    const hiddenEdit = replaceSrijikaNodeProp(
      countEdit.source,
      countCompiled.sourceMap,
      'root',
      'hidden',
      false,
    );
    expect(hiddenEdit.ok).toBe(true);
    if (!hiddenEdit.ok) return;
    expect(hiddenEdit.source).toContain('hidden={false}');
    const roundTrip = compileSrijikaTsx('Card.ui.tsx', hiddenEdit.source);
    expect(roundTrip.diagnostics).toEqual([]);
    expect(validateUiDocument(roundTrip.document).valid).toBe(true);
  });

  it('supports ariaLabel aliases and rejects dynamic, inferred, and stale props', () => {
    const source = `
export interface HeroProps { className: string; }
export function HeroUI(props: HeroProps) {
  return <main className={props.className} aria-label="Hero">Hello</main>;
}`;
    const compiled = compileSrijikaTsx('Hero.ui.tsx', source);

    const ariaEdit = replaceSrijikaNodeProp(
      source,
      compiled.sourceMap,
      'root',
      'ariaLabel',
      'Feature hero',
    );
    expect(ariaEdit.ok).toBe(true);
    if (ariaEdit.ok) expect(ariaEdit.source).toContain('aria-label={"Feature hero"}');

    expect(
      replaceSrijikaNodeProp(source, compiled.sourceMap, 'root', 'className', 'feature'),
    ).toMatchObject({ ok: false, reason: 'not-literal-prop' });
    expect(
      replaceSrijikaNodeProp(source, compiled.sourceMap, 'root', 'visible', true),
    ).toMatchObject({ ok: false, reason: 'unknown-prop' });
    expect(
      replaceSrijikaNodeProp(`\n${source}`, compiled.sourceMap, 'root', 'ariaLabel', 'Feature'),
    ).toMatchObject({ ok: false, reason: 'stale-source-map' });
  });
});

describe('insertSrijikaNodeProp and bindSrijikaNodeEvent', () => {
  it('inserts a supported intrinsic prop and round-trips through the compiler', () => {
    const source = `export interface CardProps {}
export function CardUI(props: CardProps) { return <div>Card</div>; }`;
    const compiled = compileSrijikaTsx('Card.ui.tsx', source);
    const inserted = insertSrijikaNodeProp(source, compiled.sourceMap, 'root', 'tabIndex', 0);

    expect(inserted).toMatchObject({ ok: true });
    if (!inserted.ok) return;
    expect(inserted.source).toContain('<div tabIndex={0}>');
    expect(compileSrijikaTsx('Card.ui.tsx', inserted.source).diagnostics).toEqual([]);
  });

  it('adds a build-safe optional callback contract and connects a div event atomically', () => {
    const source = `export interface CardProps {}
export function CardUI(props: CardProps) { return <div>Card</div>; }`;
    const compiled = compileSrijikaTsx('Card.ui.tsx', source);
    const inserted = bindSrijikaNodeEvent(
      source,
      compiled.sourceMap,
      'root',
      'onClick',
      'onCardClick',
    );

    expect(inserted).toMatchObject({ ok: true });
    if (!inserted.ok) return;
    expect(inserted.source).toContain('onCardClick?: () => void;');
    expect(inserted.source).toContain('onCardClick?: () => void;\n}');
    expect(inserted.source).toContain('<div onClick={props.onCardClick}>');
    expect(compileSrijikaTsx('Card.ui.tsx', inserted.source).diagnostics).toEqual([]);
  });

  it('rejects duplicate and unsupported Inspector insertions', () => {
    const source = `export interface CardProps { onCardClick: () => void; }
export function CardUI(props: CardProps) { return <div id="card" onClick={props.onCardClick}>Card</div>; }`;
    const compiled = compileSrijikaTsx('Card.ui.tsx', source);

    expect(insertSrijikaNodeProp(source, compiled.sourceMap, 'root', 'id', 'next')).toMatchObject({
      ok: false,
      reason: 'attribute-exists',
    });
    expect(
      insertSrijikaNodeProp(source, compiled.sourceMap, 'root', 'src', 'image.png'),
    ).toMatchObject({ ok: false, reason: 'unsupported-attribute' });
    expect(
      bindSrijikaNodeEvent(source, compiled.sourceMap, 'root', 'onClick', 'onCardClick'),
    ).toMatchObject({ ok: false, reason: 'attribute-exists' });
  });
});

describe('insertSrijikaContractMember', () => {
  it('adds data, event, and slot members with required/optional syntax', () => {
    const source = `export interface CardProps {}
export function CardUI(props: CardProps) { return <main>Card</main>; }`;
    const initial = compileSrijikaTsx('Card.ui.tsx', source);
    const data = insertSrijikaContractMember(source, initial.sourceMap, {
      kind: 'prop',
      name: 'title',
      required: true,
      dataType: 'string',
    });
    expect(data).toMatchObject({ ok: true });
    if (!data.ok) return;

    const afterData = compileSrijikaTsx('Card.ui.tsx', data.source);
    const event = insertSrijikaContractMember(data.source, afterData.sourceMap, {
      kind: 'event',
      name: 'onOpen',
      required: false,
    });
    expect(event).toMatchObject({ ok: true });
    if (!event.ok) return;

    const afterEvent = compileSrijikaTsx('Card.ui.tsx', event.source);
    const slot = insertSrijikaContractMember(event.source, afterEvent.sourceMap, {
      kind: 'slot',
      name: 'toolbarSlot',
      required: false,
    });
    expect(slot).toMatchObject({ ok: true });
    if (!slot.ok) return;

    expect(slot.source).toContain("import type { ReactNode } from 'react';");
    expect(slot.source).toContain('title: string;');
    expect(slot.source).toContain('onOpen?: () => void;');
    expect(slot.source).toContain('toolbarSlot?: ReactNode;');
    expect(compileSrijikaTsx('Card.ui.tsx', slot.source).diagnostics).toEqual([]);
  });

  it('rejects duplicate, invalid, and over-limit members', () => {
    const members = Array.from({ length: 16 }, (_, index) => `  value${index}: string;`).join('\n');
    const source = `export interface CardProps {\n${members}\n}
export function CardUI(props: CardProps) { return <main>Card</main>; }`;
    const compiled = compileSrijikaTsx('Card.ui.tsx', source);

    expect(
      insertSrijikaContractMember(source, compiled.sourceMap, {
        kind: 'prop',
        name: 'value0',
        required: true,
        dataType: 'string',
      }),
    ).toMatchObject({ ok: false, reason: 'contract-member-exists' });
    expect(
      insertSrijikaContractMember(source, compiled.sourceMap, {
        kind: 'prop',
        name: 'not-valid!',
        required: true,
        dataType: 'string',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-contract-name' });
    expect(
      insertSrijikaContractMember(source, compiled.sourceMap, {
        kind: 'event',
        name: 'onExtra',
        required: true,
      }),
    ).toMatchObject({ ok: false, reason: 'contract-limit-reached' });
  });

  it('accepts safe custom TypeScript types and rejects injected declarations', () => {
    const source = `export interface CardProps {}
export function CardUI(props: CardProps) { return <main>Card</main>; }`;
    const compiled = compileSrijikaTsx('Card.ui.tsx', source);
    const inserted = insertSrijikaContractMember(source, compiled.sourceMap, {
      kind: 'prop',
      name: 'items',
      required: false,
      dataType: 'ReadonlyArray<{ id: string; state?: "on" | "off" }>',
    });

    expect(inserted).toMatchObject({ ok: true });
    if (inserted.ok) {
      expect(inserted.source).toContain(
        'items?: ReadonlyArray<{ id: string; state?: "on" | "off" }>;',
      );
      expect(compileSrijikaTsx('Card.ui.tsx', inserted.source).diagnostics).toEqual([]);
    }
    expect(
      insertSrijikaContractMember(source, compiled.sourceMap, {
        kind: 'prop',
        name: 'unsafe',
        required: true,
        dataType: 'string; interface Injected { value: string }',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-contract-type' });
  });

  it('parses nested object and array types structurally without depending on whitespace', () => {
    const parsed = parseSrijikaContractType(
      '{ id : string ; profile?: { name:string; tags: Array<number> } }',
    );

    expect(parsed).toEqual({
      kind: 'object',
      fields: [
        { name: 'id', required: true, type: { kind: 'string' } },
        {
          name: 'profile',
          required: false,
          type: {
            kind: 'object',
            fields: [
              { name: 'name', required: true, type: { kind: 'string' } },
              {
                name: 'tags',
                required: true,
                type: { kind: 'array', item: { kind: 'number' } },
              },
            ],
          },
        },
      ],
    });
    expect(parsed && printSrijikaContractType(parsed)).toBe(
      '{ id: string; profile?: { name: string; tags: ReadonlyArray<number>; }; }',
    );

    const array = parseSrijikaContractType('ReadonlyArray<{ id: string }>');
    expect(array).toMatchObject({ kind: 'array', item: { kind: 'object' } });
    expect(array && printSrijikaContractType(array)).toBe('ReadonlyArray<{ id: string; }>');
    expect(parseSrijikaContractType('UserProfile | null')).toEqual({
      kind: 'custom',
      source: 'UserProfile | null',
    });
    expect(parseSrijikaContractType('string; interface Unsafe {}')).toBeNull();
  });
});
