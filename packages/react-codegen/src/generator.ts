import type {
  ElementNode,
  LengthValue,
  StyleProperties,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueType,
} from '@sutra/contracts';

const indent = (value: string, depth = 1): string => {
  const prefix = '  '.repeat(depth);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
};

const safeName = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
};

const tsType = (type: ValueType): string => {
  switch (type) {
    case 'string':
    case 'color':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'event':
      return '() => void';
    case 'array':
      return 'readonly unknown[]';
    case 'object':
      return 'Readonly<Record<string, unknown>>';
    case 'unknown':
      return 'unknown';
  }
};

const lengthToCode = (length: LengthValue): string => {
  switch (length.mode) {
    case 'fixed':
      return JSON.stringify(`${length.value}${length.unit}`);
    case 'percent':
      return JSON.stringify(`${length.value}%`);
    case 'fill':
      return JSON.stringify('100%');
    case 'hug':
      return JSON.stringify('fit-content');
    case 'auto':
      return JSON.stringify('auto');
  }
};

function styleToCode(style: StyleProperties): string | null {
  const properties: string[] = [];
  const simpleProperties: Array<keyof StyleProperties> = [
    'display',
    'flexDirection',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'gap',
    'backgroundColor',
    'color',
    'borderColor',
    'borderWidth',
    'borderRadius',
    'fontSize',
    'fontWeight',
    'textAlign',
    'overflowWrap',
    'overflow',
  ];

  simpleProperties.forEach((property) => {
    const value = style[property];
    if (value !== undefined) properties.push(`${property}: ${JSON.stringify(value)}`);
  });
  if (style.alignItems !== undefined) {
    const value =
      style.alignItems === 'start'
        ? 'flex-start'
        : style.alignItems === 'end'
          ? 'flex-end'
          : style.alignItems;
    properties.push(`alignItems: ${JSON.stringify(value)}`);
  }
  if (style.justifyContent !== undefined) {
    const value =
      style.justifyContent === 'start'
        ? 'flex-start'
        : style.justifyContent === 'end'
          ? 'flex-end'
          : style.justifyContent;
    properties.push(`justifyContent: ${JSON.stringify(value)}`);
  }
  if (style.width) properties.push(`width: ${lengthToCode(style.width)}`);
  if (style.height) properties.push(`height: ${lengthToCode(style.height)}`);
  if (style.padding) {
    properties.push(
      `padding: ${JSON.stringify(`${style.padding.top}px ${style.padding.right}px ${style.padding.bottom}px ${style.padding.left}px`)}`,
    );
  }
  if (style.margin) {
    properties.push(
      `margin: ${JSON.stringify(`${style.margin.top}px ${style.margin.right}px ${style.margin.bottom}px ${style.margin.left}px`)}`,
    );
  }
  if (style.borderWidth) properties.push(`borderStyle: "solid"`);
  properties.push(`boxSizing: "border-box"`);

  return properties.length > 1 ? `{ ${properties.join(', ')} }` : null;
}

interface EmitContext {
  document: UiDocument;
  symbols: Readonly<Record<string, string>>;
}

function emitExpression(expression: ValueExpression, context: EmitContext): string {
  switch (expression.kind) {
    case 'literal':
      return JSON.stringify(expression.value);
    case 'reference': {
      const root = context.symbols[expression.symbolId] ?? 'undefined';
      return expression.path.reduce(
        (value, segment) => `${value}?.[${JSON.stringify(segment)}]`,
        root,
      );
    }
    case 'unary':
      return expression.operator === 'not'
        ? `!(${emitExpression(expression.operand, context)})`
        : `-Number(${emitExpression(expression.operand, context)})`;
    case 'binary': {
      const operators: Record<typeof expression.operator, string> = {
        equals: '===',
        notEquals: '!==',
        greaterThan: '>',
        greaterThanOrEqual: '>=',
        lessThan: '<',
        lessThanOrEqual: '<=',
        and: '&&',
        or: '||',
        add: '+',
        subtract: '-',
        multiply: '*',
        divide: '/',
      };
      return `(${emitExpression(expression.left, context)} ${operators[expression.operator]} ${emitExpression(expression.right, context)})`;
    }
    case 'conditional':
      return `(${emitExpression(expression.condition, context)} ? ${emitExpression(expression.whenTrue, context)} : ${emitExpression(expression.whenFalse, context)})`;
    case 'template':
      return expression.parts
        .map((part) =>
          typeof part === 'string'
            ? JSON.stringify(part)
            : `String(${emitExpression(part, context)} ?? "")`,
        )
        .join(' + ');
    case 'registeredCall':
      return `runtimeFunctions[${JSON.stringify(expression.functionId)}]?.(${expression.args
        .map((arg) => emitExpression(arg, context))
        .join(', ')})`;
    case 'customCodeReference':
      return `undefined /* ${expression.moduleId}.${expression.exportName} */`;
  }
}

function emitChildren(ids: readonly string[], context: EmitContext): string {
  return ids
    .map((id) => emitNode(context.document.nodes[id], context))
    .filter(Boolean)
    .join('\n');
}

function elementTag(node: ElementNode): string {
  switch (node.componentId) {
    case 'sutra.page':
      return 'main';
    case 'sutra.text':
      return 'p';
    case 'sutra.button':
      return 'button';
    case 'sutra.input':
      return 'label';
    case 'sutra.heading': {
      const level = node.props['level'];
      return level?.kind === 'literal' && typeof level.value === 'number'
        ? `h${Math.max(1, Math.min(6, level.value))}`
        : 'h2';
    }
    case 'sutra.container':
    case 'sutra.stack':
    case 'sutra.grid':
      return 'div';
    default:
      throw new Error(
        `Component ${node.componentId} has no registered TSX code-generation adapter`,
      );
  }
}

function emitElement(node: ElementNode, context: EmitContext): string {
  const tag = elementTag(node);
  const attributes: string[] = [];
  const style = styleToCode(node.style.base);

  const visible = emitExpression(node.visible, context);
  const propValue = (name: string, fallback: string): string => {
    const expression = node.props[name];
    return expression ? emitExpression(expression, context) : fallback;
  };

  let content = emitChildren(Object.values(node.slots).flat(), context);
  if (node.componentId === 'sutra.text' || node.componentId === 'sutra.heading') {
    content = `{${propValue('text', '""')}}`;
  } else if (node.componentId === 'sutra.button') {
    const baseClassName = [...node.classRefs, 'sutra-button', 'sutra-button--'].join(' ');
    attributes.push(
      `className={${JSON.stringify(baseClassName)} + String(${propValue('variant', '"primary"')})}`,
    );
    attributes.push('type="button"');
    attributes.push(`disabled={Boolean(${propValue('disabled', 'false')})}`);
    const onClick = node.events['onClick'];
    if (onClick) attributes.push(`onClick={${emitExpression(onClick, context)}}`);
    content = `{${propValue('label', '"Button"')}}`;
  } else if (node.componentId === 'sutra.grid') {
    const columns = propValue('columns', '2');
    attributes.push(
      `style={{ ...${style ?? '{}'}, gridTemplateColumns: "repeat(" + Number(${columns}) + ", minmax(0, 1fr))" }}`,
    );
  } else if (node.componentId === 'sutra.input') {
    content = `<span>{${propValue('label', '"Label"')}}</span>\n<input placeholder={String(${propValue('placeholder', '""')})} disabled={Boolean(${propValue('disabled', 'false')})} />`;
  } else if (node.componentId === 'sutra.container') {
    const ariaLabel = node.props['ariaLabel'];
    if (ariaLabel)
      attributes.push(`aria-label={String(${emitExpression(ariaLabel, context)}) || undefined}`);
  }

  if (node.componentId !== 'sutra.grid' && style) attributes.unshift(`style={${style}}`);
  if (node.componentId !== 'sutra.button' && node.classRefs.length > 0) {
    attributes.push(`className=${JSON.stringify(node.classRefs.join(' '))}`);
  }

  const attrText = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
  const element = content
    ? `<${tag}${attrText}>\n${indent(content)}\n</${tag}>`
    : `<${tag}${attrText} />`;
  return visible === 'true' ? element : `{${visible} ? (\n${indent(element)}\n) : null}`;
}

function emitNode(node: UiNode | undefined, context: EmitContext): string {
  if (!node) return '';
  switch (node.kind) {
    case 'element':
      return emitElement(node, context);
    case 'text':
      return `{${emitExpression(node.value, context)}}`;
    case 'expression':
      return `{${emitExpression(node.expression, context)}}`;
    case 'fragment':
      return `<>\n${indent(emitChildren(node.children, context))}\n</>`;
    case 'if':
      return `{${emitExpression(node.condition, context)} ? (\n${indent(`<>\n${indent(emitChildren(node.whenTrue, context))}\n</>`)}\n) : (\n${indent(`<>\n${indent(emitChildren(node.whenFalse, context))}\n</>`)}\n)}`;
    case 'repeat': {
      const itemName = safeName(context.document.symbols[node.itemSymbolId]?.name ?? 'item');
      const indexName = safeName(context.document.symbols[node.indexSymbolId]?.name ?? 'index');
      const repeatContext: EmitContext = {
        ...context,
        symbols: {
          ...context.symbols,
          [node.itemSymbolId]: itemName,
          [node.indexSymbolId]: indexName,
        },
      };
      return `{Array.isArray(${emitExpression(node.source, context)}) ? ${emitExpression(node.source, context)}.map((${itemName}, ${indexName}) => (\n${indent(`<>\n${indent(emitChildren(node.children, repeatContext))}\n</>`)}\n)) : null}`;
    }
    case 'slot':
      return emitChildren(node.fallback, context);
  }
}

export function generateTsx(document: UiDocument): string {
  const propLines = Object.values(document.publicProps)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (prop) => `  ${safeName(prop.name)}${prop.required ? '' : '?'}: ${tsType(prop.valueType)};`,
    );
  const symbols = Object.fromEntries(
    Object.values(document.publicProps).map((prop) => [
      prop.symbolId,
      `props.${safeName(prop.name)}`,
    ]),
  );
  const componentName = `${safeName(document.name)}Page`;
  const body = emitNode(document.nodes[document.rootNodeId], { document, symbols });

  return [
    "import type { CSSProperties } from 'react';",
    '',
    `export interface ${componentName}Props {`,
    ...propLines,
    '}',
    '',
    'const runtimeFunctions: Record<string, (...args: unknown[]) => unknown> = {};',
    'void ({} as CSSProperties);',
    '',
    `export function ${componentName}(props: ${componentName}Props) {`,
    '  return (',
    indent(body, 2),
    '  );',
    '}',
    '',
  ].join('\n');
}
