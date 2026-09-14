import type { Catalogue, Product, Variant } from '../types.ts';
import { detectDelimiter, toTable } from './csv-parse.ts';
import { stripHtml } from '../util/text.ts';

/**
 * Google Merchant Center tabular feed (TSV or CSV). The XML/RSS variant is a
 * different shape and is not read here — see `limitations` on the result.
 *
 * Rows are items. `item_group_id` groups variants of one product; without it
 * each row stands alone as its own product.
 */

const AVAILABILITY_IN_STOCK = new Set(['in stock', 'in_stock', 'available for order', 'preorder', 'backorder']);
const AVAILABILITY_OUT = new Set(['out of stock', 'out_of_stock', 'discontinued']);

export interface GoogleFeedOptions {
  source?: string;
  storeName?: string;
  /** Surface label used in reconciliation reports. */
  surface?: string;
}

export interface ParsedPrice {
  amount?: number;
  currency?: string;
}

/**
 * Google prices are "899.00 INR" or "12.99 USD"; some exporters emit a bare
 * number or a symbol. Only an explicit ISO code is treated as the currency —
 * guessing one is how a catalogue ends up claiming the wrong money.
 */
export function parseFeedPrice(raw: string | undefined): ParsedPrice {
  if (!raw) return {};
  const text = raw.trim();
  if (text === '') return {};

  const currency = text.match(/\b([A-Z]{3})\b/)?.[1];
  const numeric = text.replace(/[A-Za-z]/g, '').replace(/[^\d.,-]/g, '').trim();
  if (numeric === '') return currency ? { currency } : {};

  // Strip thousands separators, keep the last separator as the decimal point.
  const lastDot = numeric.lastIndexOf('.');
  const lastComma = numeric.lastIndexOf(',');
  let normalised = numeric;
  if (lastDot >= 0 && lastComma >= 0) {
    normalised = lastDot > lastComma
      ? numeric.replace(/,/g, '')
      : numeric.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    // A lone comma is a decimal point when it leaves two trailing digits.
    normalised = /,\d{1,2}$/.test(numeric) ? numeric.replace(',', '.') : numeric.replace(/,/g, '');
  }

  const amount = Number(normalised);
  return {
    ...(Number.isFinite(amount) ? { amount } : {}),
    ...(currency ? { currency } : {}),
  };
}

export function parseAvailability(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (AVAILABILITY_IN_STOCK.has(value)) return true;
  if (AVAILABILITY_OUT.has(value)) return false;
  return undefined;
}

function pick(row: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return undefined;
}

export function catalogueFromGoogleFeed(
  input: string,
  options: GoogleFeedOptions = {},
): Catalogue {
  // Google's own exports are tab-separated; some tools emit commas. The
  // delimiter is detected rather than substituted, because a description
  // field routinely contains commas of its own.
  const { headers, rows } = toTable(input, detectDelimiter(input));
  if (headers.length === 0) {
    return { source: options.source ?? 'google:feed', products: [], skipped: 0 };
  }

  const byGroup = new Map<string, Product>();
  let skipped = 0;

  for (const row of rows) {
    const id = pick(row, 'id', 'g:id');
    if (!id) {
      skipped += 1;
      continue;
    }

    const groupId = pick(row, 'item_group_id', 'g:item_group_id') ?? id;
    const { amount, currency } = parseFeedPrice(pick(row, 'price', 'g:price'));

    const variant: Variant = {
      id,
      sku: pick(row, 'mpn', 'g:mpn', 'id'),
      gtin: pick(row, 'gtin', 'g:gtin'),
      mpn: pick(row, 'mpn', 'g:mpn'),
      ...(amount !== undefined ? { price: amount } : {}),
      ...(currency ? { currency } : {}),
      available: parseAvailability(pick(row, 'availability', 'g:availability')),
    };

    const existing = byGroup.get(groupId);
    if (existing) {
      existing.variants.push(variant);
      continue;
    }

    const image = pick(row, 'image_link', 'g:image_link');
    byGroup.set(groupId, {
      id: groupId,
      handle: pick(row, 'link', 'g:link')?.split('/').pop(),
      title: pick(row, 'title', 'g:title'),
      description: stripHtml(pick(row, 'description', 'g:description')),
      brand: pick(row, 'brand', 'g:brand'),
      productType: pick(row, 'product_type', 'g:product_type'),
      category: pick(row, 'google_product_category', 'g:google_product_category'),
      images: image ? [{ url: image }] : [],
      variants: [variant],
      options: [],
      url: pick(row, 'link', 'g:link'),
    });
  }

  return {
    source: options.source ?? 'google:feed',
    storeName: options.storeName ?? options.surface,
    products: [...byGroup.values()],
    skipped,
    blindRules: ['commerce.freshness', 'commerce.inventory', 'descriptive.attributes'],
    limitations: [
      'A Google Merchant feed carries no last-updated timestamp or stock quantity, so those checks were skipped.',
      'Feed items carry no structured attributes beyond the standard columns, so that check was skipped too.',
      'Only the tabular (TSV/CSV) feed format is read; XML/RSS feeds are not supported yet.',
    ],
  };
}
