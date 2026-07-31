import {
  FORMAT_VERSION,
  type ElementNode,
  type LiteralValue,
  type StyleDeclaration,
  type UiDocument,
  type ValueExpression,
} from './schemas';

export const literal = (value: LiteralValue): ValueExpression => ({
  kind: 'literal',
  value,
});

export const visibleExpression = (): ValueExpression => literal(true);

export const defaultStyle = (): StyleDeclaration => ({
  base: {},
});

export function createElementNode(
  id: string,
  componentId: string,
  name: string,
  overrides: Partial<ElementNode> = {},
): ElementNode {
  return {
    kind: 'element',
    id,
    name,
    componentId,
    componentVersion: 1,
    props: {},
    events: {},
    slots: { children: [] },
    classRefs: [],
    style: defaultStyle(),
    visible: visibleExpression(),
    locked: false,
    ...overrides,
  };
}

export function createBlankDocument(id = 'page_home', name = 'Home'): UiDocument {
  const root = createElementNode('root', 'sutra.page', 'Page', {
    style: {
      base: {
        display: 'flex',
        flexDirection: 'column',
        width: { mode: 'percent', value: 100 },
        minHeight: 720,
        backgroundColor: '#ffffff',
      },
    },
  });

  return {
    formatVersion: FORMAT_VERSION,
    id,
    kind: 'page',
    name,
    rootNodeId: root.id,
    revision: 0,
    nodes: { [root.id]: root },
    symbols: {},
    publicProps: {},
  };
}
