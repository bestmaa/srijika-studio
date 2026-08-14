export interface ArchitectureScanLimits {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
}

export const SRIJIKA_ARCHITECTURE_SCAN_LIMITS: ArchitectureScanLimits = Object.freeze({
  maxFiles: 4096,
  maxBytesPerFile: 4 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
});

export interface SizedArchitectureCandidate<T> {
  value: T;
  byteLength: number;
}

export interface ArchitectureBudgetSelection<T> {
  accepted: readonly SizedArchitectureCandidate<T>[];
  skippedByFileLimit: number;
  skippedOversized: number;
  skippedByTotalLimit: number;
  acceptedBytes: number;
}

/** Deterministically selects an already-sorted source corpus within trust bounds. */
export function selectArchitectureScanBudget<T>(
  candidates: readonly SizedArchitectureCandidate<T>[],
  limits: ArchitectureScanLimits = SRIJIKA_ARCHITECTURE_SCAN_LIMITS,
): ArchitectureBudgetSelection<T> {
  const accepted: SizedArchitectureCandidate<T>[] = [];
  let acceptedBytes = 0;
  let skippedOversized = 0;
  let skippedByTotalLimit = 0;
  const considered = candidates.slice(0, limits.maxFiles);

  for (const candidate of considered) {
    if (candidate.byteLength > limits.maxBytesPerFile) {
      skippedOversized += 1;
      continue;
    }
    if (acceptedBytes + candidate.byteLength > limits.maxTotalBytes) {
      skippedByTotalLimit += 1;
      continue;
    }
    accepted.push(candidate);
    acceptedBytes += candidate.byteLength;
  }

  return {
    accepted,
    skippedByFileLimit: Math.max(0, candidates.length - limits.maxFiles),
    skippedOversized,
    skippedByTotalLimit,
    acceptedBytes,
  };
}
