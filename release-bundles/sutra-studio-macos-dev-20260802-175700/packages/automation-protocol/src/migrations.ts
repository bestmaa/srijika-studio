import type { AutomationDiagnostic } from './diagnostics';

export interface ProtocolAdapter<TInput = unknown, TOutput = unknown> {
  fromVersion: string;
  toVersion: string;
  adapt: (payload: TInput) => TOutput;
}

interface StoredAdapter {
  fromVersion: string;
  toVersion: string;
  adapt: (payload: unknown) => unknown;
}

export interface ProtocolAdaptSuccess<TPayload> {
  ok: true;
  payload: TPayload;
  fromVersion: string;
  toVersion: string;
  appliedVersions: string[];
  diagnostics: AutomationDiagnostic[];
}

export interface ProtocolAdaptFailure {
  ok: false;
  fromVersion: string;
  toVersion: string;
  appliedVersions: string[];
  diagnostics: AutomationDiagnostic[];
}

export type ProtocolAdaptResult<TPayload> = ProtocolAdaptSuccess<TPayload> | ProtocolAdaptFailure;

/**
 * Directed adapter graph. It intentionally accepts non-adjacent versions so a
 * future release can add a direct compatibility adapter without rewriting old
 * migrations.
 */
export class ProtocolAdapterRegistry {
  readonly #adapters = new Map<string, StoredAdapter>();

  register<TInput, TOutput>(adapter: ProtocolAdapter<TInput, TOutput>): this {
    if (!adapter.fromVersion || !adapter.toVersion || adapter.fromVersion === adapter.toVersion) {
      throw new Error('Protocol adapters require different non-empty versions');
    }
    const key = this.#key(adapter.fromVersion, adapter.toVersion);
    if (this.#adapters.has(key)) {
      throw new Error(
        `Protocol adapter ${adapter.fromVersion} -> ${adapter.toVersion} already exists`,
      );
    }
    this.#adapters.set(key, {
      fromVersion: adapter.fromVersion,
      toVersion: adapter.toVersion,
      adapt: (payload) => adapter.adapt(payload as TInput),
    });
    return this;
  }

  versions(): Array<{ fromVersion: string; toVersion: string }> {
    return [...this.#adapters.values()]
      .map(({ fromVersion, toVersion }) => ({ fromVersion, toVersion }))
      .sort((left, right) =>
        `${left.fromVersion}/${left.toVersion}`.localeCompare(
          `${right.fromVersion}/${right.toVersion}`,
        ),
      );
  }

  adapt<TPayload = unknown>(
    payload: unknown,
    fromVersion: string,
    toVersion: string,
  ): ProtocolAdaptResult<TPayload> {
    if (fromVersion === toVersion) {
      return {
        ok: true,
        payload: payload as TPayload,
        fromVersion,
        toVersion,
        appliedVersions: [fromVersion],
        diagnostics: [],
      };
    }

    const path = this.#findPath(fromVersion, toVersion);
    if (!path) {
      return {
        ok: false,
        fromVersion,
        toVersion,
        appliedVersions: [fromVersion],
        diagnostics: [
          {
            code: 'migration-path-not-found',
            severity: 'error',
            message: `No protocol adapter path exists from ${fromVersion} to ${toVersion}`,
          },
        ],
      };
    }

    let current = payload;
    const appliedVersions = [fromVersion];
    for (const adapter of path) {
      current = adapter.adapt(current);
      appliedVersions.push(adapter.toVersion);
    }
    return {
      ok: true,
      payload: current as TPayload,
      fromVersion,
      toVersion,
      appliedVersions,
      diagnostics: [],
    };
  }

  #key(fromVersion: string, toVersion: string): string {
    return `${fromVersion}\u0000${toVersion}`;
  }

  #findPath(fromVersion: string, toVersion: string): StoredAdapter[] | null {
    const queue: Array<{ version: string; path: StoredAdapter[] }> = [
      { version: fromVersion, path: [] },
    ];
    const visited = new Set([fromVersion]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const nextAdapters = [...this.#adapters.values()]
        .filter((adapter) => adapter.fromVersion === current.version)
        .sort((left, right) => left.toVersion.localeCompare(right.toVersion));
      for (const adapter of nextAdapters) {
        const path = [...current.path, adapter];
        if (adapter.toVersion === toVersion) return path;
        if (visited.has(adapter.toVersion)) continue;
        visited.add(adapter.toVersion);
        queue.push({ version: adapter.toVersion, path });
      }
    }
    return null;
  }
}
