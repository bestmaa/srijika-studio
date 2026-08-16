import { resolve } from 'node:path';

import {
  checkSrijikaArchitecture,
  findSrijikaProjectRoot,
  inspectSrijikaProject,
  scaffoldSrijikaStructure,
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
    const ownershipRoots = [...new Set([featuresRoot, sharedRoot])];
    const fileSystem = await SrijikaProjectFileSystem.open(root);
    const discovered = await fileSystem.walkFiles(ownershipRoots, {
      maximumFiles: MAX_PROJECT_FILES,
      maximumEntries: MAX_PROJECT_ENTRIES,
      maximumDirectories: MAX_PROJECT_DIRECTORIES,
      maximumDepth: MAX_PROJECT_DEPTH,
    });
    const files = discovered.map(({ relativePath }) => relativePath);
    return {
      contractId: 'srijika.cli-first-code-project',
      root,
      projectName: project.projectName,
      packageManager: project.packageManager,
      lockfile: project.lockfile,
      viteProject: project.viteProject,
      architecture: project.architecture,
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
    const result = await checkSrijikaArchitecture(root);
    return { ...result };
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
}
