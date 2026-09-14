import type { Catalogue, Product } from '../types.ts';
import { gapsFor, sourceTextFor } from './gaps.ts';
import { SYSTEM, buildPrompt } from './prompt.ts';
import { proposalSchema, readProposals } from './schema.ts';
import { verifyProposals } from './verify.ts';
import { summarise } from './index.ts';
import type { EnrichmentResult, Gap, ProductProposals, RawProposal } from './types.ts';
import type { VerifyOptions } from './verify.ts';

export const DEFAULT_MODEL = 'claude-opus-5';

/** One product's worth of work, resolved before anything is sent. */
export interface BatchItem {
  product: Product;
  gaps: Gap[];
  sourceText: string;
  customId: string;
}

export interface BatchRequest {
  custom_id: string;
  params: Record<string, unknown>;
}

/**
 * The API requires a short, unique, alphanumeric id per request. Product ids
 * are none of those things — handles carry slashes and unicode, feed ids
 * repeat — so the id is derived and the mapping kept, never assumed.
 */
export function toCustomId(productId: string, index: number): string {
  const safe = productId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
  return `p${index}-${safe}` || `p${index}`;
}

/**
 * Resolves which products are worth sending. Products with no gaps, or with no
 * content to draw from, never reach the API — the cheapest call is the one not
 * made.
 */
export function planBatch(catalogue: Catalogue, now: Date = new Date()): {
  items: BatchItem[];
  skipped: ProductProposals[];
} {
  const items: BatchItem[] = [];
  const skipped: ProductProposals[] = [];

  catalogue.products.forEach((product, index) => {
    const gaps = gapsFor(product, now);
    const base = {
      productId: product.id,
      title: product.title ?? product.handle ?? product.id,
      gaps,
      proposals: [],
    };

    if (gaps.length === 0) {
      skipped.push(base);
      return;
    }

    const sourceText = sourceTextFor(product);
    if (sourceText.trim() === '') {
      skipped.push({ ...base, error: 'no merchant content to draw from' });
      return;
    }

    items.push({ product, gaps, sourceText, customId: toCustomId(product.id, index) });
  });

  return { items, skipped };
}

export interface BuildOptions {
  model?: string;
  maxTokens?: number;
  /** The `output_config.format` value; supplied by the caller so this stays pure. */
  outputFormat?: unknown;
}

export function buildBatchRequests(items: BatchItem[], options: BuildOptions = {}): BatchRequest[] {
  return items.map((item) => ({
    custom_id: item.customId,
    params: {
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: options.maxTokens ?? 4096,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(item.product, item.gaps, item.sourceText) }],
      ...(options.outputFormat ? { output_config: { format: options.outputFormat } } : {}),
    },
  }));
}

/** What one entry of the results stream means for one product. */
export type BatchOutcome =
  | { ok: true; proposals: RawProposal[] }
  | { ok: false; error: string };

/**
 * Reads a single batch result. Every failure mode the API documents is handled
 * explicitly, because a silently dropped result is a product the merchant
 * believes was processed.
 */
export function readBatchResult(entry: {
  custom_id?: string;
  result?: { type?: string; message?: unknown; error?: { type?: string; message?: string } };
}): BatchOutcome {
  const result = entry.result;
  if (!result) return { ok: false, error: 'result entry carried no outcome' };

  switch (result.type) {
    case 'succeeded': break;
    case 'errored':
      return {
        ok: false,
        error: result.error?.type === 'invalid_request'
          ? `rejected as invalid: ${result.error?.message ?? 'no detail'} (do not retry unchanged)`
          : `server error: ${result.error?.message ?? result.error?.type ?? 'unknown'} (safe to retry)`,
      };
    case 'canceled': return { ok: false, error: 'the batch was cancelled before this request ran' };
    case 'expired': return { ok: false, error: 'expired after 24 hours; resubmit' };
    default: return { ok: false, error: `unrecognised result type "${result.type}"` };
  }

  const message = result.message as {
    stop_reason?: string;
    stop_details?: { category?: string };
    content?: { type?: string; text?: string }[];
  } | undefined;

  if (message?.stop_reason === 'refusal') {
    return { ok: false, error: `Claude declined (${message.stop_details?.category ?? 'unknown'})` };
  }
  if (message?.stop_reason === 'max_tokens') {
    return { ok: false, error: 'reply hit max_tokens and is truncated; raise it and resubmit' };
  }

  const text = (message?.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('');

  if (text.trim() === '') return { ok: false, error: 'reply carried no text' };

  try {
    return { ok: true, proposals: readProposals(text) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** The slice of the SDK this module needs; narrow so a fake is trivial. */
export interface BatchClient {
  messages: {
    batches: {
      create(body: { requests: BatchRequest[] }): Promise<{ id: string; processing_status?: string }>;
      retrieve(id: string): Promise<{
        processing_status?: string;
        request_counts?: Record<string, number>;
      }>;
      results(id: string): Promise<AsyncIterable<any>> | AsyncIterable<any>;
    };
  };
}

export interface BatchRunOptions extends VerifyOptions {
  model?: string;
  maxTokens?: number;
  now?: Date;
  /** How often to ask whether the batch has ended. */
  pollIntervalMs?: number;
  /** Give up waiting after this long. The batch itself keeps running. */
  timeoutMs?: number;
  onProgress?: (phase: string, detail?: string) => void;
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Skip the structured-output format, e.g. when a fake client ignores it. */
  outputFormat?: unknown;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForBatch(
  client: BatchClient,
  id: string,
  options: BatchRunOptions = {},
): Promise<void> {
  const interval = options.pollIntervalMs ?? 30_000;
  const timeout = options.timeoutMs ?? 24 * 60 * 60 * 1000;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  for (;;) {
    const batch = await client.messages.batches.retrieve(id);
    if (batch.processing_status === 'ended') return;

    if (Date.now() - startedAt > timeout) {
      throw new Error(
        `batch ${id} was still ${batch.processing_status ?? 'processing'} after the timeout; `
        + 'it keeps running server-side and its results stay available for 29 days',
      );
    }

    const counts = batch.request_counts;
    options.onProgress?.(
      'polling',
      counts ? Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') : undefined,
    );
    await sleep(interval);
  }
}

/**
 * Enriches a whole catalogue through the Batches API: asynchronous, and half
 * the price of one request per product. Verification is identical to the
 * synchronous path — only the transport differs.
 */
export async function enrichCatalogueBatched(
  catalogue: Catalogue,
  client: BatchClient,
  options: BatchRunOptions = {},
): Promise<EnrichmentResult & { batchId?: string }> {
  const { items, skipped } = planBatch(catalogue, options.now ?? new Date());

  if (items.length === 0) {
    return { ...emptyResult(skipped), batchId: undefined };
  }

  let outputFormat = options.outputFormat;
  if (outputFormat === undefined) {
    const [schema, { zodOutputFormat }] = await Promise.all([
      proposalSchema(),
      import('@anthropic-ai/sdk/helpers/zod'),
    ]);
    outputFormat = zodOutputFormat(schema);
  }

  const requests = buildBatchRequests(items, {
    model: options.model,
    maxTokens: options.maxTokens,
    outputFormat,
  });

  options.onProgress?.('creating', `${requests.length} requests`);
  const batch = await client.messages.batches.create({ requests });

  await waitForBatch(client, batch.id, options);

  options.onProgress?.('reading', batch.id);
  const byCustomId = new Map(items.map((item) => [item.customId, item]));
  const results = new Map<string, ProductProposals>();

  for await (const entry of await client.messages.batches.results(batch.id)) {
    const item = byCustomId.get(entry.custom_id);
    // An id we never sent means the batch is not the one we built.
    if (!item) continue;

    const base: ProductProposals = {
      productId: item.product.id,
      title: item.product.title ?? item.product.handle ?? item.product.id,
      gaps: item.gaps,
      proposals: [],
    };

    const outcome = readBatchResult(entry);
    results.set(
      item.customId,
      outcome.ok
        ? { ...base, proposals: verifyProposals(outcome.proposals, item.sourceText, item.gaps, options) }
        : { ...base, error: outcome.error },
    );
  }

  // A request that never came back is reported, not quietly treated as empty.
  for (const item of items) {
    if (results.has(item.customId)) continue;
    results.set(item.customId, {
      productId: item.product.id,
      title: item.product.title ?? item.product.handle ?? item.product.id,
      gaps: item.gaps,
      proposals: [],
      error: 'no result returned for this product',
    });
  }

  const products = [...skipped, ...results.values()];
  return { summary: summarise(products), products, batchId: batch.id };
}

function emptyResult(skipped: ProductProposals[]): EnrichmentResult {
  return { summary: summarise(skipped), products: skipped };
}
