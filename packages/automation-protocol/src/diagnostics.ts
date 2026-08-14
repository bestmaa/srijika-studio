import type { ComponentRegistry, DocumentDiagnostic } from '@srijika/component-registry';
import { analyzeDocument } from '@srijika/component-registry';
import { validateUiDocument, type UiDocument } from '@srijika/contracts';
import type { GraphDiagnostic } from '@srijika/document-engine';
import { validateDocumentGraph } from '@srijika/document-engine';

import { DOCUMENT_FORMAT_VERSION } from './version';

export type AutomationErrorCode =
  | 'revision-conflict'
  | 'empty-operation-batch'
  | 'duplicate-operation-id'
  | 'invalid-operation'
  | 'operation-failed'
  | 'node-not-found'
  | 'component-not-found'
  | 'document-id-mismatch'
  | 'document-format-version-mismatch'
  | 'graph-validation-failed'
  | 'semantic-validation-failed'
  | 'migration-path-not-found'
  | 'duplicate-adapter';

export type AutomationDiagnosticCode =
  | AutomationErrorCode
  | `schema:${string}`
  | `graph:${GraphDiagnostic['code']}`
  | `semantic:${DocumentDiagnostic['code']}`;

export interface AutomationDiagnostic {
  code: AutomationDiagnosticCode;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  nodeId?: string;
  symbolId?: string;
  operationIndex?: number;
  operationId?: string;
}

function graphDiagnostic(diagnostic: GraphDiagnostic): AutomationDiagnostic {
  return {
    code: `graph:${diagnostic.code}`,
    severity: 'error',
    message: diagnostic.message,
    ...(diagnostic.nodeId === undefined ? {} : { nodeId: diagnostic.nodeId }),
  };
}

function semanticDiagnostic(diagnostic: DocumentDiagnostic): AutomationDiagnostic {
  return {
    code: `semantic:${diagnostic.code}`,
    severity: diagnostic.severity,
    message: diagnostic.message,
    path: diagnostic.path,
    ...(diagnostic.nodeId === undefined ? {} : { nodeId: diagnostic.nodeId }),
    ...(diagnostic.symbolId === undefined ? {} : { symbolId: diagnostic.symbolId }),
  };
}

export function validateAutomationDocument<TImplementation>(
  document: UiDocument,
  registry: ComponentRegistry<TImplementation>,
): AutomationDiagnostic[] {
  const formatVersion = Number(document.formatVersion);
  if (formatVersion !== DOCUMENT_FORMAT_VERSION) {
    return [
      {
        code: 'document-format-version-mismatch',
        severity: 'error',
        message: `Document format ${formatVersion} is not supported; expected ${DOCUMENT_FORMAT_VERSION}`,
        path: 'formatVersion',
      },
    ];
  }

  const schema = validateUiDocument(document);
  if (!schema.valid) {
    return schema.errors.map((error) => ({
      code: `schema:${error.keyword}`,
      severity: 'error',
      message: error.message ?? 'Document does not match the canonical Srijika schema',
      path: error.instancePath || '/',
    }));
  }

  const graph = validateDocumentGraph(document).map(graphDiagnostic);
  if (graph.length > 0) return graph;
  return analyzeDocument(document, registry).map(semanticDiagnostic);
}

export function hasAutomationErrors(diagnostics: readonly AutomationDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
