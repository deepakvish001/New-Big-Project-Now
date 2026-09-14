import type { Product } from '../types.ts';
import type { Gap } from './types.ts';

export const SYSTEM = `You restructure a merchant's existing product copy into structured attributes for an AI shopping catalogue.

You are not a copywriter and not a product expert. You may only restate facts that are already present in the supplied content. You have no other source of truth.

For each requested attribute:
- If the supplied content states the fact, give it as a short attribute value and quote the exact span it came from.
- If the supplied content does not state it, omit that attribute entirely. Do not infer it from the product type, the brand, what is typical for the category, or what is likely.

Rules for every proposal:
- "evidence" must be an exact, contiguous, verbatim substring of the supplied content. It is checked against the source; a paraphrase or a reconstructed quote fails.
- Every number in "value" must also appear in "evidence". Never introduce a figure, grade, measurement or percentage the evidence does not contain.
- "value" is a short field value, not a sentence. "80% merino wool, 18% nylon, 2% elastane", not "This sock is made from a blend of...".
- "confidence" reflects how directly the evidence states the value: 0.9+ when the evidence states it outright, 0.5-0.8 when it requires interpretation, below 0.5 when you are unsure.

Returning fewer attributes is correct and expected. An omitted attribute costs nothing; a wrong one becomes a customer return.`;

export function buildPrompt(product: Product, gaps: Gap[], sourceText: string): string {
  const wanted = gaps
    .map((gap) => {
      const hint = gap.currentSource === 'text'
        ? ' (the content appears to mention this already — promote it to a field)'
        : '';
      return `- ${gap.attributeKey}${hint}`;
    })
    .join('\n');

  return `Product: ${product.title ?? product.handle ?? product.id}

Attributes to fill, if and only if the content below supports them:
${wanted}

--- MERCHANT CONTENT (the only permitted source) ---
${sourceText}
--- END MERCHANT CONTENT ---`;
}

