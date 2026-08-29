import type {
  ResolvedSrijikaBrownfieldAdoptionConfig,
  ResolvedSrijikaFrameworkConfig,
  SrijikaArchitectureConfig,
  SrijikaArchitectureDiagnostic,
  SrijikaArchitectureRecommendation,
  SrijikaBrownfieldAdoptionPlan,
} from '@srijika/architecture-rules';

export type SrijikaPackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
export type SrijikaJavaScriptRuntime = 'node' | 'bun';
export type SrijikaRuntimePreference = 'auto' | SrijikaJavaScriptRuntime;
export type SrijikaProjectCommandKind = 'install' | 'dev' | 'build' | 'preview' | 'validate';

export interface SrijikaProjectMetadata {
  root: string;
  packageJsonPath: string;
  configPath: string;
  /** Canonical project-root-relative UI entry from srijika.config.json. */
  entry: string;
  projectName: string;
  packageManager: SrijikaPackageManager;
  packageManagerVersion?: string;
  lockfile: string | null;
  scripts: Readonly<Record<string, string>>;
  architecture?: Partial<SrijikaArchitectureConfig>;
  adoption?: ResolvedSrijikaBrownfieldAdoptionConfig;
  framework?: ResolvedSrijikaFrameworkConfig;
  aliases?: Readonly<Record<string, string>>;
  viteProject: boolean;
  nextProject: boolean;
  warnings: readonly string[];
}

export interface SrijikaCommandPlan {
  kind: SrijikaProjectCommandKind;
  cwd: string;
  executable: string;
  args: readonly string[];
  runtime: SrijikaJavaScriptRuntime;
  packageManager: SrijikaPackageManager;
  description: string;
  fallbackReason?: string;
}

export interface SrijikaArchitectureCheckResult {
  root: string;
  checkedFiles: number;
  reusedFiles: number;
  durationMillis: number;
  diagnostics: readonly SrijikaArchitectureDiagnostic[];
  recommendations: readonly SrijikaArchitectureRecommendation[];
  adoption?: SrijikaBrownfieldAdoptionPlan;
}

export interface SrijikaToolAvailability {
  name: 'node' | 'bun' | 'pnpm' | 'npm' | 'yarn';
  available: boolean;
  version: string | null;
}

export interface SrijikaDoctorReport {
  project: SrijikaProjectMetadata | null;
  tools: readonly SrijikaToolAvailability[];
  selectedRuntime: SrijikaJavaScriptRuntime;
  runtimeReason: string;
  healthy: boolean;
  issues: readonly string[];
}
