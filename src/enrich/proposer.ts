import type { Product } from '../types.ts';
import type { Gap, Proposer, RawProposal } from './types.ts';
import { SYSTEM, buildPrompt } from './prompt.ts';
import { proposalSchema } from './schema.ts';

export const DEFAULT_MODEL = 'claude-opus-5';

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

    const [client, schema, { zodOutputFormat }] = await Promise.all([
      this.client(),
      proposalSchema(),
      import('@anthropic-ai/sdk/helpers/zod'),
    ]);

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
