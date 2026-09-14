import type { Product, QueryDimension } from '../types.ts';

/** A dimension the catalogue does not carry as a structured field. */
export interface Gap {
  dimension: QueryDimension;
  /** Canonical attribute key to write the value under. */
  attributeKey: string;
  /**
   * `none`  - no evidence anywhere; the merchant must supply the fact.
   * `text`  - the fact is in the prose but not a field; it can be promoted.
   */
  currentSource: 'none' | 'text';
}

/** What the model proposed, before any checking. */
export interface RawProposal {
  key: string;
  value: string;
  /** A span the model claims to have taken the value from. */
  evidence: string;
  confidence: number;
}

export type ProposalVerdict =
  /** Evidence checks out and confidence is high: safe to write. */
  | 'accepted'
  /** Evidence checks out but confidence is middling: a human should confirm. */
  | 'needs_review'
  /** Evidence is not in the merchant's own content, or the shape is wrong. */
  | 'rejected';

export interface CheckedProposal extends RawProposal {
  verdict: ProposalVerdict;
  /** Why it was rejected or held, in words a merchant can act on. */
  reason?: string;
  /** Where in the source the evidence was found, once verified. */
  evidenceFound?: boolean;
}

export interface ProductProposals {
  productId: string;
  title: string;
  gaps: Gap[];
  proposals: CheckedProposal[];
  /** Set when the proposer itself failed for this product. */
  error?: string;
}

export interface EnrichmentSummary {
  productsConsidered: number;
  productsWithGaps: number;
  proposed: number;
  accepted: number;
  needsReview: number;
  rejected: number;
  failed: number;
}

export interface EnrichmentResult {
  summary: EnrichmentSummary;
  products: ProductProposals[];
}

/**
 * Anything that can turn gaps into proposals. Swapping this out is how the
 * pipeline is tested without spending money or touching the network.
 */
export interface Proposer {
  propose(product: Product, gaps: Gap[], sourceText: string): Promise<RawProposal[]>;
}
