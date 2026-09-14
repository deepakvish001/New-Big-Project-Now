#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { Catalogue } from './types.ts';
import { applicableRules } from './index.ts';
import { catalogueFromProductsJson, fetchPublicCatalogue } from './adapters/shopify.ts';
import { catalogueFromShopifyCsv } from './adapters/shopify-csv.ts';
import { scoreCatalogue } from './score.ts';
import { renderTerminal } from './report/terminal.ts';
import { renderHtml } from './report/html.ts';

const USAGE = `
catalog-score — score a product catalogue for AI shopping agent readability

  catalog-score <source> [options]

Source may be:
  a store domain      example.com or https://example.myshopify.com
                      (reads the public product feed, no credentials needed)
  a .csv file         a Shopify product export
  a .json file        a saved /products.json payload

Options:
  --out <file>        write a standalone HTML report
  --json              print the full result as JSON instead of a summary
  --top <n>           entries in each ranked list (default 10)
  --currency <ISO>    declare the currency for CSV sources, e.g. INR
  --max-pages <n>     pages to read from a public store (default 8, 250 per page)
  --no-colour         plain text output
  -h, --help          this message

Examples:
  catalog-score allbirds.com --out report.html
  catalog-score ./products_export.csv --currency INR
`;

interface Args {
  source?: string;
  out?: string;
  json: boolean;
  top: number;
  currency?: string;
  maxPages: number;
  colour: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, top: 10, maxPages: 8, colour: true, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    switch (token) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--no-colour':
      case '--no-color':
        args.colour = false;
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--currency':
        args.currency = argv[++i]?.toUpperCase();
        break;
      case '--top': {
        const value = Number(argv[++i]);
        if (!Number.isFinite(value) || value < 1) throw new Error('--top needs a positive number');
        args.top = Math.floor(value);
        break;
      }
      case '--max-pages': {
        const value = Number(argv[++i]);
        if (!Number.isFinite(value) || value < 1) throw new Error('--max-pages needs a positive number');
        args.maxPages = Math.floor(value);
        break;
      }
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
    return args.source || args.help ? 0 : 2;
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
