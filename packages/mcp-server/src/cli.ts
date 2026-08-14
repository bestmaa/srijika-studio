import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSrijikaMcpServer } from './server';

function projectArgument(arguments_: readonly string[]): string | undefined {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--project') return arguments_[index + 1];
    if (argument?.startsWith('--project=')) return argument.slice('--project='.length);
  }
  return process.env['SRIJIKA_PROJECT_ROOT'];
}

async function main(): Promise<void> {
  const projectRoot = projectArgument(process.argv.slice(2));
  const server = createSrijikaMcpServer(projectRoot ? { projectRoot } : {});
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 8 * 1024 * 1024,
  });
  await server.connect(transport);
  console.error('Srijika CLI-first and Studio MCP server ready on stdio');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Srijika MCP server failed');
  process.exitCode = 1;
});
