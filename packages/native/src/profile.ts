import {
  parseSrijikaTypeScriptPathAliases,
  type SrijikaArchitectureConfig,
  type SrijikaArchitectureSourceFile,
} from '@srijika/architecture-rules';
import * as ts from 'typescript';

import type { NativeDiagnostic, NativeProjectConfig } from './types.js';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function parseNativeProjectConfig(source: string): NativeProjectConfig {
  const value = record(JSON.parse(source), 'srijika.native.json');
  if (Object.keys(value).some((key) => !['version', 'profile', 'platforms'].includes(key)))
    throw new Error('Unknown Native project config field.');
  if (value['version'] !== 1 || value['profile'] !== 'expo-go-v1')
    throw new Error('Native projects require the version 1 expo-go-v1 profile.');
  const platforms = value['platforms'];
  if (
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    platforms.length > 2 ||
    platforms.some((platform: unknown) => platform !== 'android' && platform !== 'ios') ||
    new Set(platforms).size !== platforms.length
  )
    throw new Error('Native platforms must be a unique non-empty android/ios list.');
  return { version: 1, profile: 'expo-go-v1', platforms: platforms as ('android' | 'ios')[] };
}

export function parseNativeTypeScriptPathAliases(source: string): Readonly<Record<string, string>> {
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', source);
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, ' '));
  const config = record(parsed.config as unknown, 'tsconfig.json');
  if (config['extends'] !== undefined && config['extends'] !== 'expo/tsconfig.base')
    throw new Error('Native tsconfig may extend only expo/tsconfig.base.');
  const local = { ...config };
  delete local['extends'];
  return parseSrijikaTypeScriptPathAliases(JSON.stringify(local));
}

export function assertNativePackage(source: string): void {
  const packageJson = record(JSON.parse(source), 'package.json');
  const dependencies = record(packageJson['dependencies'], 'package.json dependencies');
  if (typeof dependencies['expo'] !== 'string' || typeof dependencies['react-native'] !== 'string')
    throw new Error('Native projects must declare expo and react-native dependencies.');
  if (
    typeof packageJson['packageManager'] !== 'string' ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(packageJson['packageManager'])
  )
    throw new Error('This Native milestone requires a pinned pnpm packageManager.');
}

/** Native rules shared by CLI, diagnostics and graph consumers, with no file reads. */
export function nativeRuntimeDiagnostics(
  files: readonly SrijikaArchitectureSourceFile[],
  architecture: Pick<SrijikaArchitectureConfig, 'logicSuffix'> = {},
): readonly NativeDiagnostic[] {
  const diagnostics: NativeDiagnostic[] = [];
  for (const file of files) {
    if (
      !file.fileName.toLowerCase().endsWith((architecture.logicSuffix ?? '.logic.ts').toLowerCase())
    )
      continue;
    const ast = ts.createSourceFile(file.fileName, file.source, ts.ScriptTarget.Latest, true);
    const modules: ts.StringLiteralLike[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        !node.importClause?.isTypeOnly
      ) {
        const named = node.importClause?.namedBindings;
        const onlyTypes =
          named &&
          ts.isNamedImports(named) &&
          named.elements.length > 0 &&
          named.elements.every((binding) => binding.isTypeOnly);
        if (!onlyTypes) modules.push(node.moduleSpecifier);
      } else if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const named = node.exportClause;
        if (!(
          named &&
          ts.isNamedExports(named) &&
          named.elements.length > 0 &&
          named.elements.every((binding) => binding.isTypeOnly)
        ))
          modules.push(node.moduleSpecifier);
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length === 1 &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        ts.isStringLiteral(node.arguments[0]!)
      )
        modules.push(node.arguments[0]);
      else if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      )
        modules.push(node.moduleReference.expression);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const module of modules) {
      if (!/^(?:react-native(?:\/|$)|expo(?:\/|$)|expo-)/.test(module.text)) continue;
      const location = ast.getLineAndCharacterOfPosition(module.getStart(ast));
      diagnostics.push({
        code: 'SRIJIKA-NATIVE2001',
        fileName: file.fileName,
        severity: 'error',
        message:
          'Business Logic must remain framework-free; Native APIs belong in the Connector/Hook/API chain.',
        start: module.getStart(ast),
        end: module.getEnd(),
        line: location.line + 1,
        column: location.character + 1,
      });
    }
  }
  return diagnostics;
}
