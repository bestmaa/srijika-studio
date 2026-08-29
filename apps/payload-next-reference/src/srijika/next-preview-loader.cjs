// @srijika-next-live-preview-v1
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

module.exports = function srijikaNextPreviewLoader(source) {
  if (process.env.NODE_ENV !== 'development') return source;
  const root = this.rootContext;
  const resource = path.resolve(this.resourcePath);
  const relativePath = path.relative(root, resource).replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath))
    return source;
  const config = JSON.parse(fs.readFileSync(path.join(root, 'srijika.config.json'), 'utf8'));
  const architecture = config.architecture ?? {};
  const roots = [
    architecture.featuresRoot ?? 'src/features',
    architecture.sharedRoot ?? 'src/shared',
  ];
  const suffix = architecture.uiSuffix ?? '.ui.tsx';
  if (
    !relativePath.endsWith(suffix) ||
    (relativePath !== config.entry &&
      !roots.some((ownerRoot) => relativePath.startsWith(ownerRoot + '/')))
  ) {
    return source;
  }
  const sourceFile = ts.createSourceFile(
    resource,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const insertions = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const existing = node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === 'data-srijika-source',
      );
      if (!existing) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        insertions.push({
          offset: node.tagName.end,
          text: ` data-srijika-source="${relativePath}:${location.line + 1}:${location.character + 1}"`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return insertions
    .sort((left, right) => right.offset - left.offset)
    .reduce(
      (result, insertion) =>
        result.slice(0, insertion.offset) + insertion.text + result.slice(insertion.offset),
      source,
    );
};
