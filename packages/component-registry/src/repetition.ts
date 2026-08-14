import {
  findRepeatedSiblingCandidates,
  type RepeatedSiblingAnalysisOptions,
  type RepeatedSiblingCandidate,
  type UiDocument,
} from '@srijika/contracts';

/**
 * Finds conservative, contiguous sibling runs that can be represented by one
 * Repeat template. Only top-level literal expression differences become item
 * fields; layout, component manifests, event handlers, and expression logic
 * must already match exactly.
 */
export function analyzeRepeatedSiblings(
  document: UiDocument,
  options: RepeatedSiblingAnalysisOptions = {},
): RepeatedSiblingCandidate[] {
  return findRepeatedSiblingCandidates(document, options);
}
