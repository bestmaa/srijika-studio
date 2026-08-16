import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const projectArgument = process.argv[2];
if (!projectArgument) throw new Error('Pass the generated Srijika project path.');
const project = resolve(projectArgument);
const useLocalBundle = process.argv.includes('--local');
const expectClean = process.argv.includes('--expect-clean');
const applyAudit = process.argv.includes('--apply-audit');
const config = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8'));
const configured = config?.mcpServers?.['srijika-project'];
assert.equal(typeof configured?.command, 'string', 'Missing srijika-project MCP command');
assert(Array.isArray(configured?.args), 'Missing srijika-project MCP arguments');

const localBundle = join(workspace, 'plugins/srijika-studio/mcp-server/srijika-mcp.mjs');
const command = useLocalBundle ? process.execPath : configured.command;
const args = useLocalBundle
  ? [localBundle, '--project', project]
  : configured.args.map((argument) => (argument === '.' ? project : argument));
const configuredCwd = configured.cwd ?? '.';
const cwd = isAbsolute(configuredCwd) ? configuredCwd : resolve(project, configuredCwd);
const transport = new StdioClientTransport({ command, args, cwd, stderr: 'pipe' });
let transportStderr = '';
transport.stderr?.on('data', (chunk) => {
  transportStderr += chunk.toString('utf8');
});
const client = new Client({ name: 'srijika-generated-project-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const resources = await client.listResources();
  assert(tools.tools.some(({ name }) => name === 'srijika_get_code_project'));
  assert(tools.tools.some(({ name }) => name === 'srijika_check_code_project'));
  assert(resources.resources.some(({ uri }) => uri === 'srijika://docs/code-first-architecture'));

  const inspected = await client.callTool({ name: 'srijika_get_code_project', arguments: {} });
  assert.equal(inspected.isError, undefined, JSON.stringify(inspected));
  let appliedFiles = 0;
  if (applyAudit) {
    const planned = await client.callTool({
      name: 'srijika_plan_code_structure',
      arguments: {
        kind: 'feature',
        name: 'McpAudit',
        optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
      },
    });
    assert.equal(planned.isError, undefined, JSON.stringify(planned));
    const planId = planned.structuredContent?.result?.planId;
    assert.equal(typeof planId, 'string');
    const applied = await client.callTool({
      name: 'srijika_apply_code_structure',
      arguments: { planId },
    });
    assert.equal(applied.isError, undefined, JSON.stringify(applied));
    appliedFiles = applied.structuredContent?.result?.created?.length ?? 0;
  }
  const checked = await client.callTool({ name: 'srijika_check_code_project', arguments: {} });
  assert.equal(checked.isError, undefined, JSON.stringify(checked));
  const diagnostics = checked.structuredContent?.result?.diagnostics ?? [];
  if (expectClean) assert.deepEqual(diagnostics, []);

  process.stdout.write(
    `${JSON.stringify(
      {
        transport: useLocalBundle ? 'local-next-release' : 'generated-config',
        projectName: inspected.structuredContent?.result?.projectName,
        tools: tools.tools.length,
        resources: resources.resources.length,
        appliedFiles,
        diagnostics: diagnostics.length,
        diagnosticIds: diagnostics.map((diagnostic) => diagnostic.ruleId ?? diagnostic.code),
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  if (transportStderr) process.stderr.write(transportStderr);
  throw error;
} finally {
  await client.close().catch(() => undefined);
}
