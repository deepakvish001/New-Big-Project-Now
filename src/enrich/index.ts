import type { Catalogue, Product } from '../types.ts';
import { gapsFor, sourceTextFor } from './gaps.ts';
import { verifyProposals } from './verify.ts';
import type {
  EnrichmentResult,
  EnrichmentSummary,
  ProductProposals,
  Proposer,
} from './types.ts';
import type { VerifyOptions } from './verify.ts';

export { gapsFor, sourceTextFor, ATTRIBUTE_KEY } from './gaps.ts';
export {
  verifyProposal,
  verifyProposals,
  normalise,
  ACCEPT_CONFIDENCE,
  REVIEW_CONFIDENCE,
} from './verify.ts';
export { ClaudeProposer, NullProposer, DEFAULT_MODEL } from './proposer.ts';
export type * from './types.ts';

export interface EnrichOptions extends VerifyOptions {
  /** Products handled at once. Keep modest: each one is an API call. */
  concurrency?: number;
  /** Stop after this many products, so a first run on a big catalogue is cheap. */
  limit?: number;
  now?: Date;
  /** Called after each product, for progress output. */
  onProgress?: (done: number, total: number) => void;
}

export async function enrichProduct(
  product: Product,
  proposer: Proposer,
  options: EnrichOptions = {},
): Promise<ProductProposals> {
  const gaps = gapsFor(product, options.now ?? new Date());
  const base: ProductProposals = {
    productId: product.id,
    title: product.title ?? product.handle ?? product.id,
    gaps,
    proposals: [],
  };

  if (gaps.length === 0) return base;

  const sourceText = sourceTextFor(product);
  if (sourceText.trim() === '') {
    return { ...base, error: 'no merchant content to draw from' };
  }

  try {
    const raw = await proposer.propose(product, gaps, sourceText);
    return { ...base, proposals: verifyProposals(raw, sourceText, gaps, options) };
  } catch (error) {
    return { ...base, error: (error as Error).message };
  }
}

export async function enrichCatalogue(
  catalogue: Catalogue,
  proposer: Proposer,
  options: EnrichOptions = {},
): Promise<EnrichmentResult> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const queue = options.limit ? catalogue.products.slice(0, options.limit) : catalogue.products;
  const results: ProductProposals[] = new Array(queue.length);

  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= queue.length) return;

      results[index] = await enrichProduct(queue[index]!, proposer, options);
      done += 1;
      options.onProgress?.(done, queue.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  return { summary: summarise(results), products: results };
}

export function summarise(products: ProductProposals[]): EnrichmentSummary {
  const summary: EnrichmentSummary = {
    productsConsidered: products.length,
    productsWithGaps: 0,
    proposed: 0,
    accepted: 0,
    needsReview: 0,
    rejected: 0,
    failed: 0,
  };

  for (const product of products) {
    if (product.gaps.length > 0) summary.productsWithGaps += 1;
    if (product.error) summary.failed += 1;
    for (const proposal of product.proposals) {
      summary.proposed += 1;
      if (proposal.verdict === 'accepted') summary.accepted += 1;
      else if (proposal.verdict === 'needs_review') summary.needsReview += 1;
      else summary.rejected += 1;
    }
  }

  return summary;
}

/**
 * Applies accepted proposals to a copy of the product. Proposals held for
 * review are deliberately left out — publishing those is a human decision.
 */
export function applyAccepted(product: Product, proposals: ProductProposals): Product {
  const attributes = { ...(product.attributes ?? {}) };
  for (const proposal of proposals.proposals) {
    if (proposal.verdict !== 'accepted') continue;
    // Never overwrite a value the merchant already stated.
    if (attributes[proposal.key] === undefined) attributes[proposal.key] = proposal.value;
  }
  return { ...product, attributes };
}
