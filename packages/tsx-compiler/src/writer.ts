import * as ts from 'typescript';
import { normalizedInstanceEventPort, type ValueShape } from '@srijika/contracts';

import type {
  InsertSrijikaNodeAttributeResult,
  InsertSrijikaJsxElementInput,
  InsertSrijikaJsxElementResult,
  InsertSrijikaContractMemberInput,
  InsertSrijikaContractMemberResult,
  ReplaceSrijikaNodePropResult,
  ReplaceSrijikaTextNodeResult,
  SrijikaEditablePropValue,
  SrijikaContractTypeField,
  SrijikaContractTypeNode,
  SrijikaSourceEdit,
  SrijikaSourceMap,
  SrijikaSourceSpan,
} from './types';
import { srijikaIntrinsicAttribute } from './intrinsics';
import { SRIJIKA_UI_COMPLEXITY_POLICY } from './policy';

function escapeJsxText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;');
}

function matchesSpan(sourceFile: ts.SourceFile, node: ts.Node, span: SrijikaSourceSpan): boolean {
  if (node.getStart(sourceFile) !== span.start || node.getEnd() !== span.end) return false;
  const location = sourceFile.getLineAndCharacterOfPosition(span.start);
  return location.line + 1 === span.line && location.character + 1 === span.column;
}

function findMappedNode(
  sourceFile: ts.SourceFile,
  span: SrijikaSourceSpan,
): ts.JsxElement | ts.JsxText | null {
  let result: ts.JsxElement | ts.JsxText | null = null;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if ((ts.isJsxElement(node) || ts.isJsxText(node)) && matchesSpan(sourceFile, node, span)) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

type MappedJsxElement = ts.JsxElement | ts.JsxSelfClosingElement;

function findMappedElement(
  sourceFile: ts.SourceFile,
  span: SrijikaSourceSpan,
): MappedJsxElement | null {
  let result: MappedJsxElement | null = null;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      matchesSpan(sourceFile, node, span)
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function parseSource(source: string, sourceMap: SrijikaSourceMap): ts.SourceFile | null {
  const sourceFile = ts.createSourceFile(
    sourceMap.fileName || 'Component.ui.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const syntaxDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return syntaxDiagnostics.length > 0 ? null : sourceFile;
}

function propAttributeNames(propName: string): readonly string[] {
  return propName === 'ariaLabel' ? ['aria-label', 'ariaLabel'] : [propName];
}

function literalAttributeValue(
  initializer: ts.JsxAttributeValue | undefined,
): SrijikaEditablePropValue | null {
  if (!initializer) return true;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return null;
  const expression = initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function serializedAttributeValue(value: SrijikaEditablePropValue): string {
  return `{${JSON.stringify(value)}}`;
}

const INSERTABLE_TAGS = new Set([
  'div',
  'main',
  'section',
  'header',
  'footer',
  'nav',
  'article',
  'aside',
  'form',
  'figure',
  'ul',
  'ol',
  'li',
  'label',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'img',
  'input',
]);

const INSERTABLE_CONTAINERS = new Set([
  'div',
  'main',
  'section',
  'header',
  'footer',
  'nav',
  'article',
  'aside',
  'form',
  'figure',
  'ul',
  'ol',
  'li',
  'label',
]);

const VOID_TAGS = new Set(['img', 'input']);

function lineIndentation(source: string, position: number): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  return /^[\t ]*/.exec(source.slice(lineStart, position))?.[0] ?? '';
}

function serializedInsertedElement(input: InsertSrijikaJsxElementInput): string | null {
  if (!INSERTABLE_TAGS.has(input.tag) || !/^[a-z][a-z0-9]*$/.test(input.tag)) return null;
  const attributes: string[] = [];
  for (const [name, value] of Object.entries(input.attributes ?? {})) {
    if (!/^(?:[A-Za-z_$][\w$-]*|aria-[a-z0-9_.:-]+|data-[a-z0-9_.:-]+)$/.test(name)) {
      return null;
    }
    if (!srijikaIntrinsicAttribute(input.tag, name) && !/^(?:aria|data)-/.test(name)) return null;
    attributes.push(`${name}=${serializedAttributeValue(value)}`);
  }
  const opening = `<${input.tag}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}`;
  if (VOID_TAGS.has(input.tag)) return input.text ? null : `${opening} />`;
  return `${opening}>${escapeJsxText(input.text ?? '')}</${input.tag}>`;
}

function applyEdits(source: string, edits: readonly SrijikaSourceEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) => `${current.slice(0, edit.start)}${edit.newText}${current.slice(edit.end)}`,
      source,
    );
}

function openingElement(mapped: MappedJsxElement): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(mapped) ? mapped.openingElement : mapped;
}

function intrinsicTag(mapped: MappedJsxElement, sourceFile: ts.SourceFile): string {
  return openingElement(mapped).tagName.getText(sourceFile);
}

function hasJsxAttribute(
  opening: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  names: readonly string[],
): boolean {
  return opening.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) && names.includes(attribute.name.getText(sourceFile)),
  );
}

function insertionEdit(
  opening: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  attributeSource: string,
): SrijikaSourceEdit {
  const closeStart = ts.isJsxSelfClosingElement(opening)
    ? opening.getEnd() - 2
    : opening.getEnd() - 1;
  const position = Math.max(opening.tagName.getEnd(), closeStart);
  return { start: position, end: position, newText: ` ${attributeSource}` };
}

function findMappedComponent(
  sourceFile: ts.SourceFile,
  span: SrijikaSourceSpan | null,
): ts.FunctionDeclaration | null {
  if (!span) return null;
  return (
    sourceFile.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && matchesSpan(sourceFile, statement, span),
    ) ?? null
  );
}

function shapeType(shape: ValueShape): string {
  if (shape.kind === 'array') return `ReadonlyArray<${shapeType(shape.item)}>`;
  if (shape.kind !== 'object') return shape.kind;
  const fields = Object.entries(shape.fields)
    .map(([name, field]) => `${name}${field.required ? '' : '?'}: ${shapeType(field.shape)};`)
    .join(' ');
  return `{ ${fields} }`;
}

function eventCallbackType(eventName: string): string | null {
  const port = normalizedInstanceEventPort(eventName);
  if (!port) return null;
  const payload = port.signature.payload;
  return payload ? `(${payload.name}: ${shapeType(payload.shape)}) => void` : '() => void';
}

function propsContract(
  sourceFile: ts.SourceFile,
  sourceMap: SrijikaSourceMap,
): {
  propsName: string;
  declaration: ts.InterfaceDeclaration;
} | null {
  const component = findMappedComponent(sourceFile, sourceMap.component);
  const parameter = component?.parameters[0];
  if (
    !parameter ||
    !ts.isIdentifier(parameter.name) ||
    !parameter.type ||
    !ts.isTypeReferenceNode(parameter.type) ||
    !ts.isIdentifier(parameter.type.typeName)
  ) {
    return null;
  }
  const interfaceName = parameter.type.typeName.text;
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  return declaration ? { propsName: parameter.name.text, declaration } : null;
}

function hasImportedPropsContract(sourceFile: ts.SourceFile, sourceMap: SrijikaSourceMap): boolean {
  const component = findMappedComponent(sourceFile, sourceMap.component);
  const parameter = component?.parameters[0];
  if (
    !parameter?.type ||
    !ts.isTypeReferenceNode(parameter.type) ||
    !ts.isIdentifier(parameter.type.typeName)
  ) {
    return false;
  }
  const localName = parameter.type.typeName.text;
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      return false;
    }
    return statement.importClause.namedBindings.elements.some(
      (element) =>
        element.name.text === localName &&
        (statement.importClause?.isTypeOnly === true || element.isTypeOnly),
    );
  });
}

function contractMember(
  declaration: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  name: string,
): ts.PropertySignature | undefined {
  return declaration.members.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) && member.name?.getText(sourceFile) === name,
  );
}

function importsReactNode(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return (
      !!bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === 'ReactNode')
    );
  });
}

function parsedTypeSource(value: string): { sourceFile: ts.SourceFile; type: ts.TypeNode } | null {
  const typeSource = value.trim();
  if (!typeSource || typeSource.length > 500) return null;
  const sourceFile = ts.createSourceFile(
    '__srijika_contract_type.ts',
    `type __SrijikaContractType = ${typeSource};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0 || sourceFile.statements.length !== 1) return null;
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isTypeAliasDeclaration(statement)) return null;
  return statement.type.getText(sourceFile) === typeSource
    ? { sourceFile, type: statement.type }
    : null;
}

function contractTypePropertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(sourceFile);
}

function contractTypeNode(node: ts.TypeNode, sourceFile: ts.SourceFile): SrijikaContractTypeNode {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { kind: 'string' };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: 'number' };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: 'boolean' };
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: 'unknown' };
    default:
      break;
  }
  if (ts.isParenthesizedTypeNode(node)) return contractTypeNode(node.type, sourceFile);
  if (ts.isArrayTypeNode(node)) {
    return { kind: 'array', item: contractTypeNode(node.elementType, sourceFile) };
  }
  if (
    ts.isTypeReferenceNode(node) &&
    (node.typeName.getText(sourceFile) === 'Array' ||
      node.typeName.getText(sourceFile) === 'ReadonlyArray') &&
    node.typeArguments?.length === 1
  ) {
    return { kind: 'array', item: contractTypeNode(node.typeArguments[0]!, sourceFile) };
  }
  if (ts.isTypeLiteralNode(node)) {
    const fields: SrijikaContractTypeField[] = [];
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.name || !member.type) {
        return { kind: 'custom', source: node.getText(sourceFile) };
      }
      const name = contractTypePropertyName(member.name, sourceFile);
      if (!name) return { kind: 'custom', source: node.getText(sourceFile) };
      fields.push({
        name,
        required: member.questionToken === undefined,
        type: contractTypeNode(member.type, sourceFile),
      });
    }
    return { kind: 'object', fields };
  }
  return { kind: 'custom', source: node.getText(sourceFile) };
}

/** Parses one valid TypeScript type into the Inspector's recursive authoring model. */
export function parseSrijikaContractType(value: string): SrijikaContractTypeNode | null {
  const parsed = parsedTypeSource(value);
  return parsed ? contractTypeNode(parsed.type, parsed.sourceFile) : null;
}

/** Prints the recursive Inspector type model back to one safe TypeScript type expression. */
export function printSrijikaContractType(type: SrijikaContractTypeNode): string {
  switch (type.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'unknown':
      return type.kind;
    case 'custom':
      return type.source.trim();
    case 'array':
      return `ReadonlyArray<${printSrijikaContractType(type.item)}>`;
    case 'object':
      return `{ ${type.fields
        .map(
          (field) =>
            `${field.name}${field.required ? '' : '?'}: ${printSrijikaContractType(field.type)};`,
        )
        .join(' ')} }`;
  }
}

function validTypeSource(value: string): string | null {
  const parsed = parsedTypeSource(value);
  return parsed ? value.trim() : null;
}

/** Adds one safe, typed member to the component props interface. */
export function insertSrijikaContractMember(
  source: string,
  sourceMap: SrijikaSourceMap,
  input: InsertSrijikaContractMemberInput,
): InsertSrijikaContractMemberResult {
  const sourceFile = parseSource(source, sourceMap);
  if (!sourceFile) {
    return {
      ok: false,
      reason: 'invalid-source',
      message: 'The TSX source contains syntax errors; Studio did not modify it.',
    };
  }
  const contract = propsContract(sourceFile, sourceMap);
  if (!contract) {
    if (hasImportedPropsContract(sourceFile, sourceMap)) {
      return {
        ok: false,
        reason: 'external-props-contract',
        message:
          'This UI contract lives in its owner Types file; edit that file through an atomic multi-file action.',
      };
    }
    return {
      ok: false,
      reason: 'missing-props-interface',
      message: 'This UI needs a named props interface before Studio can add contract members.',
    };
  }
  if (!/^[$A-Z_a-z][$\w]*$/u.test(input.name)) {
    return {
      ok: false,
      reason: 'invalid-contract-name',
      message: 'Use a valid TypeScript member name such as title, onSave, or toolbarSlot.',
    };
  }
  if (contractMember(contract.declaration, sourceFile, input.name)) {
    return {
      ok: false,
      reason: 'contract-member-exists',
      message: `${input.name} already exists in this UI contract.`,
    };
  }
  if (
    contract.declaration.members.length >= SRIJIKA_UI_COMPLEXITY_POLICY.maxTopLevelContractMembers
  ) {
    return {
      ok: false,
      reason: 'contract-limit-reached',
      message: `A Srijika UI contract can contain at most ${SRIJIKA_UI_COMPLEXITY_POLICY.maxTopLevelContractMembers} top-level members.`,
    };
  }

  const typeSource =
    input.kind === 'event'
      ? '() => void'
      : input.kind === 'slot'
        ? 'ReactNode'
        : input.dataType
          ? validTypeSource(input.dataType)
          : null;
  if (!typeSource) {
    return {
      ok: false,
      reason: 'invalid-contract-type',
      message:
        'Enter one valid TypeScript type, such as unknown, User, string[], or { id: string }.',
    };
  }

  const closeBrace = contract.declaration.getEnd() - 1;
  const location = sourceFile.getLineAndCharacterOfPosition(
    contract.declaration.getStart(sourceFile),
  );
  const interfaceIndentation = ' '.repeat(location.character);
  const indentation = ' '.repeat(location.character + 2);
  const optionalMarker = input.required ? '' : '?';
  const leadingLineBreak = source[closeBrace - 1] === '\n' ? '' : '\n';
  const edits: SrijikaSourceEdit[] = [
    {
      start: closeBrace,
      end: closeBrace,
      newText: `${leadingLineBreak}${indentation}${input.name}${optionalMarker}: ${typeSource};\n${interfaceIndentation}`,
    },
  ];
  if (input.kind === 'slot' && !importsReactNode(sourceFile)) {
    edits.push({
      start: 0,
      end: 0,
      newText: "import type { ReactNode } from 'react';\n\n",
    });
  }
  return { ok: true, edits, source: applyEdits(source, edits) };
}

function plainTextChild(node: ts.JsxElement | ts.JsxText): ts.JsxText | null {
  if (ts.isJsxText(node)) return node;
  if (node.children.length !== 1) return null;
  const child = node.children[0];
  return child && ts.isJsxText(child) ? child : null;
}

/**
 * Produces an AST-verified source edit for the deliberately small first
 * Studio-to-TSX write surface. The mapped node must still be the exact JSX
 * element/text span compiled earlier and must contain one plain JsxText child.
 * Expressions, nested elements, stale maps, and invalid source are rejected.
 */
export function replaceSrijikaTextNode(
  source: string,
  sourceMap: SrijikaSourceMap,
  nodeId: string,
  newText: string,
): ReplaceSrijikaTextNodeResult {
  const span = sourceMap.nodes[nodeId];
  if (!span) {
    return {
      ok: false,
      reason: 'unknown-node',
      message: `Node ${nodeId} is not present in the Srijika source map.`,
    };
  }
  if (span.start < 0 || span.end < span.start || span.end > source.length) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${nodeId} has a source span outside the current file.`,
    };
  }

  const sourceFile = parseSource(source, sourceMap);
  if (!sourceFile) {
    return {
      ok: false,
      reason: 'invalid-source',
      message: 'The TSX source contains syntax errors; Studio did not modify it.',
    };
  }

  const mapped = findMappedNode(sourceFile, span);
  if (!mapped) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${nodeId} no longer matches its compiled TSX span. Recompile before editing.`,
    };
  }
  const text = plainTextChild(mapped);
  if (!text) {
    return {
      ok: false,
      reason: 'not-plain-text',
      message: `Node ${nodeId} is not a single plain JSX text value.`,
    };
  }

  const edit: SrijikaSourceEdit = {
    start: text.getStart(sourceFile),
    end: text.getEnd(),
    newText: escapeJsxText(newText),
  };
  return {
    ok: true,
    edit,
    source: `${source.slice(0, edit.start)}${edit.newText}${source.slice(edit.end)}`,
  };
}

/**
 * Produces an AST-verified edit for an existing primitive JSX attribute.
 *
 * Only attributes authored on the mapped JSX element are writable. Dynamic
 * expressions, inferred/default renderer props, children, events, stale maps,
 * and missing attributes remain read-only so TSX stays authoritative.
 */
export function replaceSrijikaNodeProp(
  source: string,
  sourceMap: SrijikaSourceMap,
  nodeId: string,
  propName: string,
  newValue: SrijikaEditablePropValue,
): ReplaceSrijikaNodePropResult {
  const span = sourceMap.nodes[nodeId];
  if (!span) {
    return {
      ok: false,
      reason: 'unknown-node',
      message: `Node ${nodeId} is not present in the Srijika source map.`,
    };
  }
  if (span.start < 0 || span.end < span.start || span.end > source.length) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${nodeId} has a source span outside the current file.`,
    };
  }

  const sourceFile = parseSource(source, sourceMap);
  if (!sourceFile) {
    return {
      ok: false,
      reason: 'invalid-source',
      message: 'The TSX source contains syntax errors; Studio did not modify it.',
    };
  }
  const mapped = findMappedElement(sourceFile, span);
  if (!mapped) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${nodeId} no longer matches its compiled TSX span. Recompile before editing.`,
    };
  }

  const opening = ts.isJsxElement(mapped) ? mapped.openingElement : mapped;
  const names = propAttributeNames(propName);
  const attribute = opening.attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute =>
      ts.isJsxAttribute(candidate) && names.includes(candidate.name.getText(sourceFile)),
  );
  if (!attribute) {
    return {
      ok: false,
      reason: 'unknown-prop',
      message: `Prop ${propName} is derived or not authored as a JSX attribute on node ${nodeId}.`,
    };
  }
  if (literalAttributeValue(attribute.initializer) === null) {
    return {
      ok: false,
      reason: 'not-literal-prop',
      message: `Prop ${propName} is bound to a dynamic expression and must be changed in code or its Connector.`,
    };
  }

  const attributeName = attribute.name.getText(sourceFile);
  const edit: SrijikaSourceEdit = attribute.initializer
    ? {
        start: attribute.initializer.getStart(sourceFile),
        end: attribute.initializer.getEnd(),
        newText: serializedAttributeValue(newValue),
      }
    : {
        start: attribute.getStart(sourceFile),
        end: attribute.getEnd(),
        newText: `${attributeName}=${serializedAttributeValue(newValue)}`,
      };
  return {
    ok: true,
    edit,
    source: `${source.slice(0, edit.start)}${edit.newText}${source.slice(edit.end)}`,
  };
}

/** Inserts one compiler-supported primitive JSX attribute on an exact mapped element. */
export function insertSrijikaNodeProp(
  source: string,
  sourceMap: SrijikaSourceMap,
  nodeId: string,
  propName: string,
  value: SrijikaEditablePropValue,
): InsertSrijikaNodeAttributeResult {
  const span = sourceMap.nodes[nodeId];
  if (!span) {
    return { ok: false, reason: 'unknown-node', message: `Node ${nodeId} is not mapped.` };
  }
  const sourceFile = parseSource(source, sourceMap);
  if (!sourceFile) {
    return {
      ok: false,
      reason: 'invalid-source',
      message: 'The TSX source contains syntax errors; Studio did not modify it.',
    };
  }
  const mapped = findMappedElement(sourceFile, span);
  if (!mapped) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${nodeId} no longer matches its compiled TSX span.`,
    };
  }
  const opening = openingElement(mapped);
  const tag = intrinsicTag(mapped, sourceFile);
  const attributeName = propName === 'ariaLabel' ? 'aria-label' : propName;
  const spec = srijikaIntrinsicAttribute(tag, attributeName);
  if (!spec) {
    return {
      ok: false,
      reason: 'unsupported-attribute',
      message: `${attributeName} is not a supported Srijika attribute on <${tag}>.`,
    };
  }
  if (hasJsxAttribute(opening, sourceFile, propAttributeNames(propName))) {
    return {
      ok: false,
      reason: 'attribute-exists',
      message: `${attributeName} is already authored on this element.`,
    };
  }
  if (
    (spec.type === 'boolean' && typeof value !== 'boolean') ||
    (spec.type === 'number' && typeof value !== 'number') ||
    (spec.type === 'string' && typeof value !== 'string')
  ) {
    return {
      ok: false,
      reason: 'invalid-value',
      message: `${attributeName} expects a ${spec.type} value.`,
    };
  }
  const edit = insertionEdit(
    opening,
    sourceFile,
    `${attributeName}=${serializedAttributeValue(value)}`,
  );
  return { ok: true, edits: [edit], source: applyEdits(source, [edit]) };
}

/**
 * Inserts one catalogue-owned intrinsic element as the final child of an exact
 * mapped TSX container. The writer rejects stale maps, void parents and
 * attributes outside the compiler allow-list before producing a source edit.
 */
export function insertSrijikaJsxElement(
  source: string,
  sourceMap: SrijikaSourceMap,
  parentNodeId: string,
  input: InsertSrijikaJsxElementInput,
): InsertSrijikaJsxElementResult {
  const span = sourceMap.nodes[parentNodeId];
  if (!span) {
    return { ok: false, reason: 'unknown-node', message: `Node ${parentNodeId} is not mapped.` };
  }
  const sourceFile = parseSource(source, sourceMap);
  if (!sourceFile) {
    return {
      ok: false,
      reason: 'invalid-source',
      message: 'The TSX source contains syntax errors; Studio did not modify it.',
    };
  }
  const mapped = findMappedElement(sourceFile, span);
  if (!mapped) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${parentNodeId} no longer matches its compiled TSX span.`,
    };
  }
  const parentTag = intrinsicTag(mapped, sourceFile);
  if (!ts.isJsxElement(mapped) || !INSERTABLE_CONTAINERS.has(parentTag)) {
    return {
      ok: false,
      reason: 'not-container',
      message: `Select a layout container before adding UI. <${parentTag}> cannot contain children.`,
    };
  }
  if (!INSERTABLE_TAGS.has(input.tag)) {
    return {
      ok: false,
      reason: 'unsupported-element',
      message: `<${input.tag}> is not supported by the visual TSX catalogue.`,
    };
  }
  for (const name of Object.keys(input.attributes ?? {})) {
    if (!srijikaIntrinsicAttribute(input.tag, name) && !/^(?:aria|data)-/.test(name)) {
      return {
        ok: false,
        reason: 'unsupported-attribute',
        message: `${name} is not supported on <${input.tag}>.`,
      };
    }
  }
  const jsx = serializedInsertedElement(input);
  if (!jsx) {
    return {
      ok: false,
      reason: 'invalid-template',
      message: `The ${input.tag} catalogue template is not a safe TSX element.`,
    };
  }

  const closingStart = mapped.closingElement.getStart(sourceFile);
  const closingLineStart = source.lastIndexOf('\n', Math.max(0, closingStart - 1)) + 1;
  const closingPrefix = source.slice(closingLineStart, closingStart);
  const parentIndent = lineIndentation(source, mapped.openingElement.getStart(sourceFile));
  const childIndent = `${parentIndent}  `;
  const closingOnOwnLine = /^[\t ]*$/.test(closingPrefix);
  const edit: SrijikaSourceEdit = closingOnOwnLine
    ? {
        start: closingLineStart,
        end: closingLineStart,
        newText: `${childIndent}${jsx}\n`,
      }
    : {
        start: closingStart,
        end: closingStart,
        newText: `\n${childIndent}${jsx}\n${parentIndent}`,
      };
  const insertedAt = edit.start + edit.newText.indexOf(`<${input.tag}`);
  return {
    ok: true,
    edit,
    insertedAt,
    source: applyEdits(source, [edit]),
  };
}

/**
 * Connects a normalized intrinsic event to a typed component callback prop.
 * When the callback is missing, its interface member is inserted in the same
 * validated edit so the UI contract and JSX never drift apart.
 */
export function bindSrijikaNodeEvent(
  source: string,
  sourceMap: SrijikaSourceMap,
  nodeId: string,
  eventName: string,
  callbackPropName: string,
): InsertSrijikaNodeAttributeResult {
  const span = sourceMap.nodes[nodeId];
  if (!span) {
    return { ok: false, reason: 'unknown-node', message: `Node ${nodeId} is not mapped.` };
  }
  const callbackType = eventCallbackType(eventName);
  if (!callbackType || !/^[$A-Z_a-z][$\w]*$/u.test(callbackPropName)) {
    return {
      ok: false,
      reason: 'invalid-event-contract',
      message: `${eventName} or callback name ${callbackPropName} is not a supported typed event.`,
    };
  }
  const sourceFile = parseSource(source, sourceMap);
  if (!sourceFile) {
    return {
      ok: false,
      reason: 'invalid-source',
      message: 'The TSX source contains syntax errors; Studio did not modify it.',
    };
  }
  const mapped = findMappedElement(sourceFile, span);
  if (!mapped) {
    return {
      ok: false,
      reason: 'stale-source-map',
      message: `Node ${nodeId} no longer matches its compiled TSX span.`,
    };
  }
  const opening = openingElement(mapped);
  if (hasJsxAttribute(opening, sourceFile, [eventName])) {
    return {
      ok: false,
      reason: 'attribute-exists',
      message: `${eventName} is already authored on this element.`,
    };
  }
  const contract = propsContract(sourceFile, sourceMap);
  if (!contract) {
    return {
      ok: false,
      reason: 'invalid-event-contract',
      message: 'This UI needs a named props interface before Studio can connect an event.',
    };
  }
  const existing = contractMember(contract.declaration, sourceFile, callbackPropName);
  if (existing && (!existing.type || !ts.isFunctionTypeNode(existing.type))) {
    return {
      ok: false,
      reason: 'invalid-event-contract',
      message: `${callbackPropName} already exists but is not a callback prop.`,
    };
  }

  const edits: SrijikaSourceEdit[] = [
    insertionEdit(opening, sourceFile, `${eventName}={${contract.propsName}.${callbackPropName}}`),
  ];
  if (!existing) {
    const closeBrace = contract.declaration.getEnd() - 1;
    const location = sourceFile.getLineAndCharacterOfPosition(
      contract.declaration.getStart(sourceFile),
    );
    const declarationIndentation = ' '.repeat(location.character);
    const indentation = ' '.repeat(location.character + 2);
    edits.push({
      start: closeBrace,
      end: closeBrace,
      // A visual event binding must not make an existing Connector invalid. The
      // Connector owns behavior and may wire the callback later, so callbacks
      // introduced from the Inspector are optional until that boundary opts in.
      newText: `\n${indentation}${callbackPropName}?: ${callbackType};\n${declarationIndentation}`,
    });
  }
  return { ok: true, edits, source: applyEdits(source, edits) };
}
