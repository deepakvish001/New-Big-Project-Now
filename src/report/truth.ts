import type { Discrepancy, TruthResult } from '../truth/index.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';

const SEVERITY_COLOUR = { critical: RED, major: YELLOW, minor: DIM } as const;

const KIND_LABEL: Record<Discrepancy['kind'], string> = {
  price_mismatch: 'Price differs',
  currency_mismatch: 'Currency differs',
  availability_mismatch: 'Availability differs',
  missing_from_surface: 'Missing from a surface',
  duplicate_identifier: 'Identifier reused',
  title_drift: 'Title drift',
};

export interface TruthTerminalOptions {
  colour?: boolean;
  topN?: number;
  limitations?: string[];
}

export function renderTruthTerminal(
  result: TruthResult,
  options: TruthTerminalOptions = {},
): string {
  const colour = options.colour ?? true;
  const paint = (code: string, text: string) => (colour ? `${code}${text}${RESET}` : text);
  const topN = options.topN ?? 12;
  const { summary } = result;
  const out: string[] = [''];

  out.push(paint(BOLD, `Cross-surface truth check — ${summary.surfaces.join(' vs ')}`));
  for (const entry of summary.variantsPerSurface) {
    out.push(paint(DIM, `  ${entry.surface}: ${entry.variants} variants`));
  }
  out.push('');

  const rateColour = summary.agreementRate >= 95 ? GREEN : summary.agreementRate >= 80 ? YELLOW : RED;
  out.push(
    `  ${paint(BOLD, `${summary.matchedGroups} items matched across surfaces`)}, `
    + `${paint(rateColour + BOLD, `${summary.agreementRate}% agree on everything`)}`,
  );
  if (summary.onlyOnOneSurface > 0) {
    out.push(paint(DIM, `  ${summary.onlyOnOneSurface} variants appear on only one surface`));
  }
  out.push('');

  const { critical, major, minor } = summary.bySeverity;
  out.push(`  ${paint(RED, 'critical')} ${String(critical).padStart(4)}   an agent can transact the wrong price or a dead item`);
  out.push(`  ${paint(YELLOW, 'major')}    ${String(major).padStart(4)}`);
  out.push(`  ${paint(DIM, 'minor')}    ${String(minor).padStart(4)}`);
  out.push('');

  if (result.discrepancies.length === 0) {
    out.push(paint(GREEN, '  Every matched item agrees across all surfaces.'));
    out.push('');
    return out.join('\n');
  }

  out.push(paint(BOLD, '  Worst first'));
  for (const item of result.discrepancies.slice(0, topN)) {
    out.push(
      `    ${paint(SEVERITY_COLOUR[item.severity] + BOLD, item.severity)}`
      + `${' '.repeat(Math.max(1, 10 - item.severity.length))}`
      + `${KIND_LABEL[item.kind]}  ${paint(DIM, `(${item.matchedBy} ${item.key})`)}`,
    );
    out.push(`      ${truncate(item.productTitle, 66)}`);
    out.push(`      ${paint(DIM, item.summary)}`);
    const values = item.perSurface.map((p) => `${p.surface}: ${p.value}`).join('   ');
    out.push(`      ${paint(DIM, values)}`);
  }
  out.push('');

  if (result.discrepancies.length > topN) {
    out.push(paint(DIM, `  ...and ${result.discrepancies.length - topN} more.`));
    out.push('');
  }

  const limitations = options.limitations ?? [];
  if (limitations.length > 0) {
    out.push(paint(BOLD, '  What this check could not see'));
    for (const note of limitations) out.push(`    ${paint(DIM, `- ${note}`)}`);
    out.push('');
  }

  return out.join('\n');
}

const HEADERS = [
  'Severity', 'Issue', 'Matched by', 'Identifier', 'Product', 'Detail', 'Per surface',
] as const;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function renderTruthCsv(result: TruthResult): string {
  const rows = [HEADERS.join(',')];
  for (const item of result.discrepancies) {
    rows.push([
      item.severity,
      csvCell(KIND_LABEL[item.kind]),
      item.matchedBy,
      csvCell(item.key),
      csvCell(item.productTitle),
      csvCell(item.summary),
      csvCell(item.perSurface.map((p) => `${p.surface}: ${p.value}`).join(' | ')),
    ].join(','));
  }
  return `${rows.join('\n')}\n`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
