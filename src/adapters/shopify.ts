import type { Catalogue, Product, ProductImage, Variant } from '../types.ts';
import { stripHtml } from '../util/text.ts';

/**
 * A store's public /products.json never exposes barcodes, stock levels,
 * currency or metafields — those are admin-scope. Scoring them from a public
 * scan would report fields as missing when they may simply be unreadable, so
 * these rules are skipped and the omission is stated in the report.
 */
export const PUBLIC_SCAN_BLIND_RULES = [
  'identity.gtin',
  'commerce.inventory',
  'commerce.currency',
];

export const PUBLIC_SCAN_LIMITATIONS = [
  'Barcodes (GTIN), stock levels and currency are not exposed by the public storefront feed, so those checks were skipped.',
  'Metafields are not in the public feed either — structured attributes may score lower here than in a connected scan.',
];

interface ShopifyVariantJson {
  id?: number | string;
  title?: string;
  sku?: string;
  barcode?: string;
  price?: string | number;
  available?: boolean;
  inventory_quantity?: number;
  grams?: number;
  weight_unit?: string;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

interface ShopifyImageJson {
  src?: string;
  alt?: string | null;
}

interface ShopifyOptionJson {
  name?: string;
  values?: string[];
}

interface ShopifyProductJson {
  id?: number | string;
  handle?: string;
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  updated_at?: string;
  published_at?: string;
  variants?: ShopifyVariantJson[];
  images?: ShopifyImageJson[];
  options?: ShopifyOptionJson[];
}

function toTags(tags: string[] | string | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return tags.split(',').map((t) => t.trim()).filter(Boolean);
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function productFromJson(
  raw: ShopifyProductJson,
  options: { storeUrl?: string } = {},
): Product {
  const optionDefs = (raw.options ?? [])
    .filter((option): option is Required<ShopifyOptionJson> => Boolean(option.name))
    .map((option) => ({ name: option.name, values: option.values ?? [] }));

  const variants: Variant[] = (raw.variants ?? []).map((variant, index) => {
    const optionValues: Record<string, string> = {};
    [variant.option1, variant.option2, variant.option3].forEach((value, slot) => {
      const name = optionDefs[slot]?.name;
      if (name && value) optionValues[name] = value;
    });

    return {
      id: String(variant.id ?? `${raw.id ?? raw.handle}-${index}`),
      sku: variant.sku || undefined,
      gtin: variant.barcode || undefined,
      price: toNumber(variant.price),
      available: typeof variant.available === 'boolean' ? variant.available : undefined,
      inventoryQuantity:
        typeof variant.inventory_quantity === 'number' ? variant.inventory_quantity : undefined,
      optionValues,
      weight: typeof variant.grams === 'number' ? variant.grams : undefined,
      weightUnit: typeof variant.grams === 'number' ? 'g' : undefined,
    };
  });

  const images: ProductImage[] = (raw.images ?? [])
    .filter((image) => Boolean(image.src))
    .map((image) => ({ url: image.src!, alt: image.alt ?? undefined }));

  const handle = raw.handle;
  return {
    id: String(raw.id ?? handle ?? ''),
    handle,
    title: raw.title,
    description: stripHtml(raw.body_html),
    brand: raw.vendor || undefined,
    productType: raw.product_type || undefined,
    tags: toTags(raw.tags),
    images,
    variants,
    options: optionDefs,
    url: options.storeUrl && handle ? `${options.storeUrl}/products/${handle}` : undefined,
    updatedAt: raw.updated_at ?? raw.published_at,
  };
}

export function catalogueFromProductsJson(
  payload: { products?: ShopifyProductJson[] } | ShopifyProductJson[],
  options: { source?: string; storeUrl?: string; storeName?: string } = {},
): Catalogue {
  const list = Array.isArray(payload) ? payload : payload.products ?? [];
  const products: Product[] = [];
  let skipped = 0;

  for (const raw of list) {
    if (!raw || (!raw.id && !raw.handle)) {
      skipped += 1;
      continue;
    }
    products.push(productFromJson(raw, { storeUrl: options.storeUrl }));
  }

  return {
    source: options.source ?? 'shopify:products.json',
    storeName: options.storeName,
    products,
    skipped,
    blindRules: [...PUBLIC_SCAN_BLIND_RULES],
    limitations: [...PUBLIC_SCAN_LIMITATIONS],
  };
}

/** Normalises whatever the user typed into an https origin. */
export function normaliseStoreUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withScheme);
  url.protocol = 'https:';
  return url.origin;
}

export interface FetchOptions {
  /** Shopify caps this at 250. */
  pageSize?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Reads a storefront's public product feed. No credentials, which is the point:
 * any store can be scored before it ever installs anything.
 */
export async function fetchPublicCatalogue(
  storeInput: string,
  options: FetchOptions = {},
): Promise<Catalogue> {
  const storeUrl = normaliseStoreUrl(storeInput);
  const pageSize = Math.min(options.pageSize ?? 250, 250);
  const maxPages = options.maxPages ?? 8;
  const doFetch = options.fetchImpl ?? fetch;

  const collected: ShopifyProductJson[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${storeUrl}/products.json?limit=${pageSize}&page=${page}`;
    const response = await doFetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'catalog-score/0.1' },
      signal: options.signal,
    });

    if (!response.ok) {
      if (page === 1) {
        throw new Error(
          `${storeUrl} returned ${response.status} for its public product feed. `
          + 'The store may not be on Shopify, or the feed may be disabled.',
        );
      }
      break;
    }

    const body = (await response.json()) as { products?: ShopifyProductJson[] };
    const batch = body.products ?? [];
    collected.push(...batch);
    if (batch.length < pageSize) break;
  }

  return catalogueFromProductsJson(collected, {
    source: `${storeUrl}/products.json`,
    storeUrl,
    storeName: new URL(storeUrl).hostname,
  });
}
