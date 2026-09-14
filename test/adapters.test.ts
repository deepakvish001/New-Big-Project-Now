import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { catalogueFromProductsJson, fetchPublicCatalogue, normaliseStoreUrl } from '../src/adapters/shopify.ts';
import { catalogueFromShopifyCsv } from '../src/adapters/shopify-csv.ts';

const productsJson = JSON.parse(
  await readFile(new URL('../fixtures/sample-products.json', import.meta.url), 'utf8'),
);
const exportCsv = await readFile(new URL('../fixtures/sample-export.csv', import.meta.url), 'utf8');

test('products.json maps titles, brand, variants and images', () => {
  const catalogue = catalogueFromProductsJson(productsJson, { storeUrl: 'https://shop.test' });
  assert.equal(catalogue.products.length, 3);

  const sock = catalogue.products[0]!;
  assert.equal(sock.brand, 'Kalinga Wool');
  assert.equal(sock.variants.length, 2);
  assert.equal(sock.variants[0]!.gtin, '8901234567890');
  assert.equal(sock.images!.length, 3);
  assert.equal(sock.url, 'https://shop.test/products/merino-crew-sock');
  assert.ok(!sock.description!.includes('<p>'), 'description should be plain text');
  assert.ok(sock.description!.includes('°C'), 'HTML entities should be decoded');
});

test('products.json maps option values onto variants by position', () => {
  const catalogue = catalogueFromProductsJson(productsJson);
  const sock = catalogue.products[0]!;
  assert.deepEqual(sock.variants[0]!.optionValues, { Size: 'M', Colour: 'Charcoal' });
});

test('products.json declares the fields a public scan cannot see', () => {
  const catalogue = catalogueFromProductsJson(productsJson);
  assert.ok(catalogue.blindRules!.includes('identity.gtin'));
  assert.ok(catalogue.blindRules!.includes('commerce.inventory'));
  assert.ok(catalogue.limitations!.length > 0);
});

test('products.json accepts a bare array and counts unreadable records', () => {
  const catalogue = catalogueFromProductsJson([{ id: 1, handle: 'a' }, {} as never]);
  assert.equal(catalogue.products.length, 1);
  assert.equal(catalogue.skipped, 1);
});

test('products.json accepts tags as a comma-separated string', () => {
  const catalogue = catalogueFromProductsJson([{ id: 2, handle: 'b', tags: 'one, two , three' }]);
  assert.deepEqual(catalogue.products[0]!.tags, ['one', 'two', 'three']);
});

test('CSV groups rows by handle and collects every variant', () => {
  const catalogue = catalogueFromShopifyCsv(exportCsv, { currency: 'INR' });
  assert.equal(catalogue.products.length, 2);

  const sock = catalogue.products[0]!;
  assert.equal(sock.handle, 'merino-crew-sock');
  assert.equal(sock.variants.length, 2);
  assert.equal(sock.variants[1]!.sku, 'KW-SOCK-CHR-L');
});

test('CSV de-duplicates images across a handle group', () => {
  const catalogue = catalogueFromShopifyCsv(exportCsv);
  assert.equal(catalogue.products[0]!.images!.length, 3);
});

test('CSV reads metafield columns as structured attributes', () => {
  const catalogue = catalogueFromShopifyCsv(exportCsv);
  assert.equal(
    catalogue.products[0]!.attributes!['Material'],
    '80% merino wool, 18% nylon, 2% elastane',
  );
});

test('CSV derives availability from quantity and oversell policy', () => {
  const catalogue = catalogueFromShopifyCsv(exportCsv);
  const [inStock, outOfStock] = catalogue.products[0]!.variants;
  assert.equal(inStock!.available, true, '24 in stock under a deny policy is available');
  assert.equal(outOfStock!.available, false, '0 in stock under a deny policy is not');
});

test('CSV collects option values seen across variant rows', () => {
  const catalogue = catalogueFromShopifyCsv(exportCsv);
  const size = catalogue.products[0]!.options!.find((o) => o.name === 'Size');
  assert.deepEqual(size!.values, ['M', 'L']);
});

test('CSV marks currency blind unless it is declared', () => {
  assert.ok(catalogueFromShopifyCsv(exportCsv).blindRules!.includes('commerce.currency'));
  assert.ok(!catalogueFromShopifyCsv(exportCsv, { currency: 'INR' }).blindRules!.includes('commerce.currency'));
});

test('normaliseStoreUrl accepts a bare domain and forces https', () => {
  assert.equal(normaliseStoreUrl('example.com'), 'https://example.com');
  assert.equal(normaliseStoreUrl('http://shop.example.com/collections/all'), 'https://shop.example.com');
});

test('fetchPublicCatalogue pages until a short page arrives', async () => {
  const requested: string[] = [];
  const pages = [
    { products: [{ id: 1, handle: 'a' }, { id: 2, handle: 'b' }] },
    { products: [{ id: 3, handle: 'c' }] },
  ];

  const catalogue = await fetchPublicCatalogue('shop.test', {
    pageSize: 2,
    fetchImpl: (async (url: string) => {
      requested.push(String(url));
      const page = Number(new URL(String(url)).searchParams.get('page')) - 1;
      return { ok: true, status: 200, json: async () => pages[page] ?? { products: [] } };
    }) as unknown as typeof fetch,
  });

  assert.equal(catalogue.products.length, 3);
  assert.equal(requested.length, 2, 'stops once a page comes back short');
  assert.equal(catalogue.storeName, 'shop.test');
});

test('fetchPublicCatalogue explains a failed first page', async () => {
  await assert.rejects(
    fetchPublicCatalogue('shop.test', {
      fetchImpl: (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch,
    }),
    /404/,
  );
});
