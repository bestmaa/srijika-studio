import { describe, expect, it } from 'vitest';

import { selectArchitectureScanBudget } from '../src/architecture-scan-budget';

describe('architecture scan trust budget', () => {
  it('caps file count, individual files, and total bytes deterministically', () => {
    const result = selectArchitectureScanBudget(
      [
        { value: 'a', byteLength: 4 },
        { value: 'b-too-large', byteLength: 11 },
        { value: 'c', byteLength: 6 },
        { value: 'd-over-total', byteLength: 1 },
        { value: 'e-over-count', byteLength: 1 },
      ],
      { maxFiles: 4, maxBytesPerFile: 10, maxTotalBytes: 10 },
    );

    expect(result.accepted.map(({ value }) => value)).toEqual(['a', 'c']);
    expect(result).toMatchObject({
      acceptedBytes: 10,
      skippedByFileLimit: 1,
      skippedOversized: 1,
      skippedByTotalLimit: 1,
    });
  });
});
