import { resolve } from 'node:path';

import {
  collectSrijikaTestEvidence,
  checkSrijikaArchitecture,
  checkSrijikaUiDiagnostics,
  findSrijikaProjectRoot,
  inspectSrijikaProject,
  scaffoldSrijikaStructure,
  synchronizeSrijikaNextTests,
  synchronizeSrijikaViteTests,
  verifySrijikaOwnerTests,
  SrijikaProjectFileSystem,
  type SrijikaStructureKind,
} from '@srijika/developer-engine';
import type { SrijikaOptionalOwnerCapability } from '@srijika/project-scaffold';

const MAX_PROJECT_FILES = 2_000;
const MAX_PROJECT_ENTRIES = 16_000;
const MAX_PROJECT_DIRECTORIES = 2_000;
const MAX_PROJECT_DEPTH = 32;

export interface SrijikaCodeProjectServiceOptions {
  projectRoot?: string;
}

export class SrijikaCodeProjectService {
  readonly #configuredRoot: string | undefined;

  constructor(options: SrijikaCodeProjectServiceOptions = {}) {
    this.#configuredRoot = options.projectRoot ?? process.env['SRIJIKA_PROJECT_ROOT'];
  }

  async root(requested?: string): Promise<string> {
    const configured = this.#configuredRoot
      ? await findSrijikaProjectRoot(this.#configuredRoot)
      : undefined;
    if (!requested) return configured ?? findSrijikaProjectRoot(process.cwd());
    const selected = await findSrijikaProjectRoot(requested);
    if (configured && resolve(selected) !== resolve(configured)) {
      throw new Error('This MCP server is bounded to its configured Srijika project.');
    }
    return selected;
  }

  async inspect(requested?: string): Promise<Record<string, unknown>> {
    const root = await this.root(requested);
    const project = await inspectSrijikaProject(root);
    const featuresRoot = project.architecture?.featuresRoot ?? 'src/features';
    const sharedRoot = project.architecture?.sharedRoot ?? 'src/shared';
    const ownershipRoots = [
      ...new Set(project.adoption?.managedRoots ?? [featuresRoot, sharedRoot]),
    ];
    const fileSystem = await SrijikaProjectFileSystem.open(root);
    const discovered = await fileSystem.walkFiles(ownershipRoots, {
      maximumFiles: MAX_PROJECT_FILES,
      maximumEntries: MAX_PROJECT_ENTRIES,
      maximumDirectories: MAX_PROJECT_DIRECTORIES,
      maximumDepth: MAX_PROJECT_DEPTH,
    });
    const files = discovered.map(({ relativePath }) => relativePath);
    const adoptionPlan = project.adoption
      ? (await checkSrijikaArchitecture(root)).adoption
      : undefined;
    return {
      contractId: 'srijika.cli-first-code-project',
      root,
      projectName: project.projectName,
      packageManager: project.packageManager,
      lockfile: project.lockfile,
      viteProject: project.viteProject,
      nextProject: project.nextProject,
      architecture: project.architecture,
      adoption: project.adoption,
      adoptionPlan,
      ownershipRoots,
      scripts: project.scripts,
      files,
      truncated: files.length >= MAX_PROJECT_FILES,
      adapters: {
        cli: 'required foundation',
        vscode: 'optional',
        studio: 'optional',
        mcp: 'active without Studio',
      },
    };
  }

  async check(requested?: string): Promise<Record<string, unknown>> {
    const root = await this.root(requested);
    const [architecture, srijikaUi] = await Promise.all([
      checkSrijikaArchitecture(root),
      checkSrijikaUiDiagnostics(root),
    ]);
    const strictPassed =
      srijikaUi.diagnostics.length === 0 &&
      !architecture.diagnostics.some((diagnostic) => diagnostic.severity === 'error') &&
      architecture.adoption?.status !== 'blocked';
    return {
      ...architecture,
      srijikaUi,
      strictPassed,
      passed:
        strictPassed &&
        (!architecture.adoption || architecture.adoption.summary.fullProjectSuccess),
    };
  }

  async scaffold(
    request: {
      project?: string | undefined;
      kind: SrijikaStructureKind;
      name?: string | undefined;
      ownerFolder?: string | undefined;
      optionalCapabilities?: readonly SrijikaOptionalOwnerCapability[] | undefined;
    },
    dryRun: boolean,
  ): Promise<Record<string, unknown>> {
    const root = await this.root(request.project);
    const result = await scaffoldSrijikaStructure({
      project: root,
      kind: request.kind,
      ...(request.name ? { name: request.name } : {}),
      ...(request.ownerFolder ? { ownerFolder: request.ownerFolder } : {}),
      ...(request.optionalCapabilities
        ? { optionalCapabilities: request.optionalCapabilities }
        : {}),
      dryRun,
    });
    return {
      root: result.root,
      dryRun,
      owner: result.plan.ownerName,
      ownerFolder: result.plan.ownerFolder,
      created: result.plan.files.map((file) => file.relativePath),
      updated: result.plan.updates.map((file) => file.relativePath),
      moved: (result.plan.moves ?? []).map((move) => ({
        from: move.fromRelativePath,
        to: move.toRelativePath,
      })),
    };
  }

  async synchronizeTests(
    request: {
      dryRun?: boolean | undefined;
      port?: number | undefined;
      framework?: 'vite' | 'next-app-router' | undefined;
    } = {},
  ) {
    const root = await this.root();
    const project = await inspectSrijikaProject(root);
    const options = {
      project: root,
      ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
      ...(request.port === undefined ? {} : { port: request.port }),
    };
    if (request.framework === 'next-app-router' || (project.nextProject && !project.viteProject)) {
      return synchronizeSrijikaNextTests(options);
    }
    if (request.framework === 'vite' || (project.viteProject && !project.nextProject)) {
      return synchronizeSrijikaViteTests(options);
    }
    throw new Error(
      'The bounded project must select exactly one supported Vite or Next.js framework.',
    );
  }

  async testEvidence(request: { framework?: 'vite' | 'next-app-router' | undefined } = {}) {
    const root = await this.root();
    return collectSrijikaTestEvidence({
      project: root,
      ...(request.framework === undefined ? {} : { framework: request.framework }),
    });
  }

  async verifyTests(
    request: {
      framework?: 'vite' | 'next-app-router' | undefined;
      port?: number | undefined;
      skipInstall?: boolean | undefined;
    } = {},
  ) {
    const root = await this.root();
    return verifySrijikaOwnerTests({
      project: root,
      ...(request.framework === undefined ? {} : { framework: request.framework }),
      ...(request.port === undefined ? {} : { port: request.port }),
      ...(request.skipInstall === undefined ? {} : { skipInstall: request.skipInstall }),
    });
  }
}
