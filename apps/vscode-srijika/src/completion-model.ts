import {
  SRIJIKA_INTRINSIC_ATTRIBUTES,
  SRIJIKA_INTRINSIC_EVENTS,
  SRIJIKA_INTRINSIC_TAGS,
  type SrijikaComponentContractEntry,
} from '@srijika/tsx-compiler';

export interface SrijikaCompletionModel {
  label: string;
  filterText: string;
  insertText: string;
  detail: string;
  documentation: string;
  kind: 'prop' | 'event' | 'tag' | 'css-class';
  replacementStart?: number;
}

interface OpeningTagContext {
  tag: string;
  authoredAttributes: ReadonlySet<string>;
}

export function extractCssClassNames(source: string): readonly string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function openingTagAt(source: string, offset: number): OpeningTagContext | null {
  const prefix = source.slice(0, offset);
  const opening = prefix.match(/<([a-z][\w-]*)([^<>]*)$/s);
  if (!opening) return null;
  const tag = opening[1];
  const attributesSource = opening[2];
  if (!tag || attributesSource === undefined) return null;

  const attributes = new Set<string>();
  for (const match of attributesSource.matchAll(/\b([A-Za-z_:][\w:.-]*)\s*(?:=|(?=\s|$))/g)) {
    const name = match[1];
    if (name) attributes.add(name);
  }
  return { tag, authoredAttributes: attributes };
}

function tagPrefixAt(source: string, offset: number): string | null {
  const prefix = source.slice(0, offset);
  const opening = prefix.match(/<([a-z][a-z0-9]*)?$/i);
  return opening ? (opening[1] ?? '').toLowerCase() : null;
}

interface CssClassContext {
  authored: ReadonlySet<string>;
  prefix: string;
  replacementStart: number;
}

function cssClassContextAt(source: string, offset: number): CssClassContext | null {
  const beforeCursor = source.slice(0, offset);
  const match = /\bclassName\s*=\s*(?:\{\s*)?["']([^"']*)$/s.exec(beforeCursor);
  const value = match?.[1];
  if (value === undefined) return null;
  const parts = value.split(/\s+/u);
  const prefix = parts.pop() ?? '';
  return {
    authored: new Set(parts.filter(Boolean)),
    prefix,
    replacementStart: offset - prefix.length,
  };
}

function propSnippet(name: string, type: string): string {
  if (type === 'boolean') return `${name}={\${1:true}}`;
  if (type === 'number') return `${name}={\${1:0}}`;
  return `${name}="\${1}"`;
}

export function srijikaJsxCompletions(
  source: string,
  offset: number,
  componentContract: readonly SrijikaComponentContractEntry[],
  cssClassNames: readonly string[] = [],
): readonly SrijikaCompletionModel[] {
  const cssContext = cssClassContextAt(source, offset);
  if (cssContext) {
    return [...new Set(cssClassNames)]
      .filter(
        (className) =>
          className.startsWith(cssContext.prefix) && !cssContext.authored.has(className),
      )
      .sort((left, right) => left.localeCompare(right))
      .map((className): SrijikaCompletionModel => ({
        label: className,
        filterText: className,
        insertText: className,
        detail: 'Project CSS class',
        documentation: `Class discovered from a CSS file in the open Srijika project.`,
        kind: 'css-class',
        replacementStart: cssContext.replacementStart,
      }));
  }

  const tagPrefix = tagPrefixAt(source, offset);
  if (tagPrefix !== null) {
    return SRIJIKA_INTRINSIC_TAGS.filter((tag) => tag.startsWith(tagPrefix)).map(
      (tag): SrijikaCompletionModel => ({
        label: tag,
        filterText: tag,
        insertText: tag === 'img' || tag === 'input' ? `${tag} \${1}/>` : `${tag}>\${1}</${tag}>`,
        detail: 'Srijika supported HTML element',
        documentation: `Insert the supported <${tag}> intrinsic element.`,
        kind: 'tag',
      }),
    );
  }

  const context = openingTagAt(source, offset);
  if (!context) return [];

  const props = SRIJIKA_INTRINSIC_ATTRIBUTES.filter(
    (attribute) =>
      (!attribute.tags || attribute.tags.includes(context.tag)) &&
      !context.authoredAttributes.has(attribute.name),
  ).map((attribute): SrijikaCompletionModel => ({
    label: attribute.name,
    filterText: attribute.name,
    insertText: propSnippet(attribute.name, attribute.type),
    detail: `Srijika JSX prop · ${attribute.type}`,
    documentation: attribute.description,
    kind: 'prop',
  }));

  const callbacks = componentContract.filter((entry) => entry.kind === 'event');
  const events = SRIJIKA_INTRINSIC_EVENTS.flatMap((event): SrijikaCompletionModel[] => {
    if (context.authoredAttributes.has(event.name)) return [];
    if (callbacks.length === 0) {
      return [
        {
          label: event.name,
          filterText: event.name,
          insertText: `${event.name}={props.\${1:${event.name}}}`,
          detail: 'Srijika event · create typed callback prop',
          documentation: `${event.description} Srijika UI events reference a typed props callback; behavior stays in the Connector.`,
          kind: 'event',
        },
      ];
    }
    return callbacks.map((callback) => ({
      label: `${event.name} → props.${callback.name}`,
      filterText: event.name,
      insertText: `${event.name}={props.${callback.name}}`,
      detail: 'Srijika event · existing Connector callback',
      documentation: `${event.description} Connect this element to the declared ${callback.name} callback prop.`,
      kind: 'event',
    }));
  });

  return [...events, ...props];
}
