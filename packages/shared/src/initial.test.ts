import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialOf } from './initial';

test('the first letter, upper-cased', () => {
  assert.equal(initialOf('maowe'), 'M');
  assert.equal(initialOf('Émile'), 'É');
  assert.equal(initialOf('émile'), 'É');
  assert.equal(initialOf('ömer'), 'Ö');
});

test('scripts without cases keep their first character whole', () => {
  assert.equal(initialOf('张伟'), '张');
  assert.equal(initialOf('김민준'), '김');
  assert.equal(initialOf('さくら'), 'さ');
  assert.equal(initialOf('किरण'), 'कि');
});

test('what is not a letter or digit in front is skipped', () => {
  assert.equal(initialOf('_build'), 'B');
  assert.equal(initialOf('.dev'), 'D');
  assert.equal(initialOf('😀anna'), 'A');
  assert.equal(initialOf('2fast'), '2');
});

test('no letter or digit gives nothing', () => {
  assert.equal(initialOf(''), '');
  assert.equal(initialOf('😀'), '');
  assert.equal(initialOf('__'), '');
});
