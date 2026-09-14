import test from 'node:test';
import assert from 'node:assert/strict';

import { checkDigit, isValidGtin, normaliseGtin } from '../src/util/gtin.ts';

test('checkDigit matches known GTIN bodies', () => {
  assert.equal(checkDigit('400638133393'), 1); // EAN-13 4006381333931
  assert.equal(checkDigit('01234567890'), 5);  // UPC-A 012345678905
  assert.equal(checkDigit('9638507'), 4);      // EAN-8 96385074
  assert.equal(checkDigit('890123456789'), 0);
});

test('accepts valid GTIN-8, 12, 13 and 14', () => {
  assert.ok(isValidGtin('96385074'));
  assert.ok(isValidGtin('012345678905'));
  assert.ok(isValidGtin('8901234567890'));
  assert.ok(isValidGtin('00012345678905'));
});

test('rejects a wrong check digit', () => {
  assert.equal(isValidGtin('8901234567894'), false);
  assert.equal(isValidGtin('4006381333930'), false);
});

test('rejects wrong lengths, non-digits and all-zero codes', () => {
  assert.equal(isValidGtin('12345'), false);
  assert.equal(isValidGtin('ABC1234567890'), false);
  assert.equal(isValidGtin('0000000000000'), false);
  assert.equal(isValidGtin(''), false);
  assert.equal(isValidGtin(undefined), false);
});

test('normalises separators but not letters', () => {
  assert.equal(normaliseGtin('890-1234 567890'), '8901234567890');
  assert.equal(normaliseGtin('89012X4567890'), undefined);
});
