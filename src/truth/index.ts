import {
  compareGroups,
  duplicateDiscrepancy,
  unmatchedDiscrepancy,
} from './compare.ts';
import type { CompareOptions, Discrepancy, DiscrepancyKind, DiscrepancySeverity } from './compare.ts';
import { matchSurfaces } from './match.ts';
import type { NamedCatalogue } from './match.ts';

export { matchSurfaces, keysFor, variantRefs, conflictsOnStrongerKey } from './match.ts';
export type { MatchGroup, MatchKind, MatchResult, NamedCatalogue, VariantRef, DuplicateIdentifier } from './match.ts';
export { compareGroups, titleOverlap, duplicateDiscrepancy, unmatchedDiscrepancy } from './compare.ts';
export type { CompareOptions, Discrepancy, DiscrepancyKind, DiscrepancySeverity } from './compare.ts';

const SEVERITY_ORDER: Record<DiscrepancySeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

export interface TruthSummary {
  surfaces: string[];
  variantsPerSurface: { surface: string; variants: number }[];
  matchedGroups: number;
  /** Variants that appear on only one surface. */
  onlyOnOneSurface: number;
  byKind: Record<DiscrepancyKind, number>;
  bySeverity: Record<DiscrepancySeverity, number>;
  /** Share of matched items that agree on everything. */
  agreementRate: number;
}

export interface TruthResult {
  summary: TruthSummary;
  discrepancies: Discrepancy[];
}

export interface TruthOptions extends Omit<CompareOptions, 'surfaces'> {
  /**
   * Report items that appear on only one surface. Off by default: a merchant
   * legitimately publishes a subset to a marketplace, and flagging all of it
   * buries the price and stock mismatches that actually matter.
   */
  reportUnmatched?: boolean;
}

/**
 * Reconciles the same catalogue as published to several surfaces.
 *
 * Mismatched prices and stale availability are the most-reported cause of
 * failed agentic checkout, and nothing in the merchant's stack tells them the
 * surfaces disagree — each one looks right on its own.
 */
export function reconcile(surfaces: NamedCatalogue[], options: TruthOptions = {}): TruthResult {
  const names = surfaces.map((s) => s.surface);
  const { groups, unmatched, duplicates } = matchSurfaces(surfaces);

  const compareOptions: CompareOptions = { ...options, surfaces: names };
  const discrepancies: Discrepancy[] = [
    ...compareGroups(groups, compareOptions),
    ...duplicates.map(duplicateDiscrepancy),
  ];

  if (options.reportUnmatched && names.length > 1) {
    discrepancies.push(...unmatched.map((ref) => unmatchedDiscrepancy(ref, names)));
  }

  discrepancies.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : a.productTitle.localeCompare(b.productTitle);
  });

  const byKind = {
    price_mismatch: 0,
    currency_mismatch: 0,
    availability_mismatch: 0,
    missing_from_surface: 0,
    duplicate_identifier: 0,
    title_drift: 0,
  } satisfies Record<DiscrepancyKind, number>;
  const bySeverity = { critical: 0, major: 0, minor: 0 } satisfies Record<DiscrepancySeverity, number>;

  for (const discrepancy of discrepancies) {
    byKind[discrepancy.kind] += 1;
    bySeverity[discrepancy.severity] += 1;
  }

  const groupsWithIssues = new Set(
    compareGroups(groups, compareOptions).map((d) => `${d.matchedBy}:${d.key}`),
  ).size;

  return {
    summary: {
      surfaces: names,
      variantsPerSurface: surfaces.map(({ surface, catalogue }) => ({
        surface,
        variants: catalogue.products.reduce((total, p) => total + p.variants.length, 0),
      })),
      matchedGroups: groups.length,
      onlyOnOneSurface: unmatched.length,
      byKind,
      bySeverity,
      agreementRate: groups.length === 0
        ? 0
        : Math.round(((groups.length - groupsWithIssues) / groups.length) * 1000) / 10,
    },
    discrepancies,
  };
}
