import {
  Fragment,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import type { ComponentRegistry } from '@srijika/component-registry';
import type { ElementNode, UiDocument, UiNode } from '@srijika/contracts';
import type { CoreComponentRenderer } from '@srijika/core-components';

import { evaluateExpression, type EvaluationScope } from './expressions';
import {
  SRIJIKA_DEFAULT_VIEWPORT_WIDTH,
  srijikaResponsiveStyle,
  srijikaStyle,
  useSrijikaViewportWidth,
} from './styles';

export interface SrijikaRendererProps {
  document: UiDocument;
  registry: ComponentRegistry<CoreComponentRenderer>;
  mode: 'edit' | 'preview';
  selectedNodeId?: string | null;
  dropTargetNodeId?: string | null;
  symbols?: Readonly<Record<string, unknown>>;
  events?: Readonly<Record<string, (...args: unknown[]) => void>>;
  onSelectNode?: (nodeId: string) => void;
  activeIfBranches?: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>;
  /** Overrides responsive evaluation for deterministic editor and test surfaces. */
  viewportWidth?: number;
}

interface NodeRendererProps extends SrijikaRendererProps {
  nodeId: string;
  scope: EvaluationScope;
}

const EDIT_REPEAT_ITEM_LIMIT = 100;

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

function eventTargetValue(event: SyntheticEvent<HTMLElement>): string {
  const currentTarget = event.currentTarget as HTMLElement & { value?: unknown };
  return typeof currentTarget.value === 'string' || typeof currentTarget.value === 'number'
    ? String(currentTarget.value)
    : '';
}

function instanceAttributes(
  node: ElementNode,
  values: Readonly<Record<string, unknown>>,
  events: Readonly<Record<string, ((...args: unknown[]) => void) | undefined>>,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const propName of Object.keys(node.instanceProps ?? {})) {
    attributes[propName] = values[propName];
  }
  for (const [eventName, spec] of Object.entries(node.instanceEvents ?? {})) {
    const handler = events[eventName];
    if (!handler) continue;
    switch (spec.source) {
      case 'click':
      case 'doubleClick':
      case 'mouseEnter':
      case 'mouseLeave':
      case 'focus':
      case 'blur':
        attributes[eventName] = () => handler();
        break;
      case 'submit':
        attributes[eventName] = (event: FormEvent<HTMLElement>) => {
          event.preventDefault();
          handler();
        };
        break;
      case 'keyDown':
        attributes[eventName] = (event: KeyboardEvent<HTMLElement>) =>
          handler({
            key: event.key,
            code: event.code,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            repeat: event.repeat,
          });
        break;
      case 'valueChange':
      case 'valueInput':
        attributes[eventName] = (event: SyntheticEvent<HTMLElement>) =>
          handler(eventTargetValue(event));
        break;
    }
  }
  return attributes;
}

function NodeRenderer(props: NodeRendererProps): ReactNode {
  const { document, nodeId, scope } = props;
  const node = document.nodes[nodeId];
  if (!node) return null;

  const selectStructuralNode = (event: MouseEvent<HTMLElement>): void => {
    if (props.mode !== 'edit') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    props.onSelectNode?.(node.id);
  };

  const editStructure = (label: string, content: ReactNode, hasContent: boolean): ReactNode => (
    <div
      className="srijika-structure-node"
      data-srijika-node={node.id}
      data-srijika-selected={props.selectedNodeId === node.id ? 'true' : 'false'}
      data-srijika-drop-target={props.dropTargetNodeId === node.id ? 'true' : 'false'}
      style={{ display: 'contents' }}
      tabIndex={-1}
      onClick={selectStructuralNode}
    >
      <span className="srijika-structure-label">{label}</span>
      <div className="srijika-structure-content" style={{ display: 'contents' }}>
        {hasContent ? (
          content
        ) : (
          <span className="srijika-empty-structure">Drop components here</span>
        )}
      </div>
    </div>
  );

  if (node.kind === 'text' || node.kind === 'expression') {
    const content = toReactNode(
      evaluateExpression(node.kind === 'text' ? node.value : node.expression, scope),
    );
    return props.mode === 'edit' ? (
      <span
        className="srijika-inline-node"
        data-srijika-node={node.id}
        data-srijika-selected={props.selectedNodeId === node.id ? 'true' : 'false'}
        data-srijika-drop-target={props.dropTargetNodeId === node.id ? 'true' : 'false'}
        tabIndex={-1}
        onClick={selectStructuralNode}
      >
        {content}
      </span>
    ) : (
      content
    );
  }
  if (node.kind === 'fragment') {
    const content = (
      <Fragment key={node.id}>
        {node.children.map((childId) => (
          <NodeRenderer key={childId} {...props} nodeId={childId} />
        ))}
      </Fragment>
    );
    return props.mode === 'edit'
      ? editStructure('FRAGMENT', content, node.children.length > 0)
      : content;
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
      ? editStructure(
          `IF · ${branchName === 'whenTrue' ? 'TRUE' : 'FALSE'} BRANCH`,
          content,
          branch.length > 0,
        )
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
        items.length > 0
          ? items.slice(0, EDIT_REPEAT_ITEM_LIMIT)
          : node.children.length > 0
            ? [undefined]
            : [];
      const label =
        items.length > EDIT_REPEAT_ITEM_LIMIT
          ? `REPEAT · ${EDIT_REPEAT_ITEM_LIMIT} OF ${items.length} ITEMS`
          : `REPEAT · ${items.length} ITEMS`;
      return editStructure(label, renderItems(designItems), designItems.length > 0);
    }
    return renderItems(items);
  }
  if (node.kind === 'slot') {
    const content = node.fallback.map((childId) => (
      <NodeRenderer key={childId} {...props} nodeId={childId} />
    ));
    return props.mode === 'edit'
      ? editStructure(`SLOT · ${node.slotName}`, content, node.fallback.length > 0)
      : content;
  }

  if (!evaluateExpression(node.visible, scope)) return null;
  const definition = props.registry.get(node.componentId);
  if (!definition) {
    return props.mode === 'edit' ? (
      <div
        className="srijika-missing-component"
        data-srijika-node={node.id}
        data-srijika-selected={props.selectedNodeId === node.id ? 'true' : 'false'}
        data-srijika-drop-target={props.dropTargetNodeId === node.id ? 'true' : 'false'}
        tabIndex={-1}
        onClick={selectStructuralNode}
      >
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
      const handler = reference ? props.events?.[reference] : undefined;
      if (!handler) return [name, undefined];
      const signature = reference ? document.symbols[reference]?.eventSignature : undefined;
      if (!signature?.payload) return [name, () => handler()];

      const argument = node.eventArguments?.[name];
      if (argument?.kind === 'expression') {
        return [
          name,
          () => {
            let value = evaluateExpression(argument.expression, scope);
            if (
              argument.expression.kind === 'reference' &&
              argument.expression.path.length === 0 &&
              !Object.hasOwn(scope.symbols, argument.expression.symbolId)
            ) {
              const symbol = document.symbols[argument.expression.symbolId];
              if (!symbol?.required && symbol?.defaultValue !== undefined) {
                value = symbol.defaultValue;
              }
            }
            handler(value);
          },
        ];
      }

      // Missing mappings are legacy normalized-payload passthrough. New
      // bindings store the equivalent eventPayload mapping explicitly.
      return [name, (payload: unknown) => handler(payload)];
    }),
  );

  const onEditorClick = (event: MouseEvent<HTMLElement>): void => {
    if (props.mode !== 'edit') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
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

  const staticClassName = node.classRefs.join(' ');
  const dynamicClassName =
    typeof values['className'] === 'string' ? values['className'].trim() : '';
  const className = [staticClassName, dynamicClassName].filter(Boolean).join(' ');
  const style = {
    ...srijikaResponsiveStyle(node.style, props.viewportWidth ?? SRIJIKA_DEFAULT_VIEWPORT_WIDTH),
    ...srijikaStyle(values['style']),
  };
  const addedAttributes = instanceAttributes(node, values, events);

  return definition.implementation({
    nodeId: node.id,
    values,
    events,
    style,
    className,
    instanceAttributes: addedAttributes,
    children,
    slots,
    editorAttributes:
      props.mode === 'edit'
        ? {
            'data-srijika-node': node.id,
            'data-srijika-component': node.componentId,
            'data-srijika-selected': props.selectedNodeId === node.id ? 'true' : 'false',
            'data-srijika-drop-target': props.dropTargetNodeId === node.id ? 'true' : 'false',
            'data-srijika-empty-container':
              node.slots['children'] && node.slots['children'].length === 0 ? 'true' : 'false',
            tabIndex: -1,
            onClick: onEditorClick,
          }
        : {},
  });
}

export function SrijikaRenderer(props: SrijikaRendererProps): ReactNode {
  const scope: EvaluationScope = { symbols: props.symbols ?? {} };
  const viewportWidth = useSrijikaViewportWidth(props.viewportWidth);
  return (
    <NodeRenderer
      {...props}
      viewportWidth={viewportWidth}
      nodeId={props.document.rootNodeId}
      scope={scope}
    />
  );
}
