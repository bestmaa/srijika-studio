import * as ts from 'typescript';

/**
 * One shared complexity policy for Studio, the VS Code extension, and every
 * other consumer of the Srijika TSX compiler.
 */
export const SRIJIKA_UI_COMPLEXITY_POLICY = Object.freeze({
  maxComponentMeaningfulLines: 200,
  maxFileMeaningfulLines: 300,
  maxTopLevelContractMembers: 16,
});

function isCommentLikeNode(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/**
 * Counts source lines containing real syntax tokens within an AST node.
 * Blank lines, comments, and JSDoc do not count. A token spanning multiple
 * lines counts only the non-blank source lines it actually occupies.
 */
export function countMeaningfulLines(sourceFile: ts.SourceFile, root: ts.Node): number {
  const lines = new Set<number>();

  const visit = (node: ts.Node): void => {
    if (isCommentLikeNode(node)) return;
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;

    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (end <= start) return;

    const startLine = sourceFile.getLineAndCharacterOfPosition(start).line;
    const endLine = sourceFile.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line;
    for (let line = startLine; line <= endLine; line += 1) {
      const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
      const nextLineStart =
        line + 1 < sourceFile.getLineStarts().length
          ? sourceFile.getPositionOfLineAndCharacter(line + 1, 0)
          : sourceFile.text.length;
      const sliceStart = Math.max(start, lineStart);
      const sliceEnd = Math.min(end, nextLineStart);
      if (/\S/u.test(sourceFile.text.slice(sliceStart, sliceEnd))) lines.add(line);
    }
  };

  visit(root);
  return lines.size;
}
