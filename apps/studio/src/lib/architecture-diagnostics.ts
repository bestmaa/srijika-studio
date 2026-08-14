import {
  SRIJIKA_ARCHITECTURE_PROFILE,
  validateSrijikaArchitecture,
  type SrijikaArchitectureConfig,
  type SrijikaArchitectureDiagnostic,
  type SrijikaArchitectureRecommendation,
  type SrijikaArchitectureSourceFile,
} from '@srijika/architecture-rules';

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

const architectureKeys = [
  'featuresRoot',
  'slotsDirectory',
  'partsDirectory',
  'hooksDirectory',
  'uiSuffix',
  'connectorSuffix',
  'storeSuffix',
  'logicSuffix',
  'apiSuffix',
  'typesSuffix',
] as const;

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
  return /\.(?:ts|tsx|mts|cts)$/.test(path) && !path.endsWith('.d.ts');
}

function architectureConfigFromProject(
  sourceByPath: Readonly<Record<string, string>>,
): Partial<SrijikaArchitectureConfig> {
  const configEntry = Object.entries(sourceByPath).find(
    ([path]) => normalizePath(path) === 'srijika.config.json',
  );
  if (!configEntry) return { profile: SRIJIKA_ARCHITECTURE_PROFILE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(configEntry[1]);
  } catch {
    return { profile: SRIJIKA_ARCHITECTURE_PROFILE };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { profile: SRIJIKA_ARCHITECTURE_PROFILE };
  }
  const candidate = (parsed as Record<string, unknown>)['architecture'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { profile: SRIJIKA_ARCHITECTURE_PROFILE };
  }

  const architecture: Partial<SrijikaArchitectureConfig> = {
    profile: SRIJIKA_ARCHITECTURE_PROFILE,
  };
  const profile = (candidate as Record<string, unknown>)['profile'];
  if (profile === SRIJIKA_ARCHITECTURE_PROFILE) architecture.profile = profile;
  for (const key of architectureKeys) {
    const value = (candidate as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) architecture[key] = value;
  }
  return architecture;
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
  } = {},
): CodeProjectArchitectureAnalysis {
  const sourceFiles: readonly SrijikaArchitectureSourceFile[] = files
    .filter((file) => isArchitectureSource(normalizePath(file.fileName)))
    .map((file) => ({ fileName: normalizePath(file.fileName), source: file.source }));
  const validation = validateSrijikaArchitecture(sourceFiles, {
    ...(options.projectRoot ? { projectRoot: normalizePath(options.projectRoot) } : {}),
    architecture: options.architecture ?? { profile: SRIJIKA_ARCHITECTURE_PROFILE },
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
  });
}
