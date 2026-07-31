import { Fragment, type MouseEvent, type ReactNode } from 'react';

import type { ComponentRegistry } from '@sutra/component-registry';
import type { UiDocument, UiNode } from '@sutra/contracts';
import type { CoreComponentRenderer } from '@sutra/core-components';

import { evaluateExpression, type EvaluationScope } from './expressions';
import { stylePropertiesToCss } from './styles';

export interface SutraRendererProps {
  document: UiDocument;
  registry: ComponentRegistry<CoreComponentRenderer>;
  mode: 'edit' | 'preview';
  selectedNodeId?: string | null;
  dropTargetNodeId?: string | null;
  symbols?: Readonly<Record<string, unknown>>;
  events?: Readonly<Record<string, (...args: unknown[]) => void>>;
  registeredFunctions?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  onSelectNode?: (nodeId: string) => void;
  activeIfBranches?: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>;
}

interface NodeRendererProps extends SutraRendererProps {
  nodeId: string;
  scope: EvaluationScope;
}

function nodeChildren(node: UiNode): readonly string[] {
  if (node.kind === 'element') return Object.values(node.slots).flat();
  if (node.kind === 'fragment' || node.kind === 'repeat') return node.children;
  if (node.kind === 'slot') return node.fallback;
  return [];
}

function toReactNode(value: unknown): ReactNode {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return JSON.stringify(value);
}

function NodeRenderer(props: NodeRendererProps): ReactNode {
  const { document, nodeId, scope } = props;
  const node = document.nodes[nodeId];
  if (!node) return null;

  const selectStructuralNode = (event: MouseEvent<HTMLElement>): void => {
    if (props.mode !== 'edit') return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelectNode?.(node.id);
  };

  const editStructure = (label: string, content: ReactNode): ReactNode => (
    <div
      className="sutra-structure-node"
      data-sutra-node={node.id}
      data-sutra-selected={props.selectedNodeId === node.id ? 'true' : 'false'}
      data-sutra-drop-target={props.dropTargetNodeId === node.id ? 'true' : 'false'}
      onClick={selectStructuralNode}
    >
      <span className="sutra-structure-label">{label}</span>
      <div className="sutra-structure-content">
        {content ?? <span className="sutra-empty-structure">Drop components here</span>}
      </div>
    </div>
  );

  if (node.kind === 'text') return toReactNode(evaluateExpression(node.value, scope));
  if (node.kind === 'expression') return toReactNode(evaluateExpression(node.expression, scope));
  if (node.kind === 'fragment') {
    const content = (
      <Fragment key={node.id}>
        {node.children.map((childId) => (
          <NodeRenderer key={childId} {...props} nodeId={childId} />
        ))}
      </Fragment>
    );
    return props.mode === 'edit' ? editStructure('FRAGMENT', content) : content;
  }
  if (node.kind === 'if') {
    const condition = Boolean(evaluateExpression(node.condition, scope));
    const branchName =
      props.mode === 'edit'
        ? (props.activeIfBranches?.[node.id] ?? 'whenTrue')
        : condition
          ? 'whenTrue'
          : 'whenFalse';
    const branch = node[branchName];
    const content = (
      <Fragment key={node.id}>
        {branch.map((childId) => (
          <NodeRenderer key={childId} {...props} nodeId={childId} />
        ))}
      </Fragment>
    );
    return props.mode === 'edit'
      ? editStructure(`IF · ${branchName === 'whenTrue' ? 'TRUE' : 'FALSE'} BRANCH`, content)
      : content;
  }
  if (node.kind === 'repeat') {
    const value = evaluateExpression(node.source, scope);
    const items = Array.isArray(value) ? value : [];
    const renderItems = (source: readonly unknown[]): ReactNode =>
      source.map((item, index) => {
        const repeatScope: EvaluationScope = {
          ...scope,
          symbols: {
            ...scope.symbols,
            [node.itemSymbolId]: item,
            [node.indexSymbolId]: index,
          },
        };
        return (
          <Fragment key={`${node.id}-${index}`}>
            {node.children.map((childId) => (
              <NodeRenderer key={childId} {...props} nodeId={childId} scope={repeatScope} />
            ))}
          </Fragment>
        );
      });
    if (props.mode === 'edit') {
      const designItems =
        items.length > 0 ? items.slice(0, 3) : node.children.length > 0 ? [undefined] : [];
      return editStructure(`REPEAT · ${items.length} ITEMS`, renderItems(designItems));
    }
    return renderItems(items);
  }
  if (node.kind === 'slot') {
    const content = node.fallback.map((childId) => (
      <NodeRenderer key={childId} {...props} nodeId={childId} />
    ));
    return props.mode === 'edit' ? editStructure(`SLOT · ${node.slotName}`, content) : content;
  }

  if (!evaluateExpression(node.visible, scope)) return null;
  const definition = props.registry.get(node.componentId);
  if (!definition) {
    return props.mode === 'edit' ? (
      <div className="sutra-missing-component" data-sutra-node={node.id}>
        Missing component: {node.componentId}
      </div>
    ) : null;
  }

  const values = Object.fromEntries(
    Object.entries(node.props).map(([name, expression]) => [
      name,
      evaluateExpression(expression, scope),
    ]),
  );
  const events = Object.fromEntries(
    Object.entries(node.events).map(([name, expression]) => {
      const reference = expression.kind === 'reference' ? expression.symbolId : undefined;
      return [name, reference ? props.events?.[reference] : undefined];
    }),
  );

  const onEditorClick = (event: MouseEvent<HTMLElement>): void => {
    if (props.mode !== 'edit') return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelectNode?.(node.id);
  };

  const slots = Object.fromEntries(
    Object.entries(node.slots).map(([slotName, childIds]) => [
      slotName,
      childIds.map((childId) => <NodeRenderer key={childId} {...props} nodeId={childId} />),
    ]),
  );
  const children =
    slots['children'] ??
    nodeChildren(node).map((childId) => <NodeRenderer key={childId} {...props} nodeId={childId} />);

  return definition.implementation({
    nodeId: node.id,
    values,
    events,
    style: stylePropertiesToCss(node.style.base),
    className: node.classRefs.join(' '),
    children,
    slots,
    editorAttributes:
      props.mode === 'edit'
        ? {
            'data-sutra-node': node.id,
            'data-sutra-component': node.componentId,
            'data-sutra-selected': props.selectedNodeId === node.id ? 'true' : 'false',
            'data-sutra-drop-target': props.dropTargetNodeId === node.id ? 'true' : 'false',
            onClick: onEditorClick,
          }
        : {},
  });
}

export function SutraRenderer(props: SutraRendererProps): ReactNode {
  const scope: EvaluationScope = {
    symbols: props.symbols ?? {},
    ...(props.registeredFunctions ? { registeredFunctions: props.registeredFunctions } : {}),
  };
  return <NodeRenderer {...props} nodeId={props.document.rootNodeId} scope={scope} />;
}
