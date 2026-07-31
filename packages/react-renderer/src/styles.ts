import type { CSSProperties } from 'react';

import type { LengthValue, StyleProperties } from '@sutra/contracts';

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

const flexAlignment = (value: 'stretch' | 'start' | 'center' | 'end' | undefined) => {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
};

const flexJustification = (value: 'start' | 'center' | 'end' | 'space-between' | undefined) => {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
};

export function stylePropertiesToCss(style: StyleProperties): CSSProperties {
  return {
    display: style.display,
    flexDirection: style.flexDirection,
    alignItems: flexAlignment(style.alignItems),
    justifyContent: flexJustification(style.justifyContent),
    width: lengthToCss(style.width),
    height: lengthToCss(style.height),
    minWidth: style.minWidth,
    maxWidth: style.maxWidth,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
    gap: style.gap,
    padding: style.padding
      ? `${style.padding.top}px ${style.padding.right}px ${style.padding.bottom}px ${style.padding.left}px`
      : undefined,
    margin: style.margin
      ? `${style.margin.top}px ${style.margin.right}px ${style.margin.bottom}px ${style.margin.left}px`
      : undefined,
    backgroundColor: style.backgroundColor,
    color: style.color,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle: style.borderWidth ? 'solid' : undefined,
    borderRadius: style.borderRadius,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    textAlign: style.textAlign,
    overflowWrap: style.overflowWrap,
    overflow: style.overflow,
    boxSizing: 'border-box',
  };
}
