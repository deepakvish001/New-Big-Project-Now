import type { RawProposal } from './types.ts';

/**
 * The shape a proposal must arrive in.
 *
 * Numeric ranges are not expressible in the API's JSON-schema subset, so
 * `confidence` is only typed as a number here and is bounded in
 * `verifyProposal`. Every other guarantee is enforced there too — the schema
 * buys well-formedness, never truthfulness.
 */
export async function proposalSchema() {
  const { z } = await import('zod');
  return z.object({
    proposals: z.array(
      z.object({
        key: z.string(),
        value: z.string(),
        evidence: z.string(),
        confidence: z.number(),
      }),
    ),
  });
}

/** Reads the model's JSON reply without trusting its shape. */
export function readProposals(text: string): RawProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('the reply was not valid JSON');
  }

  const list = (parsed as { proposals?: unknown })?.proposals;
  if (!Array.isArray(list)) throw new Error('the reply carried no proposals array');

  // Malformed entries are kept rather than dropped: the verifier rejects them
  // with a reason, which is more useful to a merchant than a silent omission.
  return list as RawProposal[];
}
