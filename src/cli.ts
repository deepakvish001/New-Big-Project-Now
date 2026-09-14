#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { Catalogue, Product } from './types.ts';
import { applicableRules } from './index.ts';
import { catalogueFromProductsJson, fetchPublicCatalogue } from './adapters/shopify.ts';
import { catalogueFromShopifyCsv } from './adapters/shopify-csv.ts';
import { scoreCatalogue } from './score.ts';
import { renderTerminal } from './report/terminal.ts';
import { renderHtml } from './report/html.ts';
import { renderEnrichTerminal, renderProposalsCsv } from './report/proposals.ts';
import { applyAccepted, enrichCatalogue } from './enrich/index.ts';
import { ClaudeProposer, NullProposer } from './enrich/proposer.ts';
import type { Proposer } from './enrich/types.ts';

const USAGE = `
catalog-score — score a product catalogue for AI shopping agent readability

  catalog-score <source> [options]
  catalog-score enrich <source> [options]

Source may be:
  a store domain      example.com or https://example.myshopify.com
                      (reads the public product feed, no credentials needed)
  a .csv file         a Shopify product export
  a .json file        a saved /products.json payload

Scoring options:
  --out <file>        write a standalone HTML report
  --json              print the full result as JSON instead of a summary
  --top <n>           entries in each ranked list (default 10)
  --currency <ISO>    declare the currency for CSV sources, e.g. INR
  --max-pages <n>     pages to read from a public store (default 8, 250 per page)
  --no-colour         plain text output

Enrich options (restructures existing copy into missing attributes):
  --limit <n>         only enrich the first n products (default 25)
  --concurrency <n>   products in flight at once (default 4)
  --model <id>        Claude model (default claude-opus-5)
  --proposals <file>  write the review sheet as CSV
  --dry-run           report the gaps without calling the API

Examples:
  catalog-score allbirds.com --out report.html
  catalog-score ./products_export.csv --currency INR
  catalog-score enrich ./products_export.csv --limit 10 --proposals review.csv
`;

interface Args {
  command: 'score' | 'enrich';
  source?: string;
  out?: string;
  json: boolean;
  top: number;
  currency?: string;
  maxPages: number;
  colour: boolean;
  help: boolean;
  limit: number;
  concurrency: number;
  model?: string;
  proposals?: string;
  dryRun: boolean;
}

function positiveInt(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) throw new Error(`${flag} needs a positive number`);
  return Math.floor(value);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'score',
    json: false,
    top: 10,
    maxPages: 8,
    colour: true,
    help: false,
    limit: 25,
    concurrency: 4,
    dryRun: false,
  };

  let rest = argv;
  if (rest[0] === 'enrich' || rest[0] === 'score') {
    args.command = rest[0] as Args['command'];
    rest = rest.slice(1);
  }

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    switch (token) {
      case '-h':
      case '--help': args.help = true; break;
      case '--json': args.json = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--no-colour':
      case '--no-color': args.colour = false; break;
      case '--out': args.out = rest[++i]; break;
      case '--proposals': args.proposals = rest[++i]; break;
      case '--model': args.model = rest[++i]; break;
      case '--currency': args.currency = rest[++i]?.toUpperCase(); break;
      case '--top': args.top = positiveInt(rest[++i], '--top'); break;
      case '--max-pages': args.maxPages = positiveInt(rest[++i], '--max-pages'); break;
      case '--limit': args.limit = positiveInt(rest[++i], '--limit'); break;
      case '--concurrency': args.concurrency = positiveInt(rest[++i], '--concurrency'); break;
      default:
        if (token.startsWith('-')) throw new Error(`Unknown option: ${token}`);
        if (args.source) throw new Error('Give exactly one source');
        args.source = token;
    }
  }

  return args;
}

function looksLikeFile(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/') || /\.(csv|json)$/i.test(source);
}

export async function loadCatalogue(args: Args): Promise<Catalogue> {
  const source = args.source!;

  if (!looksLikeFile(source)) {
    return fetchPublicCatalogue(source, { maxPages: args.maxPages });
  }

  const file = path.resolve(source);
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const text = await readFile(file, 'utf8');

  if (/\.csv$/i.test(file)) {
    return catalogueFromShopifyCsv(text, {
      source: path.basename(file),
      storeName: path.basename(file),
      currency: args.currency,
    });
  }

  const payload = JSON.parse(text) as Parameters<typeof catalogueFromProductsJson>[0];
  return catalogueFromProductsJson(payload, {
    source: path.basename(file),
    storeName: path.basename(file),
  });
}

async function runScore(args: Args, catalogue: Catalogue): Promise<number> {
  const result = scoreCatalogue(catalogue, {
    rules: applicableRules(catalogue),
    topN: args.top,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      renderTerminal(result, {
        colour: args.colour && process.stdout.isTTY !== false,
        limitations: catalogue.limitations,
        topN: Math.min(args.top, 5),
      }),
    );
    if (catalogue.skipped) {
      process.stdout.write(`  ${catalogue.skipped} unreadable records were skipped.\n\n`);
    }
  }

  if (args.out) {
    const html = renderHtml(result, { limitations: catalogue.limitations, topN: args.top });
    await writeFile(args.out, html, 'utf8');
    if (!args.json) process.stdout.write(`  Report written to ${args.out}\n\n`);
  }

  return 0;
}

async function runEnrich(args: Args, catalogue: Catalogue): Promise<number> {
  const proposer: Proposer = args.dryRun
    ? new NullProposer()
    : new ClaudeProposer(args.model ? { model: args.model } : {});

  const scoped: Catalogue = { ...catalogue, products: catalogue.products.slice(0, args.limit) };
  const rules = applicableRules(catalogue);

  if (!args.json && !args.dryRun) {
    process.stdout.write(
      `\n  Enriching ${scoped.products.length} products with ${args.model ?? 'claude-opus-5'}...\n`,
    );
  }

  const result = await enrichCatalogue(scoped, proposer, {
    concurrency: args.concurrency,
    limit: args.limit,
  });

  const before = scoreCatalogue(scoped, { rules }).score;
  const byId = new Map(result.products.map((entry) => [entry.productId, entry]));
  const applied: Product[] = scoped.products.map((product) => {
    const proposals = byId.get(product.id);
    return proposals ? applyAccepted(product, proposals) : product;
  });
  const after = scoreCatalogue({ ...scoped, products: applied }, { rules }).score;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...result, scoreBefore: before, scoreAfter: after }, null, 2)}\n`);
  } else {
    process.stdout.write(
      renderEnrichTerminal(result, {
        scoreBefore: before,
        scoreAfter: after,
        scopeCount: scoped.products.length,
        catalogueCount: catalogue.products.length,
        dryRun: args.dryRun,
        topN: 5,
      }),
    );
  }

  if (args.proposals) {
    await writeFile(args.proposals, renderProposalsCsv(result), 'utf8');
    if (!args.json) process.stdout.write(`  Review sheet written to ${args.proposals}\n\n`);
  }

  return 0;
}

export async function run(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }

  if (args.help || !args.source) {
    process.stdout.write(USAGE);
    return args.help ? 0 : 2;
  }

  let catalogue: Catalogue;
  try {
    catalogue = await loadCatalogue(args);
  } catch (error) {
    process.stderr.write(`Could not read the catalogue: ${(error as Error).message}\n`);
    return 1;
  }

  if (catalogue.products.length === 0) {
    process.stderr.write(
      `No products found in ${catalogue.source}. `
      + 'If this is a live store, its public product feed may be disabled.\n',
    );
    return 1;
  }

  try {
    return args.command === 'enrich' ? await runEnrich(args, catalogue) : await runScore(args, catalogue);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && /catalog-score|cli\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  run(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      process.exitCode = 1;
    });
}
