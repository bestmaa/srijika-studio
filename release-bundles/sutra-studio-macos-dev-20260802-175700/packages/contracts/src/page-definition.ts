import type { UiDocument } from './schemas';

/**
 * A project page owns exactly one canonical UI document. Page-level metadata is intentionally
 * small: the document remains the sole source of truth for nodes, props, expressions and styles.
 */
export interface PageDefinition {
  id: string;
  name: string;
  functionName: string;
  width: 100;
  height: 100;
  locked: true;
  document: UiDocument;
}
