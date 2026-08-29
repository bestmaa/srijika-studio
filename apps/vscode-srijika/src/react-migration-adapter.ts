import { resolve } from 'node:path';

import {
  buildReactMigrationCliArguments,
  getReactMigrationStatus,
  startReactMigration,
  verifyReactMigration,
  type ReactMigrationCliOperation,
  type ReactMigrationCliRequest,
  type ReactMigrationSession,
} from '@srijika/developer-engine';

export type ReactMigrationOperation = ReactMigrationCliOperation;
export type ReactMigrationRequest = ReactMigrationCliRequest;

export interface ReactMigrationResult {
  operation: ReactMigrationOperation;
  session: ReactMigrationSession;
}

export interface ReactMigrationRunOptions {
  signal?: AbortSignal;
  onStatus?: (session: ReactMigrationSession) => void;
}

export function validateReactMigrationRequest(
  request: ReactMigrationRequest,
): ReactMigrationRequest {
  buildReactMigrationCliArguments(request);
  return {
    operation: request.operation,
    target: resolve(request.target),
    ...(request.source === undefined ? {} : { source: resolve(request.source) }),
    ...(request.framework === undefined ? {} : { framework: request.framework }),
  };
}

export function buildReactMigrationArguments(request: ReactMigrationRequest): readonly string[] {
  return buildReactMigrationCliArguments(request);
}

export function describeReactMigrationResult(
  _operation: ReactMigrationOperation,
  session: ReactMigrationSession,
): string {
  const verifiedSlices = session.appliedSlices.filter((slice) => slice.verified).length;
  const nativeMappings = session.mappings.filter((mapping) => mapping.mode === 'native').length;
  const blockers = session.verification?.errors.length ?? session.plan.unsupported.length;
  return `phase ${session.phase}; ${session.plan.ownership.length} native owner(s); ${session.appliedSlices.length}/${session.plan.slices.length} slice(s) applied, ${verifiedSlices} verified; ${nativeMappings} native mapping(s); ${blockers} blocker(s)`;
}

export async function runReactMigration(
  request: ReactMigrationRequest,
  options: ReactMigrationRunOptions = {},
): Promise<ReactMigrationResult> {
  if (options.signal?.aborted) throw new Error('Srijika React migration was cancelled.');
  const validated = validateReactMigrationRequest(request);
  const session =
    validated.operation === 'start'
      ? await startReactMigration({
          source: validated.source!,
          target: validated.target,
          ...(validated.framework === undefined ? {} : { expectedFramework: validated.framework }),
        })
      : validated.operation === 'status'
        ? await getReactMigrationStatus(validated.target)
        : await verifyReactMigration({ target: validated.target });
  options.onStatus?.(session);
  return { operation: validated.operation, session };
}
