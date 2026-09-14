import type { CategoryBucket, Product, QueryDimension, RuleContext } from '../types.ts';
import { hasMeasurement, words } from '../util/text.ts';

const BUCKET_KEYWORDS: [CategoryBucket, RegExp][] = [
  ['footwear', /\b(shoe|shoes|sneaker|trainer|boot|boots|sandal|sandals|loafer|heel|heels|slipper|footwear)\b/i],
  ['apparel', /\b(shirt|t-?shirt|tee|kurta|saree|sari|dress|jean|jeans|trouser|pant|pants|jacket|coat|sweater|hoodie|sock|socks|apparel|clothing|legging|shorts|skirt|blouse|innerwear|lingerie|scarf|glove)\b/i],
  ['electronics', /\b(phone|laptop|headphone|earbud|speaker|charger|cable|camera|monitor|keyboard|mouse|router|tablet|watch|smart|electronic|battery|power ?bank|adapter)\b/i],
  ['beauty', /\b(serum|cream|lotion|shampoo|conditioner|lipstick|foundation|moisturis|moisturiz|skincare|cosmetic|fragrance|perfume|soap|face ?wash|sunscreen)\b/i],
  ['food', /\b(tea|coffee|snack|chocolate|spice|masala|flour|oil|honey|cereal|juice|beverage|grocery|organic food|protein powder)\b/i],
  ['home', /\b(cushion|bedsheet|bed ?sheet|curtain|towel|rug|carpet|lamp|chair|table|sofa|cookware|pan|utensil|storage|decor|mattress|pillow|blanket|crockery)\b/i],
];

const DIMENSIONS_BY_BUCKET: Record<CategoryBucket, QueryDimension[]> = {
  apparel: ['size', 'material', 'care', 'fit', 'colour'],
  footwear: ['size', 'material', 'fit', 'use_case', 'colour'],
  electronics: ['power', 'capacity', 'compatibility', 'dimensions'],
  home: ['material', 'dimensions', 'care', 'colour'],
  beauty: ['ingredients', 'capacity', 'use_case', 'allergens'],
  food: ['ingredients', 'allergens', 'capacity', 'use_case'],
  general: ['material', 'dimensions', 'colour', 'use_case'],
};

export function detectBucket(product: Product): CategoryBucket {
  const haystack = [product.productType, product.category, product.title, ...(product.tags ?? [])]
    .filter(Boolean)
    .join(' ');
  for (const [bucket, pattern] of BUCKET_KEYWORDS) {
    if (pattern.test(haystack)) return bucket;
  }
  return 'general';
}

export function buildContext(product: Product, now: Date = new Date()): RuleContext {
  const bucket = detectBucket(product);
  return { bucket, expectedDimensions: DIMENSIONS_BY_BUCKET[bucket], now };
}

/** Structured attribute keys that count as evidence for each dimension. */
const ATTR_KEYS: Record<QueryDimension, RegExp> = {
  size: /\b(size|sizing|size_system|uk_size|us_size|eu_size|length|width|measurement)\b/i,
  material: /\b(material|fabric|composition|fibre|fiber|made_of|build_material)\b/i,
  care: /\b(care|wash|washing|care_instruction|maintenance|cleaning)\b/i,
  fit: /\b(fit|cut|silhouette|rise|shape)\b/i,
  colour: /\b(colour|color|shade|finish)\b/i,
  use_case: /\b(use_?case|occasion|activity|suitable_for|best_for|season|usage)\b/i,
  dimensions: /\b(dimension|dimensions|height|depth|diameter|weight|volume|size_cm|size_in)\b/i,
  capacity: /\b(capacity|volume|ml|litre|liter|storage|net_quantity|pack_size|count)\b/i,
  power: /\b(power|watt|wattage|voltage|battery|mah|energy)\b/i,
  compatibility: /\b(compatib|works_with|fits_model|supported|connector|port|interface)\b/i,
  ingredients: /\b(ingredient|ingredients|composition|contains|formulation)\b/i,
  allergens: /\b(allergen|allergens|allergy|free_from|nut_free|gluten)\b/i,
};

/** Free-text signals, used only when no structured attribute exists. */
const TEXT_SIGNALS: Record<QueryDimension, RegExp> = {
  size: /\b(size|sizes|uk \d|us \d|eu \d|small|medium|large|x-?large|\d+\s?(?:cm|inch|in)\b)/i,
  material: /\b(cotton|linen|wool|merino|silk|polyester|nylon|elastane|spandex|leather|suede|denim|bamboo|jute|steel|aluminium|aluminum|brass|ceramic|glass|wood|teak|plastic|rubber|viscose|rayon|cashmere)\b/i,
  care: /\b(machine wash|hand wash|dry clean|do not bleach|tumble dry|wipe clean|dishwasher safe)\b/i,
  fit: /\b(slim fit|regular fit|relaxed fit|oversized|true to size|tapered|straight fit|skinny|loose fit)\b/i,
  colour: /\b(black|white|navy|charcoal|grey|gray|beige|ivory|olive|maroon|burgundy|teal|mustard|rust|cream)\b/i,
  use_case: /\b(for (?:hiking|running|office|travel|gym|yoga|winter|summer|weddings?|parties|daily)|suitable for|ideal for|designed for|everyday wear|workwear)\b/i,
  dimensions: /\b\d+(?:[.,]\d+)?\s?(?:cm|mm|inch|inches|in|ft)\b\s?(?:x|×|by)\s?\d/i,
  capacity: /\b\d+(?:[.,]\d+)?\s?(?:ml|l|litre|liter|g|kg|oz|gb|tb|mah)\b/i,
  power: /\b\d+(?:[.,]\d+)?\s?(?:w|kw|v|volts?|watts?|mah|wh)\b/i,
  compatibility: /\b(compatible with|works with|fits [A-Z0-9]|supports? (?:usb|hdmi|bluetooth|wi-?fi))/i,
  ingredients: /\b(ingredients?:|contains:|aqua|glycerin|hyaluronic|niacinamide|salicylic|shea butter)\b/i,
  allergens: /\b(allergen|contains nuts|nut-free|gluten-free|dairy-free|paraben-free|sulphate-free|sulfate-free)\b/i,
};

export interface DimensionEvidence {
  dimension: QueryDimension;
  answered: boolean;
  /** Structured evidence is what agents actually consume; text is a weak fallback. */
  source: 'attribute' | 'option' | 'text' | 'none';
}

export function dimensionEvidence(product: Product, dimension: QueryDimension): DimensionEvidence {
  const attrKeys = Object.keys(product.attributes ?? {});
  if (attrKeys.some((key) => ATTR_KEYS[dimension].test(key))) {
    return { dimension, answered: true, source: 'attribute' };
  }

  const optionNames = (product.options ?? []).map((o) => o.name);
  if (optionNames.some((name) => ATTR_KEYS[dimension].test(name))) {
    return { dimension, answered: true, source: 'option' };
  }

  // Weak, free-text evidence. Image alt text and attribute *values* count here
  // for the same reason a description does: they are machine-readable content
  // the merchant already published, just not as a named field. They earn half
  // credit, which is what unstructured evidence is worth to an agent.
  const text = [
    product.title,
    product.description,
    ...(product.tags ?? []),
    ...(product.images ?? []).map((image) => image.alt),
    ...Object.values(product.attributes ?? {}),
  ]
    .filter(Boolean)
    .join(' ');
  if (text && TEXT_SIGNALS[dimension].test(text)) {
    return { dimension, answered: true, source: 'text' };
  }

  return { dimension, answered: false, source: 'none' };
}

export function answeredDimensions(product: Product, expected: QueryDimension[]): DimensionEvidence[] {
  return expected.map((dimension) => dimensionEvidence(product, dimension));
}

/** Count of distinct factual tokens: measurements plus non-fluff vocabulary. */
export function factualDensity(text: string): number {
  if (!text) return 0;
  const unique = new Set(words(text).filter((w) => w.length > 3));
  return unique.size + (hasMeasurement(text) ? 5 : 0);
}
