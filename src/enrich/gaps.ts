import type { Product, QueryDimension } from '../types.ts';
import { buildContext, dimensionEvidence } from '../rules/context.ts';
import { isBlank, isPlaceholder } from '../util/text.ts';
import type { Gap } from './types.ts';

/** The attribute key each dimension is written under. */
export const ATTRIBUTE_KEY: Record<QueryDimension, string> = {
  size: 'Size system',
  material: 'Material',
  care: 'Care',
  fit: 'Fit',
  colour: 'Colour',
  use_case: 'Use case',
  dimensions: 'Dimensions',
  capacity: 'Capacity',
  power: 'Power',
  compatibility: 'Compatibility',
  ingredients: 'Ingredients',
  allergens: 'Allergens',
};

/**
 * The dimensions this product's category needs that are not carried as
 * structured fields. A dimension already answered by an attribute or an option
 * is not a gap — we never overwrite what the merchant has already stated.
 */
export function gapsFor(product: Product, now: Date = new Date()): Gap[] {
  const ctx = buildContext(product, now);
  const gaps: Gap[] = [];

  for (const dimension of ctx.expectedDimensions) {
    const evidence = dimensionEvidence(product, dimension);
    if (evidence.source === 'attribute' || evidence.source === 'option') continue;
    gaps.push({
      dimension,
      attributeKey: ATTRIBUTE_KEY[dimension],
      currentSource: evidence.source === 'text' ? 'text' : 'none',
    });
  }

  return gaps;
}

/**
 * Everything the merchant already holds about this product, labelled. This is
 * the *only* material a proposal may be drawn from — the enricher's job is to
 * restructure the merchant's own facts, never to invent new ones.
 */
export function sourceTextFor(product: Product): string {
  const parts: string[] = [];
  const add = (label: string, value: string | undefined) => {
    if (!isBlank(value) && !isPlaceholder(value!)) parts.push(`${label}: ${value!.trim()}`);
  };

  add('Title', product.title);
  add('Brand', product.brand);
  add('Product type', product.productType);
  add('Category', product.category);
  add('Description', product.description);

  const tags = (product.tags ?? []).filter((tag) => !isBlank(tag));
  if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`);

  for (const option of product.options ?? []) {
    if (isPlaceholder(option.name)) continue;
    const values = option.values.filter((v) => !isPlaceholder(v));
    if (values.length > 0) parts.push(`Option ${option.name}: ${values.join(', ')}`);
  }

  for (const [key, value] of Object.entries(product.attributes ?? {})) {
    add(`Attribute ${key}`, value);
  }

  for (const image of product.images ?? []) {
    add('Image alt text', image.alt);
  }

  return parts.join('\n');
}
