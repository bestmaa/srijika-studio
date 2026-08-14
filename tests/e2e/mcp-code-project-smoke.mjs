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
