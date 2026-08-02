import { useSyncExternalStore, type CSSProperties } from 'react';

import {
  resolveResponsiveStyle,
  type LengthValue,
  type StyleDeclaration,
  type StyleProperties,
} from '@sutra/contracts';

export const SUTRA_DEFAULT_VIEWPORT_WIDTH = 1180;

function subscribeToViewport(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function browserViewportWidth(): number {
  if (typeof window === 'undefined') return SUTRA_DEFAULT_VIEWPORT_WIDTH;
  const documentWidth = window.document.documentElement.clientWidth;
  return documentWidth > 0 ? documentWidth : window.innerWidth || SUTRA_DEFAULT_VIEWPORT_WIDTH;
}

/**
 * Returns an explicit design-surface width when supplied, otherwise follows
 * the current browser/iframe viewport. The explicit form keeps editor canvas
 * screenshots deterministic while browser previews remain genuinely fluid.
 */
export function useSutraViewportWidth(explicitWidth?: number): number {
  const browserWidth = useSyncExternalStore(
    subscribeToViewport,
    browserViewportWidth,
    () => SUTRA_DEFAULT_VIEWPORT_WIDTH,
  );
  return explicitWidth !== undefined && Number.isFinite(explicitWidth) && explicitWidth > 0
    ? explicitWidth
    : browserWidth;
}

const sutraStyleProperties = new Set([
  'alignContent',
  'alignItems',
  'aspectRatio',
  'backgroundColor',
  'backgroundImage',
  'backgroundPosition',
  'backgroundRepeat',
  'backgroundSize',
  'backdropFilter',
  'border',
  'borderColor',
  'borderRadius',
  'borderStyle',
  'borderWidth',
  'bottom',
  'boxShadow',
  'color',
  'columnGap',
  'cursor',
  'display',
  'flexDirection',
  'flexBasis',
  'flexWrap',
  'filter',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'gap',
  'gridColumn',
  'gridRow',
  'gridTemplateColumns',
  'gridTemplateRows',
  'height',
  'inset',
  'justifySelf',
  'justifyContent',
  'left',
  'letterSpacing',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'objectFit',
  'objectPosition',
  'opacity',
  'order',
  'overflow',
  'overflowWrap',
  'overflowX',
  'overflowY',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'placeItems',
  'pointerEvents',
  'position',
  'right',
  'rowGap',
  'textAlign',
  'textDecoration',
  'textTransform',
  'top',
  'transform',
  'transformOrigin',
  'transition',
  'visibility',
  'whiteSpace',
  'width',
  'zIndex',
]);

/**
 * Converts an external page-prop value into a deliberately limited React style object.
 * Invalid containers, unknown CSS keys, nested values and executable values are ignored.
 */
export function sutraStyle(value: unknown): CSSProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      ([property, propertyValue]) =>
        sutraStyleProperties.has(property) &&
        (typeof propertyValue === 'string' || typeof propertyValue === 'number'),
    ),
  );
}

function lengthToCss(length: LengthValue | undefined): string | undefined {
  if (!length) return undefined;
  switch (length.mode) {
    case 'fixed':
      return `${length.value}${length.unit}`;
    case 'percent':
      return `${length.value}%`;
    case 'fill':
      return '100%';
    case 'hug':
      return 'fit-content';
    case 'auto':
      return 'auto';
  }
}

const flexAlignment = (value: 'auto' | 'stretch' | 'start' | 'center' | 'end' | undefined) => {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
};

const flexJustification = (
  value:
    | 'stretch'
    | 'start'
    | 'center'
    | 'end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | undefined,
) => {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
};

export function stylePropertiesToCss(style: StyleProperties): CSSProperties {
  const properties: CSSProperties = {
    display: style.display,
    flexDirection: style.flexDirection,
    flexWrap: style.flexWrap,
    flexGrow: style.flexGrow,
    flexShrink: style.flexShrink,
    flexBasis: lengthToCss(style.flexBasis),
    order: style.order,
    alignItems: flexAlignment(style.alignItems),
    alignContent: flexJustification(style.alignContent),
    alignSelf: flexAlignment(style.alignSelf),
    justifyContent: flexJustification(style.justifyContent),
    justifySelf: flexAlignment(style.justifySelf),
    placeItems: style.placeItems,
    gridTemplateColumns: style.gridTemplateColumns,
    gridTemplateRows: style.gridTemplateRows,
    gridColumn: style.gridColumn,
    gridRow: style.gridRow,
    width: lengthToCss(style.width),
    height: lengthToCss(style.height),
    minWidth: style.minWidth,
    maxWidth: style.maxWidth,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
    gap: style.gap,
    rowGap: style.rowGap,
    columnGap: style.columnGap,
    padding: style.padding
      ? `${style.padding.top}px ${style.padding.right}px ${style.padding.bottom}px ${style.padding.left}px`
      : undefined,
    margin: style.margin
      ? `${style.margin.top}px ${style.margin.right}px ${style.margin.bottom}px ${style.margin.left}px`
      : undefined,
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundSize: style.backgroundSize,
    backgroundPosition: style.backgroundPosition,
    backgroundRepeat: style.backgroundRepeat,
    color: style.color,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle: style.borderStyle ?? (style.borderWidth ? 'solid' : undefined),
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
    opacity: style.opacity,
    cursor: style.cursor,
    position: style.position,
    top: style.top,
    right: style.right,
    bottom: style.bottom,
    left: style.left,
    zIndex: style.zIndex,
    aspectRatio: style.aspectRatio,
    objectFit: style.objectFit,
    objectPosition: style.objectPosition,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textTransform: style.textTransform,
    textDecoration: style.textDecoration,
    whiteSpace: style.whiteSpace,
    textOverflow: style.textOverflow,
    overflowWrap: style.overflowWrap,
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    transform: style.transform,
    transformOrigin: style.transformOrigin,
    filter: style.filter,
    backdropFilter: style.backdropFilter,
    pointerEvents: style.pointerEvents,
    visibility: style.visibility,
    boxSizing: 'border-box',
  };
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

/** Converts base plus active breakpoint overrides into a React style object. */
export function sutraResponsiveStyle(
  declaration: StyleDeclaration,
  viewportWidth: number,
): CSSProperties {
  return stylePropertiesToCss(resolveResponsiveStyle(declaration, viewportWidth));
}
