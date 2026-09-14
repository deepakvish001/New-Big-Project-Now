/** Canonical catalogue model. Every adapter normalises into this shape. */

export interface ProductImage {
  url: string;
  alt?: string;
}

export interface Variant {
  id: string;
  sku?: string;
  /** GTIN-8/12/13/14. Shopify calls this `barcode`. */
  gtin?: string;
  /** Manufacturer part number. */
  mpn?: string;
  price?: number;
  currency?: string;
  available?: boolean;
  /** Tracked stock level. `undefined` means the merchant tracks nothing. */
  inventoryQuantity?: number;
  optionValues?: Record<string, string>;
  weight?: number;
  weightUnit?: string;
}

export interface Product {
  id: string;
  handle?: string;
  title?: string;
  /** Plain text. Adapters strip HTML before populating this. */
  description?: string;
  /** Brand. Shopify calls this `vendor`. */
  brand?: string;
  /** Merchant's own category label. Shopify calls this `product_type`. */
  productType?: string;
  /** A mapped taxonomy id (Google product category, Shopify standard product type). */
  category?: string;
  tags?: string[];
  images?: ProductImage[];
  variants: Variant[];
  /** Named option axes, e.g. `Size` -> ["S","M","L"]. */
  options?: { name: string; values: string[] }[];
  /** Structured specs from metafields, spec tables or feed columns. */
  attributes?: Record<string, string>;
  url?: string;
  updatedAt?: string;
}

export interface Catalogue {
  source: string;
  storeName?: string;
  products: Product[];
  /** Products the source reported but the adapter could not read. */
  skipped?: number;
  /**
   * Rules this source cannot see. They are dropped rather than failed, so the
   * score never reports a field as missing when it was merely unreadable.
   */
  blindRules?: string[];
  /** Plain-language notes about what the source could not show, for the report. */
  limitations?: string[];
}

export type RuleGroup =
  | 'identity'
  | 'descriptive'
  | 'commerce'
  | 'media'
  | 'answerability';

export type Severity = 'blocker' | 'major' | 'minor';

export type RuleStatus = 'pass' | 'partial' | 'fail' | 'na';

export interface RuleOutcome {
  status: RuleStatus;
  /** 0..1 credit awarded. Defaults to 1 for pass, 0 for fail. */
  ratio?: number;
  /** Human-readable specifics, e.g. "3 of 12 variants have a GTIN". */
  detail?: string;
}

export interface RuleContext {
  /** Coarse category bucket, used to pick which attributes are expected. */
  bucket: CategoryBucket;
  /** Query dimensions this category needs answered. */
  expectedDimensions: QueryDimension[];
  /** ISO date the catalogue was scored, for freshness checks. */
  now: Date;
}

export type CategoryBucket =
  | 'apparel'
  | 'footwear'
  | 'electronics'
  | 'home'
  | 'beauty'
  | 'food'
  | 'general';

/**
 * The axes a shopper's question tends to turn on. An agent can only answer a
 * query if the catalogue carries the matching evidence.
 */
export type QueryDimension =
  | 'size'
  | 'material'
  | 'care'
  | 'fit'
  | 'colour'
  | 'use_case'
  | 'dimensions'
  | 'capacity'
  | 'power'
  | 'compatibility'
  | 'ingredients'
  | 'allergens';

export interface Rule {
  id: string;
  group: RuleGroup;
  title: string;
  /** Points this rule contributes when fully satisfied. */
  weight: number;
  severity: Severity;
  /** Why a shopping agent needs this field. Shown in the report. */
  why: string;
  /** What the merchant should do about it. */
  fix: string;
  evaluate(product: Product, ctx: RuleContext): RuleOutcome;
}

export interface Finding {
  ruleId: string;
  group: RuleGroup;
  title: string;
  severity: Severity;
  status: RuleStatus;
  /** Points lost on this product, out of `weight`. */
  lost: number;
  weight: number;
  detail?: string;
  why: string;
  fix: string;
}

export interface ProductScore {
  productId: string;
  title: string;
  url?: string;
  /** 0..100. */
  score: number;
  /** Raw points earned and the applicable total, before normalising. */
  earned: number;
  applicable: number;
  findings: Finding[];
}

export interface GroupScore {
  group: RuleGroup;
  score: number;
  earned: number;
  applicable: number;
}

export interface RuleImpact {
  ruleId: string;
  title: string;
  severity: Severity;
  group: RuleGroup;
  /** Products failing or partially failing this rule. */
  affected: number;
  /** Share of the whole catalogue's available points this rule is losing. */
  catalogueCost: number;
  why: string;
  fix: string;
}

export interface CatalogueScore {
  source: string;
  storeName?: string;
  scoredAt: string;
  productCount: number;
  /** 0..100, the headline number. */
  score: number;
  grade: Grade;
  /** Products scoring below the invisibility threshold. */
  invisibleCount: number;
  invisibleShare: number;
  groups: GroupScore[];
  /** Rules ranked by how much catalogue-wide score they are costing. */
  topImpacts: RuleImpact[];
  /** Worst products, ranked by points lost. */
  worstProducts: ProductScore[];
  products: ProductScore[];
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
