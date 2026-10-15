import * as ts from 'typescript';

import { NATIVE_COMPONENTS, nativeStyleProperties } from './registry.js';
import type {
  NativeCompileResult,
  NativeDiagnostic,
  NativeSourceSpan,
  NativeUiDocument,
  NativeUiNode,
  NativeValue,
} from './types.js';

const forbiddenMembers = new Set(['__proto__', 'prototype', 'constructor']);
const binaryOperators = new Set([
  '+',
  '-',
  '*',
  '/',
  '===',
  '!==',
  '==',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  '&&',
  '||',
  '??',
]);
const voidComponents = new Set(['Image', 'TextInput', 'ActivityIndicator']);

/** Parses the bounded Native profile without importing or executing project code. */
export function compileSrijikaNativeTsx(
  source: string,
  fileName = 'Component.ui.tsx',
): NativeCompileResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics: NativeDiagnostic[] = [];
  const nodes: Record<string, NativeUiNode> = {};
  const sourceMap: Record<string, NativeSourceSpan> = {};
  const bindings = new Map<string, string>();
  const contracts = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  const fields = new Map<string, ts.PropertySignature>();
  let propsName: string | null = null;
  let ordinal = 0;

  function span(node: ts.Node): NativeSourceSpan {
    const start = node.getStart(sourceFile);
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    return { start, end: node.getEnd(), line: location.line + 1, column: location.character + 1 };
  }

  function error(node: ts.Node, message: string, code = 'SRIJIKA-NATIVE1001'): void {
    diagnostics.push({ ...span(node), code, fileName, severity: 'error', message });
  }

  function allocate(node: ts.Node): string {
    const id = `native_${ordinal++}`;
    sourceMap[id] = span(node);
    return id;
  }

  function unwrap(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
  }

  function value(expression: ts.Expression): NativeValue | null {
    expression = unwrap(expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
      return { kind: 'literal', value: expression.text };
    if (ts.isNumericLiteral(expression)) return { kind: 'literal', value: Number(expression.text) };
    if (
      expression.kind === ts.SyntaxKind.TrueKeyword ||
      expression.kind === ts.SyntaxKind.FalseKeyword
    )
      return { kind: 'literal', value: expression.kind === ts.SyntaxKind.TrueKeyword };
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null };
    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    )
      return { kind: 'literal', value: -Number(expression.operand.text) };
    if (ts.isPropertyAccessExpression(expression)) {
      const path: string[] = [];
      let current: ts.Expression = expression;
      while (ts.isPropertyAccessExpression(current) && !current.questionDotToken) {
        path.unshift(current.name.text);
        current = current.expression;
      }
      if (
        ts.isIdentifier(current) &&
        current.text === propsName &&
        path.length > 0 &&
        fields.has(path[0]!) &&
        !path.some((part) => forbiddenMembers.has(part))
      ) {
        return { kind: 'reference', path };
      }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const entries: [string, NativeValue][] = [];
      for (const property of expression.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
        ) {
          error(
            property,
            'Native values require explicit object properties; spreads, methods and computed keys are unsupported.',
          );
          return null;
        }
        const name = property.name.text;
        if (forbiddenMembers.has(name) || entries.some(([key]) => key === name)) {
          error(property, `Unsafe or duplicate object property ${name}.`);
          return null;
        }
        const parsed = value(property.initializer);
        if (!parsed) return null;
        entries.push([name, parsed]);
      }
      return { kind: 'object', fields: Object.fromEntries(entries) };
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items: NativeValue[] = [];
      for (const item of expression.elements) {
        const parsed = value(item);
        if (!parsed) return null;
        items.push(parsed);
      }
      return { kind: 'array', items };
    }
    if (ts.isBinaryExpression(expression)) {
      const operator = expression.operatorToken.getText(sourceFile);
      if (binaryOperators.has(operator)) {
        const left = value(expression.left);
        const right = value(expression.right);
        if (left && right) return { kind: 'binary', operator, left, right };
        return null;
      }
    }
    error(
      expression,
      'Use literals, explicit objects/arrays, or declared props references. Calls, hooks, callbacks and runtime expressions belong in the Connector.',
    );
    return null;
  }

  function validateStyle(expression: ts.Expression, component: string): void {
    expression = unwrap(expression);
    if (ts.isArrayLiteralExpression(expression)) {
      for (const item of expression.elements) validateStyle(item, component);
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) return;
    if (!ts.isObjectLiteralExpression(expression)) {
      error(
        expression,
        'Native styles must be explicit style objects, arrays, or typed props references.',
        'SRIJIKA-NATIVE1003',
      );
      return;
    }
    const allowed = nativeStyleProperties(component);
    for (const property of expression.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      )
        continue;
      if (!allowed.has(property.name.text))
        error(
          property,
          `${property.name.text} is not a supported ${component} native style. CSS classes, selectors and grid are unsupported.`,
          'SRIJIKA-NATIVE1003',
        );
      if (
        ts.isStringLiteral(property.initializer) &&
        /^-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw)$/.test(property.initializer.text)
      )
        error(
          property.initializer,
          'Use numeric device-independent lengths or supported percentages in Native styles.',
          'SRIJIKA-NATIVE1003',
        );
    }
  }

  function render(expression: ts.Expression, parent: string | null): string | null {
    expression = unwrap(expression);
    if (ts.isConditionalExpression(expression)) {
      const condition = value(expression.condition);
      const whenTrue = render(expression.whenTrue, parent);
      const whenFalse =
        expression.whenFalse.kind === ts.SyntaxKind.NullKeyword
          ? null
          : render(expression.whenFalse, parent);
      if (!condition || !whenTrue) return null;
      const id = allocate(expression);
      nodes[id] = { id, kind: 'conditional', condition, whenTrue, whenFalse };
      return id;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const condition = value(expression.left);
      const whenTrue = render(expression.right, parent);
      if (!condition || !whenTrue) return null;
      const id = allocate(expression);
      nodes[id] = { id, kind: 'conditional', condition, whenTrue, whenFalse: null };
      return id;
    }
    if (ts.isJsxFragment(expression)) {
      const id = allocate(expression);
      nodes[id] = { id, kind: 'fragment', children: children(expression.children, parent) };
      return id;
    }
    if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
      const opening = ts.isJsxElement(expression) ? expression.openingElement : expression;
      const localName = opening.tagName.getText(sourceFile);
      const component = bindings.get(localName);
      if (!component) {
        error(
          opening.tagName,
          `Unsupported Native component ${localName}. Import a basic component from react-native. HTML and web components are unavailable.`,
          'SRIJIKA-NATIVE1002',
        );
        return null;
      }
      const props: Record<string, NativeValue> = {};
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) {
          error(
            attribute,
            'Explicit Native props are required; spread attributes are unsupported.',
          );
          continue;
        }
        const name = attribute.name.getText(sourceFile);
        if (!NATIVE_COMPONENTS[component]?.includes(name)) {
          error(
            attribute,
            `${name} is not a supported ${component} prop. Use Native events and accessibility props.`,
            'SRIJIKA-NATIVE1002',
          );
          continue;
        }
        if (Object.hasOwn(props, name)) error(attribute, `Duplicate prop ${name}.`);
        const initializer = attribute.initializer;
        if (!initializer) props[name] = { kind: 'literal', value: true };
        else if (ts.isStringLiteral(initializer))
          props[name] = { kind: 'literal', value: initializer.text };
        else if (ts.isJsxExpression(initializer) && initializer.expression) {
          const expressionValue = unwrap(initializer.expression);
          const parsed = value(expressionValue);
          if (parsed) props[name] = parsed;
          if (name === 'style' || name === 'contentContainerStyle')
            validateStyle(expressionValue, name === 'contentContainerStyle' ? 'View' : component);
          if (name.startsWith('on') && parsed?.kind !== 'reference')
            error(
              initializer,
              `${name} must reference a declared callback prop; behavior belongs in the Connector.`,
            );
        } else error(attribute, 'This Native attribute is unsupported.');
        if (name.startsWith('on') && props[name]?.kind !== 'reference')
          error(attribute, `${name} requires a callback prop reference.`);
        if (
          (name === 'style' || name === 'contentContainerStyle') &&
          initializer &&
          ts.isStringLiteral(initializer)
        )
          error(
            attribute,
            'CSS strings are unsupported; supply a native style object.',
            'SRIJIKA-NATIVE1003',
          );
      }
      if (component === 'Image' && !props['source'])
        error(opening, 'Image requires its Native source prop.');
      const id = allocate(expression);
      const childIds = ts.isJsxElement(expression) ? children(expression.children, component) : [];
      if (voidComponents.has(component) && childIds.length > 0)
        error(expression, `${component} cannot contain children.`);
      nodes[id] = { id, kind: 'element', component, props, children: childIds };
      return id;
    }
    const parsed = value(expression);
    if (!parsed) return null;
    if (parsed.kind === 'reference' && parsed.path.length === 1) {
      const type = fields.get(parsed.path[0]!)?.type?.getText(sourceFile);
      if (type === 'ReactNode' || type === 'React.ReactNode') {
        const id = allocate(expression);
        nodes[id] = { id, kind: 'slot', name: parsed.path[0]! };
        return id;
      }
    }
    if (parent !== 'Text') {
      error(
        expression,
        'Text and scalar expressions must be inside a Text component.',
        'SRIJIKA-NATIVE1004',
      );
      return null;
    }
    const id = allocate(expression);
    nodes[id] = { id, kind: 'expression', value: parsed };
    return id;
  }

  function children(items: ts.NodeArray<ts.JsxChild>, parent: string | null): string[] {
    const ids: string[] = [];
    for (const child of items) {
      if (ts.isJsxText(child)) {
        const text = child.text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (parent !== 'Text')
          error(child, 'Native text must be wrapped in Text.', 'SRIJIKA-NATIVE1004');
        const id = allocate(child);
        nodes[id] = { id, kind: 'text', text };
        ids.push(id);
      } else if (ts.isJsxExpression(child)) {
        if (!child.expression) continue;
        const expression = unwrap(child.expression);
        if (
          expression.kind === ts.SyntaxKind.NullKeyword ||
          expression.kind === ts.SyntaxKind.FalseKeyword
        )
          continue;
        const id = render(expression, parent);
        if (id) ids.push(id);
      } else {
        const id = render(child, parent);
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics;
  for (const diagnostic of parseDiagnostics) {
    const location = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    diagnostics.push({
      code: 'SRIJIKA-NATIVE1000',
      fileName,
      severity: 'error',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      start: diagnostic.start ?? 0,
      end: (diagnostic.start ?? 0) + (diagnostic.length ?? 0),
      line: location.line + 1,
      column: location.character + 1,
    });
  }
  const components: ts.FunctionDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        error(statement, 'Static imports are required.');
        continue;
      }
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      if (
        named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((binding) => binding.isTypeOnly)
      )
        continue;
      if (
        clause?.name ||
        !named ||
        !ts.isNamedImports(named) ||
        statement.moduleSpecifier.text !== 'react-native'
      ) {
        error(
          statement,
          'Native UI runtime imports are limited to named basic react-native components.',
        );
        continue;
      }
      for (const binding of named.elements) {
        if (binding.isTypeOnly) continue;
        const imported = binding.propertyName?.text ?? binding.name.text;
        if (!Object.hasOwn(NATIVE_COMPONENTS, imported))
          error(
            binding,
            `Unsupported Native import ${imported}. Put hooks, APIs and StyleSheet calls outside the pure UI.`,
          );
        else bindings.set(binding.name.text, imported);
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      contracts.set(statement.name.text, statement);
    else if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      components.push(statement);
    else
      error(
        statement,
        'Native UI files contain only imports, passive types and one exported pure function.',
      );
  }
  const component = components[0];
  if (components.length !== 1 || !component?.name || !component.body) {
    error(component ?? sourceFile, 'Declare exactly one named exported Native UI function.');
    return { document: null, diagnostics, sourceMap };
  }
  if (
    component.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
    component.asteriskToken ||
    component.typeParameters?.length
  )
    error(component, 'Async, generator and generic UI functions are unsupported.');
  if (component.parameters.length > 1)
    error(component, 'Native UI accepts one explicitly typed props parameter.');
  const parameter = component.parameters[0];
  if (parameter) {
    if (
      !ts.isIdentifier(parameter.name) ||
      !parameter.type ||
      parameter.initializer ||
      parameter.dotDotDotToken
    )
      error(parameter, 'Use an identifier parameter with an explicit local props contract.');
    else {
      propsName = parameter.name.text;
      let members: ts.NodeArray<ts.TypeElement> | undefined;
      if (ts.isTypeLiteralNode(parameter.type)) members = parameter.type.members;
      else if (ts.isTypeReferenceNode(parameter.type) && ts.isIdentifier(parameter.type.typeName)) {
        const contract = contracts.get(parameter.type.typeName.text);
        if (
          contract &&
          ts.isInterfaceDeclaration(contract) &&
          !contract.heritageClauses &&
          !contract.typeParameters
        )
          members = contract.members;
        else if (
          contract &&
          ts.isTypeAliasDeclaration(contract) &&
          ts.isTypeLiteralNode(contract.type)
        )
          members = contract.type.members;
      }
      if (!members)
        error(
          parameter,
          'The first Native profile requires a local interface or object type for props.',
        );
      for (const member of members ?? []) {
        if (
          !ts.isPropertySignature(member) ||
          !ts.isIdentifier(member.name) ||
          !member.type ||
          forbiddenMembers.has(member.name.text)
        ) {
          error(member, 'Declare explicit typed props with identifier names.');
          continue;
        }
        if (fields.has(member.name.text))
          error(member, `Duplicate contract member ${member.name.text}.`);
        fields.set(member.name.text, member);
      }
      if (fields.size > 16)
        error(parameter, 'Split Native components with more than 16 contract members.');
    }
  }
  const statements = component.body.statements;
  const returned = statements[0];
  if (
    statements.length !== 1 ||
    !returned ||
    !ts.isReturnStatement(returned) ||
    !returned.expression
  ) {
    error(
      component.body,
      'A pure Native UI body contains one JSX return; hooks, state and behavior belong in the Connector.',
    );
    return { document: null, diagnostics, sourceMap };
  }
  const rootNodeId = render(returned.expression, null);
  for (const node of Object.values(nodes)) {
    if (node.kind !== 'element') continue;
    for (const [name, parsed] of Object.entries(node.props)) {
      if (!name.startsWith('on') || parsed.kind !== 'reference') continue;
      const field = fields.get(parsed.path[0]!);
      if (!field?.type || !ts.isFunctionTypeNode(field.type) || parsed.path.length !== 1)
        error(field ?? component, `${name} requires a directly declared function callback prop.`);
    }
  }
  const document: NativeUiDocument | null =
    rootNodeId && diagnostics.length === 0
      ? {
          version: 'srijika-native-ui-v1',
          componentName: component.name.text,
          rootNodeId,
          nodes,
          contract: [...fields.values()].map((field) => ({
            name: field.name.getText(sourceFile),
            type: field.type!.getText(sourceFile),
            optional: Boolean(field.questionToken),
          })),
        }
      : null;
  return { document, diagnostics, sourceMap };
}
