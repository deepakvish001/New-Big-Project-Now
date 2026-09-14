import test from 'node:test';
import assert from 'node:assert/strict';

import type { Catalogue, Product } from '../src/types.ts';
import {
  buildBatchRequests,
  enrichCatalogueBatched,
  planBatch,
  readBatchResult,
  toCustomId,
  waitForBatch,
} from '../src/enrich/batch.ts';
import type { BatchClient, BatchRequest } from '../src/enrich/batch.ts';

const NOW = new Date('2026-09-14T00:00:00Z');

function sock(id = 'p1'): Product {
  return {
    id,
    title: 'Kalinga Wool Merino Crew Sock',
    description:
      'Knitted from 17.5 micron merino wool. Composition is 80% merino wool, 18% nylon and 2% elastane. '
      + 'Machine wash at 30 C, do not tumble dry.',
    brand: 'Kalinga Wool',
    productType: 'Socks',
    options: [{ name: 'Size', values: ['M'] }],
    variants: [{ id: `${id}-v1`, price: 899 }],
  };
}

function catalogueOf(...products: Product[]): Catalogue {
  return { source: 'test', products };
}

const GOOD_JSON = JSON.stringify({
  proposals: [{
    key: 'Material',
    value: '80% merino wool, 18% nylon, 2% elastane',
    evidence: 'Composition is 80% merino wool, 18% nylon and 2% elastane',
    confidence: 0.95,
  }],
});

function succeeded(customId: string, text: string) {
  return {
    custom_id: customId,
    result: { type: 'succeeded', message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } },
  };
}

/* ------------------------------------------------------------------ custom ids */

test('custom ids are safe, bounded and unique per index', () => {
  assert.equal(toCustomId('merino-crew-sock', 0), 'p0-merino-crew-sock');
  assert.equal(toCustomId('shop/ürün #42', 3), 'p3-shop-r-n-42');
  assert.ok(toCustomId('x'.repeat(200), 9).length <= 64);
  assert.match(toCustomId('!!!', 1), /^[a-zA-Z0-9_-]+$/);
  assert.notEqual(toCustomId('same', 0), toCustomId('same', 1), 'duplicate ids must not collide');
});

/* ---------------------------------------------------------------------- plan */

test('planBatch sends only products that have gaps and content', () => {
  const filled = sock('filled');
  filled.attributes = { Material: 'merino', Care: 'wash cold', Fit: 'regular', Colour: 'charcoal' };
  const bare: Product = { id: 'bare', variants: [] };

  const { items, skipped } = planBatch(catalogueOf(sock('a'), filled, bare), NOW);

  assert.deepEqual(items.map((i) => i.product.id), ['a']);
  assert.equal(skipped.length, 2);
  assert.equal(skipped.find((s) => s.productId === 'bare')!.error, 'no merchant content to draw from');
  assert.equal(skipped.find((s) => s.productId === 'filled')!.error, undefined);
});

test('planBatch keeps the source text each request was built from', () => {
  const { items } = planBatch(catalogueOf(sock()), NOW);
  assert.match(items[0]!.sourceText, /Composition is 80% merino wool/);
});

/* ------------------------------------------------------------------- requests */

test('batch requests carry the model, the prompt and the output format', () => {
  const { items } = planBatch(catalogueOf(sock()), NOW);
  const [request] = buildBatchRequests(items, { model: 'claude-opus-5', outputFormat: { type: 'x' } });

  assert.equal(request!.custom_id, items[0]!.customId);
  assert.equal(request!.params['model'], 'claude-opus-5');
  assert.deepEqual(request!.params['thinking'], { type: 'adaptive' });
  assert.deepEqual(request!.params['output_config'], { format: { type: 'x' } });

  const messages = request!.params['messages'] as { content: string }[];
  assert.match(messages[0]!.content, /MERCHANT CONTENT/);
  assert.match(messages[0]!.content, /Material/);
});

test('the output format is omitted rather than sent as undefined', () => {
  const { items } = planBatch(catalogueOf(sock()), NOW);
  const [request] = buildBatchRequests(items);
  assert.ok(!('output_config' in request!.params));
});

/* --------------------------------------------------------------------- results */

test('a successful result yields proposals', () => {
  const outcome = readBatchResult(succeeded('p0-x', GOOD_JSON));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.proposals.length, 1);
});

test('every documented failure type is reported, not dropped', () => {
  const cases: [unknown, RegExp][] = [
    [{ result: { type: 'errored', error: { type: 'invalid_request', message: 'bad schema' } } }, /do not retry/],
    [{ result: { type: 'errored', error: { type: 'api_error', message: 'boom' } } }, /safe to retry/],
    [{ result: { type: 'canceled' } }, /cancelled/],
    [{ result: { type: 'expired' } }, /expired/],
    [{ result: { type: 'something_new' } }, /unrecognised/],
    [{}, /no outcome/],
  ];

  for (const [entry, pattern] of cases) {
    const outcome = readBatchResult(entry as never);
    assert.equal(outcome.ok, false);
    assert.match(!outcome.ok ? outcome.error : '', pattern);
  }
});

test('a refusal and a truncated reply are distinguished', () => {
  const refused = readBatchResult({
    custom_id: 'a',
    result: { type: 'succeeded', message: { stop_reason: 'refusal', stop_details: { category: 'cyber' } } },
  });
  assert.match(!refused.ok ? refused.error : '', /declined \(cyber\)/);

  const truncated = readBatchResult({
    custom_id: 'a',
    result: { type: 'succeeded', message: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] } },
  });
  assert.match(!truncated.ok ? truncated.error : '', /truncated/);
});

test('malformed JSON is an error, not a crash', () => {
  assert.match(
    (() => { const o = readBatchResult(succeeded('a', 'not json')); return !o.ok ? o.error : ''; })(),
    /not valid JSON/,
  );
  assert.match(
    (() => { const o = readBatchResult(succeeded('a', '{"other":1}')); return !o.ok ? o.error : ''; })(),
    /no proposals array/,
  );
  assert.match(
    (() => { const o = readBatchResult(succeeded('a', '')); return !o.ok ? o.error : ''; })(),
    /no text/,
  );
});

/* ---------------------------------------------------------------------- polling */

test('waitForBatch polls until the batch ends', async () => {
  const statuses = ['in_progress', 'in_progress', 'ended'];
  let calls = 0;
  let slept = 0;

  const client = {
    messages: {
      batches: {
        create: async () => ({ id: 'b1' }),
        retrieve: async () => ({ processing_status: statuses[calls++] ?? 'ended' }),
        results: async () => [],
      },
    },
  } as unknown as BatchClient;

  await waitForBatch(client, 'b1', { sleep: async () => { slept += 1; }, pollIntervalMs: 1 });
  assert.equal(calls, 3);
  assert.equal(slept, 2, 'no sleep after the final poll');
});

test('waitForBatch gives up after the timeout but says the batch survives', async () => {
  const client = {
    messages: {
      batches: {
        create: async () => ({ id: 'b1' }),
        retrieve: async () => ({ processing_status: 'in_progress' }),
        results: async () => [],
      },
    },
  } as unknown as BatchClient;

  await assert.rejects(
    waitForBatch(client, 'b1', { sleep: async () => {}, timeoutMs: -1 }),
    /keeps running server-side/,
  );
});

/* ----------------------------------------------------------------- end to end */

function fakeClient(reply: (requests: BatchRequest[]) => unknown[]): BatchClient & { sent: BatchRequest[] } {
  const state = { sent: [] as BatchRequest[] };
  return {
    sent: state.sent,
    messages: {
      batches: {
        create: async (body: { requests: BatchRequest[] }) => {
          state.sent.push(...body.requests);
          return { id: 'batch_test' };
        },
        retrieve: async () => ({ processing_status: 'ended' }),
        results: async () => reply(state.sent),
      },
    },
  } as BatchClient & { sent: BatchRequest[] };
}

test('the batched path verifies results exactly like the synchronous one', async () => {
  const client = fakeClient((sent) => sent.map((r) => succeeded(r.custom_id, GOOD_JSON)));
  const result = await enrichCatalogueBatched(catalogueOf(sock('a'), sock('b')), client, {
    now: NOW, outputFormat: { type: 'stub' },
  });

  assert.equal(result.batchId, 'batch_test');
  assert.equal(result.summary.accepted, 2);
  assert.equal(result.summary.rejected, 0);
});

test('fabricated evidence is rejected in batch mode too', async () => {
  const fabricated = JSON.stringify({
    proposals: [{
      key: 'Material', value: '100% Egyptian cotton',
      evidence: 'Woven from 100% Egyptian cotton in Coimbatore', confidence: 0.99,
    }],
  });
  const client = fakeClient((sent) => sent.map((r) => succeeded(r.custom_id, fabricated)));
  const result = await enrichCatalogueBatched(catalogueOf(sock()), client, {
    now: NOW, outputFormat: { type: 'stub' },
  });

  assert.equal(result.summary.accepted, 0);
  assert.equal(result.summary.rejected, 1);
  assert.match(result.products[0]!.proposals[0]!.reason!, /does not appear/);
});

test('a product whose result never arrives is reported, not silently empty', async () => {
  const client = fakeClient((sent) => [succeeded(sent[0]!.custom_id, GOOD_JSON)]);
  const result = await enrichCatalogueBatched(catalogueOf(sock('a'), sock('b')), client, {
    now: NOW, outputFormat: { type: 'stub' },
  });

  const missing = result.products.filter((p) => p.error === 'no result returned for this product');
  assert.equal(missing.length, 1);
  assert.equal(result.summary.failed, 1);
});

test('results for ids we never sent are ignored', async () => {
  const client = fakeClient((sent) => [
    succeeded(sent[0]!.custom_id, GOOD_JSON),
    succeeded('p99-not-ours', GOOD_JSON),
  ]);
  const result = await enrichCatalogueBatched(catalogueOf(sock('a')), client, {
    now: NOW, outputFormat: { type: 'stub' },
  });

  assert.equal(result.products.length, 1);
  assert.equal(result.summary.accepted, 1);
});

test('a catalogue with nothing to enrich never creates a batch', async () => {
  const filled = sock('filled');
  filled.attributes = { Material: 'merino', Care: 'wash cold', Fit: 'regular', Colour: 'charcoal' };

  const client = fakeClient(() => []);
  const result = await enrichCatalogueBatched(catalogueOf(filled), client, {
    now: NOW, outputFormat: { type: 'stub' },
  });

  assert.equal(client.sent.length, 0, 'the cheapest call is the one not made');
  assert.equal(result.batchId, undefined);
  assert.equal(result.summary.productsWithGaps, 0);
});
