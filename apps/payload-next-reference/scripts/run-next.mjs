import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'next.cmd' : 'next';
const [mode, ...rawArguments] = process.argv.slice(2);
const argumentsToNext = [
  mode,
  ...(rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments),
];
const child = spawn(command, argumentsToNext, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/srijika_payload',
    PAYLOAD_REFERENCE_MODE: process.env.PAYLOAD_REFERENCE_MODE ?? 'mock',
    PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? 'local-reference-secret-change-before-deploy',
  },
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
