import { describe, expect, it } from 'vitest';

import {
  classifySrijikaArchitecturePath,
  validateSrijikaArchitecture,
  type SrijikaArchitectureSourceFile,
} from '../src/index';

const root = '/project';

function file(fileName: string, source = 'export {};'): SrijikaArchitectureSourceFile {
  return { fileName: `${root}/${fileName}`, source };
}

function validate(...files: readonly SrijikaArchitectureSourceFile[]) {
  return validateSrijikaArchitecture(files, { projectRoot: root }).diagnostics;
}

describe('Srijika feature-slot-part architecture', () => {
  it('classifies feature, slot, and nested part ownership', () => {
    expect(classifySrijikaArchitecturePath('/project/src/features/home/Home.ui.tsx')).toMatchObject(
      {
        kind: 'feature',
        feature: 'home',
      },
    );
    expect(
      classifySrijikaArchitecturePath(
        '/project/src/features/home/slots/navigation/Navigation.connector.tsx',
      ),
    ).toMatchObject({ kind: 'slot', feature: 'home', slot: 'navigation' });
    expect(
      classifySrijikaArchitecturePath(
        '/project/src/features/home/slots/navigation/parts/user-menu/hooks/useMenu.ts',
      ),
    ).toMatchObject({ kind: 'part', feature: 'home', slot: 'navigation', part: 'user-menu' });
  });

  it('allows feature stores and hooks throughout their feature descendants', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/home.store.ts'),
      file(
        'src/features/home/hooks/useHome.ts',
        "export { useHomeKeyboard } from './useHomeKeyboard';",
      ),
      file('src/features/home/hooks/useHomeKeyboard.ts'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file(
        'src/features/home/slots/navigation/Navigation.connector.tsx',
        [
          "import { useHomeStore } from '../../home.store';",
          "import { useHomeKeyboard } from '../../hooks/useHome';",
          'export function NavigationConnector() { useHomeKeyboard(); return useHomeStore; }',
        ].join('\n'),
      ),
    );

    expect(diagnostics).toEqual([]);
  });

  it('supports many Hooks and Store slices behind one public owner gateway each', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx', "import './hooks/useHome';"),
      file(
        'src/features/home/hooks/useHome.ts',
        "import './useHomeFilters'; import './useHomeSelection'; import '../stores/home.store';",
      ),
      file('src/features/home/hooks/useHomeFilters.ts'),
      file('src/features/home/hooks/useHomeSelection.ts'),
      file(
        'src/features/home/stores/home.store.ts',
        "import './homeFilters.store'; import './homeSelection.store';",
      ),
      file('src/features/home/stores/homeFilters.store.ts'),
      file('src/features/home/stores/homeSelection.store.ts'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('blocks direct private Store-slice imports and requires the canonical Store gateway', () => {
    const bypass = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx', "import './stores/homeFilters.store';"),
      file('src/features/home/stores/home.store.ts', "import './homeFilters.store';"),
      file('src/features/home/stores/homeFilters.store.ts'),
    );
    expect(bypass).toHaveLength(1);
    expect(bypass[0]).toMatchObject({
      code: 'SRIJIKA4201',
      ruleId: 'SRIJIKA-ARCH-LAYER-JUMP',
      recommendation: {
        id: 'SRIJIKA-ARCH-RECOMMEND-STORE',
        suggestedFileName: 'stores/home.store.ts',
      },
    });

    const descendantBypass = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/stores/home.store.ts', "import './homeFilters.store';"),
      file('src/features/home/stores/homeFilters.store.ts'),
      file('src/features/home/slots/header/Header.ui.tsx'),
      file(
        'src/features/home/slots/header/Header.connector.tsx',
        "import '../../stores/homeFilters.store';",
      ),
    );
    expect(descendantBypass).toHaveLength(1);
    expect(descendantBypass[0]?.code).toBe('SRIJIKA4201');

    const orphan = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/stores/homeFilters.store.ts'),
    );
    expect(orphan).toHaveLength(1);
    expect(orphan[0]?.code).toBe('SRIJIKA4112');
    expect(orphan[0]?.message).toContain('no canonical expanded home.store.ts gateway');
  });

  it('keeps pure UI files free from stores, hooks, connectors, and React hooks', () => {
    const source = [
      "import { useState } from 'react';",
      "import { useHomeStore } from './home.store';",
      "import { HeaderConnector } from './slots/header/Header.connector';",
      'export function HomeUI() {',
      '  const [open] = useState(false);',
      '  return <main>{String(open || useHomeStore)}</main>;',
      '}',
    ].join('\n');
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx', source),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/home.store.ts'),
      file('src/features/home/slots/header/Header.ui.tsx'),
      file('src/features/home/slots/header/Header.connector.tsx'),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'SRIJIKA4101',
      'SRIJIKA4101',
      'SRIJIKA4101',
    ]);
    expect(diagnostics[0]?.span).toMatchObject({
      start: source.indexOf('useState'),
      end: source.indexOf('useState') + 'useState'.length,
      line: 1,
      column: 10,
    });
    expect(diagnostics.every(({ guidance }) => guidance.includes('Connector'))).toBe(true);
  });

  it('keeps every UI renderer free from identifier/property hooks and browser runtime APIs', () => {
    const source = [
      "import * as React from 'react';",
      'function useLocalValue() { return 1; }',
      'export function HomeUI(props: { label: string; onActivate(): void }) {',
      '  const local = useLocalValue();',
      "  const [state] = React.useState('ready');",
      "  void fetch('/api/home');",
      '  const request = new XMLHttpRequest();',
      "  const socket = new window.WebSocket('wss://example.test');",
      "  localStorage.setItem('home', state);",
      "  void window.sessionStorage.getItem('home');",
      '  const cookie = document.cookie;',
      '  setTimeout(() => undefined, 0);',
      '  window.setInterval(() => undefined, 1000);',
      '  requestAnimationFrame(() => undefined);',
      '  const observer = new MutationObserver(() => undefined);',
      '  const image = new Image();',
      '  return <button onClick={props.onActivate}>{props.label}{local}{cookie}{String(request)}{String(socket)}{String(observer)}{String(image)}</button>;',
      '}',
    ].join('\n');

    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx', source),
      file('src/features/home/Home.connector.tsx'),
    );

    expect(diagnostics).toHaveLength(13);
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('useLocalValue hook'),
        expect.stringContaining('React.useState hook'),
        expect.stringContaining('fetch browser/runtime API'),
        expect.stringContaining('XMLHttpRequest browser/runtime API'),
        expect.stringContaining('WebSocket browser/runtime API'),
        expect.stringContaining('localStorage browser/runtime API'),
        expect.stringContaining('sessionStorage browser/runtime API'),
        expect.stringContaining('document browser/runtime API'),
        expect.stringContaining('setTimeout browser/runtime API'),
        expect.stringContaining('setInterval browser/runtime API'),
        expect.stringContaining('requestAnimationFrame browser/runtime API'),
        expect.stringContaining('MutationObserver browser/runtime API'),
        expect.stringContaining('Image browser/runtime API'),
      ]),
    );
    expect(diagnostics.every(({ code }) => code === 'SRIJIKA4101')).toBe(true);
  });

  it('rejects standalone browser-global UI values without treating names or types as runtime', () => {
    const diagnostics = validate(
      file(
        'src/features/home/Home.ui.tsx',
        [
          'type BrowserWindow = typeof window;',
          'interface Labels { window: string; globalThis: string; self: string; performance: string; screen: string; process: string; Deno: string; Bun: string; }',
          "const labels: Labels = { window: 'window', globalThis: 'global', self: 'self', performance: 'performance', screen: 'screen', process: 'process', Deno: 'deno', Bun: 'bun' };",
          'const { window: windowLabel, globalThis: globalLabel, self: selfLabel } = labels;',
          'export function HomeUI(props: { keyName: string }) {',
          '  const values = [window, globalThis, self, window[props.keyName]];',
          '  const environment = [performance.now, screen.width, process.env, Deno.env, Bun.version];',
          '  return <main>{windowLabel}{globalLabel}{selfLabel}{String(values)}{String(environment)}</main>;',
          '}',
        ].join('\n'),
      ),
      file('src/features/home/Home.connector.tsx'),
    );

    expect(diagnostics).toHaveLength(9);
    expect(diagnostics.every(({ code }) => code === 'SRIJIKA4101')).toBe(true);
    expect(diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('window browser/runtime API'),
        expect.stringContaining('globalThis browser/runtime API'),
        expect.stringContaining('self browser/runtime API'),
      ]),
    );
  });

  it('allows UI values and event callbacks supplied only through props', () => {
    const diagnostics = validate(
      file(
        'src/features/home/Home.ui.tsx',
        [
          'export interface HomeUIProps { label: string; localStorage: string; selected: boolean; onActivate(): void; }',
          'export function HomeUI(props: HomeUIProps) {',
          '  const metadata = { localStorage: props.localStorage };',
          '  return <button aria-pressed={props.selected} localStorage={metadata.localStorage} onClick={props.onActivate}>{props.label}</button>;',
          '}',
        ].join('\n'),
      ),
      file('src/features/home/Home.connector.tsx'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('blocks external runtime modules in every Feature, Slot, Part, Widget, and Shared UI', () => {
    const cases: ReadonlyArray<{
      label: string;
      moduleName: string;
      files: readonly SrijikaArchitectureSourceFile[];
    }> = [
      {
        label: 'Feature UI',
        moduleName: 'axios',
        files: [
          file(
            'src/features/home/Home.ui.tsx',
            "import axios from 'axios'; export function HomeUI() { void axios.get('/home'); return <main />; }",
          ),
          file('src/features/home/Home.connector.tsx'),
        ],
      },
      {
        label: 'Slot UI',
        moduleName: 'zustand',
        files: [
          file('src/features/home/Home.ui.tsx'),
          file('src/features/home/Home.connector.tsx'),
          file(
            'src/features/home/slots/navigation/Navigation.ui.tsx',
            "import { create } from 'zustand'; const store = create(() => ({})); export function NavigationUI() { return <nav>{String(store)}</nav>; }",
          ),
          file('src/features/home/slots/navigation/Navigation.connector.tsx'),
        ],
      },
      {
        label: 'Part UI',
        moduleName: 'react-router-dom',
        files: [
          file('src/features/home/Home.ui.tsx'),
          file('src/features/home/Home.connector.tsx'),
          file('src/features/home/slots/navigation/Navigation.ui.tsx'),
          file('src/features/home/slots/navigation/Navigation.connector.tsx'),
          file(
            'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx',
            "import { Link } from 'react-router-dom'; export function UserMenuUI() { return <Link to='/account'>Account</Link>; }",
          ),
          file('src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx'),
        ],
      },
      {
        label: 'Shared Widget UI',
        moduleName: 'date-fns',
        files: [
          file(
            'src/shared/widgets/user-menu/UserMenu.ui.tsx',
            "import { format } from 'date-fns'; export function UserMenuUI() { return <time>{format(new Date(), 'yyyy')}</time>; }",
          ),
          file('src/shared/widgets/user-menu/UserMenu.connector.tsx'),
        ],
      },
      {
        label: 'Shared UI primitive',
        moduleName: 'axios',
        files: [
          file(
            'src/shared/ui/action-button/ActionButton.ui.tsx',
            "import axios from 'axios'; export function ActionButtonUI() { void axios('/action'); return <button />; }",
          ),
        ],
      },
    ];

    for (const testCase of cases) {
      const diagnostics = validate(...testCase.files);
      const runtimeDiagnostics = diagnostics.filter(({ code }) => code === 'SRIJIKA4101');
      expect(runtimeDiagnostics, testCase.label).toHaveLength(1);
      expect(runtimeDiagnostics[0]).toMatchObject({
        ruleId: 'SRIJIKA-ARCH-UI-RUNTIME-IMPORT',
      });
      expect(runtimeDiagnostics[0]?.message, testCase.label).toContain(testCase.moduleName);
    }
  });

  it('allows only type, asset, safe React JSX, and JSX-only presentational imports in UI', () => {
    const diagnostics = validate(
      file(
        'src/features/home/Home.ui.tsx',
        [
          "import React, { Fragment } from 'react';",
          "import type { AxiosResponse } from 'axios';",
          "import { Slot } from '@radix-ui/react-slot';",
          "import './home.css';",
          "import './brand.woff2?url';",
          "import './notice.mp3';",
          "import './intro.mp4#preview';",
          "import './favicon.ico';",
          'export function HomeUI(props: { label: string; response?: AxiosResponse; onActivate(): void }) {',
          '  void props.response;',
          '  return <Fragment><Slot><button onClick={props.onActivate}>{props.label}</button></Slot>{React.createElement("span")}</Fragment>;',
          '}',
        ].join('\n'),
      ),
      file('src/features/home/Home.connector.tsx'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('keeps Types files passive and requires type-only consumption', () => {
    const valid = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "import type { HomeContract } from './home.types'; void (null as HomeContract | null);",
      ),
      file(
        'src/features/home/home.types.ts',
        [
          "import type { ReactNode } from 'react';",
          "export type { ReactNode as HomeNode } from 'react';",
          'export interface HomeContract { title: string; children?: ReactNode; }',
          "export type HomeStatus = 'idle' | 'ready';",
        ].join('\n'),
      ),
    );
    expect(valid).toEqual([]);

    const runtimeConsumer = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "import { HomeContract } from './home.types'; void HomeContract;",
      ),
      file('src/features/home/home.types.ts', 'export interface HomeContract { title: string; }'),
    );
    expect(
      runtimeConsumer.some(
        ({ code, ruleId, message }) =>
          code === 'SRIJIKA4117' &&
          ruleId === 'SRIJIKA-ARCH-PASSIVE-TYPES' &&
          message.includes('imported or exported as a runtime value'),
      ),
    ).toBe(true);

    const runtimeReExport = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx', "export { HomeContract } from './home.types';"),
      file('src/features/home/home.types.ts', 'export interface HomeContract { title: string; }'),
    );
    expect(runtimeReExport.filter(({ code }) => code === 'SRIJIKA4117')).toHaveLength(1);

    const typeReExport = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "export type { HomeContract } from './home.types';",
      ),
      file('src/features/home/home.types.ts', 'export interface HomeContract { title: string; }'),
    );
    expect(typeReExport).toEqual([]);
  });

  it('rejects runtime declarations and runtime references inside Types contracts', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file(
        'src/features/home/home.types.ts',
        [
          "import { ReactNode } from 'react';",
          "export const DEFAULT_HOME = 'home';",
          'export type DefaultHome = typeof DEFAULT_HOME;',
          'export interface IterableHome { [Symbol.iterator](): Iterator<ReactNode>; }',
        ].join('\n'),
      ),
    );

    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4117')).toHaveLength(4);
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain(
      'runtime declaration or value import/export',
    );
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain(
      'references a runtime value',
    );
  });

  it('rejects feature-private modules across features while allowing public entries', () => {
    const source = [
      "import { useHomeStore } from '../home/home.store';",
      "import { HomeConnector } from '../home/Home.connector';",
      'void useHomeStore; void HomeConnector;',
    ].join('\n');
    const diagnostics = validate(
      file('src/features/dashboard/Dashboard.ui.tsx'),
      file('src/features/dashboard/Dashboard.connector.tsx', source),
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/home.store.ts'),
      file('src/features/home/Home.connector.tsx'),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'SRIJIKA4102',
      span: {
        start: source.indexOf('../home/home.store'),
        end: source.indexOf('../home/home.store') + '../home/home.store'.length,
      },
    });
    expect(diagnostics[0]?.guidance).toContain('shared domain');
  });

  it('keeps nested index modules private to their feature, slot, or part owner', () => {
    const diagnostics = validate(
      file('src/features/dashboard/Dashboard.ui.tsx'),
      file(
        'src/features/dashboard/Dashboard.connector.tsx',
        "import privateFeature from '../home/private';",
      ),
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "import privateSlot from './slots/navigation/private';",
      ),
      file('src/features/home/private/index.ts', 'export default 1;'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.connector.tsx'),
      file('src/features/home/slots/navigation/private/index.ts', 'export default 1;'),
      file('src/features/home/slots/navigation/parts/profile/Profile.ui.tsx'),
      file(
        'src/features/home/slots/navigation/parts/profile/Profile.connector.tsx',
        "import privatePart from '../user-menu/private';",
      ),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx'),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx'),
      file(
        'src/features/home/slots/navigation/parts/user-menu/private/index.ts',
        'export default 1;',
      ),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'SRIJIKA4102',
      'SRIJIKA4103',
      'SRIJIKA4110',
      'SRIJIKA4104',
      'SRIJIKA4110',
      'SRIJIKA4110',
    ]);
  });

  it('keeps a slot store, hooks, and parts inside the owning slot subtree', () => {
    const headerSource = [
      "import { useNavigationStore } from '../navigation/navigation.store';",
      "import { useNavigationKeyboard } from '../navigation/hooks/useNavigationKeyboard';",
      "import { NavItemUI } from '../navigation/parts/NavItem.ui';",
      "import { NavigationConnector } from '../navigation/Navigation.connector';",
    ].join('\n');
    const parentSource = "import { NavItemUI } from './slots/navigation/parts/NavItem.ui';";
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/slots/header/Header.ui.tsx'),
      file('src/features/home/slots/header/Header.connector.tsx', headerSource),
      file('src/features/home/Home.connector.tsx', parentSource),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.connector.tsx'),
      file('src/features/home/slots/navigation/navigation.store.ts'),
      file('src/features/home/slots/navigation/hooks/useNavigation.ts'),
      file('src/features/home/slots/navigation/hooks/useNavigationKeyboard.ts'),
      file('src/features/home/slots/navigation/parts/NavItem.ui.tsx'),
      file('src/features/home/slots/navigation/parts/NavItem.connector.tsx'),
    );

    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4103')).toHaveLength(3);
    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4116')).toHaveLength(2);
    expect(
      diagnostics
        .filter(({ code }) => code === 'SRIJIKA4116')
        .every(({ ruleId }) => ruleId === 'SRIJIKA-ARCH-DIRECT-CHILD-UI'),
    ).toBe(true);
  });

  it('allows a slot store and hook in all descendants of that slot', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.connector.tsx'),
      file('src/features/home/slots/navigation/navigation.store.ts'),
      file(
        'src/features/home/slots/navigation/hooks/useNavigation.ts',
        "export { useNavigationKeyboard } from './useNavigationKeyboard';",
      ),
      file('src/features/home/slots/navigation/hooks/useNavigationKeyboard.ts'),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx'),
      file(
        'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx',
        [
          "import { useNavigationStore } from '../../navigation.store';",
          "import { useNavigationKeyboard } from '../../hooks/useNavigation';",
        ].join('\n'),
      ),
    );

    expect(diagnostics).toEqual([]);
  });

  it('keeps part-private hooks and stores inside their part descendants', () => {
    const source = "import { useMenuStore } from '../user-menu/userMenu.store';";
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.connector.tsx'),
      file('src/features/home/slots/navigation/parts/profile/Profile.ui.tsx'),
      file('src/features/home/slots/navigation/parts/profile/Profile.connector.tsx', source),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx'),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx'),
      file('src/features/home/slots/navigation/parts/user-menu/userMenu.store.ts'),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'SRIJIKA4104' });
    expect(diagnostics[0]?.guidance).toContain('slot scope');
  });

  it('requires parent and sibling composition through the child Connector, never its UI', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file(
        'src/features/home/slots/navigation/Navigation.connector.tsx',
        [
          "import { UserMenuUI } from './parts/user-menu/UserMenu.ui';",
          "import { UserMenuConnector } from './parts/user-menu/UserMenu.connector';",
          "import { userMenuStore } from './parts/user-menu/userMenu.store';",
          'void UserMenuUI; void UserMenuConnector; void userMenuStore;',
        ].join('\n'),
      ),
      file('src/features/home/slots/navigation/parts/profile/Profile.ui.tsx'),
      file(
        'src/features/home/slots/navigation/parts/profile/Profile.connector.tsx',
        [
          "import { UserMenuUI } from '../user-menu/UserMenu.ui';",
          "import { UserMenuConnector } from '../user-menu/UserMenu.connector';",
          'void UserMenuUI; void UserMenuConnector;',
        ].join('\n'),
      ),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx'),
      file(
        'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx',
        "import { userMenuStore } from './userMenu.store'; void userMenuStore;",
      ),
      file(
        'src/features/home/slots/navigation/parts/user-menu/userMenu.store.ts',
        'export const userMenuStore = 1;',
      ),
    );

    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4116')).toHaveLength(2);
    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4104')).toHaveLength(2);
    expect(
      diagnostics
        .filter(({ code }) => code === 'SRIJIKA4116')
        .every(
          ({ ruleId, guidance }) =>
            ruleId === 'SRIJIKA-ARCH-DIRECT-CHILD-UI' && guidance.includes('matching Connector'),
        ),
    ).toBe(true);
    expect(
      diagnostics
        .filter(({ code }) => code === 'SRIJIKA4104')
        .every(({ message }) => message.includes('private') || message.includes('public entry')),
    ).toBe(true);
  });

  it('rejects store TSX, misplaced hooks, and extra UI units at an owner root', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/home.store.tsx'),
      file('src/features/home/useKeyboard.ts'),
      file('src/features/home/Header.ui.tsx'),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'SRIJIKA4108',
      'SRIJIKA4105',
      'SRIJIKA4107',
    ]);
    expect(diagnostics.find(({ code }) => code === 'SRIJIKA4105')?.guidance).toContain(
      'home.store.ts',
    );
  });

  it('requires every hooks-directory module to use the owner hook naming contract', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/hooks/shared.ts'),
      file('src/features/home/internal/hooks/useHomeKeyboard.ts'),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual(['SRIJIKA4107', 'SRIJIKA4107']);
    expect(diagnostics.every(({ message }) => message.includes('useHome'))).toBe(true);
  });

  it('requires the mandatory owner UI before optional companions', () => {
    const diagnostics = validate(
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/slots/navigation/navigation.store.ts'),
    );

    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4106')).toHaveLength(2);
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain('Home.ui.tsx');
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain('Navigation.ui.tsx');
  });

  it('requires the feature UI when an ordinary feature-owned source exists', () => {
    const diagnostics = validate(
      file('src/features/home/util.ts', 'export const formatHome = () => "home";'),
    );

    expect(diagnostics.map(({ code, ruleId }) => ({ code, ruleId }))).toEqual([
      { code: 'SRIJIKA4106', ruleId: 'SRIJIKA-ARCH-MISSING-UI' },
      { code: 'SRIJIKA4109', ruleId: 'SRIJIKA-ARCH-MISSING-CONNECTOR' },
      { code: 'SRIJIKA4110', ruleId: 'SRIJIKA-ARCH-STRICT-OWNER-SHAPE' },
    ]);
    expect(diagnostics.map(({ message }) => message).join(' ')).toContain('Home.ui.tsx');
  });

  it('enforces the highest available owner-local runtime capability without treating helper hooks as gateways', () => {
    const diagnostics = validate(
      file('src/features/dashboard/Dashboard.ui.tsx'),
      file('src/features/dashboard/Dashboard.connector.tsx', "import './dashboard.logic';"),
      file('src/features/dashboard/hooks/useDashboard.ts', "import '../dashboard.api';"),
      file('src/features/dashboard/dashboard.store.ts', "import './dashboard.api';"),
      file('src/features/dashboard/dashboard.logic.ts', "import './dashboard.api';"),
      file('src/features/dashboard/dashboard.api.ts'),
      file('src/features/dashboard/dashboard.types.ts'),
      file(
        'src/features/dashboard/hooks/useDashboardKeyboard.ts',
        'export const useDashboardKeyboard = () => {};',
      ),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'SRIJIKA4201',
      'SRIJIKA4201',
      'SRIJIKA4201',
    ]);
    expect(diagnostics.map(({ recommendation }) => recommendation)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'SRIJIKA-ARCH-RECOMMEND-HOOK',
          from: 'connector',
          currentTarget: 'logic',
          recommendedTarget: 'hook',
        }),
        expect.objectContaining({ from: 'hook', recommendedTarget: 'store' }),
        expect.objectContaining({ from: 'store', recommendedTarget: 'logic' }),
      ]),
    );
  });

  it('lets a connector use Store, Logic, or API as the gateway when senior capabilities are absent', () => {
    const diagnostics = validate(
      file('src/features/store-case/StoreCase.ui.tsx'),
      file('src/features/store-case/StoreCase.connector.tsx', "import './storeCase.store';"),
      file('src/features/store-case/storeCase.store.ts', "import './storeCase.logic';"),
      file('src/features/store-case/storeCase.logic.ts', "import './storeCase.api';"),
      file('src/features/store-case/storeCase.api.ts'),
      file('src/features/logic-case/LogicCase.ui.tsx'),
      file('src/features/logic-case/LogicCase.connector.tsx', "import './logicCase.logic';"),
      file('src/features/logic-case/logicCase.logic.ts', "import './logicCase.api';"),
      file('src/features/logic-case/logicCase.api.ts'),
      file('src/features/api-case/ApiCase.ui.tsx'),
      file('src/features/api-case/ApiCase.connector.tsx', "import './apiCase.api';"),
      file('src/features/api-case/apiCase.api.ts'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('keeps UI isolated from Logic and API while allowing passive Types', () => {
    const diagnostics = validate(
      file(
        'src/features/home/Home.ui.tsx',
        [
          "import type { HomeState } from './home.types';",
          "import { homeLogic } from './home.logic';",
          "import { homeApi } from './home.api';",
          'void homeLogic; void homeApi; void (null as HomeState | null);',
        ].join('\n'),
      ),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/home.types.ts', 'export interface HomeState {}'),
      file('src/features/home/home.logic.ts', 'export const homeLogic = {};'),
      file('src/features/home/home.api.ts', 'export const homeApi = {};'),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual(['SRIJIKA4101', 'SRIJIKA4101']);
    expect(diagnostics.map(({ message }) => message).join(' ')).toContain('logic');
    expect(diagnostics.map(({ message }) => message).join(' ')).toContain('api');
  });

  it('keeps Business Logic free from React, state, router, and query lifecycle concerns', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx', "import './home.logic';"),
      file(
        'src/features/home/home.logic.ts',
        [
          "import React from 'react';",
          "import { QueryClient, useQuery } from '@tanstack/react-query';",
          "import { create } from 'zustand';",
          "import axios from 'axios';",
          "import 'node:http';",
          "import 'node:https';",
          "import 'http';",
          "import 'https';",
          "import 'undici';",
          "import 'cross-fetch';",
          "import 'node-fetch';",
          "import 'ofetch';",
          'const queryClient = new QueryClient();',
          'const store = create(() => ({}));',
          'export function homeLogic() {',
          '  React.useEffect(() => undefined, []);',
          "  useQuery({ queryKey: ['home'], queryFn: async () => 'home' });",
          "  queryClient.invalidateQueries({ queryKey: ['home'] });",
          "  void fetch('/api/home');",
          "  void axios.get('/api/home');",
          '  return store;',
          '}',
        ].join('\n'),
      ),
    );
    const runtimeDiagnostics = diagnostics.filter(({ code }) => code === 'SRIJIKA4118');

    expect(runtimeDiagnostics).toHaveLength(17);
    expect(
      runtimeDiagnostics.every(({ ruleId }) => ruleId === 'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN'),
    ).toBe(true);
    expect(runtimeDiagnostics.map(({ message }) => message).join('\n')).toContain(
      '@tanstack/react-query',
    );
    expect(runtimeDiagnostics.map(({ message }) => message).join('\n')).toContain(
      'React.useEffect',
    );
    expect(runtimeDiagnostics.map(({ message }) => message).join('\n')).toContain(
      'queryClient.invalidateQueries',
    );
    expect(runtimeDiagnostics.map(({ message }) => message).join('\n')).toContain('fetch');
    expect(runtimeDiagnostics.map(({ message }) => message).join('\n')).toContain('axios');
  });

  it('rejects transport references, aliases, and browser-global access in Business Logic', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx', "import './home.logic';"),
      file(
        'src/features/home/home.logic.ts',
        [
          'type BrowserWindow = typeof window;',
          'interface Labels { window: string; fetch: string; }',
          "const labels: Labels = { window: 'window', fetch: 'fetch' };",
          'const transport = fetch;',
          'const invoke = fetch.call;',
          'const Constructor = XMLHttpRequest;',
          'const scopedFetch = window.fetch;',
          "const ScopedConstructor = globalThis['XMLHttpRequest'];",
          'const browserLocation = self.location;',
          'export function homeLogic() {',
          '  return [labels, transport, invoke, new Constructor(), scopedFetch, new ScopedConstructor(), browserLocation];',
          '}',
        ].join('\n'),
      ),
    ).filter(({ code }) => code === 'SRIJIKA4118');

    expect(diagnostics).toHaveLength(6);
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain('fetch');
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain('XMLHttpRequest');
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain('window.fetch');
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain(
      'globalThis.XMLHttpRequest',
    );
    expect(diagnostics.map(({ message }) => message).join('\n')).toContain('self.location');
  });

  it('strictly validates an authoritative UI entry outside ownership roots', () => {
    const diagnostics = validate(
      file(
        'application/App.ui.tsx',
        [
          "import './unscanned-runtime';",
          "import './app.css';",
          "const requested = './runtime';",
          'void import(requested);',
          'export function AppUI() { return <main />; }',
        ].join('\n'),
      ),
    );

    expect(diagnostics.map(({ code }) => code).sort()).toEqual(['SRIJIKA4119', 'SRIJIKA4121']);
  });

  it('allows deterministic Logic to use passive Types, pure utilities, and its API boundary', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx', "import './home.logic';"),
      file(
        'src/features/home/home.logic.ts',
        [
          "import type { HomeRecord } from './home.types';",
          "import { homeApi } from './home.api';",
          "import { z } from 'zod';",
          'export function normalizeHome(value: HomeRecord) {',
          '  const parsed = z.string().parse(value.label);',
          '  return homeApi.normalize(parsed.trim().toLowerCase());',
          '}',
        ].join('\n'),
      ),
      file('src/features/home/home.api.ts', 'export const homeApi = { normalize: String };'),
      file('src/features/home/home.types.ts', 'export interface HomeRecord { label: string; }'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('emits deterministic maintainability recommendations without invalidating a short chain', () => {
    const result = validateSrijikaArchitecture(
      [
        file('src/features/report/Report.ui.tsx'),
        file(
          'src/features/report/Report.connector.tsx',
          "import { reportApi } from './report.api'; reportApi.list(); reportApi.summary();",
        ),
        file('src/features/report/report.api.ts', 'export const reportApi = {} as any;'),
        file('src/features/search/Search.ui.tsx'),
        file(
          'src/features/search/Search.connector.tsx',
          "import { useEffect } from 'react'; import './search.store'; useEffect(() => {});",
        ),
        file('src/features/search/search.store.ts'),
        file('src/features/grid/Grid.ui.tsx'),
        file('src/features/grid/Grid.connector.tsx', "import './grid.store';"),
        file(
          'src/features/grid/grid.store.ts',
          'export const select = (state: any) => [state.a, state.b, state.c, state.d, state.e];',
        ),
        file('src/features/draft/Draft.ui.tsx'),
        file('src/features/draft/Draft.connector.tsx', "import './useDraft';"),
        file(
          'src/features/draft/useDraft.ts',
          "import { useState } from 'react'; import './draft.api'; useState(1); useState(2); useState(3); useState(4);",
        ),
        file('src/features/draft/draft.api.ts'),
      ],
      { projectRoot: root },
    );

    expect(result.diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: 'SRIJIKA4202', severity: 'warning' },
      { code: 'SRIJIKA4202', severity: 'warning' },
      { code: 'SRIJIKA4202', severity: 'warning' },
      { code: 'SRIJIKA4202', severity: 'warning' },
    ]);
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'SRIJIKA-ARCH-RECOMMEND-LOGIC',
          recommendedTarget: 'logic',
          evidence: { metric: 'endpoint-calls', value: 2, threshold: 2 },
        }),
        expect.objectContaining({
          id: 'SRIJIKA-ARCH-RECOMMEND-HOOK',
          recommendedTarget: 'hook',
          evidence: { metric: 'lifecycle-cache', value: 1, threshold: 1 },
        }),
        expect.objectContaining({
          id: 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE',
          evidence: { metric: 'store-members', value: 5, threshold: 5 },
        }),
        expect.objectContaining({
          id: 'SRIJIKA-ARCH-RECOMMEND-STORE',
          recommendedTarget: 'store',
          evidence: { metric: 'local-state-fields', value: 4, threshold: 4 },
        }),
      ]),
    );
  });

  it('rejects reverse owner-local dependencies', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/hooks/useHome.ts'),
      file('src/features/home/home.store.ts'),
      file('src/features/home/home.logic.ts', "import './home.store';"),
      file('src/features/home/home.api.ts', "import './home.logic';"),
    );

    expect(diagnostics.map(({ code, ruleId }) => ({ code, ruleId }))).toEqual([
      { code: 'SRIJIKA4203', ruleId: 'SRIJIKA-ARCH-REVERSE-DEPENDENCY' },
      { code: 'SRIJIKA4203', ruleId: 'SRIJIKA-ARCH-REVERSE-DEPENDENCY' },
    ]);
  });

  it('keeps legacy helper hooks private behind a canonical owner gateway when one exists', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "import { useHomeKeyboard } from './hooks/useHomeKeyboard'; void useHomeKeyboard;",
      ),
      file('src/features/home/hooks/useHome.ts'),
      file(
        'src/features/home/hooks/useHomeKeyboard.ts',
        'export const useHomeKeyboard = () => {};',
      ),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'SRIJIKA4201',
      ruleId: 'SRIJIKA-ARCH-LAYER-JUMP',
      recommendation: {
        id: 'SRIJIKA-ARCH-RECOMMEND-HOOK',
        suggestedFileName: 'hooks/useHome.ts',
      },
    });
  });

  it('requires a matching Connector for every discovered Feature, Slot, and Part', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/parts/menu/Menu.ui.tsx'),
    );

    expect(diagnostics).toHaveLength(3);
    expect(
      diagnostics.every(
        ({ code, ruleId, severity, guidance }) =>
          code === 'SRIJIKA4109' &&
          ruleId === 'SRIJIKA-ARCH-MISSING-CONNECTOR' &&
          severity === 'error' &&
          guidance.includes('required and only runtime gateway'),
      ),
    ).toBe(true);
  });

  it('detects recommendation signals without requiring a resolved runtime import', () => {
    const result = validateSrijikaArchitecture(
      [
        file('src/features/direct/Direct.ui.tsx'),
        file('src/features/direct/Direct.connector.tsx', "void fetch('/one'); void fetch('/two');"),
        file('src/features/local/Local.ui.tsx'),
        file(
          'src/features/local/Local.connector.tsx',
          "import { useState } from 'react'; useState(1); useState(2); useState(3); useState(4);",
        ),
        file('src/features/small/Small.ui.tsx'),
        file(
          'src/features/small/Small.connector.tsx',
          "import { useState } from 'react'; useState(1); useState(2); async function save() {} void save;",
        ),
      ],
      { projectRoot: root },
    );

    expect(result.recommendations.map(({ id, evidence }) => ({ id, evidence }))).toEqual([
      {
        id: 'SRIJIKA-ARCH-RECOMMEND-LOGIC',
        evidence: { metric: 'endpoint-calls', value: 2, threshold: 2 },
      },
      {
        id: 'SRIJIKA-ARCH-RECOMMEND-HOOK',
        evidence: { metric: 'react-hooks', value: 4, threshold: 3 },
      },
      {
        id: 'SRIJIKA-ARCH-RECOMMEND-STORE',
        evidence: { metric: 'local-state-fields', value: 4, threshold: 4 },
      },
    ]);
    expect(result.diagnostics.every(({ severity }) => severity === 'warning')).toBe(true);
  });

  it('promotes private capabilities deterministically through Part → Slot → Feature → Shared', () => {
    const result = validateSrijikaArchitecture(
      [
        file('src/features/dashboard/Dashboard.ui.tsx'),
        file('src/features/dashboard/Dashboard.connector.tsx', "import '../home/home.store';"),
        file('src/features/home/Home.ui.tsx'),
        file('src/features/home/Home.connector.tsx'),
        file('src/features/home/home.store.ts'),
        file('src/features/home/slots/header/Header.ui.tsx'),
        file(
          'src/features/home/slots/header/Header.connector.tsx',
          "import '../navigation/navigation.store';",
        ),
        file('src/features/home/slots/navigation/Navigation.ui.tsx'),
        file('src/features/home/slots/navigation/Navigation.connector.tsx'),
        file('src/features/home/slots/navigation/navigation.store.ts'),
        file('src/features/home/slots/navigation/parts/profile/Profile.ui.tsx'),
        file(
          'src/features/home/slots/navigation/parts/profile/Profile.connector.tsx',
          "import '../user-menu/userMenu.store';",
        ),
        file('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx'),
        file('src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx'),
        file('src/features/home/slots/navigation/parts/user-menu/userMenu.store.ts'),
      ],
      { projectRoot: root },
    );

    const promotions = result.recommendations.filter(
      ({ id }) => id === 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER',
    );
    expect(promotions).toHaveLength(3);
    expect(promotions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suggestedFileName: 'src/shared/capabilities/home/home.store.ts',
          evidence: { metric: 'owner-consumers', value: 2, threshold: 2 },
        }),
        expect.objectContaining({
          suggestedFileName: 'src/features/home/home.store.ts',
          evidence: { metric: 'owner-consumers', value: 2, threshold: 2 },
        }),
        expect.objectContaining({
          suggestedFileName: 'src/features/home/slots/navigation/navigation.store.ts',
          evidence: { metric: 'owner-consumers', value: 2, threshold: 2 },
        }),
      ]),
    );
    expect(
      result.diagnostics.filter(
        ({ recommendation }) => recommendation?.id === 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER',
      ),
    ).toHaveLength(3);
  });

  it('applies SPLIT-OWNER only above the exact 200/300/16 UI guardrails', () => {
    const functionSource = (statementCount: number) =>
      [
        'export function FunctionLimitUI() {',
        ...Array.from({ length: statementCount }, (_, index) => `  void ${index};`),
        '  return null;',
        '}',
      ].join('\n');
    const fileSource = (typeCount: number) =>
      [
        ...Array.from({ length: typeCount }, (_, index) => `type FileLine${index} = number;`),
        'export function FileLimitUI() {',
        '  return null;',
        '}',
      ].join('\n');
    const contractSource = (memberCount: number) =>
      [
        'export interface ContractLimitUIProps {',
        ...Array.from({ length: memberCount }, (_, index) => `  value${index}: string;`),
        '}',
        'export function ContractLimitUI(_props: ContractLimitUIProps) { return null; }',
      ].join('\n');
    const resultFor = (owner: string, source: string) => {
      const pascal = owner
        .split('-')
        .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
        .join('');
      return validateSrijikaArchitecture(
        [
          file(`src/features/${owner}/${pascal}.ui.tsx`, source),
          file(`src/features/${owner}/${pascal}.connector.tsx`),
        ],
        { projectRoot: root },
      );
    };

    expect(resultFor('function-limit', functionSource(197)).recommendations).toEqual([]);
    expect(resultFor('file-limit', fileSource(297)).recommendations).toEqual([]);
    expect(resultFor('contract-limit', contractSource(16)).recommendations).toEqual([]);

    const functionOver = resultFor('function-limit', functionSource(198)).recommendations[0];
    const fileOver = resultFor('file-limit', fileSource(298)).recommendations[0];
    const contractOver = resultFor('contract-limit', contractSource(17)).recommendations[0];
    expect(functionOver).toMatchObject({
      id: 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
      evidence: { metric: 'ui-function-lines', value: 201, threshold: 200 },
    });
    expect(fileOver).toMatchObject({
      id: 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
      evidence: { metric: 'ui-file-lines', value: 301, threshold: 300 },
    });
    expect(contractOver).toMatchObject({
      id: 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
      evidence: { metric: 'ui-contract-members', value: 17, threshold: 16 },
    });
  });

  it('rejects freehand files and categories directly under the Shared root', () => {
    const diagnostics = validate(
      file('src/shared/freehand.ts'),
      file('src/shared/utils/format.ts'),
      file('src/shared/common/session.ts'),
    );

    expect(diagnostics).toHaveLength(3);
    expect(
      diagnostics.every(
        ({ code, ruleId }) =>
          code === 'SRIJIKA4110' && ruleId === 'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
      ),
    ).toBe(true);
  });

  it('rejects alternate owner folder spellings across Feature, Slot, Part, and Shared', () => {
    const diagnostics = validate(
      file('src/features/Home_Page/HomePage.ui.tsx'),
      file('src/features/Home_Page/HomePage.connector.tsx'),
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/slots/MainNavigation/MainNavigation.ui.tsx'),
      file('src/features/home/slots/MainNavigation/MainNavigation.connector.tsx'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.connector.tsx'),
      file('src/features/home/slots/navigation/parts/User_Menu/UserMenu.ui.tsx'),
      file('src/features/home/slots/navigation/parts/User_Menu/UserMenu.connector.tsx'),
      file('src/shared/ui/ActionButton/ActionButton.ui.tsx'),
    );

    expect(diagnostics).toHaveLength(7);
    expect(
      diagnostics.every(
        ({ code, ruleId, guidance }) =>
          code === 'SRIJIKA4110' &&
          ruleId === 'SRIJIKA-ARCH-STRICT-OWNER-SHAPE' &&
          guidance.includes('exact kebab-case path'),
      ),
    ).toBe(true);
    expect(diagnostics.map(({ guidance }) => guidance).join('\n')).toContain('Feature → home-page');
    expect(diagnostics.map(({ guidance }) => guidance).join('\n')).toContain(
      'Slot → main-navigation',
    );
    expect(diagnostics.map(({ guidance }) => guidance).join('\n')).toContain('Part → user-menu');
    expect(diagnostics.map(({ guidance }) => guidance).join('\n')).toContain(
      'Shared owner → action-button',
    );
  });
});

describe('canonical Shared architecture', () => {
  it('classifies Shared UI, Widget, and headless Capability owners', () => {
    expect(
      classifySrijikaArchitecturePath('/project/src/shared/ui/action-button/ActionButton.ui.tsx'),
    ).toMatchObject({ kind: 'shared-ui', shared: 'action-button' });
    expect(
      classifySrijikaArchitecturePath(
        '/project/src/shared/widgets/user-menu/UserMenu.connector.tsx',
      ),
    ).toMatchObject({ kind: 'shared-widget', shared: 'user-menu' });
    expect(
      classifySrijikaArchitecturePath('/project/src/shared/capabilities/auth/useAuth.ts'),
    ).toMatchObject({ kind: 'shared-capability', shared: 'auth' });
  });

  it('accepts public Shared boundaries and the same progressive runtime chain', () => {
    const diagnostics = validate(
      file(
        'src/features/home/Home.ui.tsx',
        "import { ActionButtonUI } from '../../shared/ui/action-button/ActionButton.ui'; export function HomeUI() { return <ActionButtonUI />; }",
      ),
      file(
        'src/features/home/Home.connector.tsx',
        [
          "import { UserMenuConnector } from '../../shared/widgets/user-menu/UserMenu.connector';",
          "import { useAuth } from '../../shared/capabilities/auth/useAuth';",
          'void UserMenuConnector; void useAuth;',
        ].join('\n'),
      ),
      file(
        'src/shared/ui/action-button/ActionButton.ui.tsx',
        'import type { ActionButtonUIProps } from \'./actionButton.types\'; export function ActionButtonUI(_props: ActionButtonUIProps) { return <button type="button" />; }',
      ),
      file(
        'src/shared/ui/action-button/actionButton.types.ts',
        'export interface ActionButtonUIProps { label: string; }',
      ),
      file('src/shared/widgets/user-menu/UserMenu.ui.tsx'),
      file(
        'src/shared/widgets/user-menu/UserMenu.connector.tsx',
        "import './useUserMenu'; import './UserMenu.ui';",
      ),
      file('src/shared/widgets/user-menu/useUserMenu.ts', "import './userMenu.store';"),
      file('src/shared/widgets/user-menu/userMenu.store.ts', "import './userMenu.logic';"),
      file('src/shared/widgets/user-menu/userMenu.logic.ts', "import './userMenu.api';"),
      file('src/shared/widgets/user-menu/userMenu.api.ts'),
      file('src/shared/capabilities/auth/useAuth.ts', "import './auth.store';"),
      file('src/shared/capabilities/auth/auth.store.ts', "import './auth.logic';"),
      file('src/shared/capabilities/auth/auth.logic.ts', "import './auth.api';"),
      file('src/shared/capabilities/auth/auth.api.ts'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('lets a Shared UI primitive compose public primitives and external presentational JSX only', () => {
    const accepted = validate(
      file(
        'src/shared/ui/icon/Icon.ui.tsx',
        'export function IconUI() { return <span aria-hidden="true" />; }',
      ),
      file(
        'src/shared/ui/action-button/ActionButton.ui.tsx',
        [
          "import { Slot } from '@radix-ui/react-slot';",
          "import { IconUI } from '../icon/Icon.ui';",
          "import './action-button.css';",
          'export function ActionButtonUI(props: { label: string; onActivate(): void }) {',
          '  return <Slot><button onClick={props.onActivate}><IconUI />{props.label}</button></Slot>;',
          '}',
        ].join('\n'),
      ),
    );
    expect(accepted).toEqual([]);

    const rejected = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/shared/widgets/user-menu/UserMenu.ui.tsx'),
      file('src/shared/widgets/user-menu/UserMenu.connector.tsx'),
      file(
        'src/shared/ui/action-button/ActionButton.ui.tsx',
        [
          "import { HomeUI } from '../../../features/home/Home.ui';",
          "import { UserMenuConnector } from '../../widgets/user-menu/UserMenu.connector';",
          'export function ActionButtonUI() { void HomeUI; void UserMenuConnector; return null; }',
        ].join('\n'),
      ),
    );
    expect(
      rejected.some(
        ({ code, message }) =>
          code === 'SRIJIKA4101' &&
          message.includes('runtime module ../../../features/home/Home.ui'),
      ),
    ).toBe(true);
    expect(
      rejected.some(
        ({ code, message }) =>
          code === 'SRIJIKA4101' &&
          message.includes('runtime module ../../widgets/user-menu/UserMenu.connector'),
      ),
    ).toBe(true);
  });

  it('keeps Shared one-way and exposes only canonical public boundaries', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        [
          "import '../../shared/widgets/user-menu/useUserMenu';",
          "import '../../shared/capabilities/auth/auth.logic';",
          "import '../../shared/capabilities/notifications/hooks/useNotificationsPolling';",
        ].join('\n'),
      ),
      file('src/features/home/home.logic.ts'),
      file('src/shared/widgets/user-menu/UserMenu.ui.tsx'),
      file('src/shared/widgets/user-menu/UserMenu.connector.tsx'),
      file('src/shared/widgets/user-menu/useUserMenu.ts'),
      file(
        'src/shared/capabilities/auth/useAuth.ts',
        "import '../../../features/home/home.logic'; import './auth.logic';",
      ),
      file('src/shared/capabilities/auth/auth.logic.ts'),
      file('src/shared/capabilities/notifications/hooks/useNotifications.ts'),
      file('src/shared/capabilities/notifications/hooks/useNotificationsPolling.ts'),
    );

    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4114')).toHaveLength(3);
    expect(diagnostics.filter(({ code }) => code === 'SRIJIKA4113')).toHaveLength(1);
    expect(diagnostics.find(({ code }) => code === 'SRIJIKA4113')?.ruleId).toBe(
      'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY',
    );
  });

  it('exposes an explicit Shared API boundary even when the capability also has Logic', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "import { catalogApi } from '../../shared/capabilities/catalog/catalog.api'; export function HomeConnector() { void catalogApi; return <div />; }",
      ),
      file(
        'src/shared/capabilities/catalog/catalog.logic.ts',
        'export const normalizeCatalog = () => null;',
      ),
      file('src/shared/capabilities/catalog/catalog.api.ts', 'export const catalogApi = {};'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('applies Shared ownership rules to import type nodes', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/home.types.ts', 'export interface HomeSecret {}'),
      file('src/shared/capabilities/auth/auth.api.ts', 'export const authApi = {};'),
      file(
        'src/shared/capabilities/auth/auth.types.ts',
        "export type Leaked = import('../../../features/home/home.types').HomeSecret;",
      ),
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'SRIJIKA4113',
        ruleId: 'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY',
      }),
    );
  });

  it('enforces pure Shared UI while allowing a passive Shared Types contract', () => {
    const diagnostics = validate(
      file(
        'src/shared/ui/action-button/ActionButton.ui.tsx',
        "import { format } from 'date-fns'; export function ActionButtonUI() { void format; return null; }",
      ),
      file('src/shared/ui/action-button/actionButton.store.ts'),
      file('src/shared/capabilities/auth/auth.types.ts'),
    );

    expect(
      diagnostics.some(
        ({ code, ruleId, message }) =>
          code === 'SRIJIKA4101' &&
          ruleId === 'SRIJIKA-ARCH-UI-RUNTIME-IMPORT' &&
          message.includes('runtime module date-fns'),
      ),
    ).toBe(true);
    expect(diagnostics.some(({ code }) => code === 'SRIJIKA4110')).toBe(true);
    expect(diagnostics.some(({ code }) => code === 'SRIJIKA4115')).toBe(false);
  });

  it('supports expanded Hooks and Stores behind one Shared owner gateway', () => {
    const diagnostics = validate(
      file('src/shared/widgets/user-menu/UserMenu.ui.tsx'),
      file('src/shared/widgets/user-menu/UserMenu.connector.tsx', "import './hooks/useUserMenu';"),
      file(
        'src/shared/widgets/user-menu/hooks/useUserMenu.ts',
        "import './useUserMenuKeyboard'; import '../stores/userMenu.store';",
      ),
      file('src/shared/widgets/user-menu/hooks/useUserMenuKeyboard.ts'),
      file(
        'src/shared/widgets/user-menu/stores/userMenu.store.ts',
        "import './userMenuSession.store';",
      ),
      file('src/shared/widgets/user-menu/stores/userMenuSession.store.ts'),
    );

    expect(diagnostics).toEqual([]);
  });

  it('rejects runtime dependency cycles between public Shared owners but ignores type-only edges', () => {
    const runtimeCycle = validate(
      file(
        'src/shared/capabilities/alpha/useAlpha.ts',
        "import { useBeta } from '../beta/useBeta'; export function useAlpha() { return useBeta; }",
      ),
      file(
        'src/shared/capabilities/beta/useBeta.ts',
        "import { useAlpha } from '../alpha/useAlpha'; export function useBeta() { return useAlpha; }",
      ),
    );
    expect(runtimeCycle).toHaveLength(2);
    expect(
      runtimeCycle.every(
        ({ code, ruleId, message }) =>
          code === 'SRIJIKA4113' &&
          ruleId === 'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY' &&
          message.includes('dependency cycle'),
      ),
    ).toBe(true);

    const passiveCycle = validate(
      file('src/shared/capabilities/alpha/useAlpha.ts'),
      file(
        'src/shared/capabilities/alpha/alpha.types.ts',
        "import type { Beta } from '../beta/beta.types'; export interface Alpha { beta?: Beta; }",
      ),
      file('src/shared/capabilities/beta/useBeta.ts'),
      file(
        'src/shared/capabilities/beta/beta.types.ts',
        "import type { Alpha } from '../alpha/alpha.types'; export interface Beta { alpha?: Alpha; }",
      ),
    );
    expect(passiveCycle).toEqual([]);
  });

  it('fails closed for computed import and require targets in governed ownership roots', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        [
          "const target = './home.api';",
          'void import(target);',
          'void require(`./${target}`);',
        ].join('\n'),
      ),
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SRIJIKA4119',
          ruleId: 'SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT',
        }),
      ]),
    );

    expect(
      validate(
        file('src/features/home/Home.ui.tsx'),
        file(
          'src/features/home/Home.connector.tsx',
          'export async function loadHome() { return import(`./Home.ui`); }',
        ),
      ),
    ).toEqual([]);
  });

  it('resolves declared project aliases and rejects unresolved or undeclared local aliases', () => {
    const files = [
      file('src/features/home/Home.ui.tsx'),
      file(
        'src/features/home/Home.connector.tsx',
        "import { loadHome } from '@app/features/home/home.api'; void loadHome;",
      ),
      file('src/features/home/home.api.ts', 'export const loadHome = () => null;'),
    ];
    expect(
      validateSrijikaArchitecture(files, {
        projectRoot: root,
        aliases: { '@app/': 'src/' },
      }).diagnostics,
    ).toEqual([]);

    for (const specifier of ['@app/features/missing/home.api', '#home', '~/home']) {
      const diagnostics = validateSrijikaArchitecture(
        [
          file('src/features/home/Home.ui.tsx'),
          file(
            'src/features/home/Home.connector.tsx',
            `import value from '${specifier}'; void value;`,
          ),
        ],
        { projectRoot: root, aliases: { '@app/': 'src/' } },
      ).diagnostics;
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'SRIJIKA4120',
          ruleId: 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS',
        }),
      );
    }

    expect(
      validateSrijikaArchitecture(
        [
          file('src/features/home/Home.ui.tsx'),
          file(
            'src/features/home/Home.connector.tsx',
            "import { format } from '@utils/format'; void format;",
          ),
          file('src/utils/format.ts', 'export const format = String;'),
        ],
        { projectRoot: root, aliases: { '@utils/': 'src/utils/' } },
      ).diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: 'SRIJIKA4120',
        ruleId: 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS',
      }),
    );

    expect(
      validate(
        file('src/features/home/Home.ui.tsx'),
        file(
          'src/features/home/Home.connector.tsx',
          "import { QueryClient } from '@tanstack/react-query'; void QueryClient;",
        ),
      ).some(({ code }) => code === 'SRIJIKA4120'),
    ).toBe(false);
  });

  it('fails closed for missing or outside-root project-local imports while preserving valid targets and assets', () => {
    const rejected = validateSrijikaArchitecture(
      [
        file(
          'src/features/home/Home.ui.tsx',
          "import { run } from '../../runtime'; export function HomeUI() { run(); return <main />; }",
        ),
        file(
          'src/features/home/Home.connector.tsx',
          "import missing from 'src/features/home/missing.logic'; void missing;",
        ),
        file('src/runtime.ts', 'export const run = () => undefined;'),
      ],
      { projectRoot: root },
    ).diagnostics;

    expect(rejected).toHaveLength(2);
    expect(
      rejected.every(
        ({ code, ruleId }) =>
          code === 'SRIJIKA4121' && ruleId === 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT',
      ),
    ).toBe(true);

    expect(
      validate(
        file(
          'src/features/home/Home.ui.tsx',
          "import './home.css'; export function HomeUI() { return <main />; }",
        ),
        file(
          'src/features/home/Home.connector.tsx',
          "import { homeLogic } from 'src/features/home/home.logic'; void homeLogic;",
        ),
        file('src/features/home/home.logic.ts', 'export const homeLogic = () => undefined;'),
      ),
    ).toEqual([]);
  });
});
