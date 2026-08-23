import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planReactMigration, scanReactMigrationSource } from '../src/index.js';

const REAL_SOURCE = '/home/beste/project/testing/newadminallinone-source';

describe.runIf(existsSync(REAL_SOURCE))('local real React migration planning audit', () => {
  it('blocks cross-owner canonical collisions while allowing planned same-owner merges', async () => {
    const inventory = await scanReactMigrationSource(REAL_SOURCE);
    const plan = planReactMigration(inventory, '/tmp/srijika-native-plan-audit-target');
    const claimedTargets = new Map<string, Array<{ sourcePath: string; ownerId: string }>>();
    for (const decision of plan.ownership) {
      for (const targetPath of decision.canonicalTargetPaths) {
        const sources = claimedTargets.get(targetPath) ?? [];
        sources.push({ sourcePath: decision.sourcePath, ownerId: decision.ownerId });
        claimedTargets.set(targetPath, sources);
      }
    }
    const collisions = [...claimedTargets].filter(([, sources]) => sources.length > 1);
    const crossOwnerCollisions = collisions.filter(
      ([, sources]) => new Set(sources.map((source) => source.ownerId)).size > 1,
    );
    for (const [targetPath] of crossOwnerCollisions) {
      expect(plan.unsupported.some((finding) => finding.includes(targetPath))).toBe(true);
    }
    const nativeSliceSizes = plan.slices
      .filter((slice) => !slice.id.startsWith('owner-project-nonruntime-'))
      .map((slice) => slice.sourcePaths.length);
    // Legacy module/import façades must not collapse the product into one
    // opaque cycle. The map-editor workspace is a deliberately atomic native
    // feature cluster, but the planner still bounds one review below 128 files
    // and keeps every other owner independently addressable through pages.
    expect(Math.max(...nativeSliceSizes)).toBeLessThanOrEqual(128);
    expect(new Set(plan.slices.flatMap((slice) => slice.sourcePaths)).size).toBe(
      inventory.files.length,
    );
    console.info(
      JSON.stringify({
        files: inventory.files.length,
        bytes: inventory.totalBytes,
        owners: new Set(plan.ownership.map((decision) => decision.ownerId)).size,
        slices: plan.slices.length,
        largestNativeSlice: Math.max(...nativeSliceSizes),
        unsupported: plan.unsupported.length,
        sameOwnerMergeTargets: collisions.length - crossOwnerCollisions.length,
        crossOwnerCanonicalCollisions: crossOwnerCollisions.length,
        collisionSample: plan.unsupported
          .filter((finding) => finding.includes('Canonical target collision'))
          .slice(0, 8),
      }),
    );
  }, 30_000);
});
