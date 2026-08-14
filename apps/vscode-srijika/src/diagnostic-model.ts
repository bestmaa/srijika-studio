import type {
  SrijikaDiagnostic,
  SrijikaDiagnosticSeverity,
  SrijikaQuickFix,
  SrijikaSourceEdit,
  SrijikaSourceSpan,
} from '@srijika/tsx-compiler';

export interface EditorPosition {
  line: number;
  character: number;
}

export interface EditorRange {
  start: EditorPosition;
  end: EditorPosition;
}

export interface EditorTextEdit {
  range: EditorRange;
  newText: string;
}

export interface EditorQuickFix {
  title: string;
  kind: SrijikaQuickFix['kind'];
  edits: readonly EditorTextEdit[];
}

export interface EditorDiagnostic {
  code: SrijikaDiagnostic['code'];
  severity: SrijikaDiagnosticSeverity;
  message: string;
  range: EditorRange;
  quickFixes: readonly EditorQuickFix[];
}

export type PositionResolver = (offset: number) => EditorPosition;

function clampOffset(source: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(source.length, Math.max(0, Math.trunc(offset)));
}

/** Converts a UTF-16 source offset to the zero-based coordinates VS Code uses. */
export function positionAt(source: string, rawOffset: number): EditorPosition {
  const offset = clampOffset(source, rawOffset);
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13 /* \r */) {
      if (source.charCodeAt(index + 1) === 10 /* \n */) index += 1;
      lineStarts.push(index + 1);
    } else if (code === 10 /* \n */) {
      lineStarts.push(index + 1);
    }
  }

  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) > offset) high = middle;
    else low = middle + 1;
  }

  const line = Math.max(0, low - 1);
  return { line, character: offset - (lineStarts[line] ?? 0) };
}

export function sourceSpanToRange(
  source: string,
  span: Pick<SrijikaSourceSpan, 'start' | 'end'>,
  resolvePosition: PositionResolver = (offset) => positionAt(source, offset),
): EditorRange {
  const startOffset = clampOffset(source, span.start);
  const endOffset = Math.max(startOffset, clampOffset(source, span.end));
  return {
    start: resolvePosition(startOffset),
    end: resolvePosition(endOffset),
  };
}

export function sourceEditToEditorEdit(
  source: string,
  edit: SrijikaSourceEdit,
  resolvePosition?: PositionResolver,
): EditorTextEdit {
  return {
    range: sourceSpanToRange(source, edit, resolvePosition),
    newText: edit.newText,
  };
}

export function quickFixToEditorQuickFix(
  source: string,
  quickFix: SrijikaQuickFix,
  resolvePosition?: PositionResolver,
): EditorQuickFix {
  return {
    title: quickFix.title,
    kind: quickFix.kind,
    edits: quickFix.edits.map((edit) => sourceEditToEditorEdit(source, edit, resolvePosition)),
  };
}

export function diagnosticToEditorDiagnostic(
  source: string,
  diagnostic: SrijikaDiagnostic,
  resolvePosition?: PositionResolver,
): EditorDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    range: sourceSpanToRange(source, diagnostic.span, resolvePosition),
    quickFixes: (diagnostic.quickFixes ?? []).map((quickFix) =>
      quickFixToEditorQuickFix(source, quickFix, resolvePosition),
    ),
  };
}

export function rangesEqual(left: EditorRange, right: EditorRange): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}
