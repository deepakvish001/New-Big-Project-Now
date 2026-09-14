import type { Product, Rule, RuleContext, RuleOutcome } from '../types.ts';
import { answeredDimensions } from './context.ts';
import {
  factualDensity,
} from './context.ts';
import {
  fluffRatio,
  hasMeasurement,
  isBlank,
  isPlaceholder,
  looksAllCaps,
} from '../util/text.ts';
import { isValidGtin, normaliseGtin } from '../util/gtin.ts';

const DAY = 86_400_000;

function ratioOutcome(ratio: number, detail?: string): RuleOutcome {
  const clamped = Math.max(0, Math.min(1, ratio));
  const status = clamped >= 0.999 ? 'pass' : clamped <= 0.001 ? 'fail' : 'partial';
  return { status, ratio: clamped, detail };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ identity */

const gtin: Rule = {
  id: 'identity.gtin',
  group: 'identity',
  title: 'Every variant carries a valid GTIN',
  weight: 12,
  severity: 'blocker',
  why:
    'GTIN is how an agent knows two listings are the same product. Without it your item cannot be '
    + 'price-compared, deduplicated, or matched to a shopper asking for a specific product.',
  fix:
    'Populate the barcode field on every variant with the manufacturer GTIN. A present-but-invalid '
    + 'barcode is worse than an empty one, because it looks covered and is silently rejected.',
  evaluate(product) {
    const variants = product.variants;
    if (variants.length === 0) return { status: 'fail', ratio: 0, detail: 'no variants' };

    let valid = 0;
    let malformed = 0;
    for (const variant of variants) {
      if (isValidGtin(variant.gtin)) valid += 1;
      else if (normaliseGtin(variant.gtin)) malformed += 1;
    }

    const parts = [`${valid} of ${plural(variants.length, 'variant')} have a valid GTIN`];
    if (malformed > 0) parts.push(`${malformed} fail the check digit`);
    return ratioOutcome(valid / variants.length, parts.join('; '));
  },
};

const brand: Rule = {
  id: 'identity.brand',
  group: 'identity',
  title: 'Brand is set',
  weight: 6,
  severity: 'major',
  why: 'Shoppers ask for brands by name. An unbranded record cannot answer "show me X brand".',
  fix: 'Set the vendor/brand field to the manufacturer, not your own store name.',
  evaluate(product) {
    if (isBlank(product.brand) || isPlaceholder(product.brand!)) {
      return { status: 'fail', ratio: 0, detail: 'missing or placeholder' };
    }
    return { status: 'pass', ratio: 1 };
  },
};

const partNumber: Rule = {
  id: 'identity.mpn',
  group: 'identity',
  title: 'Variants have an SKU or MPN',
  weight: 4,
  severity: 'minor',
  why: 'A stable per-variant identifier lets an agent reorder the exact item a shopper bought before.',
  fix: 'Assign an SKU to every variant, and an MPN where the manufacturer publishes one.',
  evaluate(product) {
    const variants = product.variants;
    if (variants.length === 0) return { status: 'fail', ratio: 0 };
    const withId = variants.filter(
      (v) => (!isBlank(v.sku) && !isPlaceholder(v.sku!)) || (!isBlank(v.mpn) && !isPlaceholder(v.mpn!)),
    ).length;
    return ratioOutcome(withId / variants.length, `${withId} of ${variants.length} identified`);
  },
};

const category: Rule = {
  id: 'identity.category',
  group: 'identity',
  title: 'Mapped to a standard product category',
  weight: 8,
  severity: 'blocker',
  why:
    'Agents narrow by taxonomy before they read anything else. An unmapped product is excluded from '
    + 'the candidate set before your description is ever considered.',
  fix:
    'Map each product to a standard taxonomy (Google product category or the Shopify standard product '
    + 'type). Your own free-text product type is not a taxonomy.',
  evaluate(product) {
    const mapped = !isBlank(product.category) && !isPlaceholder(product.category!);
    if (mapped) return { status: 'pass', ratio: 1 };
    const own = !isBlank(product.productType) && !isPlaceholder(product.productType!);
    if (own) {
      return { status: 'partial', ratio: 0.4, detail: `only a free-text type ("${product.productType}")` };
    }
    return { status: 'fail', ratio: 0, detail: 'no category at all' };
  },
};

/* --------------------------------------------------------------- descriptive */

const title: Rule = {
  id: 'descriptive.title',
  group: 'descriptive',
  title: 'Title identifies the product on its own',
  weight: 10,
  severity: 'blocker',
  why:
    'The title is the strongest matching signal an agent has. "Crew Sock - Charcoal - M" tells it '
    + 'almost nothing; brand, material and size in the title tell it almost everything.',
  fix: 'Rewrite as Brand + product + key attribute + variant, e.g. "Merino Wool Crew Sock — Charcoal, Men\'s M (UK 7–9)".',
  evaluate(product) {
    const value = product.title ?? '';
    if (isBlank(value) || isPlaceholder(value)) {
      return { status: 'fail', ratio: 0, detail: 'missing or placeholder' };
    }

    const issues: string[] = [];
    let credit = 0;

    if (value.length >= 20 && value.length <= 150) credit += 0.4;
    else issues.push(value.length < 20 ? 'too short' : 'over 150 characters');

    if (product.brand && value.toLowerCase().includes(product.brand.toLowerCase())) credit += 0.2;
    else issues.push('brand not in title');

    if (!looksAllCaps(value)) credit += 0.2;
    else issues.push('all caps');

    const distinguishing =
      hasMeasurement(value) || /\b(cotton|wool|merino|silk|leather|steel|linen|denim|ceramic|bamboo)\b/i.test(value);
    if (distinguishing) credit += 0.2;
    else issues.push('no material or measurement');

    return ratioOutcome(credit, issues.length ? issues.join(', ') : undefined);
  },
};

const description: Rule = {
  id: 'descriptive.description',
  group: 'descriptive',
  title: 'Description carries facts, not adjectives',
  weight: 8,
  severity: 'major',
  why:
    'Agents extract claims they can check. Copy made of "super comfy" and "bestselling" yields nothing '
    + 'to match a query against.',
  fix: 'Write at least a short paragraph of specifics: composition, measurements, use case, care.',
  evaluate(product) {
    const text = product.description ?? '';
    if (isBlank(text)) return { status: 'fail', ratio: 0, detail: 'empty' };

    const issues: string[] = [];
    let credit = 0;

    if (text.length >= 200) credit += 0.4;
    else issues.push(`only ${text.length} characters`);

    if (factualDensity(text) >= 25) credit += 0.3;
    else issues.push('few concrete details');

    const fluff = fluffRatio(text);
    if (fluff < 0.08) credit += 0.3;
    else issues.push(`${Math.round(fluff * 100)}% marketing filler`);

    return ratioOutcome(credit, issues.length ? issues.join(', ') : undefined);
  },
};

const TARGET_ATTRIBUTES = 6;

const attributes: Rule = {
  id: 'descriptive.attributes',
  group: 'descriptive',
  title: 'Structured attributes exist',
  weight: 12,
  severity: 'blocker',
  why:
    'This is the single biggest cause of invisibility. Humans infer missing attributes from a photo; '
    + 'agents only read fields. No fields, no recommendation.',
  fix:
    `Add at least ${TARGET_ATTRIBUTES} structured attributes per product as metafields or feed columns — `
    + 'material, dimensions, care, use case, compatibility, certification.',
  evaluate(product) {
    const attrCount = Object.entries(product.attributes ?? {}).filter(
      ([, value]) => !isBlank(value) && !isPlaceholder(value),
    ).length;
    const optionCount = (product.options ?? []).filter((o) => !isPlaceholder(o.name)).length;
    const total = attrCount + optionCount;
    return ratioOutcome(
      total / TARGET_ATTRIBUTES,
      `${total} structured ${total === 1 ? 'attribute' : 'attributes'} (target ${TARGET_ATTRIBUTES})`,
    );
  },
};

/* ------------------------------------------------------------------ commerce */

const price: Rule = {
  id: 'commerce.price',
  group: 'commerce',
  title: 'Every variant has a price',
  weight: 8,
  severity: 'blocker',
  why: 'An agent cannot present, compare, or transact an item with no price. It is dropped outright.',
  fix: 'Ensure every variant carries a positive price in the feed, not only on the storefront.',
  evaluate(product) {
    const variants = product.variants;
    if (variants.length === 0) return { status: 'fail', ratio: 0 };
    const priced = variants.filter((v) => typeof v.price === 'number' && v.price > 0).length;
    return ratioOutcome(priced / variants.length, `${priced} of ${variants.length} priced`);
  },
};

const currency: Rule = {
  id: 'commerce.currency',
  group: 'commerce',
  title: 'Prices declare a currency',
  weight: 4,
  severity: 'major',
  why: 'A bare number is ambiguous across surfaces and is a common cause of mismatched-price rejections.',
  fix: 'Emit an ISO-4217 currency code alongside every price.',
  evaluate(product) {
    const variants = product.variants;
    if (variants.length === 0) return { status: 'fail', ratio: 0 };
    const withCurrency = variants.filter((v) => /^[A-Z]{3}$/.test(v.currency ?? '')).length;
    return ratioOutcome(withCurrency / variants.length, `${withCurrency} of ${variants.length} declare a currency`);
  },
};

const availability: Rule = {
  id: 'commerce.availability',
  group: 'commerce',
  title: 'Availability is explicit per variant',
  weight: 8,
  severity: 'blocker',
  why:
    'Stale availability is the most-reported failure in early agentic checkout. An agent that offers an '
    + 'out-of-stock item fails the purchase and learns to distrust the merchant.',
  fix: 'Publish an explicit in_stock / out_of_stock state per variant, refreshed on every inventory change.',
  evaluate(product) {
    const variants = product.variants;
    if (variants.length === 0) return { status: 'fail', ratio: 0 };
    const stated = variants.filter((v) => typeof v.available === 'boolean').length;
    return ratioOutcome(stated / variants.length, `${stated} of ${variants.length} state availability`);
  },
};

const inventory: Rule = {
  id: 'commerce.inventory',
  group: 'commerce',
  title: 'Stock levels are tracked',
  weight: 4,
  severity: 'minor',
  why: 'A quantity lets an agent judge whether a multi-unit order will actually fulfil.',
  fix: 'Track inventory quantity per variant and expose it in the feed.',
  evaluate(product) {
    const variants = product.variants;
    if (variants.length === 0) return { status: 'fail', ratio: 0 };
    const tracked = variants.filter((v) => typeof v.inventoryQuantity === 'number').length;
    return ratioOutcome(tracked / variants.length, `${tracked} of ${variants.length} tracked`);
  },
};

const freshness: Rule = {
  id: 'commerce.freshness',
  group: 'commerce',
  title: 'Record was updated recently',
  weight: 6,
  severity: 'major',
  why: 'Agents weight recency. A record untouched for months is treated as unreliable even when it is correct.',
  fix: 'Re-sync the catalogue on a schedule so timestamps move even when content does not.',
  evaluate(product, ctx) {
    if (!product.updatedAt) return { status: 'fail', ratio: 0, detail: 'no timestamp' };
    const updated = Date.parse(product.updatedAt);
    if (Number.isNaN(updated)) return { status: 'fail', ratio: 0, detail: 'unparseable timestamp' };

    const ageDays = Math.max(0, (ctx.now.getTime() - updated) / DAY);
    if (ageDays <= 7) return { status: 'pass', ratio: 1, detail: `${Math.round(ageDays)} days old` };
    if (ageDays <= 30) return { status: 'partial', ratio: 0.5, detail: `${Math.round(ageDays)} days old` };
    return { status: 'fail', ratio: 0, detail: `${Math.round(ageDays)} days old` };
  },
};

/* --------------------------------------------------------------------- media */

const images: Rule = {
  id: 'media.images',
  group: 'media',
  title: 'At least three images',
  weight: 6,
  severity: 'major',
  why: 'Multi-image listings are favoured in agent-surfaced results and reduce post-purchase returns.',
  fix: 'Publish three or more images per product, including one plain-background shot.',
  evaluate(product) {
    const count = product.images?.length ?? 0;
    const credit = count >= 3 ? 1 : count === 2 ? 0.6 : count === 1 ? 0.3 : 0;
    return ratioOutcome(credit, `${plural(count, 'image')}`);
  },
};

const altText: Rule = {
  id: 'media.alt',
  group: 'media',
  title: 'Images have alt text',
  weight: 4,
  severity: 'minor',
  why: 'Alt text is machine-readable product description that most merchants leave empty for free.',
  fix: 'Generate descriptive alt text naming the product, colour and view.',
  evaluate(product) {
    const list = product.images ?? [];
    if (list.length === 0) return { status: 'na', detail: 'no images to caption' };
    const withAlt = list.filter((i) => !isBlank(i.alt) && !isPlaceholder(i.alt!)).length;
    return ratioOutcome(withAlt / list.length, `${withAlt} of ${list.length} captioned`);
  },
};

/* ------------------------------------------------------------- answerability */

const answerability: Rule = {
  id: 'answerability.dimensions',
  group: 'answerability',
  title: 'Data answers the questions shoppers actually ask',
  weight: 20,
  severity: 'blocker',
  why:
    'A shopper asks "warm hiking socks that don\'t itch". That query turns on material, fibre grade and '
    + 'use case. If the catalogue holds none of those as fields, the product cannot be matched no matter '
    + 'how good it is.',
  fix:
    'For each category, fill the dimensions shoppers ask about as structured fields. Text buried in a '
    + 'description counts for half — an attribute counts for full.',
  evaluate(product, ctx) {
    const evidence = answeredDimensions(product, ctx.expectedDimensions);
    if (evidence.length === 0) return { status: 'na' };

    let credit = 0;
    const missing: string[] = [];
    const weak: string[] = [];
    for (const item of evidence) {
      if (item.source === 'attribute' || item.source === 'option') credit += 1;
      else if (item.source === 'text') {
        credit += 0.5;
        weak.push(item.dimension);
      } else missing.push(item.dimension);
    }

    const parts: string[] = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (weak.length) parts.push(`text-only: ${weak.join(', ')}`);
    return ratioOutcome(credit / evidence.length, parts.join('; ') || 'all dimensions structured');
  },
};

export const RULES: Rule[] = [
  gtin,
  brand,
  partNumber,
  category,
  title,
  description,
  attributes,
  price,
  currency,
  availability,
  inventory,
  freshness,
  images,
  altText,
  answerability,
];

export function ruleById(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}

export type { Rule, RuleContext };
