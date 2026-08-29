import ts from 'typescript';

export const SRIJIKA_PAYLOAD_NEXT_PROFILE_VERSION = 'srijika-payload-next-v1' as const;

const PAYLOAD_SERVER_MODULES = Object.freeze([
  'payload',
  '@payload-config',
  '@payloadcms/config',
  '@payloadcms/graphql',
  '@payloadcms/next',
  '@payloadcms/plugin-',
  '@payloadcms/storage-',
]);

const DATABASE_SERVER_MODULES = Object.freeze([
  '@payloadcms/db-',
  'drizzle-orm',
  'mongodb',
  'mongoose',
  'pg',
  'postgres',
]);

export type SrijikaPayloadServerModuleKind = 'payload' | 'database';

export interface SrijikaPayloadNextSourceFile {
  relativePath: string;
  source: string;
}

export interface SrijikaPayloadNextProfile {
  version: typeof SRIJIKA_PAYLOAD_NEXT_PROFILE_VERSION;
  detected: boolean;
  payloadVersion: string | null;
  nextAdapterVersion: string | null;
  databaseAdapters: readonly string[];
  configPaths: readonly string[];
  collections: readonly string[];
  globals: readonly string[];
  migrations: readonly string[];
  generatedTypes: readonly string[];
  generatedImportMaps: readonly string[];
  adminRoutes: readonly string[];
  apiRoutes: readonly string[];
  uploadStorage: readonly string[];
  localApiFiles: readonly string[];
  protectedServerFiles: readonly string[];
}

export interface AnalyzeSrijikaPayloadNextProfileOptions {
  dependencies: Readonly<Record<string, string>>;
  files: readonly SrijikaPayloadNextSourceFile[];
  appRoot?: string;
}

function normalizePath(relativePath: string): string {
  return relativePath
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/');
}

function matchesModule(specifier: string, prefix: string): boolean {
  if (prefix.endsWith('-')) return specifier.startsWith(prefix);
  return specifier === prefix || specifier.startsWith(`${prefix}/`);
}

export function classifySrijikaPayloadServerModule(
  specifier: string,
): SrijikaPayloadServerModuleKind | null {
  if (DATABASE_SERVER_MODULES.some((entry) => matchesModule(specifier, entry))) return 'database';
  if (PAYLOAD_SERVER_MODULES.some((entry) => matchesModule(specifier, entry))) return 'payload';
  return null;
}

export function srijikaRuntimeServerImports(
  fileName: string,
  source: string,
): readonly {
  specifier: string;
  kind: SrijikaPayloadServerModuleKind;
  start: number;
  end: number;
}[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: {
    specifier: string;
    kind: SrijikaPayloadServerModuleKind;
    start: number;
    end: number;
  }[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    const hasRuntimeBinding =
      !clause ||
      Boolean(clause.name) ||
      (clause.namedBindings !== undefined &&
        (ts.isNamespaceImport(clause.namedBindings) ||
          clause.namedBindings.elements.some((element) => !element.isTypeOnly)));
    if (!hasRuntimeBinding) continue;
    const specifier = statement.moduleSpecifier.text;
    const kind = classifySrijikaPayloadServerModule(specifier);
    if (!kind) continue;
    imports.push({
      specifier,
      kind,
      start: statement.moduleSpecifier.getStart(sourceFile),
      end: statement.moduleSpecifier.getEnd(),
    });
  }
  return Object.freeze(imports);
}

function isSourcePath(relativePath: string): boolean {
  return /\.[cm]?[jt]sx?$/iu.test(relativePath);
}

function routeGroupPath(relativePath: string, appRoot: string): string | null {
  const normalizedRoot = normalizePath(appRoot).replace(/\/$/u, '');
  const prefix = `${normalizedRoot}/(payload)/`;
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : null;
}

function sorted(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

/**
 * Builds a bounded, source-only Payload profile. It never loads Payload config,
 * imports project modules, connects to a database, or mutates generated files.
 */
export function analyzeSrijikaPayloadNextProfile(
  options: AnalyzeSrijikaPayloadNextProfileOptions,
): SrijikaPayloadNextProfile {
  const appRoot = options.appRoot ?? 'src/app';
  const files = options.files.map((file) => ({
    relativePath: normalizePath(file.relativePath),
    source: file.source,
  }));
  const dependencies = options.dependencies;
  const payloadVersion = dependencies['payload'] ?? null;
  const nextAdapterVersion = dependencies['@payloadcms/next'] ?? null;
  const detected = payloadVersion !== null && nextAdapterVersion !== null;
  const databaseAdapters = Object.keys(dependencies).filter((name) =>
    DATABASE_SERVER_MODULES.some((entry) => matchesModule(name, entry)),
  );
  const configPaths: string[] = [];
  const collections: string[] = [];
  const globals: string[] = [];
  const migrations: string[] = [];
  const generatedTypes: string[] = [];
  const generatedImportMaps: string[] = [];
  const adminRoutes: string[] = [];
  const apiRoutes: string[] = [];
  const uploadStorage: string[] = [];
  const localApiFiles: string[] = [];

  for (const file of files) {
    const path = file.relativePath;
    const groupPath = routeGroupPath(path, appRoot);
    if (/(?:^|\/)payload\.config\.[cm]?[jt]s$/iu.test(path)) configPaths.push(path);
    if (/(?:^|\/)collections(?:\/|$)/u.test(path)) collections.push(path);
    if (/(?:^|\/)globals(?:\/|$)/u.test(path)) globals.push(path);
    if (/(?:^|\/)migrations(?:\/|$)/u.test(path)) migrations.push(path);
    if (/(?:^|\/)payload-types\.[cm]?ts$/iu.test(path)) generatedTypes.push(path);
    if (/(?:^|\/)importMap\.[cm]?[jt]s$/iu.test(path)) generatedImportMaps.push(path);
    if (groupPath?.startsWith('admin/')) adminRoutes.push(path);
    if (
      groupPath &&
      (groupPath.startsWith('api/') ||
        groupPath.startsWith('graphql/') ||
        groupPath.startsWith('graphql-playground/'))
    ) {
      apiRoutes.push(path);
    }
    if (
      /(?:^|\/)(?:media|uploads?|storage)(?:\/|$)/iu.test(path) ||
      (isSourcePath(path) &&
        srijikaRuntimeServerImports(path, file.source).some(({ specifier }) =>
          specifier.startsWith('@payloadcms/storage-'),
        ))
    ) {
      uploadStorage.push(path);
    }
    if (
      isSourcePath(path) &&
      srijikaRuntimeServerImports(path, file.source).some(
        ({ specifier }) => matchesModule(specifier, 'payload') || specifier === '@payload-config',
      )
    ) {
      localApiFiles.push(path);
    }
  }

  const protectedServerFiles = sorted([
    ...configPaths,
    ...collections,
    ...globals,
    ...migrations,
    ...generatedTypes,
    ...generatedImportMaps,
    ...adminRoutes,
    ...apiRoutes,
    ...uploadStorage,
    ...localApiFiles,
  ]);

  return Object.freeze({
    version: SRIJIKA_PAYLOAD_NEXT_PROFILE_VERSION,
    detected,
    payloadVersion,
    nextAdapterVersion,
    databaseAdapters: sorted(databaseAdapters),
    configPaths: sorted(configPaths),
    collections: sorted(collections),
    globals: sorted(globals),
    migrations: sorted(migrations),
    generatedTypes: sorted(generatedTypes),
    generatedImportMaps: sorted(generatedImportMaps),
    adminRoutes: sorted(adminRoutes),
    apiRoutes: sorted(apiRoutes),
    uploadStorage: sorted(uploadStorage),
    localApiFiles: sorted(localApiFiles),
    protectedServerFiles,
  });
}
