export type {
  Catalogue,
  CatalogueScore,
  Finding,
  Grade,
  GroupScore,
  Product,
  ProductImage,
  ProductScore,
  Rule,
  RuleContext,
  RuleGroup,
  RuleImpact,
  RuleOutcome,
  RuleStatus,
  Severity,
  Variant,
} from './types.ts';

export { RULES, ruleById } from './rules/index.ts';
export { buildContext, detectBucket, dimensionEvidence } from './rules/context.ts';
export { scoreProduct, scoreCatalogue, gradeFor, INVISIBLE_THRESHOLD } from './score.ts';
export type { ScoreOptions } from './score.ts';

export {
  catalogueFromProductsJson,
  fetchPublicCatalogue,
  normaliseStoreUrl,
  productFromJson,
  PUBLIC_SCAN_BLIND_RULES,
  PUBLIC_SCAN_LIMITATIONS,
} from './adapters/shopify.ts';
export { catalogueFromShopifyCsv } from './adapters/shopify-csv.ts';
export { parseCsv, toTable } from './adapters/csv-parse.ts';

export { renderTerminal } from './report/terminal.ts';
export { renderHtml } from './report/html.ts';

import type { Catalogue, Rule } from './types.ts';
import { RULES } from './rules/index.ts';

/**
 * Drops the rules a source cannot observe, so an unreadable field is never
 * reported to a merchant as a missing one.
 */
export function applicableRules(catalogue: Catalogue, all: Rule[] = RULES): Rule[] {
  const blind = new Set(catalogue.blindRules ?? []);
  return blind.size === 0 ? all : all.filter((rule) => !blind.has(rule.id));
}

export {
  buildBatchRequests,
  enrichCatalogueBatched,
  planBatch,
  readBatchResult,
  toCustomId,
  waitForBatch,
} from './enrich/batch.ts';
export type { BatchClient, BatchItem, BatchOutcome, BatchRequest } from './enrich/batch.ts';
