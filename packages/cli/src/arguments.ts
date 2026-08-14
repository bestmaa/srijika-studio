export interface ParsedArguments {
  positionals: readonly string[];
  options: ReadonlyMap<string, string | true>;
}

const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  h: 'help',
  v: 'version',
  p: 'project',
});
const BOOLEAN_OPTIONS = new Set([
  'help',
  'version',
  'install',
  'json',
  'dry-run',
  'hook',
  'store',
  'logic',
  'api',
  'types',
  'watch',
  'no-install',
  'no-open',
  'no-vscode',
  'no-studio',
  'no-extension',
]);

export function parseSrijikaArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  let positionalOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    if (positionalOnly) {
      positionals.push(argument);
      continue;
    }
    if (argument === '--') {
      positionalOnly = true;
      continue;
    }
    if (!argument.startsWith('-') || argument === '-') {
      positionals.push(argument);
      continue;
    }
    const long = argument.startsWith('--') ? argument.slice(2) : ALIASES[argument.slice(1)];
    if (!long) throw new Error(`Unknown option: ${argument}`);
    const equals = long.indexOf('=');
    if (equals >= 0) {
      const name = long.slice(0, equals);
      const value = long.slice(equals + 1);
      if (!name || !value) throw new Error(`Invalid option: ${argument}`);
      options.set(name, value);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(long)) {
      options.set(long, true);
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('-')) {
      options.set(long, next);
      index += 1;
    } else {
      options.set(long, true);
    }
  }
  return Object.freeze({ positionals: Object.freeze(positionals), options });
}

export function stringOption(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.options.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new Error(`--${name} requires a value.`);
  return value;
}

export function booleanOption(parsed: ParsedArguments, name: string): boolean {
  const value = parsed.options.get(name);
  if (value === undefined) return false;
  if (value !== true) throw new Error(`--${name} does not accept a value.`);
  return true;
}

export function assertKnownOptions(parsed: ParsedArguments, allowed: readonly string[]): void {
  const known = new Set(allowed);
  const unknown = [...parsed.options.keys()].filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`Unknown option: --${unknown[0]}`);
}
