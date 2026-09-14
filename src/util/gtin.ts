/**
 * GTIN validation. Agents and marketplaces reject malformed identifiers
 * silently, so a present-but-invalid barcode is worse than an absent one:
 * the merchant believes they are covered.
 */

const VALID_LENGTHS = new Set([8, 12, 13, 14]);

export function normaliseGtin(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) ? digits : undefined;
}

export function isValidGtin(raw: string | undefined | null): boolean {
  const gtin = normaliseGtin(raw);
  if (!gtin || !VALID_LENGTHS.has(gtin.length)) return false;
  if (/^0+$/.test(gtin)) return false;
  return checkDigit(gtin.slice(0, -1)) === Number(gtin[gtin.length - 1]);
}

/** Mod-10 check digit for a GTIN body (the code without its final digit). */
export function checkDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3,1 from the right-hand end of the body.
  for (let i = body.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}
