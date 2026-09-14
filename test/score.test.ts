import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { Catalogue, Product } from '../src/types.ts';
import { catalogueFromProductsJson } from '../src/adapters/shopify.ts';
import { applicableRules } from '../src/index.ts';
import { RULES, ruleById } from '../src/rules/index.ts';
import { detectBucket, dimensionEvidence } from '../src/rules/context.ts';
import { gradeFor, scoreCatalogue, scoreProduct } from '../src/score.ts';

const NOW = new Date('2026-09-14T00:00:00Z');

const productsJson = JSON.parse(
  await readFile(new URL('../fixtures/sample-products.json', import.meta.url), 'utf8'),
);

function wellFormed(): Product {
  return {
    id: 'p1',
    title: 'Kalinga Wool Merino Crew Sock — Charcoal, 17.5 micron',
    description:
      'Knitted from 17.5 micron merino wool so it insulates between 0 and 15 degrees without itching. '
      + 'Composition is 80 percent merino wool, 18 percent nylon and 2 percent elastane. Cushioned heel '
      + 'and arch band designed for hiking and long walks. Machine wash at 30 C, do not tumble dry.',
    brand: 'Kalinga Wool',
    productType: 'Socks',
    category: 'Apparel & Accessories > Clothing > Underwear & Socks',
    tags: ['hiking', 'merino'],
    updatedAt: '2026-09-12T00:00:00Z',
    attributes: {
      Material: '80% merino wool, 18% nylon, 2% elastane',
      Care: 'Machine wash 30 C',
      'Use case': 'Hiking, cold weather',
      Fit: 'Regular fit',
      Colour: 'Charcoal',
      'Fibre grade': '17.5 micron',
    },
    options: [{ name: 'Size', values: ['M', 'L'] }],
    images: [
      { url: 'a.jpg', alt: 'front' },
      { url: 'b.jpg', alt: 'worn' },
      { url: 'c.jpg', alt: 'texture' },
    ],
    variants: [
      {
        id: 'v1', sku: 'KW-1', gtin: '8901234567890', price: 899, currency: 'INR',
        available: true, inventoryQuantity: 24,
      },
    ],
  };
}

test('a fully populated product scores near the top', () => {
  const score = scoreProduct(wellFormed(), { now: NOW });
  assert.ok(score.score >= 95, `expected >= 95, got ${score.score}`);
  assert.equal(score.findings.filter((f) => f.severity === 'blocker').length, 0);
});

test('an empty product scores zero and reports every rule', () => {
  const bare: Product = { id: 'empty', variants: [] };
  const score = scoreProduct(bare, { now: NOW });
  assert.equal(score.score, 0);
  // Alt text is n/a with no images, so every other rule should have fired.
  assert.equal(score.findings.length, RULES.length - 1);
});

test('findings are ordered by points lost', () => {
  const bare: Product = { id: 'empty', variants: [] };
  const { findings } = scoreProduct(bare, { now: NOW });
  const lost = findings.map((f) => f.lost);
  assert.deepEqual(lost, [...lost].sort((a, b) => b - a));
});

test('a malformed GTIN earns no credit and is named as malformed', () => {
  const product = wellFormed();
  product.variants[0]!.gtin = '12345';
  const finding = scoreProduct(product, { now: NOW }).findings.find((f) => f.ruleId === 'identity.gtin');
  assert.ok(finding, 'expected a GTIN finding');
  assert.equal(finding!.lost, finding!.weight);
  assert.match(finding!.detail!, /check digit/);
});

test('a free-text product type earns partial credit, no category earns none', () => {
  const partial = wellFormed();
  delete partial.category;
  const partialOutcome = ruleById('identity.category')!.evaluate(partial, {
    bucket: 'apparel', expectedDimensions: [], now: NOW,
  });
  assert.equal(partialOutcome.status, 'partial');

  delete partial.productType;
  const noneOutcome = ruleById('identity.category')!.evaluate(partial, {
    bucket: 'apparel', expectedDimensions: [], now: NOW,
  });
  assert.equal(noneOutcome.status, 'fail');
});

test('freshness decays with age', () => {
  const rule = ruleById('commerce.freshness')!;
  const ctx = { bucket: 'general' as const, expectedDimensions: [], now: NOW };
  const at = (iso: string) => rule.evaluate({ ...wellFormed(), updatedAt: iso }, ctx);

  assert.equal(at('2026-09-12T00:00:00Z').status, 'pass');
  assert.equal(at('2026-08-25T00:00:00Z').ratio, 0.5);
  assert.equal(at('2026-01-01T00:00:00Z').ratio, 0);
  assert.equal(at('not a date').status, 'fail');
});

test('structured attributes outrank the same fact buried in description text', () => {
  const structured = wellFormed();
  const textOnly = wellFormed();
  delete textOnly.attributes;

  const a = scoreProduct(structured, { now: NOW }).score;
  const b = scoreProduct(textOnly, { now: NOW }).score;
  assert.ok(a > b, `structured (${a}) should beat text-only (${b})`);
});

test('dimension evidence reports its source', () => {
  const product = wellFormed();
  assert.equal(dimensionEvidence(product, 'material').source, 'attribute');

  const textOnly = wellFormed();
  delete textOnly.attributes;
  textOnly.options = [];
  assert.equal(dimensionEvidence(textOnly, 'material').source, 'text');

  const silent: Product = { id: 'x', variants: [], title: 'Thing' };
  assert.equal(dimensionEvidence(silent, 'material').source, 'none');
});

test('category buckets pick the expected dimensions', () => {
  assert.equal(detectBucket({ id: 'a', variants: [], title: 'Running Shoe' }), 'footwear');
  assert.equal(detectBucket({ id: 'b', variants: [], productType: 'Kurta' }), 'apparel');
  assert.equal(detectBucket({ id: 'c', variants: [], title: 'USB-C Charger' }), 'electronics');
  assert.equal(detectBucket({ id: 'd', variants: [], title: 'Mystery Box' }), 'general');
});

test('grade bands map as documented', () => {
  assert.equal(gradeFor(92), 'A');
  assert.equal(gradeFor(85), 'A');
  assert.equal(gradeFor(70), 'B');
  assert.equal(gradeFor(55), 'C');
  assert.equal(gradeFor(40), 'D');
  assert.equal(gradeFor(39.9), 'F');
});

test('catalogue roll-up ranks impacts and counts invisible products', () => {
  const catalogue = catalogueFromProductsJson(productsJson);
  const result = scoreCatalogue(catalogue, { rules: applicableRules(catalogue), now: NOW });

  assert.equal(result.productCount, 3);
  assert.ok(result.score > 0 && result.score < 100);
  assert.ok(result.invisibleCount >= 1, 'the placeholder product should be invisible');
  assert.equal(result.invisibleShare, Math.round((result.invisibleCount / 3) * 1000) / 10);

  const costs = result.topImpacts.map((i) => i.catalogueCost);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
});

test('blind rules are dropped rather than failed', () => {
  const catalogue = catalogueFromProductsJson(productsJson);
  const rules = applicableRules(catalogue);
  assert.ok(!rules.some((r) => r.id === 'identity.gtin'));

  const result = scoreCatalogue(catalogue, { rules, now: NOW });
  assert.ok(!result.topImpacts.some((i) => i.ruleId === 'identity.gtin'));

  const withAll = scoreCatalogue(catalogue, { now: NOW });
  assert.ok(
    result.score > withAll.score,
    'dropping an unobservable rule must not penalise the merchant',
  );
});

test('group scores are sorted worst first and stay within range', () => {
  const catalogue = catalogueFromProductsJson(productsJson);
  const result = scoreCatalogue(catalogue, { rules: applicableRules(catalogue), now: NOW });
  const scores = result.groups.map((g) => g.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  for (const group of result.groups) {
    assert.ok(group.score >= 0 && group.score <= 100, `${group.group} out of range`);
  }
});

test('an empty catalogue scores zero without dividing by zero', () => {
  const empty: Catalogue = { source: 'test', products: [] };
  const result = scoreCatalogue(empty, { now: NOW });
  assert.equal(result.score, 0);
  assert.equal(result.invisibleShare, 0);
  assert.equal(result.grade, 'F');
});
