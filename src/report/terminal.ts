import type { CatalogueScore, Grade } from '../types.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const GRADE_COLOUR: Record<Grade, string> = {
  A: GREEN,
  B: GREEN,
  C: YELLOW,
  D: YELLOW,
  F: RED,
};

export interface TerminalOptions {
  colour?: boolean;
  limitations?: string[];
  topN?: number;
}

export function renderTerminal(result: CatalogueScore, options: TerminalOptions = {}): string {
  const colour = options.colour ?? true;
  const paint = (code: string, text: string) => (colour ? `${code}${text}${RESET}` : text);
  const topN = options.topN ?? 5;
  const out: string[] = [];

  const heading = result.storeName ?? result.source;
  out.push('');
  out.push(paint(BOLD, `Agent-readiness report — ${heading}`));
  out.push(paint(DIM, `${result.productCount} products · scored ${result.scoredAt}`));
  out.push('');

  out.push(
    `  ${paint(BOLD, `${result.score.toFixed(1)} / 100`)}  `
    + `${paint(GRADE_COLOUR[result.grade] + BOLD, `grade ${result.grade}`)}`,
  );
  out.push(`  ${bar(result.score, 40, colour)}`);
  out.push('');

  const invisible = `${result.invisibleCount} of ${result.productCount} products (${result.invisibleShare}%)`;
  out.push(`  ${paint(BOLD, invisible)} score below 50 — effectively invisible to AI shopping agents.`);
  out.push('');

  if (result.groups.length > 0) {
    out.push(paint(BOLD, '  By group'));
    const groupWidth = Math.max(...result.groups.map((g) => g.group.length));
    for (const group of result.groups) {
      out.push(
        `    ${group.group.padEnd(groupWidth)}  ${group.score.toFixed(1).padStart(5)}  `
        + bar(group.score, 24, colour),
      );
    }
    out.push('');
  }

  if (result.topImpacts.length > 0) {
    out.push(paint(BOLD, '  Costing you the most'));
    for (const impact of result.topImpacts.slice(0, topN)) {
      out.push(
        `    ${paint(BOLD, `-${impact.catalogueCost.toFixed(1)} pts`)}  ${impact.title} `
        + paint(DIM, `(${impact.affected} ${impact.affected === 1 ? 'product' : 'products'}, ${impact.severity})`),
      );
      out.push(`               ${paint(DIM, impact.fix)}`);
    }
    out.push('');
  }

  if (result.worstProducts.length > 0) {
    out.push(paint(BOLD, '  Worst products'));
    for (const product of result.worstProducts.slice(0, topN)) {
      const top = product.findings[0];
      out.push(
        `    ${product.score.toFixed(0).padStart(3)}  ${truncate(product.title, 52)}`
        + (top ? paint(DIM, `  - ${top.title.toLowerCase()}`) : ''),
      );
    }
    out.push('');
  }

  const limitations = options.limitations ?? [];
  if (limitations.length > 0) {
    out.push(paint(BOLD, '  What this scan could not see'));
    for (const note of limitations) out.push(`    ${paint(DIM, `- ${note}`)}`);
    out.push('');
  }

  return out.join('\n');
}

function bar(score: number, width: number, colour: boolean): string {
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * width);
  const body = '█'.repeat(filled) + '░'.repeat(width - filled);
  if (!colour) return body;
  const code = clamped >= 70 ? GREEN : clamped >= 40 ? YELLOW : RED;
  return `${code}${body}${RESET}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
