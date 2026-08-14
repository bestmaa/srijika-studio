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
      file('src/features/home/hooks/useHomeKeyboard.ts'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file(
        'src/features/home/slots/navigation/Navigation.connector.tsx',
        [
          "import { useHomeStore } from '../../home.store';",
          "import { useHomeKeyboard } from '../../hooks/useHomeKeyboard';",
          'export function NavigationConnector() { useHomeKeyboard(); return useHomeStore; }',
        ].join('\n'),
      ),
    );

    expect(diagnostics).toEqual([]);
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
      'SRIJIKA4104',
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
      file('src/features/home/slots/navigation/hooks/useNavigationKeyboard.ts'),
      file('src/features/home/slots/navigation/parts/NavItem.ui.tsx'),
      file('src/features/home/slots/navigation/parts/NavItem.connector.tsx'),
    );

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'SRIJIKA4103',
      'SRIJIKA4103',
      'SRIJIKA4103',
      'SRIJIKA4103',
      'SRIJIKA4103',
    ]);
    expect(diagnostics.every(({ guidance }) => guidance.includes('promote'))).toBe(true);
  });

  it('allows a slot store and hook in all descendants of that slot', () => {
    const diagnostics = validate(
      file('src/features/home/Home.ui.tsx'),
      file('src/features/home/Home.connector.tsx'),
      file('src/features/home/slots/navigation/Navigation.ui.tsx'),
      file('src/features/home/slots/navigation/Navigation.connector.tsx'),
      file('src/features/home/slots/navigation/navigation.store.ts'),
      file('src/features/home/slots/navigation/hooks/useNavigationKeyboard.ts'),
      file('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx'),
      file(
        'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx',
        [
          "import { useNavigationStore } from '../../navigation.store';",
          "import { useNavigationKeyboard } from '../../hooks/useNavigationKeyboard';",
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

  it('lets the owning slot compose public part entries without leaking them to siblings', () => {
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

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'SRIJIKA4104',
      'SRIJIKA4104',
      'SRIJIKA4104',
    ]);
    expect(diagnostics[0]?.message).toContain('private to its own subtree');
    expect(diagnostics[0]?.guidance).toContain('public UI/Connector');
    expect(diagnostics.slice(1).every(({ message }) => message.includes('public entry'))).toBe(
      true,
    );
    expect(
      diagnostics.slice(1).every(({ guidance }) => guidance.includes('owning navigation')),
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
    ]);
    expect(diagnostics.map(({ message }) => message).join(' ')).toContain('Home.ui.tsx');
  });

  it('enforces the highest available owner-local runtime capability without treating helper hooks as gateways', () => {
    const diagnostics = validate(
      file('src/features/dashboard/Dashboard.ui.tsx'),
      file('src/features/dashboard/Dashboard.connector.tsx', "import './dashboard.logic';"),
      file('src/features/dashboard/useDashboard.ts', "import './dashboard.api';"),
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
      file('src/features/home/useHome.ts'),
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
      file('src/features/home/useHome.ts'),
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
        suggestedFileName: 'useHome.ts',
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
});
