import type { DuplicateIdentifier, MatchGroup, MatchKind, VariantRef } from './match.ts';

export type DiscrepancyKind =
  | 'price_mismatch'
  | 'currency_mismatch'
  | 'availability_mismatch'
  | 'missing_from_surface'
  | 'duplicate_identifier'
  | 'title_drift';

export type DiscrepancySeverity = 'critical' | 'major' | 'minor';

export interface Discrepancy {
  kind: DiscrepancyKind;
  severity: DiscrepancySeverity;
  /** The identifier the item was matched on, so a merchant can look it up. */
  key: string;
  matchedBy: MatchKind;
  productTitle: string;
  /** What each surface says, as text, for the report. */
  perSurface: { surface: string; value: string }[];
  summary: string;
}

export interface CompareOptions {
  /** Every surface expected to carry the catalogue, for missing-item checks. */
  surfaces: string[];
  /**
   * Prices closer than this are treated as equal. Defaults to 0.005 so that
   * float noise does not register, but a one-paisa real difference does.
   */
  priceTolerance?: number;
  /** Titles are compared loosely; below this similarity they have drifted. */
  titleSimilarity?: number;
}

function money(value: number | undefined, currency: string | undefined): string {
  if (value === undefined) return 'no price';
  return currency ? `${value.toFixed(2)} ${currency}` : value.toFixed(2);
}

function availabilityWord(value: boolean | undefined): string {
  if (value === undefined) return 'not stated';
  return value ? 'in stock' : 'out of stock';
}

function titleFor(group: MatchGroup): string {
  return group.members[0]?.productTitle ?? group.key;
}

/** Jaccard similarity over word sets — enough to spot a genuinely different title. */
export function titleOverlap(a: string, b: string): number {
  const words = (text: string) =>
    new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2));
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 1;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function compareGroup(group: MatchGroup, options: CompareOptions): Discrepancy[] {
  const tolerance = options.priceTolerance ?? 0.005;
  const minOverlap = options.titleSimilarity ?? 0.4;
  const found: Discrepancy[] = [];

  const base = {
    key: group.key,
    matchedBy: group.kind,
    productTitle: titleFor(group),
  };

  const priced = group.members.filter((m) => typeof m.variant.price === 'number');
  const prices = priced.map((m) => m.variant.price!);
  const spread = prices.length > 0 ? Math.max(...prices) - Math.min(...prices) : 0;

  // A price that differs while both surfaces claim the item is buyable is the
  // failure that actually costs money: an agent transacts at the wrong one.
  if (spread > tolerance) {
    const bothSellable = priced.filter((m) => m.variant.available !== false).length > 1;
    found.push({
      ...base,
      kind: 'price_mismatch',
      severity: bothSellable ? 'critical' : 'major',
      perSurface: priced.map((m) => ({
        surface: m.surface,
        value: money(m.variant.price, m.variant.currency),
      })),
      summary: `prices differ by ${spread.toFixed(2)} across ${priced.length} surfaces`,
    });
  }

  const currencies = new Set(
    group.members.map((m) => m.variant.currency).filter((c): c is string => Boolean(c)),
  );
  if (currencies.size > 1) {
    found.push({
      ...base,
      kind: 'currency_mismatch',
      severity: 'critical',
      perSurface: group.members
        .filter((m) => m.variant.currency)
        .map((m) => ({ surface: m.surface, value: m.variant.currency! })),
      summary: `the same item is priced in ${[...currencies].join(' and ')}`,
    });
  }

  const stated = group.members.filter((m) => typeof m.variant.available === 'boolean');
  const availabilities = new Set(stated.map((m) => m.variant.available));
  if (availabilities.size > 1) {
    found.push({
      ...base,
      kind: 'availability_mismatch',
      severity: 'critical',
      perSurface: stated.map((m) => ({
        surface: m.surface,
        value: availabilityWord(m.variant.available),
      })),
      summary: 'one surface will sell this item while another says it is gone',
    });
  }

  const titles = [...new Set(group.members.map((m) => m.productTitle))];
  if (titles.length > 1) {
    const worst = Math.min(
      ...titles.slice(1).map((title) => titleOverlap(titles[0]!, title)),
    );
    if (worst < minOverlap) {
      found.push({
        ...base,
        kind: 'title_drift',
        severity: 'minor',
        perSurface: group.members.map((m) => ({ surface: m.surface, value: m.productTitle })),
        summary: 'the same identifier carries materially different titles',
      });
    }
  }

  const present = new Set(group.members.map((m) => m.surface));
  const missing = options.surfaces.filter((surface) => !present.has(surface));
  if (missing.length > 0) {
    found.push({
      ...base,
      kind: 'missing_from_surface',
      severity: 'major',
      perSurface: options.surfaces.map((surface) => ({
        surface,
        value: present.has(surface) ? 'present' : 'absent',
      })),
      summary: `not published to ${missing.join(', ')}`,
    });
  }

  return found;
}

export function duplicateDiscrepancy(duplicate: DuplicateIdentifier): Discrepancy {
  return {
    kind: 'duplicate_identifier',
    severity: 'major',
    key: duplicate.key,
    matchedBy: duplicate.kind,
    productTitle: duplicate.productTitles.join(' / '),
    perSurface: [{ surface: duplicate.surface, value: `${duplicate.count} variants` }],
    summary:
      `${duplicate.kind.toUpperCase()} ${duplicate.key} is used by ${duplicate.count} variants on `
      + `${duplicate.surface}; an agent cannot tell them apart`,
  };
}

/** An item present on only one surface, when several were supplied. */
export function unmatchedDiscrepancy(ref: VariantRef, surfaces: string[]): Discrepancy {
  const others = surfaces.filter((s) => s !== ref.surface);
  return {
    kind: 'missing_from_surface',
    severity: 'major',
    key: ref.variant.sku ?? ref.variant.gtin ?? ref.variant.id,
    matchedBy: 'handle',
    productTitle: ref.productTitle,
    perSurface: [
      { surface: ref.surface, value: 'present' },
      ...others.map((surface) => ({ surface, value: 'absent' })),
    ],
    summary: `only on ${ref.surface}; no matching item on ${others.join(', ')}`,
  };
}

export function compareGroups(groups: MatchGroup[], options: CompareOptions): Discrepancy[] {
  return groups.flatMap((group) => compareGroup(group, options));
}
