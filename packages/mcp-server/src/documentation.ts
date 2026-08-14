import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SRIJIKA_OWNER_FILE_CONTRACT,
  SRIJIKA_STRUCTURE_CREATION_MATRIX,
} from '@srijika/architecture-rules/creation';
import {
  CAPABILITIES,
  DOCUMENT_FORMAT_VERSION,
  PROTOCOL_VERSION,
  SRIJIKA_RPC_METHODS,
  SRIJIKA_TOOL_NAMES,
  TOOL_VERSION,
} from '@srijika/automation-protocol';

interface DocumentationResource {
  uri: string;
  title: string;
  description: string;
  value: Record<string, unknown>;
}

export const SRIJIKA_DOCUMENTATION: readonly DocumentationResource[] = [
  {
    uri: 'srijika://docs/protocol',
    title: 'Srijika automation protocol',
    description: 'Versioned tool, RPC, capability, and compatibility contract.',
    value: {
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      toolVersion: TOOL_VERSION,
      documentFormatVersion: DOCUMENT_FORMAT_VERSION,
      capabilities: CAPABILITIES,
      rpcMethods: SRIJIKA_RPC_METHODS,
      toolNames: SRIJIKA_TOOL_NAMES,
      writeContract: {
        atomic: true,
        requiresExpectedRevision: true,
        onConflict: 'refetch-rebase-retry-once',
        validatesBeforeCommit: true,
      },
    },
  },
  {
    uri: 'srijika://docs/document-model',
    title: 'Srijika document model',
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
    uri: 'srijika://docs/design-plan',
    title: 'Srijika design plan contract',
    description: 'How Codex converts a visible design into a compact atomic operation plan.',
    value: {
      schemaVersion: 1,
      canonicalTool: SRIJIKA_TOOL_NAMES.importDesignPlan,
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
  {
    uri: 'srijika://docs/code-first-architecture',
    title: 'Srijika code-first architecture',
    description:
      'Machine-readable Feature, Slot, and Part ownership and progressive behavior-chain contract.',
    value: {
      schemaVersion: 1,
      contractId: 'srijika.progressive-behavior-chain',
      ownerKinds: ['feature', 'slot', 'part'],
      ownerContract: {
        required: SRIJIKA_OWNER_FILE_CONTRACT.required,
        optional: SRIJIKA_OWNER_FILE_CONTRACT.optional,
        canonicalFiles: {
          ui: '{Owner}.ui.tsx',
          connector: '{Owner}.connector.tsx',
          hook: 'use{Owner}.ts',
          store: '{owner}.store.ts',
          logic: '{owner}.logic.ts',
          api: '{owner}.api.ts',
          types: '{owner}.types.ts',
        },
        privateHelperHooks:
          'hooks/ may contain owner-private helper hooks; use{Owner}.ts is the public gateway.',
      },
      creation: {
        contractVersion: 1,
        triggers: ['studio-folder-plus', 'studio-folder-context-menu', 'vscode-explorer-context'],
        ownerActions: SRIJIKA_STRUCTURE_CREATION_MATRIX,
        compositeOwners: {
          feature: {
            parent: 'src/features',
            required: SRIJIKA_OWNER_FILE_CONTRACT.required,
            selectable: SRIJIKA_OWNER_FILE_CONTRACT.optional,
          },
          slot: {
            parent: 'feature-root',
            required: SRIJIKA_OWNER_FILE_CONTRACT.required,
            selectable: SRIJIKA_OWNER_FILE_CONTRACT.optional,
          },
          part: {
            parent: 'slot-root',
            required: SRIJIKA_OWNER_FILE_CONTRACT.required,
            selectable: SRIJIKA_OWNER_FILE_CONTRACT.optional,
          },
        },
        naming: {
          owner: 'normalized PascalCase',
          folder: 'derived kebab-case',
          alternateNamesAllowed: false,
        },
        writePolicy: {
          preflightAllPaths: true,
          overwrite: false,
          coherentBatch: true,
          arbitraryFolders: false,
        },
      },
      capabilityOrder: ['connector', 'hook', 'store', 'logic', 'api'],
      resolution: {
        connector: ['hook', 'store', 'logic', 'api'],
        hook: ['store', 'logic', 'api'],
        store: ['logic', 'api'],
        logic: ['api'],
        api: ['sharedHttp', 'backend'],
      },
      rules: {
        highestAvailable:
          'Call the first capability present in the ordered resolution list for the same owner and behavior.',
        noJump: 'Never skip an available intermediate capability for the same owner and behavior.',
        returnPath: 'Return results through the same chain and map them to typed UI props.',
        uiIsolation: 'Only the matching Connector renders a UI; UI does not import runtime layers.',
        composition:
          'Feature Connectors compose Slot Connectors; Slot Connectors compose Part Connectors. Parents do not render child UI files directly.',
      },
      promotion: [
        { from: 'one-part', when: 'two sibling Parts need it', to: 'slot-root' },
        { from: 'one-slot', when: 'two sibling Slots need it', to: 'feature-root' },
        { from: 'one-feature', when: 'two Features need it', to: 'src/shared' },
      ],
      cacheAndState: {
        hook: ['TanStack Query', 'server cache', 'retry', 'refetch', 'mutations', 'effects'],
        store: ['shared client state', 'selectors', 'synchronous transitions', 'owner actions'],
        invariant: 'Do not mirror one server entity in both Query cache and Zustand.',
      },
      diagnostics: {
        errors: [
          'SRIJIKA-ARCH-MISSING-UI',
          'SRIJIKA-ARCH-MISSING-CONNECTOR',
          'SRIJIKA-ARCH-LAYER-JUMP',
          'SRIJIKA-ARCH-UI-RUNTIME-IMPORT',
          'SRIJIKA-ARCH-PRIVATE-IMPORT',
          'SRIJIKA-ARCH-DIRECT-CHILD-UI',
          'SRIJIKA-ARCH-REVERSE-DEPENDENCY',
        ],
        recommendations: {
          deterministicVersion: 1,
          blocking: false,
          entries: [
            {
              code: 'SRIJIKA-ARCH-RECOMMEND-LOGIC',
              trigger:
                'two or more endpoint calls, business branching, validation, authorization, transformation, aggregation, or multi-step orchestration',
            },
            {
              code: 'SRIJIKA-ARCH-RECOMMEND-HOOK',
              trigger:
                'cache/retry/polling/cancellation/subscription/pagination/mutation lifecycle, two or more async handlers, or three or more React lifecycle hooks',
            },
            {
              code: 'SRIJIKA-ARCH-RECOMMEND-STORE',
              trigger:
                'state used by two or more descendants, props cross two ownership boundaries, or four or more related local state fields',
            },
            {
              code: 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE',
              trigger:
                'five or more Store selectors/actions consumed by a Connector, or Store actions own async lifecycle/cache responsibilities',
            },
            {
              code: 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER',
              trigger: 'the same private capability is imported or duplicated by sibling owners',
            },
            {
              code: 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
              trigger:
                'UI function exceeds 200 meaningful lines, UI file exceeds 300, or public contract exceeds 16 top-level members',
            },
          ],
        },
      },
    },
  },
  {
    uri: 'srijika://docs/cli-runtime',
    title: 'Srijika CLI and fast runtime',
    description:
      'Machine-readable shared CLI, VS Code, Desktop handoff, Vite, Node, and optional Bun contract.',
    value: {
      schemaVersion: 1,
      contractId: 'srijika.fast-developer-workflow',
      adapters: ['cli', 'vscode', 'desktop', 'codex-mcp'],
      engineResponsibilities: [
        'project-detection',
        'lockfile-detection',
        'runtime-selection',
        'ownership-scaffold-planning',
        'incremental-architecture-validation',
        'vite-command-planning',
        'software-independent-mcp-project-context',
      ],
      runtime: {
        default: 'node',
        optional: ['bun'],
        bunActivation: 'explicit-and-vite-only',
        incompatibleFallback: 'node-with-reason',
        dependencyResolutionIndependent: true,
        reactExecution: 'browser',
      },
      commands: {
        create:
          'complete CLI-first onboarding: scaffold, install, validate, VS Code setup, optional Studio handoff',
        init: 'create a pinned non-overwriting project',
        add: 'create only canonical Feature, Slot, Part, or owner capability files',
        check: 'validate the configured ownership subtree in-process',
        doctor: 'inspect runtimes, package manager, lockfile, and scripts',
        install: 'install exactly from the detected lockfile',
        dev: 'start the real strict-port Vite HMR application',
        build: 'run the project build script',
        studio: 'launch Desktop with --project for bounded native opening',
      },
      safety: {
        overwrite: false,
        arbitraryOwnerFolders: false,
        runtimeChangesLockfile: false,
        bunRequired: false,
        desktopRequiredForCliOrVscode: false,
        desktopRequiredForCodeProjectMcp: false,
      },
      mcp: {
        config: '.mcp.json',
        instructions: 'AGENTS.md',
        tools: [
          'srijika_get_code_project',
          'srijika_check_code_project',
          'srijika_plan_code_structure',
          'srijika_apply_code_structure',
        ],
        studioBridgeOptional: true,
      },
    },
  },
] as const;

export function registerSrijikaDocumentation(server: McpServer): void {
  for (const resource of SRIJIKA_DOCUMENTATION) {
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
