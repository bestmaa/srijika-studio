import { printNativeCheck } from './project.js';

try {
  const args = process.argv.slice(2);
  if (
    args.some((argument) => argument.startsWith('--') && argument !== '--json') ||
    args.filter((argument) => argument !== '--json').length > 1
  )
    throw new Error('Usage: node .srijika/native/check.mjs [project] [--json]');
  process.exitCode = await printNativeCheck(
    args.find((argument) => argument !== '--json') ?? process.cwd(),
    args.includes('--json'),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
