import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { validateSrijikaArchitecture } from '../src/index';
import { createSrijikaArchitectureValidatorScript } from '../src/portable';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('portable architecture validator', () => {
  it('creates a standalone project script that fails on an ownership violation', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await mkdir(path.join(project, 'src/features/dashboard'), { recursive: true });
    await writeFile(
      path.join(project, 'src/features/home/home.store.ts'),
      'export const useHomeStore = 1;\n',
    );
    await writeFile(
      path.join(project, 'src/features/dashboard/Dashboard.connector.tsx'),
      "import { useHomeStore } from '../home/home.store';\nvoid useHomeStore;\n",
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], {
      cwd: project,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SRIJIKA4102');
  });

  it('keeps portable CLI codes in parity with the browser-safe validator', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-parity-'));
    temporaryDirectories.push(project);
    const uiFile = path.join(project, 'src/features/home/Home.ui.tsx');
    const storeFile = path.join(project, 'src/features/home/home.store.tsx');
    await mkdir(path.dirname(uiFile), { recursive: true });
    const uiSource = [
      "import { useState } from 'react';",
      "import { useHomeStore } from './home.store';",
      'export function HomeUI() { const [open] = useState(false); return <main>{String(open || useHomeStore)}</main>; }',
    ].join('\n');
    const storeSource = 'export const useHomeStore = 1;\n';
    await writeFile(uiFile, uiSource);
    await writeFile(storeFile, storeSource);
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      [
        { fileName: uiFile, source: uiSource },
        { fileName: storeFile, source: storeSource },
      ],
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
  });

  it('matches browser ownership checks for nested indexes, import-equals, and ordinary sources', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-acceptance-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/dashboard/Dashboard.ui.tsx': 'export function DashboardUI() { return null; }',
      'src/features/dashboard/Dashboard.connector.tsx': [
        "import privateFeature from '../home/private';",
        "import homeStore = require('../home/home.store');",
        'void privateFeature; void homeStore;',
      ].join('\n'),
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }',
      'src/features/home/Home.connector.tsx':
        "import privateSlot from './slots/navigation/private'; void privateSlot;",
      'src/features/home/home.store.ts': 'export const homeStore = 1;',
      'src/features/home/private/index.ts': 'export default 1;',
      'src/features/home/slots/navigation/Navigation.ui.tsx':
        'export function NavigationUI() { return null; }',
      'src/features/home/slots/navigation/Navigation.connector.tsx': [
        "import { UserMenuUI } from './parts/user-menu/UserMenu.ui';",
        "import { UserMenuConnector } from './parts/user-menu/UserMenu.connector';",
        "import { userMenuStore } from './parts/user-menu/userMenu.store';",
        'void UserMenuUI; void UserMenuConnector; void userMenuStore;',
      ].join('\n'),
      'src/features/home/slots/navigation/private/index.ts': 'export default 1;',
      'src/features/home/slots/navigation/parts/profile/Profile.ui.tsx':
        'export function ProfileUI() { return null; }',
      'src/features/home/slots/navigation/parts/profile/Profile.connector.tsx': [
        "import privatePart from '../user-menu/private';",
        "import { UserMenuUI } from '../user-menu/UserMenu.ui';",
        "import { UserMenuConnector } from '../user-menu/UserMenu.connector';",
        'void privatePart; void UserMenuUI; void UserMenuConnector;',
      ].join('\n'),
      'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx':
        'export function UserMenuUI() { return null; }',
      'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx':
        "import { userMenuStore } from './userMenu.store'; void userMenuStore;",
      'src/features/home/slots/navigation/parts/user-menu/userMenu.store.ts':
        'export const userMenuStore = 1;',
      'src/features/home/slots/navigation/parts/user-menu/private/index.ts': 'export default 1;',
      'src/features/settings/util.ts': 'export const setting = 1;',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.sort()).toEqual([
      'SRIJIKA4102',
      'SRIJIKA4102',
      'SRIJIKA4103',
      'SRIJIKA4104',
      'SRIJIKA4104',
      'SRIJIKA4104',
      'SRIJIKA4104',
      'SRIJIKA4106',
      'SRIJIKA4109',
    ]);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual(browserCodes);
    expect(result.stderr).toContain('SRIJIKA-ARCH-MISSING-CONNECTOR');
  });

  it('keeps the progressive capability chain in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-chain-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/dashboard/Dashboard.ui.tsx': 'export function DashboardUI() { return null; }',
      'src/features/dashboard/Dashboard.connector.tsx': "import './dashboard.api';",
      'src/features/dashboard/useDashboard.ts': "import './dashboard.logic';",
      'src/features/dashboard/dashboard.store.ts': "import './dashboard.logic';",
      'src/features/dashboard/dashboard.logic.ts': "import './dashboard.api';",
      'src/features/dashboard/dashboard.api.ts': 'export const dashboardApi = {};',
      'src/features/dashboard/dashboard.types.ts': 'export interface DashboardState {}',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes).toEqual(['SRIJIKA4201', 'SRIJIKA4201']);
    expect(result.status).toBe(1);
    expect(portableCodes).toEqual(browserCodes);
  });

  it('keeps deterministic recommendation signals and stable IDs in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-recommend-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/report/Report.ui.tsx': 'export function ReportUI() { return null; }',
      'src/features/report/Report.connector.tsx': [
        "void fetch('/reports');",
        "void fetch('/summary');",
      ].join('\n'),
      'src/features/report/report.api.ts': 'export const reportApi = {} as any;',
      'src/features/grid/Grid.ui.tsx': 'export function GridUI() { return null; }',
      'src/features/grid/Grid.connector.tsx': "import './grid.store';",
      'src/features/grid/grid.store.ts':
        'export const select = (state: any) => [state.a, state.b, state.c, state.d, state.e];',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(0);
    expect(portableCodes.sort()).toEqual(browserCodes.sort());
    expect(result.stderr).toContain('SRIJIKA-ARCH-RECOMMEND-LOGIC');
    expect(result.stderr).toContain('SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE');
  });
});
