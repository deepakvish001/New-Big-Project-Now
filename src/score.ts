import type {
  Catalogue,
  CatalogueScore,
  Finding,
  Grade,
  GroupScore,
  Product,
  ProductScore,
  Rule,
  RuleGroup,
  RuleImpact,
} from './types.ts';
import { RULES } from './rules/index.ts';
import { buildContext } from './rules/context.ts';

/** Below this, treat the product as effectively unreachable by an agent. */
export const INVISIBLE_THRESHOLD = 50;

const GRADE_BANDS: [Grade, number][] = [
  ['A', 85],
  ['B', 70],
  ['C', 55],
  ['D', 40],
];

export function gradeFor(score: number): Grade {
  for (const [grade, floor] of GRADE_BANDS) {
    if (score >= floor) return grade;
  }
  return 'F';
}

export interface ScoreOptions {
  rules?: Rule[];
  /** Reference time for freshness checks. Injectable so tests are deterministic. */
  now?: Date;
  /** How many entries to keep in the ranked lists. */
  topN?: number;
}

interface Totals {
  earned: number;
  applicable: number;
}

interface DetailedScore {
  score: ProductScore;
  groups: Map<RuleGroup, Totals>;
}

/**
 * Runs every rule once and keeps both the product roll-up and the per-group
 * split, so the catalogue pass never has to re-evaluate a rule.
 */
function evaluateProduct(product: Product, rules: Rule[], now: Date): DetailedScore {
  const ctx = buildContext(product, now);
  const findings: Finding[] = [];
  const groups = new Map<RuleGroup, Totals>();
  let earned = 0;
  let applicable = 0;

  for (const rule of rules) {
    const outcome = rule.evaluate(product, ctx);
    if (outcome.status === 'na') continue;

    const ratio = outcome.ratio ?? (outcome.status === 'pass' ? 1 : 0);
    const gained = rule.weight * ratio;

    earned += gained;
    applicable += rule.weight;

    const bucket = groups.get(rule.group) ?? { earned: 0, applicable: 0 };
    bucket.earned += gained;
    bucket.applicable += rule.weight;
    groups.set(rule.group, bucket);

    if (outcome.status !== 'pass') {
      findings.push({
        ruleId: rule.id,
        group: rule.group,
        title: rule.title,
        severity: rule.severity,
        status: outcome.status,
        lost: rule.weight - gained,
        weight: rule.weight,
        detail: outcome.detail,
        why: rule.why,
        fix: rule.fix,
      });
    }
  }

  findings.sort((a, b) => b.lost - a.lost);

  return {
    score: {
      productId: product.id,
      title: product.title ?? product.handle ?? product.id,
      url: product.url,
      score: applicable === 0 ? 0 : round1((earned / applicable) * 100),
      earned,
      applicable,
      findings,
    },
    groups,
  };
}

export function scoreProduct(product: Product, options: ScoreOptions = {}): ProductScore {
  return evaluateProduct(product, options.rules ?? RULES, options.now ?? new Date()).score;
}

export function scoreCatalogue(catalogue: Catalogue, options: ScoreOptions = {}): CatalogueScore {
  const rules = options.rules ?? RULES;
  const topN = options.topN ?? 10;
  const now = options.now ?? new Date();

  const products: ProductScore[] = [];
  const groupTotals = new Map<RuleGroup, Totals>();
  const lostByRule = new Map<string, { lost: number; affected: number }>();
  let earned = 0;
  let applicable = 0;

  for (const product of catalogue.products) {
    const { score, groups } = evaluateProduct(product, rules, now);
    products.push(score);
    earned += score.earned;
    applicable += score.applicable;

    for (const [group, totals] of groups) {
      const bucket = groupTotals.get(group) ?? { earned: 0, applicable: 0 };
      bucket.earned += totals.earned;
      bucket.applicable += totals.applicable;
      groupTotals.set(group, bucket);
    }

    for (const finding of score.findings) {
      const entry = lostByRule.get(finding.ruleId) ?? { lost: 0, affected: 0 };
      entry.lost += finding.lost;
      entry.affected += 1;
      lostByRule.set(finding.ruleId, entry);
    }
  }

  const groups: GroupScore[] = [...groupTotals.entries()]
    .filter(([, totals]) => totals.applicable > 0)
    .map(([group, totals]) => ({
      group,
      earned: totals.earned,
      applicable: totals.applicable,
      score: round1((totals.earned / totals.applicable) * 100),
    }))
    .sort((a, b) => a.score - b.score);

  const ruleIndex = new Map(rules.map((rule) => [rule.id, rule]));
  const topImpacts: RuleImpact[] = [...lostByRule.entries()]
    .flatMap(([ruleId, entry]) => {
      const rule = ruleIndex.get(ruleId);
      if (!rule) return [];
      return [{
        ruleId,
        title: rule.title,
        severity: rule.severity,
        group: rule.group,
        affected: entry.affected,
        // Points of the headline score this single rule is costing.
        catalogueCost: applicable === 0 ? 0 : round1((entry.lost / applicable) * 100),
        why: rule.why,
        fix: rule.fix,
      }];
    })
    .sort((a, b) => b.catalogueCost - a.catalogueCost)
    .slice(0, topN);

  const invisibleCount = products.filter((p) => p.score < INVISIBLE_THRESHOLD).length;
  const score = applicable === 0 ? 0 : round1((earned / applicable) * 100);

  return {
    source: catalogue.source,
    storeName: catalogue.storeName,
    scoredAt: now.toISOString(),
    productCount: products.length,
    score,
    grade: gradeFor(score),
    invisibleCount,
    invisibleShare: products.length === 0 ? 0 : round1((invisibleCount / products.length) * 100),
    groups,
    topImpacts,
    worstProducts: [...products].sort((a, b) => a.score - b.score).slice(0, topN),
    products,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
