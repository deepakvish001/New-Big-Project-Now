const TAG = /<[^>]*>/g;
const ENTITY: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  // Entities that routinely carry meaning in product copy: dropping these to a
  // space silently destroys specifications such as "0-15 &deg;C".
  '&deg;': '\u00b0', '&times;': '\u00d7', '&divide;': '\u00f7',
  '&frac12;': '\u00bd', '&frac14;': '\u00bc', '&frac34;': '\u00be',
  '&mdash;': '\u2014', '&ndash;': '\u2013', '&hellip;': '\u2026',
  '&lsquo;': '\u2018', '&rsquo;': '\u2019', '&ldquo;': '\u201c', '&rdquo;': '\u201d',
  '&bull;': '\u2022', '&middot;': '\u00b7', '&plusmn;': '\u00b1',
  '&reg;': '\u00ae', '&copy;': '\u00a9', '&trade;': '\u2122',
  '&euro;': '\u20ac', '&pound;': '\u00a3', '&yen;': '\u00a5', '&cent;': '\u00a2',
  '&micro;': '\u00b5', '&sup2;': '\u00b2', '&sup3;': '\u00b3',
};

export function stripHtml(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|br|tr|h[1-6])>/gi, ' ')
    .replace(TAG, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
}

export function isBlank(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim() === '';
}

/** True when the string carries a number joined to a real unit, e.g. "40 cm", "17.5 micron". */
export function hasMeasurement(text: string): boolean {
  return /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|m|in|inch|inches|ft|g|kg|gm|gms|gram|grams|mg|ml|l|litre|liter|oz|lb|lbs|micron|microns|gsm|w|kw|wh|mah|v|hz|ghz|mhz|gb|tb|mb|pcs|thread|tc|denier|den|°c|°f|deg)\b/i.test(
    text,
  );
}

/** Marketing filler that carries no information an agent can match on. */
const FLUFF = new Set([
  'best', 'bestselling', 'amazing', 'awesome', 'super', 'premium', 'luxury',
  'stunning', 'gorgeous', 'perfect', 'ultimate', 'must', 'love', 'favourite',
  'favorite', 'comfy', 'cool', 'great', 'beautiful', 'exclusive', 'stylish',
  'trendy', 'elegant', 'classy', 'quality',
]);

export function fluffRatio(text: string): number {
  const w = words(text);
  if (w.length === 0) return 1;
  let fluff = 0;
  for (const word of w) if (FLUFF.has(word)) fluff += 1;
  return fluff / w.length;
}

export function looksAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 8) return false;
  return letters === letters.toUpperCase();
}

/** Placeholder junk that survives from imports and CSV round-trips. */
export function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return true;
  return /^(n\/?a|none|null|undefined|tbd|test|sample|default title|untitled|copy of|-+|\.+)$/.test(v)
    || v.endsWith(' - copy')
    || v.startsWith('copy of ');
}
