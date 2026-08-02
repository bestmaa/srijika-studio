import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CAPABILITIES,
  DOCUMENT_FORMAT_VERSION,
  PROTOCOL_VERSION,
  SUTRA_RPC_METHODS,
  SUTRA_TOOL_NAMES,
  TOOL_VERSION,
} from '@sutra/automation-protocol';

interface DocumentationResource {
  uri: string;
  title: string;
  description: string;
  value: Record<string, unknown>;
}

export const SUTRA_DOCUMENTATION: readonly DocumentationResource[] = [
  {
    uri: 'sutra://docs/protocol',
    title: 'Sutra automation protocol',
    description: 'Versioned tool, RPC, capability, and compatibility contract.',
    value: {
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      toolVersion: TOOL_VERSION,
      documentFormatVersion: DOCUMENT_FORMAT_VERSION,
      capabilities: CAPABILITIES,
      rpcMethods: SUTRA_RPC_METHODS,
      toolNames: SUTRA_TOOL_NAMES,
      writeContract: {
        atomic: true,
        requiresExpectedRevision: true,
        onConflict: 'refetch-rebase-retry-once',
        validatesBeforeCommit: true,
      },
    },
  },
  {
    uri: 'sutra://docs/document-model',
    title: 'Sutra document model',
    description: 'Compact canonical AST model used by Studio, renderers, codegen, and tools.',
    value: {
      schemaVersion: 1,
      documentFormatVersion: DOCUMENT_FORMAT_VERSION,
      topLevelFields: [
        'formatVersion',
        'id',
        'kind',
        'name',
        'rootNodeId',
        'revision',
        'nodes',
        'symbols',
        'publicProps',
      ],
      nodeKinds: ['element', 'text', 'expression', 'fragment', 'if', 'repeat', 'slot'],
      expressionKinds: [
        'literal',
        'reference',
        'unary',
        'binary',
        'conditional',
        'template',
        'customCodeReference',
      ],
      invariants: [
        'one locked page root',
        'one parent per non-root node',
        'acyclic and fully reachable graph',
        'registered component ports or approved instance ports',
        'typed visible symbol references',
        'logic enters UI through declared props and events',
      ],
    },
  },
  {
    uri: 'sutra://docs/design-plan',
    title: 'Sutra design plan contract',
    description: 'How Codex converts a visible design into a compact atomic operation plan.',
    value: {
      schemaVersion: 1,
      canonicalTool: SUTRA_TOOL_NAMES.importDesignPlan,
      imageHandling:
        'Codex analyzes the supplied image; the local bridge receives structured JSON operations only.',
      planFields: [
        'pageId',
        'expectedRevision',
        'planId',
        'phase',
        'source',
        'requiredRegions',
        'acceptance',
        'assumptions',
        'operations',
      ],
      phases: ['geometry', 'content', 'styling', 'correction', 'final'],
      metadataContract:
        'requiredRegions and acceptance are echoed caller-enforced metadata; verify them with layout and capture reads.',
      operationContract:
        'Components, public props, events, Repeat/If structure, and responsive breakpoint styles belong inside operations.',
      verification: [
        'validate document',
        'read diagnostics',
        'render exact source viewport',
        'inspect computed layout and overflow',
        'capture clean PNG',
        'compare and correct largest mismatch',
      ],
    },
  },
] as const;

export function registerSutraDocumentation(server: McpServer): void {
  for (const resource of SUTRA_DOCUMENTATION) {
    server.registerResource(
      resource.title,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: 'application/json',
      },
      () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: 'application/json',
            text: JSON.stringify(resource.value, null, 2),
          },
        ],
      }),
    );
  }
}
