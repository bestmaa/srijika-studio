import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSrijikaMcpServer } from './server';

async function main(): Promise<void> {
  const server = createSrijikaMcpServer();
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 8 * 1024 * 1024,
  });
  await server.connect(transport);
  console.error('Srijika Studio MCP server ready on stdio');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Srijika Studio MCP server failed');
  process.exitCode = 1;
});
