import {
  parseSrijikaProjectConfig,
  parseSrijikaTypeScriptPathAliases,
  resolveSrijikaArchitectureConfig,
  SRIJIKA_ARCHITECTURE_PROFILE,
  validateSrijikaArchitecture,
  type SrijikaArchitectureConfig,
  type SrijikaArchitectureDiagnostic,
  type SrijikaArchitectureRecommendation,
  type SrijikaArchitectureSourceFile,
  type ResolvedSrijikaArchitectureConfig,
} from '@srijika/architecture-rules';

export type CodeProjectArchitectureConfig = ResolvedSrijikaArchitectureConfig;
export type CodeProjectArchitectureRoots = Pick<
  ResolvedSrijikaArchitectureConfig,
  'featuresRoot' | 'sharedRoot'
>;

export interface CodeProjectArchitectureDiagnostic extends SrijikaArchitectureDiagnostic {
  /** Keeps project-wide rules distinct from active-file compiler diagnostics in Studio. */
  origin: 'architecture';
}

export interface CodeProjectArchitectureAnalysis {
  diagnostics: readonly CodeProjectArchitectureDiagnostic[];
  recommendations: readonly SrijikaArchitectureRecommendation[];
  checkedFileCount: number;
}

export interface CodeProjectArchitectureSource {
  fileName: string;
  source: string;
}

function normalizePath(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '');
}

function joinProjectPath(rootPath: string | undefined, relativePath: string): string {
  const relative = normalizePath(relativePath).replace(/^\//, '');
  if (!rootPath) return relative;
  return `${normalizePath(rootPath).replace(/\/$/, '')}/${relative}`;
}

function isArchitectureSource(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(lower) && !/\.d\.(?:ts|tsx|mts|cts)$/.test(lower)
  );
}

function architectureConfigFromProject(
  sourceByPath: Readonly<Record<string, string>>,
): Partial<SrijikaArchitectureConfig> {
  const configEntry = Object.entries(sourceByPath).find(
    ([path]) => normalizePath(path) === 'srijika.config.json',
  );
  if (!configEntry) return { profile: SRIJIKA_ARCHITECTURE_PROFILE };
  return parseSrijikaProjectConfig(configEntry[1]).architecture;
}

function architectureAliasesFromProject(
  sourceByPath: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const tsconfigEntry = Object.entries(sourceByPath).find(
    ([path]) => normalizePath(path) === 'tsconfig.json',
  );
  return tsconfigEntry ? parseSrijikaTypeScriptPathAliases(tsconfigEntry[1]) : {};
}

/**
 * Reads the same configured ownership roots used by architecture validation.
 * Desktop callers still rely on the native scaffold service as the final path
 * and symlink-safety authority; this projection only keeps discovery and path
 * previews aligned with that validated write boundary.
 */
export function architectureConfigFromFileMap(
  files: Readonly<Record<string, string>>,
): CodeProjectArchitectureConfig {
  return resolveSrijikaArchitectureConfig(architectureConfigFromProject(files));
}

export function architectureRootsFromFileMap(
  files: Readonly<Record<string, string>>,
): CodeProjectArchitectureRoots {
  const { featuresRoot, sharedRoot } = architectureConfigFromFileMap(files);
  return { featuresRoot, sharedRoot };
}

export function architectureSourcesFromFileMap(
  files: Readonly<Record<string, string>>,
  projectRoot?: string,
): readonly CodeProjectArchitectureSource[] {
  return Object.entries(files)
    .filter(([path]) => isArchitectureSource(normalizePath(path)))
    .map(([path, source]) => ({ fileName: joinProjectPath(projectRoot, path), source }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

/**
 * Derives project-wide ownership diagnostics without editing authoritative source.
 * Callers may pass either a browser project's complete file map or sources loaded
 * through the bounded desktop project reader.
 */
export function analyzeCodeProjectArchitecture(
  files: readonly CodeProjectArchitectureSource[],
  options: {
    projectRoot?: string;
    architecture?: Partial<SrijikaArchitectureConfig>;
    aliases?: Readonly<Record<string, string>>;
  } = {},
): CodeProjectArchitectureAnalysis {
  const sourceFiles: readonly SrijikaArchitectureSourceFile[] = files
    .filter((file) => isArchitectureSource(normalizePath(file.fileName)))
    .map((file) => ({ fileName: normalizePath(file.fileName), source: file.source }));
  const validation = validateSrijikaArchitecture(sourceFiles, {
    ...(options.projectRoot ? { projectRoot: normalizePath(options.projectRoot) } : {}),
    architecture: options.architecture ?? { profile: SRIJIKA_ARCHITECTURE_PROFILE },
    ...(options.aliases ? { aliases: options.aliases } : {}),
  });
  return {
    checkedFileCount: sourceFiles.length,
    recommendations: validation.recommendations,
    diagnostics: validation.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      origin: 'architecture' as const,
    })),
  };
}

export function analyzeCodeProjectFileMap(
  files: Readonly<Record<string, string>>,
  projectRoot?: string,
): CodeProjectArchitectureAnalysis {
  return analyzeCodeProjectArchitecture(architectureSourcesFromFileMap(files, projectRoot), {
    ...(projectRoot ? { projectRoot } : {}),
    architecture: architectureConfigFromProject(files),
    aliases: architectureAliasesFromProject(files),
  });
}
