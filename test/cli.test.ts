import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../src/cli.ts';

test('defaults to scoring with no command word', () => {
  const args = parseArgs(['example.com']);
  assert.equal(args.command, 'score');
  assert.deepEqual(args.sources, ['example.com']);
  assert.equal(args.top, 10);
  assert.equal(args.limit, 25);
  assert.equal(args.concurrency, 4);
  assert.equal(args.colour, true);
  assert.equal(args.batch, false);
});

test('recognises each command word', () => {
  assert.equal(parseArgs(['score', 'a.json']).command, 'score');
  assert.equal(parseArgs(['enrich', 'a.json']).command, 'enrich');
  assert.equal(parseArgs(['truth', 'a.json', 'b.tsv']).command, 'truth');
});

test('a command word is only taken from the first position', () => {
  // Otherwise a store literally named "enrich" could not be scored.
  const args = parseArgs(['score', 'enrich']);
  assert.equal(args.command, 'score');
  assert.deepEqual(args.sources, ['enrich']);
});

test('collects flag values that take an argument', () => {
  const args = parseArgs([
    'enrich', 'a.csv',
    '--out', 'r.html', '--report', 'd.csv', '--proposals', 'p.csv',
    '--model', 'claude-sonnet-5', '--currency', 'inr',
  ]);

  assert.equal(args.out, 'r.html');
  assert.equal(args.report, 'd.csv');
  assert.equal(args.proposals, 'p.csv');
  assert.equal(args.model, 'claude-sonnet-5');
  assert.equal(args.currency, 'INR', 'currency is upper-cased to ISO form');
});

test('collects boolean flags', () => {
  const args = parseArgs(['enrich', 'a.csv', '--json', '--dry-run', '--batch', '--no-colour']);
  assert.equal(args.json, true);
  assert.equal(args.dryRun, true);
  assert.equal(args.batch, true);
  assert.equal(args.colour, false);
});

test('accepts both spellings of colour', () => {
  assert.equal(parseArgs(['a.json', '--no-color']).colour, false);
  assert.equal(parseArgs(['a.json', '--no-colour']).colour, false);
});

test('parses numeric flags and rejects nonsense', () => {
  const args = parseArgs(['a.json', '--top', '3', '--max-pages', '2', '--limit', '50', '--concurrency', '8']);
  assert.equal(args.top, 3);
  assert.equal(args.maxPages, 2);
  assert.equal(args.limit, 50);
  assert.equal(args.concurrency, 8);

  assert.throws(() => parseArgs(['a.json', '--top', '0']), /--top needs a positive number/);
  assert.throws(() => parseArgs(['a.json', '--limit', 'many']), /--limit needs a positive number/);
  assert.throws(() => parseArgs(['a.json', '--concurrency', '-2']), /positive number/);
  assert.throws(() => parseArgs(['a.json', '--top']), /--top needs a positive number/);
});

test('numeric flags truncate rather than carrying a fraction', () => {
  assert.equal(parseArgs(['a.json', '--limit', '7.9']).limit, 7);
});

test('--format only accepts the formats that exist', () => {
  assert.equal(parseArgs(['a.csv', '--format', 'shopify']).format, 'shopify');
  assert.equal(parseArgs(['a.csv', '--format', 'google']).format, 'google');
  assert.throws(() => parseArgs(['a.csv', '--format', 'magento']), /--format must be shopify or google/);
});

test('an unknown option is an error, not a source', () => {
  assert.throws(() => parseArgs(['a.json', '--nope']), /Unknown option: --nope/);
});

test('score and enrich take exactly one source', () => {
  assert.throws(() => parseArgs(['a.json', 'b.json']), /takes exactly one source/);
  assert.throws(() => parseArgs(['enrich', 'a.json', 'b.json']), /takes exactly one source/);
});

test('truth needs at least two sources', () => {
  assert.throws(() => parseArgs(['truth', 'a.json']), /at least two sources/);
  assert.deepEqual(parseArgs(['truth', 'a.json', 'b.tsv']).sources, ['a.json', 'b.tsv']);
  assert.equal(parseArgs(['truth', 'a.json', 'b.tsv', 'c.csv']).sources.length, 3);
});

test('help is accepted in both forms and needs no source', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--help']).sources.length, 0);
});

test('no arguments at all parses without throwing', () => {
  const args = parseArgs([]);
  assert.deepEqual(args.sources, []);
  assert.equal(args.help, false);
});

test('a labelled source is kept intact for the loader to split', () => {
  const args = parseArgs(['truth', 'storefront=./products.json', 'feed=./merchant.tsv']);
  assert.deepEqual(args.sources, ['storefront=./products.json', 'feed=./merchant.tsv']);
});
