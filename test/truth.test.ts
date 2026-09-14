import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { Catalogue, Variant } from '../src/types.ts';
import {
  catalogueFromGoogleFeed,
  parseAvailability,
  parseFeedPrice,
} from '../src/adapters/google-feed.ts';
import { catalogueFromShopifyCsv } from '../src/adapters/shopify-csv.ts';
import { keysFor, matchSurfaces, reconcile, titleOverlap } from '../src/truth/index.ts';
import type { NamedCatalogue } from '../src/truth/index.ts';
import { detectCsvKind, resolveSurfaceNames } from '../src/cli.ts';

const feedTsv = await readFile(new URL('../fixtures/sample-google-feed.tsv', import.meta.url), 'utf8');
const exportCsv = await readFile(new URL('../fixtures/sample-export.csv', import.meta.url), 'utf8');

/* ------------------------------------------------------------ feed adapter */

test('feed prices split the amount from an explicit ISO code', () => {
  assert.deepEqual(parseFeedPrice('899.00 INR'), { amount: 899, currency: 'INR' });
  assert.deepEqual(parseFeedPrice('12.99 USD'), { amount: 12.99, currency: 'USD' });
});

test('thousands separators are stripped and decimal commas honoured', () => {
  assert.equal(parseFeedPrice('1,299.00 INR').amount, 1299);
  assert.equal(parseFeedPrice('1.299,00 EUR').amount, 1299);
  assert.equal(parseFeedPrice('12,99 EUR').amount, 12.99);
  assert.equal(parseFeedPrice('1,299 INR').amount, 1299);
});

test('a currency is never guessed when none is stated', () => {
  assert.deepEqual(parseFeedPrice('899.00'), { amount: 899 });
  assert.equal(parseFeedPrice('₹899').currency, undefined);
  assert.deepEqual(parseFeedPrice(''), {});
  assert.deepEqual(parseFeedPrice(undefined), {});
});

test('availability maps only known vocabulary', () => {
  assert.equal(parseAvailability('in stock'), true);
  assert.equal(parseAvailability('in_stock'), true);
  assert.equal(parseAvailability('preorder'), true);
  assert.equal(parseAvailability('out of stock'), false);
  assert.equal(parseAvailability('discontinued'), false);
  assert.equal(parseAvailability('maybe'), undefined, 'unknown words must not become a claim');
  assert.equal(parseAvailability(undefined), undefined);
});

test('feed rows group into products by item_group_id', () => {
  const catalogue = catalogueFromGoogleFeed(feedTsv);
  assert.equal(catalogue.products.length, 2, 'two groups: charcoal and navy');

  const charcoal = catalogue.products.find((p) => p.id === 'merino-crew-sock')!;
  assert.equal(charcoal.variants.length, 2);
  assert.equal(charcoal.brand, 'Kalinga Wool');
  assert.equal(charcoal.variants[0]!.price, 949);
  assert.equal(charcoal.variants[0]!.currency, 'INR');
});

test('a feed declares what it cannot carry', () => {
  const catalogue = catalogueFromGoogleFeed(feedTsv);
  assert.ok(catalogue.blindRules!.includes('commerce.freshness'));
  assert.ok(catalogue.limitations!.some((l) => /XML\/RSS/.test(l)));
});

test('CSV kind is detected from the header', () => {
  assert.equal(detectCsvKind(exportCsv), 'shopify');
  assert.equal(detectCsvKind(feedTsv), 'google');
  assert.equal(detectCsvKind('id,title,price\n1,x,2'), 'google');
});

/* ---------------------------------------------------------------- matching */

function variant(over: Partial<Variant> = {}): Variant {
  return { id: 'v', ...over };
}

test('identity keys are emitted strongest first', () => {
  const keys = keysFor({
    surface: 'a', productId: 'p', productTitle: 'P', handle: 'p',
    variant: variant({ gtin: '8901234567890', sku: 'ABC' }),
  });
  assert.deepEqual(keys.map((k) => k.kind), ['gtin', 'sku', 'handle']);
  assert.equal(keys[0]!.key, '8901234567890');
});

test('an invalid GTIN or placeholder SKU yields no key', () => {
  const keys = keysFor({
    surface: 'a', productId: 'p', productTitle: 'P', handle: 'p',
    variant: variant({ gtin: '12345', sku: 'N/A' }),
  });
  assert.deepEqual(keys.map((k) => k.kind), ['handle'], 'a bad identifier must not join variants');
});

test('handle keys include the option values so variants stay distinct', () => {
  const base = { surface: 'a', productId: 'p', productTitle: 'P', handle: 'sock' };
  const m = keysFor({ ...base, variant: variant({ optionValues: { Size: 'M' } }) })[0]!.key;
  const l = keysFor({ ...base, variant: variant({ optionValues: { Size: 'L' } }) })[0]!.key;
  assert.notEqual(m, l);
});

function surface(name: string, variants: Variant[], title = 'Sock'): NamedCatalogue {
  return {
    surface: name,
    catalogue: {
      source: name,
      products: [{ id: 'sock', handle: 'sock', title, variants }],
    } satisfies Catalogue,
  };
}

test('a GTIN match wins over a coincidental SKU match', () => {
  const { groups } = matchSurfaces([
    surface('a', [variant({ id: '1', gtin: '8901234567890', sku: 'SHARED' })]),
    surface('b', [
      variant({ id: '2', gtin: '8901234567890', sku: 'OTHER' }),
      variant({ id: '3', sku: 'SHARED' }),
    ]),
  ]);

  const gtinGroup = groups.find((g) => g.kind === 'gtin');
  assert.ok(gtinGroup, 'the GTIN pair should match');
  assert.equal(gtinGroup!.members.length, 2);
  assert.ok(!groups.some((g) => g.kind === 'sku'), 'the SHARED sku was already consumed');
});

test('an identifier reused inside one surface is reported, not matched', () => {
  const { groups, duplicates } = matchSurfaces([
    surface('a', [
      variant({ id: '1', gtin: '8901234567890' }),
      variant({ id: '2', gtin: '8901234567890' }),
    ]),
    surface('b', [variant({ id: '3', gtin: '8901234567890' })]),
  ]);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0]!.surface, 'a');
  assert.equal(duplicates[0]!.count, 2);
  assert.ok(!groups.some((g) => g.kind === 'gtin'), 'an ambiguous key must not be guessed at');
});

test('a group needs two distinct surfaces to count as a match', () => {
  const { groups, unmatched } = matchSurfaces([
    surface('a', [variant({ id: '1', sku: 'ONLY-A' })]),
    surface('b', [variant({ id: '2', sku: 'ONLY-B' })]),
  ]);
  assert.equal(groups.length, 0);
  assert.equal(unmatched.length, 2);
});

/* --------------------------------------------------------------- comparing */

test('a price mismatch on two sellable surfaces is critical', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', price: 899, available: true })]),
    surface('feed', [variant({ gtin: '8901234567890', price: 949, available: true })]),
  ]);

  const price = result.discrepancies.find((d) => d.kind === 'price_mismatch');
  assert.ok(price);
  assert.equal(price!.severity, 'critical');
  assert.match(price!.summary, /differ by 50.00/);
  assert.deepEqual(price!.perSurface.map((p) => p.surface), ['shop', 'feed']);
});

test('a price mismatch on an unsellable item is major, not critical', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', price: 899, available: false })]),
    surface('feed', [variant({ gtin: '8901234567890', price: 949, available: false })]),
  ]);
  assert.equal(result.discrepancies.find((d) => d.kind === 'price_mismatch')!.severity, 'major');
});

test('float noise below the tolerance is not a discrepancy', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', price: 899.0 })]),
    surface('feed', [variant({ gtin: '8901234567890', price: 899.001 })]),
  ]);
  assert.equal(result.discrepancies.length, 0);
  assert.equal(result.summary.agreementRate, 100);
});

test('one surface selling what another says is gone is critical', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', available: true })]),
    surface('feed', [variant({ gtin: '8901234567890', available: false })]),
  ]);
  const issue = result.discrepancies.find((d) => d.kind === 'availability_mismatch');
  assert.equal(issue!.severity, 'critical');
});

test('an unstated availability is not treated as a mismatch', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', available: true })]),
    surface('feed', [variant({ gtin: '8901234567890' })]),
  ]);
  assert.ok(!result.discrepancies.some((d) => d.kind === 'availability_mismatch'));
});

test('the same item priced in two currencies is critical', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', price: 899, currency: 'INR' })]),
    surface('feed', [variant({ gtin: '8901234567890', price: 899, currency: 'USD' })]),
  ]);
  const issue = result.discrepancies.find((d) => d.kind === 'currency_mismatch');
  assert.equal(issue!.severity, 'critical');
  assert.match(issue!.summary, /INR and USD/);
});

test('title drift is reported only when the titles really diverge', () => {
  const near = reconcile([
    { ...surface('shop', [variant({ gtin: '8901234567890' })], 'Merino Wool Crew Sock Charcoal') },
    { ...surface('feed', [variant({ gtin: '8901234567890' })], 'Merino Wool Crew Sock - Charcoal') },
  ]);
  assert.ok(!near.discrepancies.some((d) => d.kind === 'title_drift'), 'punctuation is not drift');

  const far = reconcile([
    { ...surface('shop', [variant({ gtin: '8901234567890' })], 'Merino Wool Crew Sock') },
    { ...surface('feed', [variant({ gtin: '8901234567890' })], 'Stainless Steel Water Bottle') },
  ]);
  assert.equal(far.discrepancies.find((d) => d.kind === 'title_drift')!.severity, 'minor');
});

test('titleOverlap ignores short words and ordering', () => {
  assert.equal(titleOverlap('Merino Wool Sock', 'Sock Wool Merino'), 1);
  assert.ok(titleOverlap('Merino Wool Sock', 'Cotton Water Bottle') < 0.2);
  assert.equal(titleOverlap('', 'anything'), 1, 'an empty title cannot have drifted');
});

test('unmatched items are only reported when asked for', () => {
  const surfaces = [
    surface('shop', [variant({ id: '1', sku: 'ONLY-SHOP' })]),
    surface('feed', [variant({ id: '2', sku: 'ONLY-FEED' })]),
  ];

  assert.equal(reconcile(surfaces).discrepancies.length, 0);

  const loud = reconcile(surfaces, { reportUnmatched: true });
  assert.equal(loud.discrepancies.filter((d) => d.kind === 'missing_from_surface').length, 2);
});

test('discrepancies are ordered worst first', () => {
  const result = reconcile([
    surface('shop', [
      variant({ id: '1', gtin: '8901234567890', price: 899, available: true }),
      variant({ id: '2', gtin: '8901234567906' }),
    ], 'Merino Wool Crew Sock'),
    { ...surface('feed', [
      variant({ id: '3', gtin: '8901234567890', price: 949, available: true }),
      variant({ id: '4', gtin: '8901234567906' }),
    ], 'Stainless Steel Water Bottle') },
  ]);

  const order = ['critical', 'major', 'minor'];
  const seen = result.discrepancies.map((d) => order.indexOf(d.severity));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test('an all-agreeing reconciliation reports a perfect rate and no findings', () => {
  const result = reconcile([
    surface('shop', [variant({ gtin: '8901234567890', price: 899, currency: 'INR', available: true })]),
    surface('feed', [variant({ gtin: '8901234567890', price: 899, currency: 'INR', available: true })]),
  ]);
  assert.deepEqual(result.discrepancies, []);
  assert.equal(result.summary.agreementRate, 100);
  assert.equal(result.summary.matchedGroups, 1);
});

/* ------------------------------------------------------ the real fixtures */

test('the Shopify export and the Merchant feed disagree exactly as planted', () => {
  const result = reconcile([
    { surface: 'shopify', catalogue: catalogueFromShopifyCsv(exportCsv, { currency: 'INR' }) },
    { surface: 'google', catalogue: catalogueFromGoogleFeed(feedTsv) },
  ]);

  // The M sock is 899 on the store and 949 in the feed, both sellable.
  const price = result.discrepancies.find((d) => d.kind === 'price_mismatch');
  assert.ok(price, 'the planted price drift should surface');
  assert.equal(price!.severity, 'critical');
  assert.equal(price!.matchedBy, 'gtin');

  // The L sock is out of stock on the store but still listed in the feed.
  const availability = result.discrepancies.find((d) => d.kind === 'availability_mismatch');
  assert.ok(availability, 'the dead item still being advertised should surface');
  assert.equal(availability!.severity, 'critical');

  // The navy sock reuses the L sock's GTIN inside the feed.
  const duplicate = result.discrepancies.find((d) => d.kind === 'duplicate_identifier');
  assert.ok(duplicate, 'the reused GTIN should surface');
  assert.equal(duplicate!.perSurface[0]!.surface, 'google');

  assert.ok(result.summary.bySeverity.critical >= 2);
});

/* ------------------------------------------------------ surface identity */

test('the same source given twice is refused, not silently compared', () => {
  assert.throws(
    () => resolveSurfaceNames(['./a.csv', './a.csv']),
    /same source was given twice/,
  );
});

test('distinct sources sharing a basename get distinct labels', () => {
  assert.deepEqual(
    resolveSurfaceNames(['./shop/feed.csv', './google/feed.csv']),
    ['feed', 'feed#2'],
  );
});

test('surface labels drop the extension and use the host for a domain', () => {
  assert.deepEqual(
    resolveSurfaceNames(['./products_export.csv', 'shop.example.com']),
    ['products_export', 'shop.example.com'],
  );
});
