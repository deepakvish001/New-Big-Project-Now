import test from 'node:test';
import assert from 'node:assert/strict';

import type { Catalogue, Product } from '../src/types.ts';
import type { Gap, Proposer, RawProposal } from '../src/enrich/types.ts';
import { ATTRIBUTE_KEY, gapsFor, sourceTextFor } from '../src/enrich/gaps.ts';
import { normalise, verifyProposal, verifyProposals } from '../src/enrich/verify.ts';
import { applyAccepted, enrichCatalogue, enrichProduct, summarise } from '../src/enrich/index.ts';
import { NullProposer } from '../src/enrich/proposer.ts';

const NOW = new Date('2026-09-14T00:00:00Z');

function sock(): Product {
  return {
    id: 'p1',
    title: 'Kalinga Wool Merino Crew Sock',
    description:
      'Knitted from 17.5 micron merino wool. Composition is 80% merino wool, 18% nylon and 2% elastane. '
      + 'Machine wash at 30 C, do not tumble dry.',
    brand: 'Kalinga Wool',
    productType: 'Socks',
    tags: ['hiking'],
    options: [{ name: 'Size', values: ['M', 'L'] }],
    images: [{ url: 'a.jpg', alt: 'Charcoal sock' }],
    variants: [{ id: 'v1', price: 899 }],
  };
}

const SOURCE = sourceTextFor(sock());
const APPAREL_GAPS: Gap[] = [
  { dimension: 'material', attributeKey: 'Material', currentSource: 'text' },
  { dimension: 'care', attributeKey: 'Care', currentSource: 'text' },
];

function propose(over: Partial<RawProposal> = {}): RawProposal {
  return {
    key: 'Material',
    value: '80% merino wool, 18% nylon, 2% elastane',
    evidence: 'Composition is 80% merino wool, 18% nylon and 2% elastane',
    confidence: 0.95,
    ...over,
  };
}

function check(over: Partial<RawProposal> = {}, keys = ['Material', 'Care']) {
  return verifyProposal(propose(over), SOURCE, new Set(keys));
}

/* --------------------------------------------------------------------- gaps */

test('gaps skip dimensions already carried as an attribute or option', () => {
  const product = sock();
  product.attributes = { Material: 'merino' };
  const dimensions = gapsFor(product, NOW).map((g) => g.dimension);

  assert.ok(!dimensions.includes('material'), 'material is already an attribute');
  assert.ok(!dimensions.includes('size'), 'size is already an option');
  assert.ok(dimensions.includes('care'), 'care is only in prose');
});

test('a gap already mentioned in prose is marked for promotion', () => {
  const care = gapsFor(sock(), NOW).find((g) => g.dimension === 'care');
  assert.equal(care!.currentSource, 'text', 'the description states the wash instructions');

  const colour = gapsFor(sock(), NOW).find((g) => g.dimension === 'colour');
  assert.equal(colour!.currentSource, 'text', 'the image alt text names the colour');
});

test('every dimension has an attribute key', () => {
  for (const gap of gapsFor(sock(), NOW)) {
    assert.equal(gap.attributeKey, ATTRIBUTE_KEY[gap.dimension]);
  }
});

test('source text carries only the merchant’s own fields', () => {
  assert.match(SOURCE, /Title: Kalinga Wool Merino Crew Sock/);
  assert.match(SOURCE, /Option Size: M, L/);
  assert.match(SOURCE, /Image alt text: Charcoal sock/);
  assert.ok(!SOURCE.includes('899'), 'price is not evidence about attributes');
});

/* ----------------------------------------------------------------- verifier */

test('a well-evidenced, confident proposal is accepted', () => {
  const result = check();
  assert.equal(result.verdict, 'accepted');
  assert.equal(result.evidenceFound, true);
});

test('fabricated evidence is rejected even when the value is plausible', () => {
  const result = check({
    value: '100% organic cotton',
    evidence: 'Made from 100% organic cotton grown in Gujarat',
  });
  assert.equal(result.verdict, 'rejected');
  assert.match(result.reason!, /does not appear/);
});

test('a real quote with a fabricated number bolted on is rejected', () => {
  // The evidence is genuine; the 21.5 micron grade is not in it.
  const result = check({
    value: '21.5 micron merino',
    evidence: 'Knitted from 17.5 micron merino wool',
  });
  assert.equal(result.verdict, 'rejected');
  assert.match(result.reason!, /21\.5/);
});

test('a number that is present in the evidence passes the containment check', () => {
  const result = check({
    key: 'Material',
    value: '17.5 micron merino',
    evidence: 'Knitted from 17.5 micron merino wool',
  });
  assert.equal(result.verdict, 'accepted');
});

test('decimal commas and points compare equal', () => {
  const result = check({ value: '17,5 micron merino', evidence: 'Knitted from 17.5 micron merino wool' });
  assert.equal(result.verdict, 'accepted');
});

test('an attribute that was not requested is rejected', () => {
  const result = check({ key: 'Warranty' });
  assert.equal(result.verdict, 'rejected');
  assert.match(result.reason!, /not one of the attributes requested/);
});

test('a trivially short evidence span proves nothing', () => {
  const result = check({ value: 'wool', evidence: 'wool' });
  assert.equal(result.verdict, 'rejected');
  assert.match(result.reason!, /too short/);
});

test('mid-range confidence is held for review rather than published', () => {
  const result = check({ confidence: 0.62 });
  assert.equal(result.verdict, 'needs_review');
  assert.equal(result.evidenceFound, true);
});

test('low confidence is discarded even with good evidence', () => {
  const result = check({ confidence: 0.2 });
  assert.equal(result.verdict, 'rejected');
  assert.match(result.reason!, /below the 0.5 floor/);
});

test('confidence outside 0..1 is clamped, not trusted', () => {
  assert.equal(check({ confidence: 7 }).confidence, 1);
  assert.equal(check({ confidence: -3 }).verdict, 'rejected');
});

test('malformed proposals are rejected without throwing', () => {
  assert.match(check({ confidence: Number.NaN }).reason!, /not a number/);
  assert.match(check({ value: '' }).reason!, /empty or a placeholder/);
  assert.match(check({ value: 'N/A' }).reason!, /empty or a placeholder/);
  assert.match(check({ value: 'x'.repeat(400) }).reason!, /characters/);
  assert.match(check({ evidence: undefined as never }).reason!, /no evidence/);
  assert.match(check({ key: undefined as never }).reason!, /not one of the attributes/);
});

test('normalise folds case, smart punctuation and whitespace only', () => {
  assert.equal(normalise('  Merino   Wool '), 'merino wool');
  assert.equal(normalise('80%–90%'), '80%-90%');
  assert.equal(normalise('don’t'), "don't");
  assert.notEqual(normalise('17.5'), normalise('175'), 'digits must not be folded together');
});

test('evidence matching ignores whitespace and case differences in the source', () => {
  const result = verifyProposal(
    propose({ evidence: 'COMPOSITION IS 80%   merino wool, 18% nylon and 2% elastane' }),
    SOURCE,
    new Set(['Material']),
  );
  assert.equal(result.verdict, 'accepted');
});

test('duplicate proposals for one attribute collapse to the best', () => {
  const checked = verifyProposals(
    [
      propose({ confidence: 0.55 }),
      propose({ confidence: 0.95 }),
      propose({ value: 'polyester', evidence: 'Made entirely of polyester fibre' }),
    ],
    SOURCE,
    APPAREL_GAPS,
  );

  const material = checked.filter((p) => p.key === 'Material');
  assert.equal(material.length, 1, 'one winner per attribute');
  assert.equal(material[0]!.verdict, 'accepted');
  assert.equal(material[0]!.confidence, 0.95);
});

test('a rejected out-of-scope key still appears in the report', () => {
  const checked = verifyProposals([propose({ key: 'Warranty' })], SOURCE, APPAREL_GAPS);
  assert.equal(checked.length, 1);
  assert.equal(checked[0]!.verdict, 'rejected');
});

/* ------------------------------------------------------------- orchestration */

class FakeProposer implements Proposer {
  calls = 0;
  readonly reply: (p: Product) => RawProposal[];

  constructor(reply: (p: Product) => RawProposal[]) {
    this.reply = reply;
  }

  async propose(product: Product): Promise<RawProposal[]> {
    this.calls += 1;
    return this.reply(product);
  }
}

test('enrichProduct verifies whatever the proposer returns', async () => {
  const proposer = new FakeProposer(() => [propose(), propose({ key: 'Care', value: 'Machine wash at 30 C', evidence: 'Machine wash at 30 C, do not tumble dry' })]);
  const result = await enrichProduct(sock(), proposer, { now: NOW });

  assert.equal(proposer.calls, 1);
  assert.equal(result.proposals.filter((p) => p.verdict === 'accepted').length, 2);
});

test('a proposer failure is captured per product, not thrown', async () => {
  const boom: Proposer = { propose: async () => { throw new Error('rate limited'); } };
  const result = await enrichProduct(sock(), boom, { now: NOW });
  assert.equal(result.error, 'rate limited');
  assert.deepEqual(result.proposals, []);
});

test('a product with no gaps never reaches the proposer', async () => {
  const product = sock();
  product.attributes = {
    Material: 'merino', Care: 'wash cold', Fit: 'regular', Colour: 'charcoal',
  };
  const proposer = new FakeProposer(() => [propose()]);
  const result = await enrichProduct(product, proposer, { now: NOW });

  assert.equal(proposer.calls, 0, 'no gaps means no spend');
  assert.deepEqual(result.gaps, []);
});

test('a product with nothing to draw from is skipped with a reason', async () => {
  const empty: Product = { id: 'bare', variants: [] };
  const proposer = new FakeProposer(() => [propose()]);
  const result = await enrichProduct(empty, proposer, { now: NOW });

  assert.equal(proposer.calls, 0);
  assert.equal(result.error, 'no merchant content to draw from');
});

test('enrichCatalogue processes every product and reports progress', async () => {
  const products = Array.from({ length: 7 }, (_, i) => ({ ...sock(), id: `p${i}` }));
  const catalogue: Catalogue = { source: 'test', products };
  const seen: number[] = [];

  const result = await enrichCatalogue(catalogue, new FakeProposer(() => [propose()]), {
    concurrency: 3,
    now: NOW,
    onProgress: (done) => seen.push(done),
  });

  assert.equal(result.products.length, 7);
  assert.equal(result.products.filter(Boolean).length, 7, 'no holes in the results array');
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
});

test('enrichCatalogue honours the limit so a first run stays cheap', async () => {
  const products = Array.from({ length: 10 }, (_, i) => ({ ...sock(), id: `p${i}` }));
  const proposer = new FakeProposer(() => [propose()]);

  await enrichCatalogue({ source: 'test', products }, proposer, { limit: 3, now: NOW });
  assert.equal(proposer.calls, 3);
});

test('the null proposer produces gaps but no spend', async () => {
  const result = await enrichCatalogue(
    { source: 'test', products: [sock()] },
    new NullProposer(),
    { now: NOW },
  );
  assert.ok(result.summary.productsWithGaps > 0);
  assert.equal(result.summary.proposed, 0);
});

test('only accepted proposals are applied, and existing values are never overwritten', () => {
  const product = sock();
  product.attributes = { Care: 'Hand wash only' };

  const applied = applyAccepted(product, {
    productId: product.id,
    title: product.title!,
    gaps: APPAREL_GAPS,
    proposals: [
      { ...propose(), verdict: 'accepted', evidenceFound: true },
      { ...propose({ key: 'Care', value: 'Machine wash 30 C' }), verdict: 'needs_review', evidenceFound: true },
    ],
  });

  assert.equal(applied.attributes!['Material'], '80% merino wool, 18% nylon, 2% elastane');
  assert.equal(applied.attributes!['Care'], 'Hand wash only', 'the merchant’s own value wins');
  assert.notEqual(product.attributes!['Material'], applied.attributes!['Material'], 'input is not mutated');
});

test('summarise counts every verdict', () => {
  const summary = summarise([
    {
      productId: 'a', title: 'A', gaps: APPAREL_GAPS,
      proposals: [
        { ...propose(), verdict: 'accepted' },
        { ...propose(), verdict: 'needs_review' },
        { ...propose(), verdict: 'rejected' },
      ],
    },
    { productId: 'b', title: 'B', gaps: [], proposals: [] },
    { productId: 'c', title: 'C', gaps: APPAREL_GAPS, proposals: [], error: 'boom' },
  ]);

  assert.deepEqual(summary, {
    productsConsidered: 3,
    productsWithGaps: 2,
    proposed: 3,
    accepted: 1,
    needsReview: 1,
    rejected: 1,
    failed: 1,
  });
});
