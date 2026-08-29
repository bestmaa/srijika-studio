import * as ts from 'typescript';

import type {
  AnalyzeSrijikaNextBoundaryOptions,
  AnalyzeSrijikaNextBoundaryResult,
  SrijikaComponentContractEntry,
  SrijikaDiagnostic,
  SrijikaDiagnosticCode,
  SrijikaResolvedUiComponent,
  SrijikaSourceSpan,
} from './types';

const reactClientHooks = new Set([
  'useActionState',
  'useCallback',
  'useDeferredValue',
  'useEffect',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useOptimistic',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
]);
const nextClientHooks = new Set([
  'useParams',
  'usePathname',
  'useReportWebVitals',
  'useRouter',
  'useSearchParams',
  'useSelectedLayoutSegment',
  'useSelectedLayoutSegments',
]);
const browserGlobals = new Set([
  'document',
  'history',
  'localStorage',
  'location',
  'navigator',
  'sessionStorage',
  'window',
]);

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return true;
}

function sourceSpan(sourceFile: ts.SourceFile, node: ts.Node): SrijikaSourceSpan {
  const start = node.getStart(sourceFile);
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    start,
    end: node.getEnd(),
    line: location.line + 1,
    column: location.character + 1,
  };
}

function routeKind(fileName: string): AnalyzeSrijikaNextBoundaryResult['routeKind'] {
  const base = fileName.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  if (/^page\.[cm]?[jt]sx?$/.test(base)) return 'page';
  if (/^layout\.[cm]?[jt]sx?$/.test(base)) return 'layout';
  if (/^route\.[cm]?[jt]sx?$/.test(base)) return 'route';
  return null;
}

function serializableContract(entry: SrijikaComponentContractEntry): boolean {
  if (entry.kind === 'event') return false;
  if (entry.kind === 'slot') return true;
  const visit = (shape: typeof entry.valueShape): boolean => {
    if (shape.kind === 'unknown') return false;
    if (shape.kind === 'array') return visit(shape.item);
    if (shape.kind === 'object')
      return Object.values(shape.fields).every((field) => visit(field.shape));
    return true;
  };
  return visit(entry.valueShape);
}

function staticallyNonSerializable(expression: ts.Expression): boolean {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return true;
  if (ts.isNewExpression(expression) || ts.isClassExpression(expression)) return true;
  if (ts.isBigIntLiteral(expression)) return true;
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some(
      (property) =>
        !ts.isPropertyAssignment(property) || staticallyNonSerializable(property.initializer),
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some(
      (element) => ts.isSpreadElement(element) || staticallyNonSerializable(element),
    );
  }
  return false;
}

function resolvedComponentKey(specifier: string, exportName: string): string {
  return `${specifier}\0${exportName}`;
}

/**
 * Analyzes App Router server/client composition without compiling a route into
 * UiDocument and without loading any imported module.
 */
export function analyzeSrijikaNextBoundary(
  fileName: string,
  source: string,
  options: AnalyzeSrijikaNextBoundaryOptions = {},
): AnalyzeSrijikaNextBoundaryResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics: SrijikaDiagnostic[] = [];
  const add = (code: SrijikaDiagnosticCode, message: string, node: ts.Node): void => {
    diagnostics.push({
      code,
      severity: 'error',
      message,
      fileName,
      span: sourceSpan(sourceFile, node),
    });
  };
  const syntaxDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  for (const diagnostic of syntaxDiagnostics) {
    const start = diagnostic.start ?? 0;
    const anchor = sourceFile.getChildAt(Math.min(start, Math.max(0, sourceFile.end - 1)));
    add('SRIJIKA0001', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), anchor);
  }

  const directives: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
      directives.push(statement.expression.text);
      continue;
    }
    break;
  }
  const boundary = directives.includes('use client') ? 'client' : 'server';
  const hookBindings = new Set<string>();
  const reactNamespaceBindings = new Set<string>();
  const uiByKey = new Map(
    (options.resolvedUiComponents ?? []).map((component) => [
      resolvedComponentKey(component.specifier, component.exportName),
      component,
    ]),
  );
  const uiBindings = new Map<string, SrijikaResolvedUiComponent>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (moduleSpecifier === 'react' && clause.name) {
      reactNamespaceBindings.add(clause.name.text);
    }
    if (clause.name) {
      const resolved = uiByKey.get(resolvedComponentKey(moduleSpecifier, 'default'));
      if (resolved) uiBindings.set(clause.name.text, resolved);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        const importedName = element.propertyName?.text ?? element.name.text;
        if (
          (moduleSpecifier === 'react' && reactClientHooks.has(importedName)) ||
          (moduleSpecifier === 'next/navigation' && nextClientHooks.has(importedName))
        ) {
          hookBindings.add(element.name.text);
        }
        const resolved = uiByKey.get(resolvedComponentKey(moduleSpecifier, importedName));
        if (resolved) uiBindings.set(element.name.text, resolved);
      }
    }
    if (
      moduleSpecifier === 'react' &&
      clause.namedBindings &&
      ts.isNamespaceImport(clause.namedBindings)
    ) {
      reactNamespaceBindings.add(clause.namedBindings.name.text);
    }
  }

  const visit = (node: ts.Node): void => {
    if (boundary === 'server') {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && hookBindings.has(node.expression.text)) {
          add(
            'SRIJIKA5004',
            `${node.expression.text} is client behavior in a Server Component. Add "use client" at the boundary or move the behavior to a Connector/Hook.`,
            node.expression,
          );
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          reactNamespaceBindings.has(node.expression.expression.text) &&
          reactClientHooks.has(node.expression.name.text)
        ) {
          add(
            'SRIJIKA5004',
            `${node.expression.getText(sourceFile)} is client behavior in a Server Component. Add "use client" at the boundary or move it to a Connector/Hook.`,
            node.expression,
          );
        }
      }
      if (ts.isIdentifier(node) && browserGlobals.has(node.text) && isIdentifierReference(node)) {
        add(
          'SRIJIKA5004',
          `${node.text} is a browser API in a Server Component. Move it behind a client Connector/Hook.`,
          node,
        );
      }
      if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(sourceFile))) {
        add(
          'SRIJIKA5004',
          `${node.name.getText(sourceFile)} is client behavior in a Server Component. Move the interactive subtree behind a "use client" boundary.`,
          node.name,
        );
      }
    }

    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      if (
        argument &&
        ts.isStringLiteralLike(argument) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        (argument.text === 'next/link' || argument.text === 'next/image')
      ) {
        add(
          'SRIJIKA5002',
          `Dynamic loading of ${argument.text} is unsupported. Use the registered static primitive import.`,
          node,
        );
      }
    }

    if (boundary === 'server' && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const resolved = uiBindings.get(opening.tagName.getText(sourceFile));
      if (resolved) {
        const contract = new Map(resolved.contract.map((entry) => [entry.name, entry]));
        for (const attribute of opening.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) {
            add(
              'SRIJIKA5005',
              `Spread props into ${resolved.componentName} cannot prove a serializable Server Component boundary. Pass typed props explicitly.`,
              attribute,
            );
            continue;
          }
          const name = attribute.name.getText(sourceFile);
          const entry = contract.get(name);
          if (!entry || !serializableContract(entry)) {
            add(
              'SRIJIKA5005',
              `Prop ${name} passed from a Server Component into ${resolved.componentName} is not declared as a serializable data prop.`,
              attribute,
            );
            continue;
          }
          const initializer = attribute.initializer;
          if (
            initializer &&
            ts.isJsxExpression(initializer) &&
            initializer.expression &&
            staticallyNonSerializable(initializer.expression)
          ) {
            add(
              'SRIJIKA5005',
              `Prop ${name} passed into ${resolved.componentName} contains a non-serializable value.`,
              initializer.expression,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const unique = new Map<string, SrijikaDiagnostic>();
  for (const diagnostic of diagnostics) {
    unique.set(`${diagnostic.code}:${diagnostic.span.start}:${diagnostic.message}`, diagnostic);
  }
  return Object.freeze({
    fileName,
    boundary,
    routeKind: routeKind(fileName),
    diagnostics: Object.freeze(
      [...unique.values()].sort(
        (left, right) => left.span.start - right.span.start || left.code.localeCompare(right.code),
      ),
    ),
    resolvedUiComponents: Object.freeze(
      [...new Set([...uiBindings.values()].map((component) => component.componentName))].sort(
        (left, right) => left.localeCompare(right),
      ),
    ),
  });
}
