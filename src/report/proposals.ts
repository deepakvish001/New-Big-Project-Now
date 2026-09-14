import type { EnrichmentResult } from '../enrich/types.ts';

const HEADERS = [
  'Product ID',
  'Product',
  'Attribute',
  'Proposed value',
  'Verdict',
  'Confidence',
  'Evidence',
  'Note',
] as const;

function cell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The review sheet. Every row carries the evidence it was drawn from, so a
 * merchant can check a value without opening the product.
 */
export function renderProposalsCsv(result: EnrichmentResult): string {
  const rows: string[] = [HEADERS.join(',')];

  for (const product of result.products) {
    if (product.error) {
      rows.push([
        cell(product.productId), cell(product.title), '', '', 'failed', '', '',
        cell(product.error),
      ].join(','));
      continue;
    }

    for (const proposal of product.proposals) {
      rows.push([
        cell(product.productId),
        cell(product.title),
        cell(proposal.key),
        cell(proposal.value),
        cell(proposal.verdict),
        cell(proposal.confidence.toFixed(2)),
        cell(proposal.evidence),
        cell(proposal.reason),
      ].join(','));
    }
  }

  return `${rows.join('\n')}\n`;
}

export interface EnrichTerminalOptions {
  /** Score before and after applying accepted proposals. */
  scoreBefore?: number;
  scoreAfter?: number;
  /** How many products the delta covers, when it is only part of the catalogue. */
  scopeCount?: number;
  catalogueCount?: number;
  dryRun?: boolean;
  topN?: number;
}

export function renderEnrichTerminal(
  result: EnrichmentResult,
  options: EnrichTerminalOptions = {},
): string {
  const { summary } = result;
  const out: string[] = [''];

  out.push(options.dryRun ? 'Enrichment dry run — no proposals requested' : 'Enrichment');
  out.push(
    `  ${summary.productsWithGaps} of ${summary.productsConsidered} products have unfilled attributes`,
  );
  out.push('');

  out.push(`  proposed      ${String(summary.proposed).padStart(5)}`);
  out.push(`  accepted      ${String(summary.accepted).padStart(5)}   evidence checks out, high confidence`);
  out.push(`  needs review  ${String(summary.needsReview).padStart(5)}   evidence checks out, confirm before publishing`);
  out.push(`  rejected      ${String(summary.rejected).padStart(5)}   unsupported by the merchant's own content`);
  if (summary.failed > 0) out.push(`  failed        ${String(summary.failed).padStart(5)}`);
  out.push('');

  const rejected = result.products
    .flatMap((p) => p.proposals.filter((x) => x.verdict === 'rejected').map((x) => ({ p, x })))
    .slice(0, options.topN ?? 5);

  if (rejected.length > 0) {
    out.push('  Rejected, and why');
    for (const { p, x } of rejected) {
      out.push(`    ${x.key} = "${truncate(x.value, 40)}"  (${truncate(p.title, 34)})`);
      out.push(`      ${x.reason}`);
    }
    out.push('');
  }

  if (options.scoreBefore !== undefined && options.scoreAfter !== undefined) {
    const delta = options.scoreAfter - options.scoreBefore;
    const arrow = delta >= 0 ? '+' : '';
    const partial = options.scopeCount !== undefined
      && options.catalogueCount !== undefined
      && options.scopeCount < options.catalogueCount;
    const scope = partial
      ? ` across the ${options.scopeCount} products enriched, not the full catalogue of ${options.catalogueCount}`
      : '';

    out.push(
      `  Score if the accepted proposals are published: `
      + `${options.scoreBefore.toFixed(1)} -> ${options.scoreAfter.toFixed(1)} (${arrow}${delta.toFixed(1)})${scope}`,
    );
    out.push('');
  }

  return out.join('\n');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
