import type { StyleDeclaration, StyleProperties } from './schemas';

/**
 * Sutra uses desktop-first named breakpoints so a design can keep its exact
 * source geometry in `base` and add only the overrides required at other
 * viewport sizes. `tablet` cascades into `mobile`; `desktop` cascades into
 * `wide`, with the more specific breakpoint applied last.
 */
export const SUTRA_NAMED_BREAKPOINTS = {
  mobile: { kind: 'max', width: 639 },
  tablet: { kind: 'max', width: 1023 },
  desktop: { kind: 'min', width: 1024 },
  wide: { kind: 'min', width: 1440 },
} as const;

export type SutraNamedBreakpoint = keyof typeof SUTRA_NAMED_BREAKPOINTS;

interface ParsedBreakpoint {
  key: string;
  kind: 'max' | 'min';
  width: number;
  style: StyleProperties;
}

const NAMED_BREAKPOINT_ALIASES: Readonly<
  Record<string, (typeof SUTRA_NAMED_BREAKPOINTS)[SutraNamedBreakpoint]>
> = {
  sm: SUTRA_NAMED_BREAKPOINTS.mobile,
  md: SUTRA_NAMED_BREAKPOINTS.tablet,
  lg: SUTRA_NAMED_BREAKPOINTS.desktop,
  xl: SUTRA_NAMED_BREAKPOINTS.wide,
};

function numericWidth(value: string | undefined): number | null {
  if (!value) return null;
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? width : null;
}

function parseBreakpoint(key: string, style: StyleProperties): ParsedBreakpoint | null {
  const normalized = key.trim().toLowerCase();
  const named =
    SUTRA_NAMED_BREAKPOINTS[normalized as SutraNamedBreakpoint] ??
    NAMED_BREAKPOINT_ALIASES[normalized];
  if (named) return { key, ...named, style };

  // A plain number is the legacy shorthand for a max-width breakpoint.
  const legacyWidth = numericWidth(normalized);
  if (legacyWidth !== null) return { key, kind: 'max', width: legacyWidth, style };

  // Accept compact tool-friendly keys (`max:900`, `min-1200`) and the common
  // CSS media-query spelling used by imported design plans.
  const match = normalized.match(
    /(?:@media\s*\()?\s*(min|max)(?:-?width)?\s*[:=-]\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*\)?/,
  );
  const width = numericWidth(match?.[2]);
  if (!match?.[1] || width === null) return null;
  return { key, kind: match[1] as 'max' | 'min', width, style };
}

function activeBreakpoints(
  declaration: StyleDeclaration,
  viewportWidth: number,
): ParsedBreakpoint[] {
  if (!declaration.breakpoints || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return [];

  const active = Object.entries(declaration.breakpoints)
    .map(([key, style]) => parseBreakpoint(key, style))
    .filter((entry): entry is ParsedBreakpoint => entry !== null)
    .filter((entry) =>
      entry.kind === 'max' ? viewportWidth <= entry.width : viewportWidth >= entry.width,
    );

  // Broad rules are applied before narrow rules. Min-width rules intentionally
  // follow max-width rules when authors combine the two strategies.
  return active.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'max' ? -1 : 1;
    if (left.kind === 'max') return right.width - left.width || left.key.localeCompare(right.key);
    return left.width - right.width || left.key.localeCompare(right.key);
  });
}

export function activeResponsiveBreakpointKeys(
  declaration: StyleDeclaration,
  viewportWidth: number,
): string[] {
  return activeBreakpoints(declaration, viewportWidth).map((entry) => entry.key);
}

/** Resolve a style declaration without mutating the canonical document. */
export function resolveResponsiveStyle(
  declaration: StyleDeclaration,
  viewportWidth: number,
): StyleProperties {
  return activeBreakpoints(declaration, viewportWidth).reduce<StyleProperties>(
    (resolved, entry) => ({ ...resolved, ...entry.style }),
    { ...declaration.base },
  );
}
