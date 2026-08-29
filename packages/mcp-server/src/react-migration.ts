import {
  applyReactMigrationSlice,
  captureReactMigrationBrowserParity,
  finalizeReactMigration,
  getReactMigrationSliceContext,
  getReactMigrationStatus,
  planReactMigration,
  reviewReactMigrationSlice,
  reviewReactMigrationOwnership,
  runReactMigrationVerificationGates,
  scanReactMigrationSource,
  startReactMigration,
  verifyReactMigration,
  verifyReactMigrationSlice,
  type ApplyReactMigrationSliceRequest,
  type GetReactMigrationSliceContextRequest,
  type ReactMigrationInventory,
  type ReactMigrationPlan,
  type ReactMigrationSession,
  type ReviewReactMigrationOwnershipRequest,
  type ReviewReactMigrationSliceRequest,
  type StartReactMigrationRequest,
} from '@srijika/developer-engine';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

export interface SrijikaReactMigrationScanRequest {
  source: string;
  target?: string;
  cursor?: string;
  limit?: number;
  sliceId?: string;
}

export interface SrijikaReactMigrationStatusRequest {
  target: string;
  cursor?: string;
  limit?: number;
}

export interface SrijikaReactMigrationSliceVerificationRequest {
  target: string;
  sliceId: string;
}

export interface SrijikaReactMigrationVerificationRequest {
  target: string;
  includeInstall?: boolean;
}

export type SrijikaReactMigrationOwnershipReviewRequest = ReviewReactMigrationOwnershipRequest;

export interface SrijikaReactMigrationCaller {
  scan(request: SrijikaReactMigrationScanRequest): Promise<unknown>;
  plan(request: SrijikaReactMigrationScanRequest): Promise<unknown>;
  start(request: StartReactMigrationRequest): Promise<unknown>;
  status(request: SrijikaReactMigrationStatusRequest): Promise<unknown>;
  getSliceContext(request: GetReactMigrationSliceContextRequest): Promise<unknown>;
  reviewOwnership(request: SrijikaReactMigrationOwnershipReviewRequest): Promise<unknown>;
  reviewSlice(request: ReviewReactMigrationSliceRequest): Promise<unknown>;
  applySlice(request: ApplyReactMigrationSliceRequest): Promise<unknown>;
  verifySlice(request: SrijikaReactMigrationSliceVerificationRequest): Promise<unknown>;
  verify(request: SrijikaReactMigrationVerificationRequest): Promise<unknown>;
  finalize(request: Pick<SrijikaReactMigrationVerificationRequest, 'target'>): Promise<unknown>;
}

export class SrijikaReactMigrationService implements SrijikaReactMigrationCaller {
  async scan(request: SrijikaReactMigrationScanRequest): Promise<unknown> {
    return pageInventory(
      await scanReactMigrationSource(request.source),
      request.cursor,
      request.limit,
    );
  }

  async plan(request: SrijikaReactMigrationScanRequest): Promise<unknown> {
    const inventory = await scanReactMigrationSource(request.source);
    if (!request.target) {
      return {
        inventory: pageInventory(inventory, request.cursor, request.limit),
        plan: null,
        blockers: [
          'A distinct absolute target is required before the canonical migration plan can be derived.',
        ],
      };
    }
    const sessionFile = join(request.target, '.srijika', 'migrations', 'react', 'session.json');
    try {
      await access(sessionFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return pagePlan(
        planReactMigration(inventory, request.target),
        request.cursor,
        request.limit,
        request.sliceId,
      );
    }
    const session = await getReactMigrationStatus(request.target);
    if (
      session.sourceRoot !== inventory.sourceRoot ||
      session.inventory.snapshotSha256 !== inventory.snapshotSha256
    ) {
      throw new Error('The requested source does not match the persisted migration session.');
    }
    return pagePlan(session.plan, request.cursor, request.limit, request.sliceId);
  }

  async start(request: StartReactMigrationRequest): Promise<unknown> {
    return compactSession(await startReactMigration(request));
  }

  async status(request: SrijikaReactMigrationStatusRequest): Promise<unknown> {
    const session = await getReactMigrationStatus(request.target);
    return {
      ...compactSession(session),
      ownership: pageItems(
        session.plan.ownership,
        request.cursor,
        request.limit,
        `status:${session.plan.id}:ownership`,
      ),
    };
  }

  getSliceContext(request: GetReactMigrationSliceContextRequest): Promise<unknown> {
    return getReactMigrationSliceContext(request);
  }

  async reviewOwnership(request: SrijikaReactMigrationOwnershipReviewRequest): Promise<unknown> {
    return compactSession(await reviewReactMigrationOwnership(request));
  }

  reviewSlice(request: ReviewReactMigrationSliceRequest): Promise<unknown> {
    return reviewReactMigrationSlice(request);
  }

  async applySlice(request: ApplyReactMigrationSliceRequest): Promise<unknown> {
    return compactSession(await applyReactMigrationSlice(request));
  }

  async verifySlice(request: SrijikaReactMigrationSliceVerificationRequest): Promise<unknown> {
    const commands = await runReactMigrationVerificationGates({ target: request.target });
    return compactSession(
      await verifyReactMigrationSlice(
        request.target,
        request.sliceId,
        commands.filter(({ name }) => name === 'typecheck' || name === 'build'),
      ),
    );
  }

  async verify(request: SrijikaReactMigrationVerificationRequest): Promise<unknown> {
    await captureReactMigrationBrowserParity({
      target: request.target,
      ...(request.includeInstall === undefined ? {} : { includeInstall: request.includeInstall }),
    });
    const commands = await runReactMigrationVerificationGates({
      target: request.target,
      ...(request.includeInstall === undefined ? {} : { includeInstall: request.includeInstall }),
    });
    return compactSession(
      await verifyReactMigration({
        target: request.target,
        commands,
      }),
    );
  }

  async finalize(
    request: Pick<SrijikaReactMigrationVerificationRequest, 'target'>,
  ): Promise<unknown> {
    return compactSession(await finalizeReactMigration({ target: request.target }));
  }
}

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

function pageCursorScope(scope: string): string {
  return createHash('sha256').update(scope).digest('hex');
}

function encodePageCursor(scope: string, offset: number): string {
  return Buffer.from(
    JSON.stringify({ version: 1, offset, scope: pageCursorScope(scope) }),
    'utf8',
  ).toString('base64url');
}

function decodePageCursor(cursor: string | undefined, scope: string, itemCount: number): number {
  if (cursor === undefined) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      version?: unknown;
      offset?: unknown;
      scope?: unknown;
    };
    if (
      value.version !== 1 ||
      !Number.isInteger(value.offset) ||
      typeof value.offset !== 'number' ||
      value.offset < 0 ||
      value.offset >= itemCount ||
      value.scope !== pageCursorScope(scope)
    ) {
      throw new Error('invalid');
    }
    return value.offset;
  } catch {
    throw new Error('Migration page cursor is invalid, stale, or belongs to another query.');
  }
}

function pageItems<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit = DEFAULT_PAGE_LIMIT,
  scope: string,
) {
  const boundedCursor = decodePageCursor(cursor, scope, items.length);
  const boundedLimit = Math.max(1, Math.min(MAX_PAGE_LIMIT, limit));
  const page = items.slice(boundedCursor, boundedCursor + boundedLimit);
  const nextOffset = boundedCursor + page.length;
  const nextCursor = nextOffset < items.length ? encodePageCursor(scope, nextOffset) : null;
  return {
    items: page,
    cursor: cursor ?? null,
    limit: boundedLimit,
    total: items.length,
    nextCursor,
  };
}

function pageInventory(inventory: ReactMigrationInventory, cursor?: string, limit?: number) {
  const files = pageItems(
    inventory.files,
    cursor,
    limit,
    `inventory:${inventory.snapshotSha256}:files`,
  );
  const paths = new Set(files.items.map((file) => file.relativePath));
  return {
    contractVersion: 2,
    sourceRoot: inventory.sourceRoot,
    packageName: inventory.packageName,
    framework: inventory.framework,
    language: inventory.language,
    snapshotSha256: inventory.snapshotSha256,
    semanticRoutesPresent: inventory.semanticRoutesPresent,
    totalBytes: inventory.totalBytes,
    packageDependencies: inventory.packageDependencies,
    packageDependencyRecords: inventory.packageDependencyRecords,
    packageScripts: inventory.packageScripts,
    toolchain: inventory.toolchain,
    nextAppRouter: inventory.nextAppRouter ?? null,
    environmentKeys: inventory.environmentKeys,
    sourceAliases: inventory.sourceAliases,
    files,
    ownership: inventory.ownership.filter((decision) => paths.has(decision.sourcePath)),
    nextAction: files.nextCursor === null ? 'get-plan' : 'scan-next-page',
  };
}

function pagePlan(plan: ReactMigrationPlan, cursor?: string, limit?: number, sliceId?: string) {
  const selectedSlice = sliceId ? plan.slices.find((slice) => slice.id === sliceId) : undefined;
  if (sliceId && !selectedSlice) throw new Error(`Unknown migration slice: ${sliceId}`);
  const ownership = selectedSlice
    ? plan.ownership.filter((decision) => selectedSlice.sourcePaths.includes(decision.sourcePath))
    : plan.ownership;
  const ownershipPage = pageItems(
    ownership,
    cursor,
    limit,
    `plan:${plan.id}:ownership:${sliceId ?? '*'}`,
  );
  return {
    contractVersion: 2,
    planId: plan.id,
    sourceRoot: plan.sourceRoot,
    targetRoot: plan.targetRoot,
    sourceSnapshotSha256: plan.sourceSnapshotSha256,
    targetBaselineSha256: plan.targetBaselineSha256,
    slices: plan.slices.map((slice) => ({
      id: slice.id,
      title: slice.title,
      sourceCount: slice.sourcePaths.length,
      acceptance: slice.acceptance,
    })),
    ...(selectedSlice === undefined
      ? {}
      : {
          selectedSlice: {
            id: selectedSlice.id,
            title: selectedSlice.title,
            sourceCount: selectedSlice.sourcePaths.length,
            acceptance: selectedSlice.acceptance,
          },
        }),
    ownership: ownershipPage,
    approvedLegacyAdapters: plan.approvedLegacyAdapters,
    blockers: plan.unsupported,
    nextAction:
      plan.unsupported.length > 0
        ? 'resolve-blockers'
        : selectedSlice === undefined
          ? 'select-slice'
          : ownershipPage.nextCursor === null
            ? 'get-slice-context'
            : 'get-next-plan-page',
  };
}

function compactSession(session: ReactMigrationSession) {
  const verification = session.verification;
  const nextAction =
    session.phase === 'complete'
      ? 'complete'
      : verification && !verification.passed
        ? 'resolve-verification-blockers'
        : session.reviewedSlices.length > 0
          ? 'apply-reviewed-slice'
          : session.appliedSlices.some((slice) => !slice.verified)
            ? 'verify-slice'
            : session.appliedSlices.length < session.plan.slices.length
              ? 'get-next-slice-plan'
              : 'verify-session';
  return {
    contractVersion: 2,
    sessionId: session.id,
    phase: session.phase,
    sourceRoot: session.sourceRoot,
    targetRoot: session.targetRoot,
    planId: session.plan.id,
    sourceSnapshotSha256: session.inventory.snapshotSha256,
    framework: session.inventory.framework,
    nextAppRouter: session.inventory.nextAppRouter ?? null,
    targetBaselineSha256: session.plan.targetBaselineSha256,
    summary: {
      counts: {
        sourceFiles: session.inventory.files.length,
        ownershipDecisions: session.plan.ownership.length,
        planSlices: session.plan.slices.length,
        appliedSlices: session.appliedSlices.length,
        verifiedSlices: session.appliedSlices.filter((slice) => slice.verified).length,
        mappings: session.mappings.length,
        ignoredSources: session.ignoredSources.length,
      },
    },
    recentSlices: session.appliedSlices.slice(-20).map((slice) => ({
      id: slice.id,
      title: slice.title,
      verified: slice.verified,
      writeCount: slice.writes.length,
    })),
    pendingApplyHandles: session.reviewedSlices.slice(-20).map((review) => ({
      sliceId: review.sliceId,
      handle: review.token,
      reviewedAt: review.reviewedAt,
    })),
    blockers: verification?.errors ?? session.plan.unsupported,
    ...(verification === undefined
      ? {}
      : {
          verification: {
            passed: verification.passed,
            sourceUnchanged: verification.sourceUnchanged,
            nativeCompletionValid: verification.nativeCompletionValid,
            targetGraphValid: verification.targetGraphValid,
            targetSnapshotSha256: verification.targetSnapshotSha256,
            wrapperFindings: verification.wrapperFindings,
            unownedTargetPaths: verification.unownedTargetPaths,
          },
        }),
    nextAction,
  };
}
