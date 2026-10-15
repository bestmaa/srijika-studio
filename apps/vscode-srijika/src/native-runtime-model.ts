export function nativeEditorRuntimePlan(
  root: string,
  kind: 'dev' | 'install',
  options: { port?: number; connection?: 'lan' | 'tunnel'; windows?: boolean } = {},
) {
  const port = options.port ?? 8081;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error('Native Metro ports must be between 1024 and 65535.');
  const connection = options.connection ?? 'lan';
  if (connection !== 'lan' && connection !== 'tunnel')
    throw new Error('Native connection must be lan or tunnel.');
  return {
    cwd: root,
    executable: options.windows ? 'pnpm.cmd' : 'pnpm',
    args:
      kind === 'install'
        ? ['install', '--frozen-lockfile']
        : [
            'exec',
            'expo',
            'start',
            '--go',
            connection === 'tunnel' ? '--tunnel' : '--lan',
            '--port',
            String(port),
          ],
  };
}
