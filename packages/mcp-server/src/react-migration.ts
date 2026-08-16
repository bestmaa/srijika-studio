import {
  applyReactMigrationSlice,
  finalizeReactMigration,
  getReactMigrationStatus,
  planReactMigration,
  scanReactMigrationSource,
  startReactMigration,
  verifyReactMigration,
  verifyReactMigrationSlice,
  type ApplyReactMigrationSliceRequest,
  type StartReactMigrationRequest,
  type VerifyReactMigrationRequest,
} from '@srijika/developer-engine';

export interface SrijikaReactMigrationScanRequest {
  source: string;
  target?: string;
}

export interface SrijikaReactMigrationSliceVerificationRequest {
  target: string;
  sliceId: string;
}

export interface SrijikaReactMigrationCaller {
  scan(request: SrijikaReactMigrationScanRequest): Promise<unknown>;
  plan(request: SrijikaReactMigrationScanRequest): Promise<unknown>;
  start(request: StartReactMigrationRequest): Promise<unknown>;
  status(target: string): Promise<unknown>;
  applySlice(request: ApplyReactMigrationSliceRequest): Promise<unknown>;
  verifySlice(request: SrijikaReactMigrationSliceVerificationRequest): Promise<unknown>;
  verify(request: VerifyReactMigrationRequest): Promise<unknown>;
  finalize(request: VerifyReactMigrationRequest): Promise<unknown>;
}

export class SrijikaReactMigrationService implements SrijikaReactMigrationCaller {
  scan(request: SrijikaReactMigrationScanRequest): Promise<unknown> {
    return scanReactMigrationSource(request.source);
  }

  async plan(request: SrijikaReactMigrationScanRequest): Promise<unknown> {
    const inventory = await scanReactMigrationSource(request.source);
    if (!request.target) {
      return {
        inventory,
        plan: null,
        blockers: [
          'A distinct absolute target is required before the canonical migration plan can be derived.',
        ],
      };
    }
    return planReactMigration(inventory, request.target);
  }

  start(request: StartReactMigrationRequest): Promise<unknown> {
    return startReactMigration(request);
  }

  status(target: string): Promise<unknown> {
    return getReactMigrationStatus(target);
  }

  applySlice(request: ApplyReactMigrationSliceRequest): Promise<unknown> {
    return applyReactMigrationSlice(request);
  }

  verifySlice(request: SrijikaReactMigrationSliceVerificationRequest): Promise<unknown> {
    return verifyReactMigrationSlice(request.target, request.sliceId);
  }

  verify(request: VerifyReactMigrationRequest): Promise<unknown> {
    return verifyReactMigration(request);
  }

  finalize(request: VerifyReactMigrationRequest): Promise<unknown> {
    return finalizeReactMigration(request);
  }
}
