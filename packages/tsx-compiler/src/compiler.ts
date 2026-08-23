import {
  FORMAT_VERSION,
  createInstanceEventSpec,
  createElementNode,
  literal,
  type ElementNode,
  type EventSignature,
  type InstancePropSpec,
  type LiteralValue,
  type PublicProp,
  type SymbolDeclaration,
  type UiDocument,
  type UiNode,
  type ValueExpression,
  type ValueShape,
  type ValueType,
} from '@srijika/contracts';
import * as ts from 'typescript';

import type {
  CompileSrijikaTsxOptions,
  CompileSrijikaTsxResult,
  SrijikaComponentContractEntry,
  SrijikaDiagnostic,
  SrijikaDiagnosticCode,
  SrijikaQuickFix,
  SrijikaSourceMap,
  SrijikaSourceSpan,
} from './types';
import { srijikaIntrinsicAttribute } from './intrinsics';
import { countMeaningfulLines, SRIJIKA_UI_COMPLEXITY_POLICY } from './policy';

type JsxRenderable = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
type ObjectShape = Extract<ValueShape, { kind: 'object' }>;
type SrijikaBinaryOperator = Extract<ValueExpression, { kind: 'binary' }>['operator'];

interface ContractEntry {
  name: string;
  required: boolean;
  shape: ValueShape;
  eventSignature: EventSignature | null;
  declaration?: ts.PropertySignature;
  synthetic: boolean;
  /** ReactNode contracts are structural slots, not runtime data symbols. */
  slot: boolean;
}

interface ResolvedTypeModuleSource {
  fileName: string;
  hash?: string;
  sourceFile: ts.SourceFile;
}

function mergeShapes(shapes: readonly ValueShape[]): ValueShape {
  const first = shapes[0];
  if (!first) return { kind: 'unknown' };
  if (shapes.some((shape) => shape.kind !== first.kind)) return { kind: 'unknown' };
  if (first.kind === 'array') {
    return {
      kind: 'array',
      item: mergeShapes(
        shapes.map((shape) =>
          shape.kind === 'array' ? shape.item : ({ kind: 'unknown' } as const),
        ),
      ),
    };
  }
  if (first.kind === 'object') {
    const objects = shapes.filter((shape): shape is ObjectShape => shape.kind === 'object');
    const fieldNames = new Set(objects.flatMap((shape) => Object.keys(shape.fields)));
    const fields: ObjectShape['fields'] = {};
    for (const name of fieldNames) {
      const present = objects.flatMap((shape) => {
        const field = shape.fields[name];
        return field ? [field] : [];
      });
      fields[name] = {
        required: present.length === objects.length && present.every((field) => field.required),
        shape: mergeShapes(present.map((field) => field.shape)),
      };
    }
    return {
      kind: 'object',
      fields,
      additionalProperties: objects.some((shape) => shape.additionalProperties),
    };
  }
  return first;
}

function isNullishType(node: ts.TypeNode): boolean {
  return (
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

interface MissingTypeEntry {
  entry: ContractEntry;
  declaration: ts.PropertySignature;
}

interface TagDefinition {
  componentId: string;
  displayName: string;
  mode: 'container' | 'page' | 'text' | 'heading' | 'image' | 'button' | 'input';
}

const tagDefinitions: Readonly<Record<string, TagDefinition>> = {
  div: { componentId: 'srijika.container', displayName: 'Container', mode: 'container' },
  header: { componentId: 'srijika.container', displayName: 'Header', mode: 'container' },
  nav: { componentId: 'srijika.container', displayName: 'Navigation', mode: 'container' },
  section: { componentId: 'srijika.container', displayName: 'Section', mode: 'container' },
  footer: { componentId: 'srijika.container', displayName: 'Footer', mode: 'container' },
  article: { componentId: 'srijika.container', displayName: 'Article', mode: 'container' },
  aside: { componentId: 'srijika.container', displayName: 'Aside', mode: 'container' },
  form: { componentId: 'srijika.container', displayName: 'Form', mode: 'container' },
  figure: { componentId: 'srijika.container', displayName: 'Figure', mode: 'container' },
  ul: { componentId: 'srijika.container', displayName: 'Unordered list', mode: 'container' },
  ol: { componentId: 'srijika.container', displayName: 'Ordered list', mode: 'container' },
  li: { componentId: 'srijika.container', displayName: 'List item', mode: 'container' },
  label: { componentId: 'srijika.container', displayName: 'Label', mode: 'container' },
  main: { componentId: 'srijika.page', displayName: 'Main', mode: 'page' },
  span: { componentId: 'srijika.text', displayName: 'Text', mode: 'text' },
  p: { componentId: 'srijika.text', displayName: 'Paragraph', mode: 'text' },
  h1: { componentId: 'srijika.heading', displayName: 'Heading 1', mode: 'heading' },
  h2: { componentId: 'srijika.heading', displayName: 'Heading 2', mode: 'heading' },
  h3: { componentId: 'srijika.heading', displayName: 'Heading 3', mode: 'heading' },
  h4: { componentId: 'srijika.heading', displayName: 'Heading 4', mode: 'heading' },
  h5: { componentId: 'srijika.heading', displayName: 'Heading 5', mode: 'heading' },
  h6: { componentId: 'srijika.heading', displayName: 'Heading 6', mode: 'heading' },
  img: { componentId: 'srijika.image', displayName: 'Image', mode: 'image' },
  button: { componentId: 'srijika.button', displayName: 'Button', mode: 'button' },
  input: { componentId: 'srijika.input', displayName: 'Input', mode: 'input' },
};

export const SRIJIKA_INTRINSIC_TAGS: readonly string[] = Object.freeze(Object.keys(tagDefinitions));
const intrinsicTags = SRIJIKA_INTRINSIC_TAGS.join(', ');
const forbiddenPathSegments = new Set(['__proto__', 'prototype', 'constructor']);

const binaryOperators = new Map<ts.SyntaxKind, SrijikaBinaryOperator>([
  [ts.SyntaxKind.EqualsEqualsToken, 'equals'],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, 'equals'],
  [ts.SyntaxKind.ExclamationEqualsToken, 'notEquals'],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, 'notEquals'],
  [ts.SyntaxKind.GreaterThanToken, 'greaterThan'],
  [ts.SyntaxKind.GreaterThanEqualsToken, 'greaterThanOrEqual'],
  [ts.SyntaxKind.LessThanToken, 'lessThan'],
  [ts.SyntaxKind.LessThanEqualsToken, 'lessThanOrEqual'],
  [ts.SyntaxKind.AmpersandAmpersandToken, 'and'],
  [ts.SyntaxKind.BarBarToken, 'or'],
  [ts.SyntaxKind.QuestionQuestionToken, 'coalesce'],
  [ts.SyntaxKind.PlusToken, 'add'],
  [ts.SyntaxKind.MinusToken, 'subtract'],
  [ts.SyntaxKind.AsteriskToken, 'multiply'],
  [ts.SyntaxKind.SlashToken, 'divide'],
]);

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function isTypeOnlyImportDeclaration(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return (
    !clause.name &&
    !!clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function isPassiveTypeModuleStatement(statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement)) return isTypeOnlyImportDeclaration(statement);
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return true;
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return true;
    return (
      !statement.moduleSpecifier &&
      !!statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.length === 0
    );
  }
  return ts.isEmptyStatement(statement);
}

function containsTypeQuery(node: ts.Node): boolean {
  if (ts.isTypeQueryNode(node)) return true;
  return node.getChildren().some(containsTypeQuery);
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

function shapeValueType(shape: ValueShape): ValueType {
  return shape.kind;
}

function primitiveShape(type: ValueType): ValueShape {
  switch (type) {
    case 'string':
      return { kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return { kind: 'array', item: { kind: 'unknown' } };
    case 'object':
      return { kind: 'object', fields: {}, additionalProperties: false };
    case 'color':
      return { kind: 'color' };
    default:
      return { kind: 'unknown' };
  }
}

function nestedShape(path: readonly string[], leaf: ValueShape): ValueShape {
  if (path.length === 0) return leaf;
  const [head, ...tail] = path;
  if (!head) return leaf;
  return {
    kind: 'object',
    fields: {
      [head]: {
        required: true,
        shape: nestedShape(tail, leaf),
      },
    },
    additionalProperties: false,
  };
}

function renderShapeType(shape: ValueShape, indent = ''): string {
  switch (shape.kind) {
    case 'string':
    case 'number':
    case 'boolean':
      return shape.kind;
    case 'array':
      return `ReadonlyArray<${renderShapeType(shape.item, indent)}>`;
    case 'object': {
      const fields = Object.entries(shape.fields);
      if (fields.length === 0) return 'Record<string, unknown>';
      const childIndent = `${indent}  `;
      const members = fields
        .map(
          ([name, field]) =>
            `${childIndent}${name}${field.required ? '' : '?'}: ${renderShapeType(
              field.shape,
              childIndent,
            )};`,
        )
        .join('\n');
      return `{\n${members}\n${indent}}`;
    }
    default:
      return 'unknown';
  }
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 120);
  if (!normalized) return fallback;
  return /^[A-Za-z]/.test(normalized) ? normalized : `srijika_${normalized}`;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableNodeId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/g, '_');
  if (normalized.length <= 112) return normalized;
  return `${normalized.slice(0, 100)}_${shortHash(normalized)}`;
}

function decodeJsxEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: '\u00a0',
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([\dA-Fa-f]+)|([A-Za-z]+));/g,
    (entity, decimal, hex, name) => {
      const numeric =
        typeof decimal === 'string'
          ? Number.parseInt(decimal, 10)
          : typeof hex === 'string'
            ? Number.parseInt(hex, 16)
            : Number.NaN;
      if (
        Number.isInteger(numeric) &&
        numeric >= 0 &&
        numeric <= 0x10ffff &&
        !(numeric >= 0xd800 && numeric <= 0xdfff)
      ) {
        return String.fromCodePoint(numeric);
      }
      return typeof name === 'string' ? (named[name] ?? entity) : entity;
    },
  );
}

function normalizeJsxText(value: string): string {
  const collapsed = decodeJsxEntities(value).replace(/[\t\r\n ]+/g, ' ');
  return collapsed.trim().length === 0 ? '' : collapsed;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isJsxRenderable(node: ts.Node): node is JsxRenderable {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

class SrijikaTsxCompiler {
  readonly #sourceFile: ts.SourceFile;
  readonly #options: CompileSrijikaTsxOptions;
  readonly #diagnostics: SrijikaDiagnostic[] = [];
  readonly #nodes: Record<string, UiNode> = {};
  readonly #nodeSpans: Record<string, SrijikaSourceSpan> = {};
  readonly #propSpans: Record<string, SrijikaSourceSpan> = {};
  readonly #contract = new Map<string, ContractEntry>();
  readonly #missingTypes: MissingTypeEntry[] = [];
  readonly #resolvedTypeModules = new Map<string, ResolvedTypeModuleSource>();
  #component: ts.FunctionDeclaration | null = null;
  #propsParameter: ts.ParameterDeclaration | null = null;
  #propsName: string | null = null;
  #propsInterface: ts.InterfaceDeclaration | null = null;
  #propsContractSource: ResolvedTypeModuleSource | null = null;
  #externalDiagnosticAnchor: ts.Node | null = null;
  #needsPropsInterface = false;

  constructor(fileName: string, source: string, options: CompileSrijikaTsxOptions) {
    this.#sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    this.#options = options;
    for (const module of options.resolvedTypeModules ?? []) {
      if (this.#resolvedTypeModules.has(module.specifier)) continue;
      this.#resolvedTypeModules.set(module.specifier, {
        fileName: module.fileName,
        ...(module.hash ? { hash: module.hash } : {}),
        sourceFile: ts.createSourceFile(
          module.fileName,
          module.source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      });
    }
  }

  compile(): CompileSrijikaTsxResult {
    const syntaxDiagnostics = (
      this.#sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    ).parseDiagnostics;
    for (const diagnostic of syntaxDiagnostics) {
      const start = diagnostic.start ?? 0;
      const end = start + (diagnostic.length ?? 1);
      this.#addDiagnostic(
        'SRIJIKA0001',
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        start,
        end,
      );
    }
    if (syntaxDiagnostics.length > 0) return this.#result(null);

    this.#validateFileComplexity();

    const components = this.#sourceFile.statements.filter(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword),
    );

    if (components.length === 0) {
      this.#addDiagnostic(
        'SRIJIKA1001',
        'A Srijika UI file must export one named function component.',
        this.#sourceFile,
      );
      return this.#result(null);
    }
    if (components.length > 1) {
      for (const component of components.slice(1)) {
        this.#addDiagnostic(
          'SRIJIKA1002',
          'A Srijika UI file can export only one function component.',
          component,
        );
      }
      return this.#result(null);
    }

    const component = components[0];
    if (!component?.name || !component.body) {
      this.#addDiagnostic(
        'SRIJIKA1001',
        'The exported Srijika UI component must be named and have a function body.',
        component ?? this.#sourceFile,
      );
      return this.#result(null);
    }
    this.#component = component;
    this.#validateComponentComplexity(component);
    this.#readPropsContract(component);

    const returnStatement = this.#findReturn(component);
    if (!returnStatement?.expression) return this.#result(null);
    const rootExpression = unwrapExpression(returnStatement.expression);
    if (!isJsxRenderable(rootExpression)) {
      this.#addDiagnostic(
        'SRIJIKA2004',
        'A Srijika UI component must return one JSX root.',
        returnStatement.expression,
      );
      return this.#result(null);
    }

    const rootIds = this.#compileRenderable(rootExpression, 'root');
    if (rootIds.length !== 1 || !rootIds[0]) {
      this.#addDiagnostic(
        'SRIJIKA2004',
        'The JSX root could not be represented as one Srijika node.',
        rootExpression,
      );
      return this.#result(null);
    }

    this.#emitDeferredContractDiagnostics();
    const document = this.#createDocument(component.name.text, rootIds[0]);
    return this.#result(document);
  }

  #validateFileComplexity(): void {
    const meaningfulLines = countMeaningfulLines(this.#sourceFile, this.#sourceFile);
    if (meaningfulLines <= SRIJIKA_UI_COMPLEXITY_POLICY.maxFileMeaningfulLines) return;
    this.#addDiagnostic(
      'SRIJIKA3001',
      `This .ui.tsx file contains ${meaningfulLines} meaningful lines. Srijika allows at most ${SRIJIKA_UI_COMPLEXITY_POLICY.maxFileMeaningfulLines}; split the UI into focused components. Blank lines and comments do not count.`,
      this.#sourceFile,
    );
  }

  #validateComponentComplexity(component: ts.FunctionDeclaration): void {
    const meaningfulLines = countMeaningfulLines(this.#sourceFile, component);
    if (meaningfulLines <= SRIJIKA_UI_COMPLEXITY_POLICY.maxComponentMeaningfulLines) return;
    this.#addDiagnostic(
      'SRIJIKA3002',
      `This UI function contains ${meaningfulLines} meaningful lines. Srijika allows at most ${SRIJIKA_UI_COMPLEXITY_POLICY.maxComponentMeaningfulLines}; extract a focused child UI component. Props interfaces, blank lines, and comments do not count toward this function limit.`,
      component.name ?? component,
    );
  }

  #result(document: UiDocument | null): CompileSrijikaTsxResult {
    const sourceMap: SrijikaSourceMap = {
      fileName: this.#sourceFile.fileName,
      component: this.#component ? this.#span(this.#component) : null,
      nodes: { ...this.#nodeSpans },
      props: { ...this.#propSpans },
    };
    return {
      document,
      diagnostics: [...this.#diagnostics].sort(
        (left, right) => left.span.start - right.span.start || left.code.localeCompare(right.code),
      ),
      sourceMap,
      componentContract: this.#componentContract(),
    };
  }

  #componentContract(): SrijikaComponentContractEntry[] {
    return [...this.#contract.values()]
      .filter(
        (entry): entry is ContractEntry & { declaration: ts.PropertySignature } =>
          !entry.synthetic && entry.declaration !== undefined,
      )
      .sort(
        (left, right) =>
          left.declaration.getStart(left.declaration.getSourceFile()) -
          right.declaration.getStart(right.declaration.getSourceFile()),
      )
      .map((entry): SrijikaComponentContractEntry => {
        const declarationSource = entry.declaration.getSourceFile();
        const imported = declarationSource !== this.#sourceFile;
        const base = {
          name: entry.name,
          required: entry.required,
          typeSource: entry.declaration.type?.getText(declarationSource) ?? 'unknown',
          span: this.#span(entry.declaration),
          ...(imported
            ? {
                contractSource: {
                  kind: 'imported' as const,
                  fileName: declarationSource.fileName,
                  ...(this.#propsContractSource?.hash
                    ? { hash: this.#propsContractSource.hash }
                    : {}),
                },
              }
            : {}),
        };
        if (entry.slot) return { ...base, kind: 'slot' };
        if (entry.eventSignature) {
          return { ...base, kind: 'event', eventSignature: entry.eventSignature };
        }
        return { ...base, kind: 'prop', valueShape: entry.shape };
      });
  }

  #createDocument(componentName: string, rootNodeId: string): UiDocument {
    const symbols: Record<string, SymbolDeclaration> = {};
    const publicProps: Record<string, PublicProp> = {};
    for (const entry of this.#contract.values()) {
      if (entry.slot) continue;
      const isEvent = entry.eventSignature !== null;
      const symbolId = `${isEvent ? 'event' : 'prop'}_${sanitizeIdentifier(entry.name, 'value')}`;
      const valueType = isEvent ? 'event' : shapeValueType(entry.shape);
      symbols[symbolId] = {
        id: symbolId,
        name: entry.name,
        displayName: entry.name,
        provider: isEvent ? 'event' : 'prop',
        valueType,
        ...(entry.eventSignature
          ? { eventSignature: entry.eventSignature }
          : { valueShape: entry.shape }),
        required: entry.required,
      };
      publicProps[entry.name] = {
        symbolId,
        name: entry.name,
        displayName: entry.name,
        valueType,
        ...(entry.eventSignature
          ? { eventSignature: entry.eventSignature }
          : { valueShape: entry.shape }),
        required: entry.required,
      };
    }

    return {
      formatVersion: FORMAT_VERSION,
      id: sanitizeIdentifier(
        this.#options.documentId ?? `component_${componentName}`,
        'component_ui',
      ),
      kind: this.#options.documentKind ?? 'component',
      name: componentName,
      rootNodeId,
      revision: Math.max(0, Math.floor(this.#options.revision ?? 0)),
      nodes: { ...this.#nodes },
      symbols,
      publicProps,
    };
  }

  #readPropsContract(component: ts.FunctionDeclaration): void {
    if (component.parameters.length > 1) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        'A Srijika UI component accepts at most one props parameter.',
        component.parameters[1] ?? component,
      );
    }
    const parameter = component.parameters[0];
    if (!parameter) return;
    this.#propsParameter = parameter;
    if (!ts.isIdentifier(parameter.name)) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        'Destructured props are not supported. Use one named props parameter.',
        parameter.name,
      );
      return;
    }
    this.#propsName = parameter.name.text;

    if (!parameter.type) {
      this.#needsPropsInterface = true;
      return;
    }
    if (!ts.isTypeReferenceNode(parameter.type) || !ts.isIdentifier(parameter.type.typeName)) {
      this.#needsPropsInterface = true;
      this.#addDiagnostic(
        'SRIJIKA1003',
        'Props must reference a named interface, for example `props: ProfileProps`.',
        parameter.type,
      );
      return;
    }

    const interfaceName = parameter.type.typeName.text;
    let declaration = this.#sourceFile.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
    );
    if (!declaration) {
      const imported = this.#resolveImportedPropsInterface(interfaceName, parameter.type);
      if (imported === undefined) {
        this.#needsPropsInterface = true;
        this.#addDiagnostic(
          'SRIJIKA1003',
          `Props type ${interfaceName} must be declared in this UI file or imported type-only from its resolved owner Types file.`,
          parameter.type,
        );
        return;
      }
      if (imported === null) return;
      declaration = imported.declaration;
      this.#propsContractSource = imported.module;
      this.#externalDiagnosticAnchor = parameter.type;
    }
    this.#propsInterface = declaration;
    if (declaration.heritageClauses && declaration.heritageClauses.length > 0) {
      this.#addDiagnostic(
        'SRIJIKA1005',
        'Srijika props interfaces cannot extend another type in v1.',
        declaration.heritageClauses[0] ?? declaration,
      );
    }

    const topLevelMembers = declaration.members.filter(ts.isPropertySignature);
    if (topLevelMembers.length > SRIJIKA_UI_COMPLEXITY_POLICY.maxTopLevelContractMembers) {
      this.#addDiagnostic(
        'SRIJIKA3003',
        `This props contract declares ${topLevelMembers.length} top-level members. Srijika allows at most ${SRIJIKA_UI_COMPLEXITY_POLICY.maxTopLevelContractMembers}; split the component contract by responsibility. Data props, events, slots, and optional props all count.`,
        topLevelMembers[SRIJIKA_UI_COMPLEXITY_POLICY.maxTopLevelContractMembers] ??
          declaration.name,
      );
    }

    for (const member of declaration.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        this.#addDiagnostic(
          'SRIJIKA1005',
          'Only property declarations are allowed in a Srijika props interface.',
          member,
        );
        continue;
      }
      const name = propertyName(member.name);
      if (!name || !/^[$A-Z_a-z][$\w]*$/u.test(name)) {
        this.#addDiagnostic(
          'SRIJIKA1005',
          'Srijika prop names must be JavaScript identifiers.',
          member.name,
        );
        continue;
      }
      if (forbiddenPathSegments.has(name)) {
        this.#addDiagnostic('SRIJIKA1005', `Prop name ${name} is not safe.`, member.name);
        continue;
      }
      if (this.#contract.has(name)) {
        this.#addDiagnostic('SRIJIKA1005', `Prop ${name} is declared more than once.`, member.name);
        continue;
      }
      const slot = member.type ? this.#isReactNodeType(member.type) : false;
      const eventSignature = member.type ? this.#eventSignature(member.type) : null;
      const shape =
        member.type && !slot && !eventSignature
          ? this.#parseType(member.type)
          : { kind: 'unknown' as const };
      const entry: ContractEntry = {
        name,
        required: member.questionToken === undefined,
        shape,
        eventSignature,
        declaration: member,
        synthetic: false,
        slot,
      };
      this.#contract.set(name, entry);
      if (!this.#propsContractSource) this.#propSpans[name] = this.#span(member.name);
      if (!member.type) this.#missingTypes.push({ entry, declaration: member });
    }
  }

  #resolveImportedPropsInterface(
    localName: string,
    anchor: ts.Node,
  ): { declaration: ts.InterfaceDeclaration; module: ResolvedTypeModuleSource } | null | undefined {
    const matches: Array<{
      declaration: ts.ImportDeclaration;
      importedName: string;
      specifier: string;
      typeOnly: boolean;
    }> = [];
    for (const statement of this.#sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text !== localName) continue;
        matches.push({
          declaration: statement,
          importedName: (element.propertyName ?? element.name).text,
          specifier: statement.moduleSpecifier.text,
          typeOnly: statement.importClause.isTypeOnly || element.isTypeOnly,
        });
      }
    }
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Props type ${localName} must have one unambiguous owner-local type import.`,
        anchor,
      );
      return null;
    }
    const imported = matches[0]!;
    if (!imported.typeOnly || !/^\.\.?\//.test(imported.specifier)) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Props type ${localName} must use an owner-local relative import type.`,
        imported.declaration,
      );
      return null;
    }
    const module = this.#resolvedTypeModules.get(imported.specifier);
    if (!module) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Props type ${localName} could not be resolved from ${imported.specifier}. Open the Srijika project root or fix the canonical Types path.`,
        imported.declaration.moduleSpecifier,
      );
      return null;
    }
    const parseDiagnostics = (
      module.sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    ).parseDiagnostics;
    if (parseDiagnostics.length > 0) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Resolved Types module ${imported.specifier} contains invalid TypeScript syntax.`,
        imported.declaration.moduleSpecifier,
      );
      return null;
    }
    if (
      module.sourceFile.statements.some((statement) => !isPassiveTypeModuleStatement(statement))
    ) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Resolved Types module ${imported.specifier} must contain passive type-only declarations.`,
        imported.declaration.moduleSpecifier,
      );
      return null;
    }
    const declarations = module.sourceFile.statements.filter(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) &&
        statement.name.text === imported.importedName &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword),
    );
    if (declarations.length !== 1) {
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Resolved Types module ${imported.specifier} must export exactly one interface ${imported.importedName}.`,
        imported.declaration.moduleSpecifier,
      );
      return null;
    }
    const declaration = declarations[0]!;
    if (containsTypeQuery(declaration)) {
      this.#addDiagnostic(
        'SRIJIKA1005',
        'Imported Srijika props interfaces cannot reference runtime values with typeof.',
        imported.declaration.moduleSpecifier,
      );
      return null;
    }
    return { declaration, module };
  }

  #eventSignature(node: ts.TypeNode): EventSignature | null {
    let type = node;
    while (ts.isParenthesizedTypeNode(type)) type = type.type;
    if (!ts.isFunctionTypeNode(type)) return null;
    if (type.parameters.length > 1) {
      this.#addDiagnostic(
        'SRIJIKA1005',
        'A Srijika event callback may declare at most one normalized payload.',
        type.parameters[1] ?? type,
      );
    }
    if (type.type.kind !== ts.SyntaxKind.VoidKeyword) {
      this.#addDiagnostic('SRIJIKA1005', 'A Srijika event callback must return void.', type.type);
    }
    const parameter = type.parameters[0];
    if (!parameter) return { payload: null };
    if (!ts.isIdentifier(parameter.name) || !parameter.type) {
      this.#addDiagnostic(
        'SRIJIKA1005',
        'A normalized event payload needs a named parameter with an explicit type.',
        parameter,
      );
      return { payload: null };
    }
    return {
      payload: {
        name: parameter.name.text,
        shape: this.#parseType(parameter.type),
      },
    };
  }

  #parseType(node: ts.TypeNode, resolving = new Set<string>()): ValueShape {
    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword:
        return { kind: 'string' };
      case ts.SyntaxKind.NumberKeyword:
        return { kind: 'number' };
      case ts.SyntaxKind.BooleanKeyword:
        return { kind: 'boolean' };
      case ts.SyntaxKind.UnknownKeyword:
        return { kind: 'unknown' };
      case ts.SyntaxKind.AnyKeyword:
        this.#addDiagnostic(
          'SRIJIKA1005',
          '`any` disables contract safety. Prefer `unknown` and narrow it before use.',
          node,
          'warning',
        );
        return { kind: 'unknown' };
      default:
        break;
    }

    if (ts.isParenthesizedTypeNode(node)) return this.#parseType(node.type, resolving);
    if (ts.isTypeOperatorNode(node)) return this.#parseType(node.type, resolving);
    if (ts.isArrayTypeNode(node)) {
      return { kind: 'array', item: this.#parseType(node.elementType, resolving) };
    }
    if (ts.isTupleTypeNode(node)) {
      return {
        kind: 'array',
        item: mergeShapes(
          node.elements.map((element) => {
            if (ts.isNamedTupleMember(element)) return this.#parseType(element.type, resolving);
            if (ts.isOptionalTypeNode(element) || ts.isRestTypeNode(element)) {
              return this.#parseType(element.type, resolving);
            }
            return this.#parseType(element, resolving);
          }),
        ),
      };
    }
    if (ts.isTypeReferenceNode(node)) {
      const sourceFile = node.getSourceFile();
      const name = node.typeName.getText(sourceFile);
      if ((name === 'Array' || name === 'ReadonlyArray') && node.typeArguments?.length === 1) {
        return { kind: 'array', item: this.#parseType(node.typeArguments[0]!, resolving) };
      }
      if (name === 'Record' && node.typeArguments?.length === 2) {
        return { kind: 'object', fields: {}, additionalProperties: true };
      }
      if (resolving.has(name)) return { kind: 'unknown' };
      const interfaceDeclaration = sourceFile.statements.find(
        (statement): statement is ts.InterfaceDeclaration =>
          ts.isInterfaceDeclaration(statement) && statement.name.text === name,
      );
      const typeAliasDeclaration = sourceFile.statements.find(
        (statement): statement is ts.TypeAliasDeclaration =>
          ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
      );
      if (interfaceDeclaration || typeAliasDeclaration) {
        const nextResolving = new Set(resolving).add(name);
        if (typeAliasDeclaration) {
          return this.#parseType(typeAliasDeclaration.type, nextResolving);
        }
        return this.#parseObjectMembers(interfaceDeclaration!.members, nextResolving);
      }
      // Imported and library types remain valid TypeScript contracts. The
      // exact source type is exposed to Inspector while the derived IR uses
      // the safe unknown shape until project-wide type resolution is needed.
      return { kind: 'unknown' };
    }
    if (ts.isTypeLiteralNode(node)) {
      return this.#parseObjectMembers(node.members, resolving);
    }
    if (ts.isUnionTypeNode(node)) {
      const nonNullish = node.types.filter((type) => !isNullishType(type));
      return mergeShapes(
        nonNullish.map((type) =>
          ts.isLiteralTypeNode(type)
            ? this.#literalTypeShape(type.literal)
            : this.#parseType(type, resolving),
        ),
      );
    }
    if (ts.isIntersectionTypeNode(node)) {
      return mergeShapes(node.types.map((type) => this.#parseType(type, resolving)));
    }
    if (ts.isLiteralTypeNode(node)) return this.#literalTypeShape(node.literal);

    // Valid TypeScript types that Srijika cannot structurally resolve are kept
    // as unknown in UiDocument and preserved verbatim in componentContract.
    return { kind: 'unknown' };
  }

  #parseObjectMembers(members: ts.NodeArray<ts.TypeElement>, resolving: Set<string>): ValueShape {
    const fields: ObjectShape['fields'] = {};
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        this.#addDiagnostic(
          'SRIJIKA1005',
          'Nested Srijika object types may contain only properties.',
          member,
        );
        continue;
      }
      const name = propertyName(member.name);
      if (!name || !/^[$A-Z_a-z][$\w]*$/u.test(name) || forbiddenPathSegments.has(name)) {
        this.#addDiagnostic(
          'SRIJIKA1005',
          'Nested prop names must be safe identifiers.',
          member.name,
        );
        continue;
      }
      fields[name] = {
        required: member.questionToken === undefined,
        shape: member.type ? this.#parseType(member.type, resolving) : { kind: 'unknown' },
      };
      if (member.getSourceFile() === this.#sourceFile)
        this.#propSpans[name] = this.#span(member.name);
      if (!member.type) {
        const syntheticEntry: ContractEntry = {
          name,
          required: member.questionToken === undefined,
          shape: fields[name].shape,
          eventSignature: null,
          declaration: member,
          synthetic: false,
          slot: false,
        };
        this.#missingTypes.push({ entry: syntheticEntry, declaration: member });
      }
    }
    return { kind: 'object', fields, additionalProperties: false };
  }

  #literalTypeShape(literalNode: ts.LiteralTypeNode['literal']): ValueShape {
    if (ts.isStringLiteral(literalNode)) return { kind: 'string' };
    if (ts.isNumericLiteral(literalNode)) return { kind: 'number' };
    if (
      literalNode.kind === ts.SyntaxKind.TrueKeyword ||
      literalNode.kind === ts.SyntaxKind.FalseKeyword
    ) {
      return { kind: 'boolean' };
    }
    return { kind: 'unknown' };
  }

  #isReactNodeType(node: ts.TypeNode): boolean {
    if (!ts.isTypeReferenceNode(node)) return false;
    const typeName = node.typeName.getText(node.getSourceFile());
    return typeName === 'ReactNode' || typeName === 'React.ReactNode';
  }

  #findReturn(component: ts.FunctionDeclaration): ts.ReturnStatement | null {
    const body = component.body;
    if (!body) return null;
    const returns = body.statements.filter(ts.isReturnStatement);
    for (const statement of body.statements) {
      if (ts.isReturnStatement(statement)) continue;
      if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
        continue;
      }
      this.#addDiagnostic(
        'SRIJIKA2004',
        'UI component bodies may contain only a JSX return. Move logic to a Connector.',
        statement,
      );
    }
    if (returns.length !== 1 || !returns[0]?.expression) {
      this.#addDiagnostic(
        'SRIJIKA2004',
        'A Srijika UI component must contain exactly one JSX return statement.',
        body,
      );
      return null;
    }
    return returns[0];
  }

  #compileRenderable(renderable: JsxRenderable, requestedId: string): string[] {
    if (ts.isJsxFragment(renderable)) {
      const id = stableNodeId(requestedId);
      const children = this.#compileChildren(renderable.children, id);
      this.#recordNode(
        {
          kind: 'fragment',
          id,
          name: 'Fragment',
          children,
        },
        renderable,
      );
      return [id];
    }

    const opening = ts.isJsxElement(renderable) ? renderable.openingElement : renderable;
    const tag = opening.tagName.getText(this.#sourceFile);
    const definition = tagDefinitions[tag];
    if (!definition) {
      this.#addDiagnostic(
        'SRIJIKA2001',
        `Unsupported JSX component <${tag}>. Srijika TSX v1 supports: ${intrinsicTags}.`,
        opening.tagName,
      );
      return [];
    }

    const id = stableNodeId(requestedId);
    const children = ts.isJsxElement(renderable) ? renderable.children : [];
    const node = this.#createElement(id, tag, definition, children);
    this.#compileAttributes(node, tag, definition, opening.attributes);
    this.#recordNode(node, renderable);
    return [id];
  }

  #createElement(
    id: string,
    tag: string,
    definition: TagDefinition,
    children: readonly ts.JsxChild[],
  ): ElementNode {
    switch (definition.mode) {
      case 'container': {
        const node = createElementNode(id, definition.componentId, definition.displayName, {
          props: { as: literal(tag) },
          slots: { children: [] },
        });
        node.slots['children'] = this.#compileChildren(children, id);
        return node;
      }
      case 'page': {
        const node = createElementNode(id, definition.componentId, definition.displayName, {
          slots: { children: [] },
        });
        node.slots['children'] = this.#compileChildren(children, id);
        return node;
      }
      case 'text':
        return createElementNode(id, definition.componentId, definition.displayName, {
          props: { text: this.#compileLeafContent(children, 'string') },
          slots: {},
        });
      case 'heading':
        return createElementNode(id, definition.componentId, definition.displayName, {
          props: {
            text: this.#compileLeafContent(children, 'string'),
            level: literal(Number(tag.slice(1))),
          },
          slots: {},
        });
      case 'image':
        return createElementNode(id, definition.componentId, definition.displayName, {
          props: {
            src: literal(''),
            alt: literal(''),
            fit: literal('cover'),
            loading: literal('lazy'),
          },
          slots: {},
        });
      case 'button':
        return createElementNode(id, definition.componentId, definition.displayName, {
          props: {
            label: this.#compileLeafContent(children, 'string'),
            variant: literal('primary'),
            disabled: literal(false),
          },
          slots: {},
        });
      case 'input':
        return createElementNode(id, definition.componentId, definition.displayName, {
          props: {
            label: literal('Input'),
            placeholder: literal(''),
            type: literal('text'),
            name: literal(''),
            defaultValue: literal(''),
            autoComplete: literal('off'),
            required: literal(false),
            disabled: literal(false),
            hideLabel: literal(true),
          },
          slots: {},
        });
    }
  }

  #compileChildren(children: readonly ts.JsxChild[], parentId: string): string[] {
    const result: string[] = [];
    let outputIndex = 0;
    for (const child of children) {
      const childBase = `${parentId}_${outputIndex}`;
      if (ts.isJsxText(child)) {
        const value = normalizeJsxText(child.text);
        if (!value) continue;
        const id = stableNodeId(`${childBase}_text`);
        this.#recordNode({ kind: 'text', id, name: 'Text', value: literal(value) }, child);
        result.push(id);
        outputIndex += 1;
        continue;
      }
      if (ts.isJsxExpression(child)) {
        if (!child.expression) continue;
        const ids = this.#compileStructuralExpression(child.expression, childBase);
        result.push(...ids);
        if (ids.length > 0) outputIndex += 1;
        continue;
      }
      const ids = this.#compileRenderable(child, `${childBase}_${this.#renderableName(child)}`);
      result.push(...ids);
      if (ids.length > 0) outputIndex += 1;
    }
    return result;
  }

  #compileStructuralExpression(expression: ts.Expression, requestedId: string): string[] {
    const value = unwrapExpression(expression);
    if (isJsxRenderable(value)) return this.#compileRenderable(value, requestedId);

    const slotPath = this.#referencePath(value);
    if (slotPath?.length === 1) {
      const slotName = slotPath[0];
      const contract = slotName ? this.#contract.get(slotName) : undefined;
      if (slotName && contract?.slot) {
        const id = stableNodeId(`${requestedId}_${slotName}_slot`);
        this.#propSpans[slotName] ??= this.#span(value);
        this.#recordNode(
          {
            kind: 'slot',
            id,
            name: `${slotName} Slot`,
            slotName,
            fallback: [],
          },
          value,
        );
        return [id];
      }
    }

    if (
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const id = stableNodeId(`${requestedId}_if`);
      const condition = this.#compileExpression(value.left, 'boolean');
      const whenTrue = this.#compileBranch(value.right, `${id}_true`);
      this.#recordNode(
        {
          kind: 'if',
          id,
          name: 'Conditional',
          condition,
          whenTrue,
          whenFalse: [],
        },
        value,
      );
      return [id];
    }

    if (ts.isConditionalExpression(value)) {
      const id = stableNodeId(`${requestedId}_if`);
      const condition = this.#compileExpression(value.condition, 'boolean');
      const whenTrue = this.#compileBranch(value.whenTrue, `${id}_true`);
      const whenFalse = this.#compileBranch(value.whenFalse, `${id}_false`);
      this.#recordNode(
        {
          kind: 'if',
          id,
          name: 'Conditional',
          condition,
          whenTrue,
          whenFalse,
        },
        value,
      );
      return [id];
    }

    if (
      value.kind === ts.SyntaxKind.NullKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(value) && value.text === 'undefined')
    ) {
      return [];
    }

    const id = stableNodeId(`${requestedId}_expression`);
    this.#recordNode(
      {
        kind: 'expression',
        id,
        name: 'Expression',
        expression: this.#compileExpression(value),
      },
      value,
    );
    return [id];
  }

  #compileBranch(expression: ts.Expression, requestedId: string): string[] {
    const value = unwrapExpression(expression);
    if (isJsxRenderable(value)) return this.#compileRenderable(value, requestedId);
    if (
      value.kind === ts.SyntaxKind.NullKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(value) && value.text === 'undefined')
    ) {
      return [];
    }
    const id = stableNodeId(`${requestedId}_expression`);
    this.#recordNode(
      {
        kind: 'expression',
        id,
        name: 'Expression',
        expression: this.#compileExpression(value),
      },
      value,
    );
    return [id];
  }

  #compileLeafContent(children: readonly ts.JsxChild[], expected: ValueType): ValueExpression {
    const parts: Array<string | ValueExpression> = [];
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const value = normalizeJsxText(child.text);
        if (value) parts.push(value);
        continue;
      }
      if (ts.isJsxExpression(child)) {
        if (child.expression) parts.push(this.#compileExpression(child.expression, expected));
        continue;
      }
      this.#addDiagnostic(
        'SRIJIKA2005',
        'Text, heading, and button elements cannot contain nested JSX in Srijika TSX v1.',
        child,
      );
    }
    if (parts.length === 0) return literal('');
    if (parts.length === 1) {
      const only = parts[0]!;
      return typeof only === 'string' ? literal(only) : only;
    }

    const merged: Array<string | ValueExpression> = [];
    for (const part of parts) {
      const previous = merged.at(-1);
      if (typeof part === 'string' && typeof previous === 'string') {
        merged[merged.length - 1] = `${previous}${part}`;
      } else {
        merged.push(part);
      }
    }
    return { kind: 'template', parts: merged };
  }

  #compileAttributes(
    node: ElementNode,
    tag: string,
    definition: TagDefinition,
    attributes: ts.JsxAttributes,
  ): void {
    const instanceProps: Record<string, InstancePropSpec> = {};
    for (const attribute of attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        this.#addDiagnostic(
          'SRIJIKA2002',
          'JSX spread attributes are not allowed in Srijika UI files.',
          attribute,
        );
        continue;
      }
      const name = attribute.name.getText(this.#sourceFile);
      const instanceEvent = createInstanceEventSpec(name);
      if (instanceEvent) {
        node.events[name] = this.#compileAttributeValue(attribute, 'event');
        if (!(definition.mode === 'button' && name === 'onClick')) {
          node.instanceEvents = { ...(node.instanceEvents ?? {}), [name]: instanceEvent };
        }
        continue;
      }
      const known = this.#knownAttribute(definition.mode, name);
      if (known) {
        const expression = this.#compileAttributeValue(attribute, known.type);
        node.props[known.outputName] = expression;
        continue;
      }

      const safeType = this.#safeInstanceAttributeType(tag, name, attribute);
      if (!safeType) {
        this.#addDiagnostic(
          'SRIJIKA2002',
          `Attribute ${name} is not allowed on <${tag}> in Srijika TSX v1.`,
          attribute.name,
          'error',
          [
            {
              title: `Remove ${name} from <${tag}>`,
              kind: 'remove-attribute',
              edits: [this.#removeAttributeEdit(attribute)],
              data: { attributeName: name },
            },
          ],
        );
        continue;
      }
      const expression = this.#compileAttributeValue(attribute, safeType);
      const expressionType = this.#expressionType(expression);
      const instanceType = expressionType === 'unknown' ? safeType : expressionType;
      instanceProps[name] = {
        displayName: name,
        type: this.#instanceValueType(instanceType),
        required: false,
        valueShape: primitiveShape(this.#instanceValueType(instanceType)),
      };
      node.props[name] = expression;
    }
    if (Object.keys(instanceProps).length > 0) node.instanceProps = instanceProps;
  }

  #knownAttribute(
    mode: TagDefinition['mode'],
    name: string,
  ): { outputName: string; type: ValueType } | null {
    if (name === 'className') return { outputName: 'className', type: 'string' };
    if (name === 'style') return { outputName: 'style', type: 'object' };
    if (mode === 'container' && (name === 'aria-label' || name === 'ariaLabel')) {
      return { outputName: 'ariaLabel', type: 'string' };
    }
    if (mode === 'image') {
      if (name === 'src' || name === 'alt' || name === 'loading' || name === 'fit') {
        return { outputName: name, type: 'string' };
      }
    }
    if (mode === 'button') {
      if (name === 'disabled') return { outputName: name, type: 'boolean' };
      if (name === 'variant') return { outputName: name, type: 'string' };
    }
    if (mode === 'input') {
      if (
        name === 'type' ||
        name === 'name' ||
        name === 'placeholder' ||
        name === 'defaultValue' ||
        name === 'autoComplete' ||
        name === 'aria-label' ||
        name === 'ariaLabel'
      ) {
        return {
          outputName: name === 'aria-label' || name === 'ariaLabel' ? 'label' : name,
          type: 'string',
        };
      }
      if (name === 'required' || name === 'disabled') {
        return { outputName: name, type: 'boolean' };
      }
    }
    return null;
  }

  #safeInstanceAttributeType(
    tag: string,
    name: string,
    attribute: ts.JsxAttribute,
  ): ValueType | null {
    if (/^(?:aria|data)-[a-z][a-z0-9_.:-]*$/.test(name)) {
      if (!attribute.initializer) return 'boolean';
      if (
        ts.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression &&
        (attribute.initializer.expression.kind === ts.SyntaxKind.TrueKeyword ||
          attribute.initializer.expression.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        return 'boolean';
      }
      return 'string';
    }
    const type = srijikaIntrinsicAttribute(tag, name)?.type;
    if (!type) return null;
    return type;
  }

  #compileAttributeValue(attribute: ts.JsxAttribute, expected: ValueType): ValueExpression {
    const initializer = attribute.initializer;
    if (!initializer) {
      if (expected === 'event') {
        this.#addDiagnostic(
          'SRIJIKA2003',
          'Event attributes must reference a typed event prop.',
          attribute,
        );
        return literal(null);
      }
      return literal(true);
    }
    if (ts.isStringLiteral(initializer)) {
      if (expected === 'event') {
        this.#addDiagnostic(
          'SRIJIKA2003',
          'Event attributes must reference a typed event prop.',
          initializer,
        );
        return literal(null);
      }
      return literal(initializer.text);
    }
    if (!ts.isJsxExpression(initializer)) {
      this.#addDiagnostic(
        'SRIJIKA2003',
        'A JSX element cannot be used directly as an attribute value.',
        initializer,
      );
      return literal(null);
    }
    if (!initializer.expression) return literal(null);
    if (
      expected === 'event' &&
      this.#isNormalizedInputValueBridge(attribute, unwrapExpression(initializer.expression))
    ) {
      // Native text inputs receive a ChangeEvent, while Srijika UI props expose
      // a portable string value callback. This is the one permitted UI-side
      // adapter: it forwards event.target.value directly to a typed prop and
      // contains no state, branching, or other behavior.
      return literal(null);
    }
    if (expected === 'event' && !this.#referencePath(unwrapExpression(initializer.expression))) {
      this.#addDiagnostic(
        'SRIJIKA2003',
        'Interactive UI events must reference a typed callback prop. Keep behavior in the Connector and pass it into this UI.',
        initializer.expression,
        'error',
        this.#eventAttributeQuickFixes(attribute),
      );
      return literal(null);
    }
    const expression = this.#compileExpression(initializer.expression, expected);
    if (expected === 'event' && this.#expressionType(expression) !== 'event') {
      this.#addDiagnostic(
        'SRIJIKA2003',
        'Event attributes must reference a local props callback declared as `() => void`.',
        initializer.expression,
      );
    }
    return expression;
  }

  #isNormalizedInputValueBridge(attribute: ts.JsxAttribute, expression: ts.Expression): boolean {
    const name = attribute.name.getText(this.#sourceFile);
    if (name !== 'onChange' && name !== 'onInput') return false;
    if (!ts.isArrowFunction(expression) || expression.parameters.length !== 1) return false;
    const parameter = expression.parameters[0];
    if (!parameter || !ts.isIdentifier(parameter.name) || !ts.isCallExpression(expression.body))
      return false;
    if (expression.body.arguments.length !== 1) return false;
    const callback = this.#referencePath(unwrapExpression(expression.body.expression));
    // `#referencePath` returns segments *below* the props identifier, so a
    // direct props callback has exactly one segment here.
    if (!callback || callback.length !== 1) return false;
    const argument = unwrapExpression(expression.body.arguments[0]!);
    if (!ts.isPropertyAccessExpression(argument) || argument.name.text !== 'value') return false;
    if (
      !ts.isPropertyAccessExpression(argument.expression) ||
      argument.expression.name.text !== 'target'
    )
      return false;
    return (
      ts.isIdentifier(argument.expression.expression) &&
      argument.expression.expression.text === parameter.name.text
    );
  }

  #eventAttributeQuickFixes(attribute: ts.JsxAttribute): readonly SrijikaQuickFix[] {
    const attributeName = attribute.name.getText(this.#sourceFile);
    const propsName = this.#propsName;
    const replacementEdit = (eventName: string) =>
      attribute.initializer
        ? {
            start: attribute.initializer.getStart(this.#sourceFile),
            end: attribute.initializer.getEnd(),
            newText: `{${propsName}.${eventName}}`,
          }
        : {
            start: attribute.getStart(this.#sourceFile),
            end: attribute.getEnd(),
            newText: `${attributeName}={${propsName}.${eventName}}`,
          };
    const fixes: SrijikaQuickFix[] = [];

    if (propsName) {
      for (const entry of this.#contract.values()) {
        if (!entry.eventSignature) continue;
        fixes.push({
          title: `Connect ${attributeName} to ${propsName}.${entry.name}`,
          kind: 'bind-event-prop',
          edits: [replacementEdit(entry.name)],
          data: { attributeName, eventName: entry.name, propPath: [entry.name] },
        });
      }
      if (!this.#contract.has(attributeName)) {
        const declarationEdits = this.#missingPropEdits([attributeName], [], 'event');
        if (declarationEdits.length > 0) {
          fixes.unshift({
            title: `Declare and connect ${propsName}.${attributeName}`,
            kind: 'bind-event-prop',
            edits: [...declarationEdits, replacementEdit(attributeName)],
            data: {
              attributeName,
              eventName: attributeName,
              propPath: [attributeName],
              suggestedType: 'event',
            },
          });
        }
      }
    }

    fixes.push({
      title: `Remove ${attributeName} from this element`,
      kind: 'remove-attribute',
      edits: [this.#removeAttributeEdit(attribute)],
      data: { attributeName },
    });
    return fixes;
  }

  #removeAttributeEdit(attribute: ts.JsxAttribute): {
    start: number;
    end: number;
    newText: string;
  } {
    const start = attribute.getStart(this.#sourceFile);
    let whitespaceStart = start;
    const source = this.#sourceFile.text;
    while (whitespaceStart > 0 && /[ \t]/.test(source[whitespaceStart - 1] ?? '')) {
      whitespaceStart -= 1;
    }
    return { start: whitespaceStart, end: attribute.getEnd(), newText: '' };
  }

  #compileExpression(expression: ts.Expression, expected: ValueType = 'unknown'): ValueExpression {
    const value = unwrapExpression(expression);
    const referencePath = this.#referencePath(value);
    if (referencePath) {
      return this.#referenceExpression(referencePath, expected, value);
    }
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return literal(value.text);
    }
    if (ts.isNumericLiteral(value)) return literal(Number(value.text));
    if (value.kind === ts.SyntaxKind.TrueKeyword) return literal(true);
    if (value.kind === ts.SyntaxKind.FalseKeyword) return literal(false);
    if (value.kind === ts.SyntaxKind.NullKeyword) return literal(null);
    if (ts.isIdentifier(value) && value.text === 'undefined') return literal(null);

    if (ts.isPrefixUnaryExpression(value)) {
      if (value.operator === ts.SyntaxKind.ExclamationToken) {
        return {
          kind: 'unary',
          operator: 'not',
          operand: this.#compileExpression(value.operand, 'boolean'),
        };
      }
      if (value.operator === ts.SyntaxKind.MinusToken) {
        return {
          kind: 'unary',
          operator: 'negate',
          operand: this.#compileExpression(value.operand, 'number'),
        };
      }
    }

    if (ts.isBinaryExpression(value)) {
      const operator = binaryOperators.get(value.operatorToken.kind);
      if (operator) {
        const booleanOperator = operator === 'and' || operator === 'or';
        const numericOperator = ['subtract', 'multiply', 'divide'].includes(operator);
        return {
          kind: 'binary',
          operator,
          left: this.#compileExpression(
            value.left,
            booleanOperator ? 'boolean' : numericOperator ? 'number' : 'unknown',
          ),
          right: this.#compileExpression(
            value.right,
            booleanOperator ? 'boolean' : numericOperator ? 'number' : 'unknown',
          ),
        };
      }
    }

    if (ts.isConditionalExpression(value)) {
      return {
        kind: 'conditional',
        condition: this.#compileExpression(value.condition, 'boolean'),
        whenTrue: this.#compileExpression(value.whenTrue, expected),
        whenFalse: this.#compileExpression(value.whenFalse, expected),
      };
    }

    if (ts.isTemplateExpression(value)) {
      const parts: Array<string | ValueExpression> = [value.head.text];
      for (const span of value.templateSpans) {
        parts.push(this.#compileExpression(span.expression));
        if (span.literal.text) parts.push(span.literal.text);
      }
      return { kind: 'template', parts };
    }

    const literalValue = this.#literalExpression(value);
    if (literalValue.ok) return literal(literalValue.value);

    this.#addDiagnostic(
      'SRIJIKA2003',
      'Unsupported UI expression. Use literals, props paths, unary/binary expressions, templates, or a ternary.',
      value,
    );
    return literal(null);
  }

  #literalExpression(expression: ts.Expression): { ok: true; value: LiteralValue } | { ok: false } {
    const value = unwrapExpression(expression);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return { ok: true, value: value.text };
    }
    if (ts.isNumericLiteral(value)) return { ok: true, value: Number(value.text) };
    if (value.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
    if (value.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
    if (value.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
    if (
      ts.isPrefixUnaryExpression(value) &&
      value.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(value.operand)
    ) {
      return { ok: true, value: -Number(value.operand.text) };
    }
    if (ts.isArrayLiteralExpression(value)) {
      const entries: LiteralValue[] = [];
      for (const element of value.elements) {
        if (ts.isSpreadElement(element)) return { ok: false };
        const entry = this.#literalExpression(element);
        if (!entry.ok) return { ok: false };
        entries.push(entry.value);
      }
      return { ok: true, value: entries };
    }
    if (ts.isObjectLiteralExpression(value)) {
      const entries: Record<string, LiteralValue> = {};
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) return { ok: false };
        const name = propertyName(property.name);
        if (!name || forbiddenPathSegments.has(name)) return { ok: false };
        const entry = this.#literalExpression(property.initializer);
        if (!entry.ok) return { ok: false };
        entries[name] = entry.value;
      }
      return { ok: true, value: entries };
    }
    return { ok: false };
  }

  #referencePath(expression: ts.Expression): string[] | null {
    if (!this.#propsName) return null;
    const path: string[] = [];
    let current: ts.Expression = expression;
    while (ts.isPropertyAccessExpression(current)) {
      path.unshift(current.name.text);
      current = current.expression;
    }
    if (!ts.isIdentifier(current) || current.text !== this.#propsName || path.length === 0) {
      return null;
    }
    return path;
  }

  #referenceExpression(
    path: readonly string[],
    expected: ValueType,
    sourceNode: ts.Node,
  ): ValueExpression {
    const [top, ...rest] = path;
    if (!top) return literal(null);
    this.#ensureContractPath(path, expected, sourceNode);
    const entry = this.#contract.get(top);
    return {
      kind: 'reference',
      symbolId: `${entry?.eventSignature ? 'event' : 'prop'}_${sanitizeIdentifier(top, 'value')}`,
      path: rest,
    };
  }

  #ensureContractPath(path: readonly string[], expected: ValueType, sourceNode: ts.Node): void {
    if (path.some((segment) => forbiddenPathSegments.has(segment))) {
      this.#addDiagnostic('SRIJIKA1006', 'Unsafe prop path is not allowed.', sourceNode);
      return;
    }
    const [top, ...rest] = path;
    if (!top) return;
    const usageShape = primitiveShape(expected);
    this.#propSpans[path.join('.')] ??= this.#span(sourceNode);
    let entry = this.#contract.get(top);
    if (!entry) {
      entry = {
        name: top,
        required: true,
        shape: nestedShape(rest, usageShape),
        eventSignature: expected === 'event' ? { payload: null } : null,
        synthetic: true,
        slot: false,
      };
      this.#contract.set(top, entry);
      this.#addMissingPropDiagnostic(path, expected, sourceNode, []);
      return;
    }

    if (expected === 'event') {
      if (rest.length > 0) {
        this.#addDiagnostic(
          'SRIJIKA1007',
          `Event prop ${top} cannot expose a nested callback path.`,
          sourceNode,
        );
        return;
      }
      if (!entry.eventSignature && entry.declaration && !entry.declaration.type) {
        entry.eventSignature = { payload: null };
      }
      if (!entry.eventSignature) {
        this.#addDiagnostic(
          'SRIJIKA1007',
          `Prop ${top} is data, but this UI position expects a () => void event.`,
          sourceNode,
        );
      }
      return;
    }
    if (entry.eventSignature) {
      this.#addDiagnostic(
        'SRIJIKA1007',
        `Event prop ${top} cannot be rendered as ${expected === 'unknown' ? 'data' : expected}.`,
        sourceNode,
      );
      return;
    }

    let shape = entry.shape;
    const traversed = [top];
    for (let index = 0; index < rest.length; index += 1) {
      const segment = rest[index];
      if (!segment) continue;
      if (shape.kind === 'unknown') return;
      if (shape.kind !== 'object') {
        this.#addDiagnostic(
          'SRIJIKA1006',
          `Prop ${traversed.join('.')} is ${shape.kind} and cannot expose .${segment}.`,
          sourceNode,
        );
        return;
      }
      const field = shape.fields[segment];
      if (!field) {
        const remaining = rest.slice(index + 1);
        shape.fields[segment] = {
          required: true,
          shape: nestedShape(remaining, usageShape),
        };
        this.#addMissingPropDiagnostic(
          [...traversed, segment, ...remaining],
          expected,
          sourceNode,
          traversed,
        );
        return;
      }
      shape = field.shape;
      traversed.push(segment);
    }

    if (
      expected !== 'unknown' &&
      shape.kind !== 'unknown' &&
      shape.kind !== expected &&
      !(expected === 'string' && shape.kind === 'color')
    ) {
      this.#addDiagnostic(
        'SRIJIKA1007',
        `Prop ${path.join('.')} is ${shape.kind}, but this UI position expects ${expected}.`,
        sourceNode,
      );
    }
  }

  #addMissingPropDiagnostic(
    path: readonly string[],
    expected: ValueType,
    sourceNode: ts.Node,
    existingParentPath: readonly string[],
  ): void {
    const suggested = expected === 'unknown' ? 'string' : expected;
    const edits = this.#missingPropEdits(path, existingParentPath, suggested);
    const quickFix: SrijikaQuickFix = {
      title: `Add ${path.join('.')}: ${suggested} to the props interface`,
      kind: 'add-missing-prop',
      edits,
      data: { propPath: [...path], suggestedType: suggested },
    };
    this.#addDiagnostic(
      'SRIJIKA1004',
      `Property ${path.join('.')} is used but is not declared in the props interface.`,
      sourceNode,
      'error',
      [quickFix],
    );
  }

  #missingPropEdits(
    fullPath: readonly string[],
    existingParentPath: readonly string[],
    suggestedType: ValueType,
  ): readonly { start: number; end: number; newText: string }[] {
    if (!this.#propsInterface || this.#propsInterface.getSourceFile() !== this.#sourceFile)
      return [];
    const container = this.#contractContainer(existingParentPath);
    if (!container) return [];
    const missingPath = fullPath.slice(existingParentPath.length);
    const first = missingPath[0];
    if (!first) return [];
    const shape = nestedShape(missingPath.slice(1), primitiveShape(suggestedType));
    const closeBrace = container.end - 1;
    const location = this.#sourceFile.getLineAndCharacterOfPosition(
      container.getStart(this.#sourceFile),
    );
    const indentation = ' '.repeat(location.character + 2);
    return [
      {
        start: closeBrace,
        end: closeBrace,
        newText: `\n${indentation}${first}: ${
          suggestedType === 'event' ? '() => void' : renderShapeType(shape, indentation)
        };`,
      },
    ];
  }

  #contractContainer(path: readonly string[]): ts.InterfaceDeclaration | ts.TypeLiteralNode | null {
    const root = this.#propsInterface;
    if (!root) return null;
    let container: ts.InterfaceDeclaration | ts.TypeLiteralNode = root;
    for (const segment of path) {
      const member: ts.PropertySignature | undefined = container.members.find(
        (candidate): candidate is ts.PropertySignature =>
          ts.isPropertySignature(candidate) &&
          candidate.name !== undefined &&
          propertyName(candidate.name) === segment,
      );
      if (!member?.type) return null;
      let type: ts.TypeNode = member.type;
      while (ts.isParenthesizedTypeNode(type)) type = type.type;
      if (!ts.isTypeLiteralNode(type)) return null;
      container = type;
    }
    return container;
  }

  #emitDeferredContractDiagnostics(): void {
    for (const missing of this.#missingTypes) {
      if (missing.declaration.getSourceFile() !== this.#sourceFile) {
        this.#addDiagnostic(
          'SRIJIKA1003',
          `Imported prop ${missing.entry.name} must declare an explicit type in the owner Types file.`,
          missing.declaration,
        );
        continue;
      }
      const suggested = missing.entry.eventSignature
        ? ('event' as const)
        : shapeValueType(missing.entry.shape);
      const suggestedSourceType = suggested === 'event' ? '() => void' : suggested;
      const insertion = missing.declaration.questionToken?.end ?? missing.declaration.name.end;
      const quickFix: SrijikaQuickFix = {
        title: `Declare ${missing.entry.name} as ${suggestedSourceType}`,
        kind: 'add-prop-type',
        edits: [{ start: insertion, end: insertion, newText: `: ${suggestedSourceType}` }],
        data: { propPath: [missing.entry.name], suggestedType: suggested },
      };
      this.#addDiagnostic(
        'SRIJIKA1003',
        `Prop ${missing.entry.name} must declare an explicit type.`,
        missing.declaration,
        'error',
        [quickFix],
      );
    }

    if (!this.#needsPropsInterface || !this.#component || !this.#propsParameter) return;
    const interfaceName = `${this.#component.name?.text ?? 'SrijikaComponent'}Props`;
    const lines = [...this.#contract.values()].map(
      (entry) =>
        `  ${entry.name}${entry.required ? '' : '?'}: ${
          entry.eventSignature ? '() => void' : renderShapeType(entry.shape, '  ')
        };`,
    );
    const interfaceText = `export interface ${interfaceName} {\n${lines.join('\n')}\n}\n\n`;
    const edits = ts.isIdentifier(this.#propsParameter.name)
      ? [
          {
            start: this.#component.getStart(this.#sourceFile),
            end: this.#component.getStart(this.#sourceFile),
            newText: interfaceText,
          },
          {
            start: this.#propsParameter.name.end,
            end: this.#propsParameter.name.end,
            newText: `: ${interfaceName}`,
          },
        ]
      : [];
    const quickFix: SrijikaQuickFix = {
      title: `Create ${interfaceName}`,
      kind: 'create-props-interface',
      edits,
      data: { interfaceName },
    };
    this.#addDiagnostic(
      'SRIJIKA1003',
      `Props must use a local typed interface such as ${interfaceName}.`,
      this.#propsParameter,
      'error',
      [quickFix],
    );
  }

  #expressionType(expression: ValueExpression): ValueType {
    switch (expression.kind) {
      case 'literal':
        if (typeof expression.value === 'string') return 'string';
        if (typeof expression.value === 'number') return 'number';
        if (typeof expression.value === 'boolean') return 'boolean';
        if (Array.isArray(expression.value)) return 'array';
        if (expression.value !== null && typeof expression.value === 'object') return 'object';
        return 'unknown';
      case 'reference': {
        if (expression.symbolId.startsWith('event_')) return 'event';
        const symbolName = expression.symbolId.replace(/^prop_/, '');
        let shape = this.#contract.get(symbolName)?.shape;
        for (const segment of expression.path) {
          if (!shape || shape.kind !== 'object') return 'unknown';
          shape = shape.fields[segment]?.shape;
        }
        return shape ? shapeValueType(shape) : 'unknown';
      }
      case 'unary':
        return expression.operator === 'not' ? 'boolean' : 'number';
      case 'binary':
        return [
          'equals',
          'notEquals',
          'greaterThan',
          'greaterThanOrEqual',
          'lessThan',
          'lessThanOrEqual',
          'and',
          'or',
        ].includes(expression.operator)
          ? 'boolean'
          : expression.operator === 'add'
            ? 'unknown'
            : 'number';
      case 'template':
        return 'string';
      case 'conditional': {
        const whenTrue = this.#expressionType(expression.whenTrue);
        return whenTrue === this.#expressionType(expression.whenFalse) ? whenTrue : 'unknown';
      }
      case 'customCodeReference':
        return 'unknown';
    }
  }

  #instanceValueType(type: ValueType): Exclude<ValueType, 'event' | 'color'> {
    if (type === 'event' || type === 'color') return 'unknown';
    return type;
  }

  #renderableName(renderable: JsxRenderable): string {
    if (ts.isJsxFragment(renderable)) return 'fragment';
    const opening = ts.isJsxElement(renderable) ? renderable.openingElement : renderable;
    return opening.tagName.getText(this.#sourceFile).toLowerCase();
  }

  #recordNode(node: UiNode, source: ts.Node): void {
    this.#nodes[node.id] = node;
    this.#nodeSpans[node.id] = this.#span(source);
  }

  #span(nodeOrStart: ts.Node | number, explicitEnd?: number): SrijikaSourceSpan {
    const sourceFile =
      typeof nodeOrStart === 'number' ? this.#sourceFile : nodeOrStart.getSourceFile();
    const start = typeof nodeOrStart === 'number' ? nodeOrStart : nodeOrStart.getStart(sourceFile);
    const end =
      typeof nodeOrStart === 'number' ? (explicitEnd ?? nodeOrStart + 1) : nodeOrStart.getEnd();
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      start,
      end,
      line: location.line + 1,
      column: location.character + 1,
      ...(sourceFile !== this.#sourceFile ? { fileName: sourceFile.fileName } : {}),
    };
  }

  #addDiagnostic(
    code: SrijikaDiagnosticCode,
    message: string,
    nodeOrStart: ts.Node | number,
    severityOrEnd: 'error' | 'warning' | number = 'error',
    quickFixes?: readonly SrijikaQuickFix[],
  ): void {
    const severity = typeof severityOrEnd === 'number' ? 'error' : severityOrEnd;
    const anchoredNode =
      typeof nodeOrStart !== 'number' &&
      nodeOrStart.getSourceFile() !== this.#sourceFile &&
      this.#externalDiagnosticAnchor
        ? this.#externalDiagnosticAnchor
        : nodeOrStart;
    const span =
      typeof anchoredNode === 'number'
        ? this.#span(nodeOrStart, typeof severityOrEnd === 'number' ? severityOrEnd : undefined)
        : this.#span(anchoredNode);
    const diagnostic: SrijikaDiagnostic = {
      code,
      severity,
      message,
      fileName: this.#sourceFile.fileName,
      span,
    };
    if (quickFixes && quickFixes.length > 0) diagnostic.quickFixes = quickFixes;
    this.#diagnostics.push(diagnostic);
  }
}

/**
 * Compiles one restricted, code-first Srijika `.ui.tsx` file into the canonical
 * UiDocument IR consumed by Studio, the renderer, and React code generation.
 */
export function compileSrijikaTsx(
  fileName: string,
  source: string,
  options: CompileSrijikaTsxOptions = {},
): CompileSrijikaTsxResult {
  return new SrijikaTsxCompiler(fileName, source, options).compile();
}

/**
 * Returns exact relative specifiers used by named type-only imports. Callers
 * can resolve these through their own bounded project filesystem and pass the
 * resulting sources back through `resolvedTypeModules`.
 */
export function srijikaTypeOnlyModuleSpecifiers(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    'Srijika.ui.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return Object.freeze(
    [
      ...new Set(
        sourceFile.statements.flatMap((statement) => {
          if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !/^\.\.?\//.test(statement.moduleSpecifier.text) ||
            !statement.importClause?.namedBindings ||
            !ts.isNamedImports(statement.importClause.namedBindings) ||
            !(
              statement.importClause.isTypeOnly ||
              statement.importClause.namedBindings.elements.some((element) => element.isTypeOnly)
            )
          ) {
            return [];
          }
          return [statement.moduleSpecifier.text];
        }),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  );
}
