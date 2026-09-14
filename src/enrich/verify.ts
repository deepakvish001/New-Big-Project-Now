import { isBlank, isPlaceholder } from '../util/text.ts';
import type { CheckedProposal, Gap, RawProposal } from './types.ts';

/** Below this, a proposal is not written without a human looking at it. */
export const ACCEPT_CONFIDENCE = 0.8;
/** Below this, a proposal is discarded entirely. */
export const REVIEW_CONFIDENCE = 0.5;

/** An evidence span shorter than this proves nothing — "wool" matches anything. */
const MIN_EVIDENCE_CHARS = 8;
const MAX_VALUE_CHARS = 300;

/**
 * Fold away the differences that are presentation, not substance: unicode
 * width, case, smart punctuation, and whitespace runs. Deliberately keeps
 * digits and letters intact — loosening further would let a fabricated value
 * slip through the containment check below.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Numbers carry the claims that hurt when wrong: grades, sizes, percentages. */
function numbersIn(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  // Normalise decimal commas so "17,5" and "17.5" compare equal.
  return matches.map((n) => n.replace(',', '.'));
}

export interface VerifyOptions {
  acceptConfidence?: number;
  reviewConfidence?: number;
}

/**
 * Checks one proposal against the merchant's own content.
 *
 * The model is never trusted about provenance. It reports an `evidence` span,
 * and this function independently confirms that span exists in the source and
 * that every number in the proposed value is present in that span. A quoted
 * span the model invented, or a real quote with a fabricated figure bolted on,
 * both fail here — which is the point, since a wrong fibre grade or dimension
 * becomes a return.
 */
export function verifyProposal(
  proposal: RawProposal,
  sourceText: string,
  allowedKeys: Set<string>,
  options: VerifyOptions = {},
): CheckedProposal {
  const accept = options.acceptConfidence ?? ACCEPT_CONFIDENCE;
  const review = options.reviewConfidence ?? REVIEW_CONFIDENCE;

  const reject = (reason: string): CheckedProposal => ({
    ...proposal,
    verdict: 'rejected',
    reason,
    evidenceFound: false,
  });

  if (typeof proposal.key !== 'string' || !allowedKeys.has(proposal.key)) {
    return reject(`"${proposal.key}" was not one of the attributes requested`);
  }

  if (typeof proposal.value !== 'string' || isBlank(proposal.value) || isPlaceholder(proposal.value)) {
    return reject('value is empty or a placeholder');
  }

  if (proposal.value.length > MAX_VALUE_CHARS) {
    return reject(`value is ${proposal.value.length} characters; attributes must stay short`);
  }

  if (typeof proposal.confidence !== 'number' || !Number.isFinite(proposal.confidence)) {
    return reject('confidence was not a number');
  }

  if (typeof proposal.evidence !== 'string') {
    return reject('no evidence supplied');
  }

  const evidence = normalise(proposal.evidence);
  if (evidence.length < MIN_EVIDENCE_CHARS) {
    return reject('evidence span is too short to prove anything');
  }

  const source = normalise(sourceText);
  if (!source.includes(evidence)) {
    return reject('evidence does not appear in the merchant’s own content');
  }

  const unsupported = numbersIn(normalise(proposal.value))
    .filter((n) => !numbersIn(evidence).includes(n));
  if (unsupported.length > 0) {
    return reject(`value states ${unsupported.join(', ')}, which the evidence does not`);
  }

  const confidence = Math.max(0, Math.min(1, proposal.confidence));
  if (confidence < review) {
    return {
      ...proposal,
      confidence,
      verdict: 'rejected',
      reason: `confidence ${confidence.toFixed(2)} is below the ${review} floor`,
      evidenceFound: true,
    };
  }

  return {
    ...proposal,
    confidence,
    verdict: confidence >= accept ? 'accepted' : 'needs_review',
    reason: confidence >= accept ? undefined : 'confidence is mid-range; confirm before publishing',
    evidenceFound: true,
  };
}

/**
 * Verifies a batch and keeps at most one proposal per attribute — the best
 * verdict, then the highest confidence. Two values for the same field would
 * otherwise both land in the export and one would silently win.
 */
export function verifyProposals(
  proposals: RawProposal[],
  sourceText: string,
  gaps: Gap[],
  options: VerifyOptions = {},
): CheckedProposal[] {
  const allowedKeys = new Set(gaps.map((gap) => gap.attributeKey));
  const checked = proposals.map((proposal) => verifyProposal(proposal, sourceText, allowedKeys, options));

  const rank: Record<CheckedProposal['verdict'], number> = {
    accepted: 2,
    needs_review: 1,
    rejected: 0,
  };

  const best = new Map<string, CheckedProposal>();
  const unkeyed: CheckedProposal[] = [];

  for (const proposal of checked) {
    if (!allowedKeys.has(proposal.key)) {
      // Keep it visible in the report rather than dropping it silently.
      unkeyed.push(proposal);
      continue;
    }
    const current = best.get(proposal.key);
    if (
      !current
      || rank[proposal.verdict] > rank[current.verdict]
      || (rank[proposal.verdict] === rank[current.verdict] && proposal.confidence > current.confidence)
    ) {
      best.set(proposal.key, proposal);
    }
  }

  return [...best.values(), ...unkeyed];
}
