import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toTable } from '../src/adapters/csv-parse.ts';

test('parses quoted fields containing commas and quotes', () => {
  const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"'], ['1', '2', '3']]);
});

test('parses newlines inside quoted fields', () => {
  const rows = parseCsv('h1,h2\n"line one\nline two",x');
  assert.deepEqual(rows, [['h1', 'h2'], ['line one\nline two', 'x']]);
});

test('handles CRLF and a trailing newline', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('strips a UTF-8 BOM from the first header', () => {
  const { headers } = toTable('﻿Handle,Title\nx,y');
  assert.deepEqual(headers, ['Handle', 'Title']);
});

test('toTable pads short rows rather than dropping columns', () => {
  const { rows } = toTable('a,b,c\n1,2');
  assert.deepEqual(rows[0], { a: '1', b: '2', c: '' });
});

test('empty input yields no headers', () => {
  assert.deepEqual(toTable(''), { headers: [], rows: [] });
});
