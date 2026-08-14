import type { UiDocument, UiNode, ValueExpression } from '@srijika/contracts';

export interface UiNodePresentation {
  /** Human-readable label only. The canonical node identity remains `UiNode.id`. */
  label: string;
  /** Compact source or semantic context shown beside the label. */
  detail: string;
}

const MAX_LABEL_LENGTH = 48;

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LABEL_LENGTH - 3).trimEnd()}...`;
}

function literalString(expression: ValueExpression | undefined): string | null {
  if (!expression) return null;
  if (expression.kind === 'literal') {
    if (typeof expression.value === 'string' || typeof expression.value === 'number') {
      return String(expression.value).trim() || null;
    }
    return null;
  }
  if (
    expression.kind === 'template' &&
    expression.parts.every((part) => typeof part === 'string')
  ) {
    const value = expression.parts.join('').trim();
    return value || null;
  }
  return null;
}

function humanizeToken(value: string): string {
  const words = value
    .replace(/^[.#]+/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_:./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return value;
  return words
    .split(' ')
    .map((word) =>
      /^[A-Z\d]+$/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(' ');
}

function naturalLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return compact(/[\s]/.test(normalized) ? normalized : humanizeToken(normalized));
}

function expressionLabel(document: UiDocument, expression: ValueExpression): string | null {
  const literal = literalString(expression);
  if (literal) return naturalLabel(literal);
  if (expression.kind === 'reference') {
    const symbol = document.symbols[expression.symbolId];
    const root = symbol?.displayName || symbol?.name || expression.symbolId;
    return compact([root, ...expression.path].map(humanizeToken).join(' › '));
  }
  return null;
}

export function intrinsicElementTag(node: Extract<UiNode, { kind: 'element' }>): string {
  const authoredTag = literalString(node.props['as']);
  if (authoredTag) return authoredTag.toLowerCase();
  if (node.componentId === 'srijika.page') return 'main';
  if (node.componentId === 'srijika.image') return 'img';
  if (node.componentId === 'srijika.button') return 'button';
  if (node.componentId === 'srijika.heading') {
    const level = node.props['level'];
    if (level?.kind === 'literal' && typeof level.value === 'number') return `h${level.value}`;
  }
  if (node.componentId === 'srijika.text') return node.name === 'Paragraph' ? 'p' : 'span';
  return node.name.toLowerCase();
}

function rawPresentation(document: UiDocument, node: UiNode): UiNodePresentation {
  if (node.kind === 'text') {
    return {
      label: expressionLabel(document, node.value) ?? node.name,
      detail: 'Text',
    };
  }
  if (node.kind === 'expression') {
    return {
      label: expressionLabel(document, node.expression) ?? node.name,
      detail: 'Expression',
    };
  }
  if (node.kind === 'slot') {
    return {
      label: compact(`${humanizeToken(node.slotName)} slot`),
      detail: 'Slot',
    };
  }
  if (node.kind === 'if') {
    const condition = expressionLabel(document, node.condition);
    return {
      label: condition ? compact(`If ${condition}`) : node.name,
      detail: 'Condition',
    };
  }
  if (node.kind === 'repeat') {
    const source = expressionLabel(document, node.source);
    return {
      label: source ? compact(`Repeat ${source}`) : node.name,
      detail: 'Repeat',
    };
  }
  if (node.kind === 'fragment') {
    return { label: node.name, detail: 'Group' };
  }

  return { label: intrinsicElementTag(node), detail: node.name };
}

export function uiNodeChildren(node: UiNode): readonly string[] {
  switch (node.kind) {
    case 'element':
      return Object.values(node.slots).flat();
    case 'fragment':
    case 'repeat':
      return node.children;
    case 'if':
      return [...node.whenTrue, ...node.whenFalse];
    case 'slot':
      return node.fallback;
    default:
      return [];
  }
}

/**
 * Builds presentation-only labels. Node IDs, source-map keys, and AST identity are never changed.
 */
export function buildUiNodePresentations(
  document: UiDocument,
): Readonly<Record<string, UiNodePresentation>> {
  const presentations: Record<string, UiNodePresentation> = {};
  for (const node of Object.values(document.nodes)) {
    presentations[node.id] = rawPresentation(document, node);
  }

  for (const parent of Object.values(document.nodes)) {
    const childIds = uiNodeChildren(parent).filter((id) => presentations[id]);
    const totals = new Map<string, number>();
    for (const childId of childIds) {
      const label = presentations[childId]!.label.toLocaleLowerCase();
      totals.set(label, (totals.get(label) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    for (const childId of childIds) {
      const presentation = presentations[childId]!;
      const key = presentation.label.toLocaleLowerCase();
      if ((totals.get(key) ?? 0) < 2) continue;
      const ordinal = (seen.get(key) ?? 0) + 1;
      seen.set(key, ordinal);
      presentations[childId] = { ...presentation, label: `${presentation.label} ${ordinal}` };
    }
  }

  return presentations;
}
