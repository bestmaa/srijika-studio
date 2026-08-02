import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSutraMcpServer } from './server';

async function main(): Promise<void> {
  const server = createSutraMcpServer();
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 8 * 1024 * 1024,
  });
  await server.connect(transport);
  console.error('Sutra Studio MCP server ready on stdio');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Sutra Studio MCP server failed');
  process.exitCode = 1;
});
