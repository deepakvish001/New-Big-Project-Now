import type { Catalogue, Product, ProductImage, Variant } from '../types.ts';
import { toTable } from './csv-parse.ts';
import { stripHtml } from '../util/text.ts';

const METAFIELD = /\(product\.metafields\.[^)]+\)\s*$/i;

/** "Material (product.metafields.custom.material)" -> "Material" */
function metafieldLabel(header: string): string {
  return header.replace(METAFIELD, '').trim() || header;
}

function num(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') return undefined;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ShopifyCsvOptions {
  source?: string;
  storeName?: string;
  /** Shopify's product export carries no currency column; supply it to score that rule. */
  currency?: string;
}

/**
 * Reads Shopify's product export CSV. Rows are grouped by Handle: the first row
 * of a handle carries the product fields, later rows add variants and images.
 */
export function catalogueFromShopifyCsv(input: string, options: ShopifyCsvOptions = {}): Catalogue {
  const { headers, rows } = toTable(input);
  if (headers.length === 0) {
    return { source: options.source ?? 'shopify:csv', products: [], skipped: 0 };
  }

  const metafieldHeaders = headers.filter((header) => METAFIELD.test(header));
  const byHandle = new Map<string, Product>();
  const seenImages = new Map<string, Set<string>>();
  let skipped = 0;

  for (const row of rows) {
    const handle = (row['Handle'] ?? '').trim();
    if (!handle) {
      skipped += 1;
      continue;
    }

    let product = byHandle.get(handle);
    if (!product) {
      const attributes: Record<string, string> = {};
      for (const header of metafieldHeaders) {
        const value = (row[header] ?? '').trim();
        if (value) attributes[metafieldLabel(header)] = value;
      }

      product = {
        id: handle,
        handle,
        title: (row['Title'] ?? '').trim() || undefined,
        description: stripHtml(row['Body (HTML)']),
        brand: (row['Vendor'] ?? '').trim() || undefined,
        productType: (row['Type'] ?? '').trim() || undefined,
        category: (row['Product Category'] ?? '').trim() || undefined,
        tags: (row['Tags'] ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        images: [],
        variants: [],
        options: [],
        attributes,
      };

      for (let slot = 1; slot <= 3; slot += 1) {
        const name = (row[`Option${slot} Name`] ?? '').trim();
        if (name) product.options!.push({ name, values: [] });
      }

      byHandle.set(handle, product);
      seenImages.set(handle, new Set());
    }

    // Variant row: Shopify writes the price on every row that defines a variant.
    const hasVariant = Boolean(
      (row['Variant SKU'] ?? '').trim()
      || (row['Variant Price'] ?? '').trim()
      || (row['Option1 Value'] ?? '').trim(),
    );

    if (hasVariant) {
      const optionValues: Record<string, string> = {};
      for (let slot = 1; slot <= 3; slot += 1) {
        const name = product.options?.[slot - 1]?.name;
        const value = (row[`Option${slot} Value`] ?? '').trim();
        if (name && value) {
          optionValues[name] = value;
          const def = product.options![slot - 1]!;
          if (!def.values.includes(value)) def.values.push(value);
        }
      }

      const quantity = num(row['Variant Inventory Qty']);
      const policy = (row['Variant Inventory Policy'] ?? '').trim().toLowerCase();
      const tracker = (row['Variant Inventory Tracker'] ?? '').trim();
      // Untracked inventory is always sellable; tracked inventory depends on the
      // quantity unless the merchant allows overselling.
      const available = tracker === ''
        ? true
        : quantity === undefined
          ? undefined
          : quantity > 0 || policy === 'continue';

      const variant: Variant = {
        id: `${handle}:${product.variants.length + 1}`,
        sku: (row['Variant SKU'] ?? '').trim() || undefined,
        gtin: (row['Variant Barcode'] ?? '').trim() || undefined,
        price: num(row['Variant Price']),
        currency: options.currency,
        available,
        inventoryQuantity: quantity,
        optionValues,
        weight: num(row['Variant Grams']),
        weightUnit: (row['Variant Weight Unit'] ?? '').trim() || undefined,
      };
      product.variants.push(variant);
    }

    const imageSrc = (row['Image Src'] ?? '').trim();
    if (imageSrc) {
      const seen = seenImages.get(handle)!;
      if (!seen.has(imageSrc)) {
        seen.add(imageSrc);
        const image: ProductImage = {
          url: imageSrc,
          alt: (row['Image Alt Text'] ?? '').trim() || undefined,
        };
        product.images!.push(image);
      }
    }
  }

  const limitations = [
    "Shopify's product export carries no last-updated timestamp, so the freshness check was skipped.",
  ];
  const blindRules = ['commerce.freshness'];

  if (!options.currency) {
    limitations.push('No currency column in the export; pass --currency to score that check.');
    blindRules.push('commerce.currency');
  }

  return {
    source: options.source ?? 'shopify:csv',
    storeName: options.storeName,
    products: [...byHandle.values()],
    skipped,
    blindRules,
    limitations,
  };
}
