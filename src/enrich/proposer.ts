import type { Product } from '../types.ts';
import type { Gap, Proposer, RawProposal } from './types.ts';

export const DEFAULT_MODEL = 'claude-opus-5';

const SYSTEM = `You restructure a merchant's existing product copy into structured attributes for an AI shopping catalogue.

You are not a copywriter and not a product expert. You may only restate facts that are already present in the supplied content. You have no other source of truth.

For each requested attribute:
- If the supplied content states the fact, give it as a short attribute value and quote the exact span it came from.
- If the supplied content does not state it, omit that attribute entirely. Do not infer it from the product type, the brand, what is typical for the category, or what is likely.

Rules for every proposal:
- "evidence" must be an exact, contiguous, verbatim substring of the supplied content. It is checked against the source; a paraphrase or a reconstructed quote fails.
- Every number in "value" must also appear in "evidence". Never introduce a figure, grade, measurement or percentage the evidence does not contain.
- "value" is a short field value, not a sentence. "80% merino wool, 18% nylon, 2% elastane", not "This sock is made from a blend of...".
- "confidence" reflects how directly the evidence states the value: 0.9+ when the evidence states it outright, 0.5-0.8 when it requires interpretation, below 0.5 when you are unsure.

Returning fewer attributes is correct and expected. An omitted attribute costs nothing; a wrong one becomes a customer return.`;

function buildPrompt(product: Product, gaps: Gap[], sourceText: string): string {
  const wanted = gaps
    .map((gap) => {
      const hint = gap.currentSource === 'text'
        ? ' (the content appears to mention this already — promote it to a field)'
        : '';
      return `- ${gap.attributeKey}${hint}`;
    })
    .join('\n');

  return `Product: ${product.title ?? product.handle ?? product.id}

Attributes to fill, if and only if the content below supports them:
${wanted}

--- MERCHANT CONTENT (the only permitted source) ---
${sourceText}
--- END MERCHANT CONTENT ---`;
}

export interface ClaudeProposerOptions {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  /** Injectable for tests; defaults to a real client built on first use. */
  client?: unknown;
}

/**
 * Calls Claude to restructure existing copy into attributes.
 *
 * The SDK is imported lazily so that scoring — the part that must stay free and
 * dependency-light — never loads it.
 */
export class ClaudeProposer implements Proposer {
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly apiKey: string | undefined;
  private clientPromise: Promise<any> | undefined;

  constructor(options: ClaudeProposerOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? 4096;
    this.apiKey = options.apiKey;
    if (options.client) this.clientPromise = Promise.resolve(options.client);
  }

  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let Anthropic: any;
        try {
          ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
        } catch {
          throw new Error(
            'Enrichment needs the Anthropic SDK. Run: npm install @anthropic-ai/sdk zod',
          );
        }
        return this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : new Anthropic();
      })();
    }
    return this.clientPromise;
  }

  async propose(product: Product, gaps: Gap[], sourceText: string): Promise<RawProposal[]> {
    if (gaps.length === 0) return [];

    const [client, { z }, { zodOutputFormat }] = await Promise.all([
      this.client(),
      import('zod'),
      import('@anthropic-ai/sdk/helpers/zod'),
    ]);

    // Numeric ranges are not expressible in the API's JSON-schema subset, so
    // confidence is bounded in verifyProposal rather than here.
    const schema = z.object({
      proposals: z.array(
        z.object({
          key: z.string(),
          value: z.string(),
          evidence: z.string(),
          confidence: z.number(),
        }),
      ),
    });

    const response = await client.messages.parse({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(product, gaps, sourceText) }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined this product (${response.stop_details?.category ?? 'unknown'})`);
    }

    return response.parsed_output?.proposals ?? [];
  }
}

/** Returns nothing, for dry runs and for scoring the pipeline without spend. */
export class NullProposer implements Proposer {
  async propose(): Promise<RawProposal[]> {
    return [];
  }
}
