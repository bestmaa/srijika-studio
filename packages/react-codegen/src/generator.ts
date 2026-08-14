import type {
  ElementNode,
  EventSignature,
  LengthValue,
  StyleProperties,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueShape,
  ValueType,
} from '@srijika/contracts';

const visualComponentTags = {
  'srijika.avatar': 'SrijikaAvatar',
  'srijika.badge': 'SrijikaBadge',
  'srijika.chart': 'SrijikaChart',
  'srijika.divider': 'SrijikaDivider',
  'srijika.icon': 'SrijikaIcon',
  'srijika.progress': 'SrijikaProgress',
} as const;

const indent = (value: string, depth = 1): string => {
  const prefix = '  '.repeat(depth);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
};

const reservedBindingNames = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const normalizedName = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
};

const safeName = (value: string): string => {
  const normalized = normalizedName(value);
  return reservedBindingNames.has(normalized) ? `_${normalized}` : normalized;
};

const componentName = (value: string): string => {
  const words = value.match(/[A-Za-z0-9]+/g) ?? [];
  let name = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  if (!name) name = 'Untitled';
  if (!/^[A-Za-z_$]/.test(name)) name = `Page${name}`;
  return name.endsWith('Page') ? name : `${name}Page`;
};

const tsShape = (shape: ValueShape): string => {
  switch (shape.kind) {
    case 'string':
    case 'color':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'unknown':
      return 'unknown';
    case 'array':
      return `ReadonlyArray<${tsShape(shape.item)}>`;
    case 'object': {
      const fields = Object.entries(shape.fields)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([name, field]) =>
            `${normalizedName(name)}${field.required ? '' : '?'}: ${tsShape(field.shape)};`,
        );
      if (shape.additionalProperties) fields.push('[key: string]: unknown;');
      return fields.length > 0 ? `{ ${fields.join(' ')} }` : 'Readonly<Record<string, never>>';
    }
  }
};

const tsEventSignature = (signature: EventSignature | undefined): string => {
  const payload = signature?.payload;
  if (!payload) return '() => void';
  return `(${safeName(payload.name)}: ${tsShape(payload.shape)}) => void`;
};

const tsType = (type: ValueType, shape?: ValueShape, eventSignature?: EventSignature): string => {
  if (shape) return tsShape(shape);
  switch (type) {
    case 'string':
    case 'color':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'event':
      return tsEventSignature(eventSignature);
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
    'flexWrap',
    'flexGrow',
    'flexShrink',
    'order',
    'alignContent',
    'justifySelf',
    'placeItems',
    'gridTemplateColumns',
    'gridTemplateRows',
    'gridColumn',
    'gridRow',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'gap',
    'rowGap',
    'columnGap',
    'backgroundColor',
    'backgroundImage',
    'backgroundSize',
    'backgroundPosition',
    'backgroundRepeat',
    'color',
    'borderColor',
    'borderWidth',
    'borderStyle',
    'borderRadius',
    'boxShadow',
    'opacity',
    'cursor',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'zIndex',
    'aspectRatio',
    'objectFit',
    'objectPosition',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textTransform',
    'textDecoration',
    'whiteSpace',
    'textOverflow',
    'overflowWrap',
    'overflow',
    'overflowX',
    'overflowY',
    'transform',
    'transformOrigin',
    'filter',
    'backdropFilter',
    'pointerEvents',
    'visibility',
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
  if (style.alignSelf !== undefined) {
    const value =
      style.alignSelf === 'start'
        ? 'flex-start'
        : style.alignSelf === 'end'
          ? 'flex-end'
          : style.alignSelf;
    properties.push(`alignSelf: ${JSON.stringify(value)}`);
  }
  if (style.width) properties.push(`width: ${lengthToCode(style.width)}`);
  if (style.height) properties.push(`height: ${lengthToCode(style.height)}`);
  if (style.flexBasis) properties.push(`flexBasis: ${lengthToCode(style.flexBasis)}`);
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
  if (style.borderWidth && style.borderStyle === undefined) properties.push(`borderStyle: "solid"`);
  properties.push(`boxSizing: "border-box"`);

  return properties.length > 1 ? `{ ${properties.join(', ')} }` : null;
}

function eventHandlerCall(
  node: ElementNode,
  eventName: string,
  expression: ValueExpression,
  context: EmitContext,
  payloadCode?: string,
): { code: string; usesEventPayload: boolean } {
  const handler = emitExpression(expression, context);
  const signature =
    expression.kind === 'reference'
      ? context.document.symbols[expression.symbolId]?.eventSignature
      : undefined;
  const argument = node.eventArguments?.[eventName];
  if (!signature?.payload) {
    if (argument !== undefined) {
      throw new Error(`Event ${eventName} cannot map an argument to a no-payload callback`);
    }
    return { code: `${handler}?.()`, usesEventPayload: false };
  }
  if (argument?.kind === 'expression') {
    return {
      code: `${handler}?.(${emitMappedArgument(argument.expression, context)})`,
      usesEventPayload: false,
    };
  }
  if (payloadCode === undefined) {
    throw new Error(`Event ${eventName} requires a normalized payload or an argument expression`);
  }
  return { code: `${handler}?.(${payloadCode})`, usesEventPayload: true };
}

interface EmitContext {
  document: UiDocument;
  symbols: Readonly<Record<string, string>>;
}

function documentUsesSrijikaStyle(document: UiDocument): boolean {
  return Object.values(document.nodes).some(
    (node) => node.kind === 'element' && node.props['style'] !== undefined,
  );
}

function nodeUsesResponsiveStyle(node: ElementNode): boolean {
  return Object.keys(node.style.breakpoints ?? {}).length > 0;
}

function documentUsesResponsiveStyle(document: UiDocument): boolean {
  return Object.values(document.nodes).some(
    (node) => node.kind === 'element' && nodeUsesResponsiveStyle(node),
  );
}

function responsiveStyleCode(node: ElementNode): string {
  return `srijikaResponsiveStyle(${JSON.stringify(node.style)}, srijikaViewportWidth)`;
}

function documentUsesInputPartStyle(document: UiDocument): boolean {
  return Object.values(document.nodes).some(
    (node) => node.kind === 'element' && node.componentId === 'srijika.input',
  );
}

function emitExpression(expression: ValueExpression, context: EmitContext): string {
  switch (expression.kind) {
    case 'literal':
      return JSON.stringify(expression.value);
    case 'reference': {
      const root = context.symbols[expression.symbolId];
      if (!root) throw new Error(`Expression references unavailable symbol ${expression.symbolId}`);
      if (
        expression.path.some(
          (segment) =>
            segment === '__proto__' || segment === 'prototype' || segment === 'constructor',
        )
      ) {
        throw new Error(`Expression contains an unsafe reference path`);
      }
      const symbol = context.document.symbols[expression.symbolId];
      const serializedDefault =
        symbol?.provider === 'prop' && !symbol.required && symbol.defaultValue !== undefined
          ? JSON.stringify(symbol.defaultValue)
          : undefined;
      const rootWithDefault =
        serializedDefault === undefined ? root : `(${root} ?? ${serializedDefault})`;
      return expression.path.reduce(
        (value, segment) => `${value}?.[${JSON.stringify(segment)}]`,
        rootWithDefault,
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
        coalesce: '??',
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
    case 'customCodeReference':
      return `undefined /* ${expression.moduleId}.${expression.exportName} */`;
  }
}

function emitMappedArgument(expression: ValueExpression, context: EmitContext): string {
  return emitExpression(expression, context);
}

function classNameAttribute(
  node: ElementNode,
  context: EmitContext,
  computedParts: readonly string[] = [],
): string | null {
  const staticClassName = node.classRefs.join(' ');
  const dynamicClassName = node.props['className'];
  if (!dynamicClassName && computedParts.length === 0) {
    return staticClassName ? `className=${JSON.stringify(staticClassName)}` : null;
  }

  const parts: string[] = [];
  if (staticClassName) parts.push(JSON.stringify(staticClassName));
  if (dynamicClassName) {
    parts.push(`String(${emitExpression(dynamicClassName, context)} ?? "")`);
  }
  parts.push(...computedParts);
  return `className={[${parts.join(', ')}].filter(Boolean).join(" ")}`;
}

function styleAttribute(
  node: ElementNode,
  context: EmitContext,
  computedProperties: readonly string[] = [],
  defaultProperties: readonly string[] = [],
): string | null {
  const staticStyle = nodeUsesResponsiveStyle(node)
    ? responsiveStyleCode(node)
    : styleToCode(node.style.base);
  const dynamicStyle = node.props['style'];
  if (!dynamicStyle && computedProperties.length === 0 && defaultProperties.length === 0) {
    return staticStyle ? `style={${staticStyle}}` : null;
  }

  const parts: string[] = [...defaultProperties];
  if (staticStyle) parts.push(`...${staticStyle}`);
  if (dynamicStyle) parts.push(`...srijikaStyle(${emitExpression(dynamicStyle, context)})`);
  parts.push(...computedProperties);
  return `style={{ ${parts.join(', ')} }}`;
}

function instancePropsAttribute(node: ElementNode, context: EmitContext): string | null {
  const properties = Object.keys(node.instanceProps ?? {}).flatMap((propName) => {
    const expression = node.props[propName];
    return expression
      ? [`${JSON.stringify(propName)}: ${emitExpression(expression, context)}`]
      : [];
  });
  return properties.length > 0
    ? `{...({ ${properties.join(', ')} } as Record<string, unknown>)}`
    : null;
}

function instanceEventPayloadCode(node: ElementNode, eventName: string): string | undefined {
  const source = node.instanceEvents?.[eventName]?.source;
  if (source === 'keyDown') {
    return '{ key: event.key, code: event.code, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, repeat: event.repeat }';
  }
  if (source === 'valueChange' || source === 'valueInput') {
    return 'String((event.currentTarget as HTMLElement & { value?: unknown }).value ?? "")';
  }
  return undefined;
}

function instanceEventAttribute(
  node: ElementNode,
  eventName: string,
  expression: ValueExpression,
  context: EmitContext,
): string {
  const source = node.instanceEvents?.[eventName]?.source;
  const call = eventHandlerCall(
    node,
    eventName,
    expression,
    context,
    instanceEventPayloadCode(node, eventName),
  );
  if (source === 'submit') {
    return `${eventName}={(event) => { event.preventDefault(); ${call.code}; }}`;
  }
  return `${eventName}={${call.usesEventPayload ? '(event)' : '()'} => ${call.code}}`;
}

function emitChildren(ids: readonly string[], context: EmitContext): string {
  return ids
    .map((id) => emitNode(context.document.nodes[id], context))
    .filter(Boolean)
    .join('\n');
}

function elementTag(node: ElementNode): string {
  switch (node.componentId) {
    case 'srijika.page':
      return 'main';
    case 'srijika.text':
      return 'p';
    case 'srijika.button':
      return 'button';
    case 'srijika.input':
      return 'label';
    case 'srijika.image':
      return 'img';
    case 'srijika.heading': {
      const level = node.props['level'];
      return level?.kind === 'literal' && typeof level.value === 'number'
        ? `h${Math.max(1, Math.min(6, level.value))}`
        : 'h2';
    }
    case 'srijika.container': {
      const semanticTag = node.props['as'];
      const value = semanticTag?.kind === 'literal' ? semanticTag.value : null;
      return typeof value === 'string' &&
        ['div', 'section', 'header', 'footer', 'nav', 'article', 'aside'].includes(value)
        ? value
        : 'div';
    }
    case 'srijika.stack':
    case 'srijika.grid':
      return 'div';
    default:
      if (node.componentId in visualComponentTags) {
        return visualComponentTags[node.componentId as keyof typeof visualComponentTags];
      }
      throw new Error(
        `Component ${node.componentId} has no registered TSX code-generation adapter`,
      );
  }
}

function emitElement(node: ElementNode, context: EmitContext): string {
  const tag = elementTag(node);
  const attributes: string[] = [];
  const computedClassParts: string[] = [];
  const computedStyleProperties: string[] = [];

  const visible = emitExpression(node.visible, context);
  const propValue = (name: string, fallback: string): string => {
    const expression = node.props[name];
    return expression ? emitExpression(expression, context) : fallback;
  };

  let content = emitChildren(Object.values(node.slots).flat(), context);
  if (node.componentId === 'srijika.text' || node.componentId === 'srijika.heading') {
    content = `{${propValue('text', '""')}}`;
  } else if (node.componentId === 'srijika.button') {
    computedClassParts.push(
      JSON.stringify('srijika-button'),
      `${JSON.stringify('srijika-button--')} + String(${propValue('variant', '"primary"')})`,
    );
    attributes.push('type="button"');
    attributes.push(`disabled={Boolean(${propValue('disabled', 'false')})}`);
    const onClick = node.events['onClick'];
    if (onClick) {
      const call = eventHandlerCall(node, 'onClick', onClick, context);
      attributes.push(`onClick={() => ${call.code}}`);
    }
    content = `{${propValue('label', '"Button"')}}`;
  } else if (node.componentId === 'srijika.grid') {
    const columns = propValue('columns', '2');
    const columnsTemplate = propValue('columnsTemplate', '""');
    const rowsTemplate = propValue('rowsTemplate', '""');
    const staticColumns = nodeUsesResponsiveStyle(node)
      ? `${responsiveStyleCode(node)}.gridTemplateColumns`
      : `String(${JSON.stringify(node.style.base.gridTemplateColumns ?? '')})`;
    const staticRows = nodeUsesResponsiveStyle(node)
      ? `${responsiveStyleCode(node)}.gridTemplateRows`
      : `String(${JSON.stringify(node.style.base.gridTemplateRows ?? '')})`;
    computedStyleProperties.push(
      `gridTemplateColumns: ${staticColumns} || String(${columnsTemplate}) || "repeat(" + Number(${columns}) + ", minmax(0, 1fr))"`,
      `gridTemplateRows: ${staticRows} || String(${rowsTemplate}) || undefined`,
    );
  } else if (node.componentId === 'srijika.input') {
    const onChange = node.events['onChange'];
    let onChangeAttribute = '';
    if (onChange) {
      const call = eventHandlerCall(
        node,
        'onChange',
        onChange,
        context,
        'event.currentTarget.value',
      );
      onChangeAttribute = call.usesEventPayload
        ? ` onChange={(event) => ${call.code}}`
        : ` onChange={() => ${call.code}}`;
    }
    const requestedType = node.props['type'];
    const type =
      requestedType?.kind === 'literal' &&
      typeof requestedType.value === 'string' &&
      [
        'text',
        'email',
        'password',
        'number',
        'search',
        'tel',
        'url',
        'date',
        'time',
        'datetime-local',
      ].includes(requestedType.value)
        ? requestedType.value
        : 'text';
    const label = propValue('label', '"Label"');
    const hideLabel = propValue('hideLabel', 'false');
    const labelStyle = propValue('labelStyle', '{}');
    const controlStyle = propValue('controlStyle', '{}');
    content = `{!Boolean(${hideLabel}) ? <span style={srijikaInputPartStyle(${labelStyle})}>{${label}}</span> : null}\n<input aria-label={Boolean(${hideLabel}) ? String(${label}) || undefined : undefined} type=${JSON.stringify(type)} name={String(${propValue('name', '""')}) || undefined} placeholder={String(${propValue('placeholder', '""')})} defaultValue={String(${propValue('defaultValue', '""')})} autoComplete={String(${propValue('autoComplete', '"off"')})} required={Boolean(${propValue('required', 'false')})} disabled={Boolean(${propValue('disabled', 'false')})} style={srijikaInputPartStyle(${controlStyle})}${onChangeAttribute} />`;
  } else if (node.componentId === 'srijika.image') {
    const requestedFit = node.props['fit'];
    const fit =
      requestedFit?.kind === 'literal' &&
      typeof requestedFit.value === 'string' &&
      ['cover', 'contain', 'fill', 'none', 'scale-down'].includes(requestedFit.value)
        ? requestedFit.value
        : 'cover';
    const loading =
      node.props['loading']?.kind === 'literal' && node.props['loading'].value === 'eager'
        ? 'eager'
        : 'lazy';
    attributes.push(`src={String(${propValue('src', '""')})}`);
    attributes.push(`alt={String(${propValue('alt', '""')})}`);
    attributes.push(`loading=${JSON.stringify(loading)}`);
    computedStyleProperties.push(`objectFit: ${JSON.stringify(fit)}`);
  } else if (node.componentId === 'srijika.icon') {
    attributes.push(`name={${propValue('name', '"home"')}}`);
    attributes.push(`label={${propValue('label', '""')}}`);
    attributes.push(`size={${propValue('size', '24')}}`);
    attributes.push(`strokeWidth={${propValue('strokeWidth', '2')}}`);
  } else if (node.componentId === 'srijika.divider') {
    attributes.push(`orientation={${propValue('orientation', '"horizontal"')}}`);
    attributes.push(`color={${propValue('color', '"#d1d5db"')}}`);
    attributes.push(`thickness={${propValue('thickness', '1')}}`);
  } else if (node.componentId === 'srijika.progress') {
    attributes.push(`value={${propValue('value', '65')}}`);
    attributes.push(`max={${propValue('max', '100')}}`);
    attributes.push(`label={${propValue('label', '"Progress"')}}`);
    attributes.push(`fillColor={${propValue('fillColor', '"#6d5dfc"')}}`);
    attributes.push(`trackColor={${propValue('trackColor', '"#2a303b"')}}`);
  } else if (node.componentId === 'srijika.badge') {
    attributes.push(`label={${propValue('label', '"Badge"')}}`);
    attributes.push(`tone={${propValue('tone', '"neutral"')}}`);
    attributes.push(`dot={${propValue('dot', 'false')}}`);
  } else if (node.componentId === 'srijika.avatar') {
    attributes.push(`src={${propValue('src', '""')}}`);
    attributes.push(`alt={${propValue('alt', '"Avatar"')}}`);
    attributes.push(`fallback={${propValue('fallback', '"A"')}}`);
    attributes.push(`size={${propValue('size', '40')}}`);
    attributes.push(`status={${propValue('status', '"none"')}}`);
  } else if (node.componentId === 'srijika.chart') {
    attributes.push(`chartType={${propValue('chartType', '"line"')}}`);
    attributes.push(`curve={${propValue('curve', '"linear"')}}`);
    attributes.push(`data={${propValue('data', '[]')}}`);
    attributes.push(`colors={${propValue('colors', '[]')}}`);
    attributes.push(`label={${propValue('label', '"Data chart"')}}`);
    attributes.push(`showGrid={${propValue('showGrid', 'true')}}`);
    attributes.push(`strokeWidth={${propValue('strokeWidth', '3')}}`);
    attributes.push(`innerRadius={${propValue('innerRadius', '58')}}`);
  } else if (node.componentId === 'srijika.container') {
    const ariaLabel = node.props['ariaLabel'];
    if (ariaLabel)
      attributes.push(`aria-label={String(${emitExpression(ariaLabel, context)}) || undefined}`);
  }

  const addedProps = instancePropsAttribute(node, context);
  if (addedProps) attributes.push(addedProps);
  for (const eventName of Object.keys(node.instanceEvents ?? {})) {
    const expression = node.events[eventName];
    if (expression) attributes.push(instanceEventAttribute(node, eventName, expression, context));
  }

  const defaultStyleProperties =
    node.componentId === 'srijika.text' || node.componentId === 'srijika.heading'
      ? ['...{ margin: 0 }']
      : [];
  const style = styleAttribute(node, context, computedStyleProperties, defaultStyleProperties);
  if (style) attributes.unshift(style);
  const className = classNameAttribute(node, context, computedClassParts);
  if (className) attributes.push(className);

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
      if (node.whenFalse.length === 0) {
        return `{${emitExpression(node.condition, context)} && (\n${indent(`<>\n${indent(emitChildren(node.whenTrue, context))}\n</>`)}\n)}`;
      }
      return `{${emitExpression(node.condition, context)} ? (\n${indent(`<>\n${indent(emitChildren(node.whenTrue, context))}\n</>`)}\n) : (\n${indent(`<>\n${indent(emitChildren(node.whenFalse, context))}\n</>`)}\n)}`;
    case 'repeat': {
      const itemName = safeName(context.document.symbols[node.itemSymbolId]?.name ?? 'item');
      const indexName = safeName(context.document.symbols[node.indexSymbolId]?.name ?? 'index');
      const source = emitMappedArgument(node.source, context);
      const repeatContext: EmitContext = {
        ...context,
        symbols: {
          ...context.symbols,
          [node.itemSymbolId]: itemName,
          [node.indexSymbolId]: indexName,
        },
      };
      return `{Array.isArray(${source}) ? ${source}.map((${itemName}, ${indexName}) => (\n${indent(`<Fragment key={${indexName}}>\n${indent(emitChildren(node.children, repeatContext))}\n</Fragment>`)}\n)) : null}`;
    }
    case 'slot':
      return emitChildren(node.fallback, context);
  }
}

export function generateTsx(document: UiDocument): string {
  const propLines = Object.values(document.publicProps)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (prop) =>
        `  ${safeName(prop.name)}${prop.required ? '' : '?'}: ${tsType(prop.valueType, prop.valueShape, prop.eventSignature)};`,
    );
  const symbols = Object.fromEntries(
    Object.values(document.publicProps).map((prop) => [
      prop.symbolId,
      `props.${safeName(prop.name)}`,
    ]),
  );
  const generatedComponentName = componentName(document.name);
  const body = emitNode(document.nodes[document.rootNodeId], { document, symbols });
  const rendererImports = [
    ...(documentUsesSrijikaStyle(document) ? ['srijikaStyle'] : []),
    ...(documentUsesResponsiveStyle(document)
      ? ['srijikaResponsiveStyle', 'useSrijikaViewportWidth']
      : []),
  ].sort();
  const styleImport =
    rendererImports.length > 0
      ? [`import { ${rendererImports.join(', ')} } from '@srijika/react-renderer';`, '']
      : [];
  const usedCoreExports = [
    ...new Set(
      Object.values(document.nodes).flatMap((node) =>
        node.kind === 'element' && node.componentId in visualComponentTags
          ? [visualComponentTags[node.componentId as keyof typeof visualComponentTags]]
          : [],
      ),
    ),
    ...(documentUsesInputPartStyle(document) ? ['srijikaInputPartStyle'] : []),
  ].sort();
  const coreImport =
    usedCoreExports.length > 0
      ? [`import { ${usedCoreExports.join(', ')} } from '@srijika/core-components';`, '']
      : [];

  return [
    "import { Fragment } from 'react';",
    '',
    ...coreImport,
    ...styleImport,
    `export interface ${generatedComponentName}Props {`,
    ...propLines,
    '}',
    '',
    `export function ${generatedComponentName}(props: ${generatedComponentName}Props) {`,
    ...(documentUsesResponsiveStyle(document)
      ? ['  const srijikaViewportWidth = useSrijikaViewportWidth();']
      : []),
    '  return (',
    indent(body, 2),
    '  );',
    '}',
    '',
  ].join('\n');
}
