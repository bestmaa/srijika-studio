import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const bundle = join(workspace, 'plugins/srijika-studio/mcp-server/srijika-mcp.mjs');
const cli = join(workspace, 'packages/cli/dist/cli.mjs');
const temporary = await mkdtemp(join(tmpdir(), 'srijika-mcp-code-'));
const project = join(temporary, 'app');

const initialized = spawnSync(process.execPath, [cli, 'init', project], {
  cwd: workspace,
  encoding: 'utf8',
});
assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle, '--project', project],
  cwd: workspace,
  stderr: 'pipe',
});
let transportStderr = '';
transport.stderr?.on('data', (chunk) => {
  transportStderr += chunk.toString('utf8');
});
const client = new Client({ name: 'srijika-code-project-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const inspected = await client.callTool({ name: 'srijika_get_code_project', arguments: {} });
  assert.equal(inspected.isError, undefined, JSON.stringify(inspected));
  assert.equal(inspected.structuredContent.result.projectName, 'app');
  assert.deepEqual(inspected.structuredContent.result.ownershipRoots, [
    'src/features',
    'src/shared',
  ]);

  const architecture = await client.readResource({
    uri: 'srijika://docs/code-first-architecture',
  });
  const architectureContract = JSON.parse(architecture.contents[0].text);
  assert.deepEqual(architectureContract.sharedOwnerContract.kinds['shared-ui'].required, ['ui']);
  assert.equal(
    architectureContract.sharedOwnerContract.kinds['shared-capability'].runtimeMinimum,
    1,
  );
  assert.deepEqual(architectureContract.ownerContract.uiBoundary.directChildUiDiagnostic, {
    code: 'SRIJIKA4116',
    ruleId: 'SRIJIKA-ARCH-DIRECT-CHILD-UI',
  });
  assert.deepEqual(architectureContract.ownerContract.passiveTypes.diagnostic, {
    code: 'SRIJIKA4117',
    ruleId: 'SRIJIKA-ARCH-PASSIVE-TYPES',
  });
  assert.equal(architectureContract.ownerContract.uiBoundary.externalRuntimeBehaviorAllowed, false);
  assert.deepEqual(architectureContract.ownerContract.logicBoundary.diagnostic, {
    code: 'SRIJIKA4118',
    ruleId: 'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN',
  });
  assert.equal(architectureContract.ownerContract.logicBoundary.frameworkFree, true);
  assert(
    architectureContract.ownerContract.logicBoundary.allowed.includes(
      'pure validation and authorization decisions',
    ),
    'The MCP architecture resource must preserve pure validation inside Logic.',
  );
  assert.equal(
    architectureContract.ownerContract.passiveTypes.runtimeValueReferencesAllowed,
    false,
  );
  assert(
    architectureContract.diagnostics.errors.includes('SRIJIKA-ARCH-PASSIVE-TYPES'),
    'The MCP architecture resource must publish the passive Types hard rule.',
  );
  assert(
    architectureContract.diagnostics.errors.includes('SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN'),
    'The MCP architecture resource must publish the Logic runtime-concern hard rule.',
  );
  assert.equal(architectureContract.architectureConfiguration.safety.traversalAllowed, false);
  assert.equal(architectureContract.architectureConfiguration.safety.rootsNonOverlapping, true);
  assert.equal(architectureContract.architectureConfiguration.safety.symlinkEscapesAllowed, false);
  assert.deepEqual(architectureContract.architectureConfiguration.profilePolicy, {
    supported: 'feature-slot-part-v1',
    architectureBlockAbsent: 'use canonical defaults',
    architectureBlockPresent: 'profile is required and must exactly match supported',
    missingProfile: 'fail closed',
    unsupportedProfile: 'fail closed',
    surfaces: ['generated validator', 'CLI', 'VS Code', 'Studio', 'MCP'],
  });
  assert.equal(
    architectureContract.architectureConfiguration.runtimeParity.generatedValidator
      .readsCurrentProjectConfigAtRuntime,
    true,
  );
  assert.equal(
    architectureContract.architectureConfiguration.runtimeParity.generatedValidator
      .retainsGeneratedArchitectureSnapshot,
    false,
  );
  assert.deepEqual(architectureContract.architectureConfiguration.runtimeParity.cliWatch.watches, [
    'srijika.config.json',
    'root tsconfig.json',
    'configured entry',
    'resolved featuresRoot and sharedRoot',
    'ancestors where a future configured root may appear',
  ]);
  assert.equal(
    architectureContract.architectureConfiguration.runtimeParity.exactFilePreviews.hardcodedPaths,
    false,
  );
  assert(
    architectureContract.diagnostics.recommendations.entries.some(
      ({ code, emission }) =>
        code === 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER' &&
        emission.includes('blocking private-ownership diagnostic'),
    ),
    'The MCP architecture resource must document emitted promotion guidance.',
  );
  assert(
    architectureContract.diagnostics.recommendations.entries.some(
      ({ code, emission }) =>
        code === 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER' &&
        emission.includes('non-blocking SRIJIKA4202'),
    ),
    'The MCP architecture resource must document emitted split guidance.',
  );

  const planned = await client.callTool({
    name: 'srijika_plan_code_structure',
    arguments: {
      kind: 'feature',
      name: 'AgentAudit',
      optionalCapabilities: ['hook', 'logic', 'types'],
    },
  });
  assert.equal(planned.isError, undefined, JSON.stringify(planned));
  const planId = planned.structuredContent.result.planId;
  assert.equal(typeof planId, 'string');

  const applied = await client.callTool({
    name: 'srijika_apply_code_structure',
    arguments: { planId },
  });
  assert.equal(applied.isError, undefined, JSON.stringify(applied));
  assert.match(
    await readFile(join(project, 'src/features/agent-audit/AgentAudit.connector.tsx'), 'utf8'),
    /useAgentAudit/,
  );

  const sharedPlan = await client.callTool({
    name: 'srijika_plan_code_structure',
    arguments: {
      kind: 'shared-widget',
      name: 'CommandPalette',
      optionalCapabilities: ['hook', 'logic', 'types'],
    },
  });
  assert.equal(sharedPlan.isError, undefined, JSON.stringify(sharedPlan));
  const sharedApplied = await client.callTool({
    name: 'srijika_apply_code_structure',
    arguments: { planId: sharedPlan.structuredContent.result.planId },
  });
  assert.equal(sharedApplied.isError, undefined, JSON.stringify(sharedApplied));
  assert.match(
    await readFile(
      join(project, 'src/shared/widgets/command-palette/CommandPalette.connector.tsx'),
      'utf8',
    ),
    /useCommandPalette/,
  );

  const rejected = await client.callTool({
    name: 'srijika_plan_code_structure',
    arguments: {
      kind: 'shared-capability',
      name: 'ContractsOnly',
      optionalCapabilities: ['types'],
    },
  });
  assert.equal(rejected.isError, true, JSON.stringify(rejected));

  const checked = await client.callTool({ name: 'srijika_check_code_project', arguments: {} });
  assert.equal(checked.isError, undefined, JSON.stringify(checked));
  assert.deepEqual(checked.structuredContent.result.diagnostics, []);
  process.stdout.write('Srijika software-independent code-project MCP smoke passed\n');
} catch (error) {
  if (transportStderr) process.stderr.write(transportStderr);
  throw error;
} finally {
  await client.close().catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
}
