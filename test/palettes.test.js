/*
 * Tests for the colour schemes (utils/palettes.js). Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeScheme,
  defaultPalettes,
  hasCustomColours,
  makeScheme,
  normalisePalettes,
  withSectionColour,
  withSplitColour,
  withoutSectionColour,
  withoutSectionSplitColours
} from '../src/utils/palettes.js';

test('the default is one scheme, on the app’s own colours, and it is active', () => {
  const p = defaultPalettes();
  assert.equal(p.schemes.length, 1);
  assert.equal(activeScheme(p).name, 'Default');
  assert.deepEqual(activeScheme(p).colours, {});
  assert.deepEqual(activeScheme(p).splitColours, {});
});

test('junk normalises to the default rather than to nothing', () => {
  for (const bad of [null, undefined, 7, 'x', {}, { schemes: [] }, { schemes: [{ name: 'no id' }] }])
    assert.deepEqual(normalisePalettes(bad), defaultPalettes());
});

test('each scheme is cleaned, and a duplicate id keeps the first', () => {
  const p = normalisePalettes({
    active: 'p2',
    schemes: [
      { id: 'p1', name: 'One', colours: { Alto: '#AABBCC', Tenor: 'teal', Descant: '#000000' } },
      { id: 'p2', name: '', splitColours: { Bass: { 0: '#FF8800', 99: '#000000' } } },
      { id: 'p1', name: 'Duplicate' }
    ]
  });
  assert.deepEqual(p.schemes.map((s) => s.name), ['One', 'Colours']);
  assert.deepEqual(p.schemes[0].colours, { Alto: '#aabbcc' });
  assert.deepEqual(p.schemes[1].splitColours, { Bass: { 0: '#ff8800' } });
  assert.equal(activeScheme(p).id, 'p2');
});

test('an active id naming no scheme falls back to the first', () => {
  const p = normalisePalettes({ active: 'p9', schemes: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] });
  assert.equal(p.active, 'p1');
});

test('makeScheme mints the next id and copies colours only when asked', () => {
  const p = normalisePalettes({ schemes: [{ id: 'p1', name: 'One', colours: { Alto: '#112233' } }, { id: 'p4', name: 'Four' }] });
  const blank = makeScheme(p, '  Fresh  ');
  assert.equal(blank.id, 'p5');
  assert.equal(blank.name, 'Fresh');
  assert.deepEqual(blank.colours, {});
  const copy = makeScheme(p, 'Copy', p.schemes[0]);
  assert.deepEqual(copy.colours, { Alto: '#112233' });
  assert.notEqual(copy.colours, p.schemes[0].colours, 'a copy, not a shared object');
});

const blankPair = () => ({ colours: {}, splitColours: {} });

test('a section colour is stored lower-case, and a bad section or hex changes nothing', () => {
  const pair = blankPair();
  const next = withSectionColour(pair, 'Alto', '#AABBCC');
  assert.deepEqual(next.colours, { Alto: '#aabbcc' });
  assert.deepEqual(pair.colours, {}, 'the input pair is not mutated');
  assert.equal(withSectionColour(next, 'Alto', '#aabbcc'), next, 'the same colour again is a no-op');
  assert.equal(withSectionColour(next, 'Descant', '#000000'), next);
  assert.equal(withSectionColour(next, 'Alto', 'teal'), next);
});

test('resetting a section deletes its override rather than writing the default', () => {
  const pair = withSectionColour(blankPair(), 'Tenor', '#123456');
  assert.deepEqual(withoutSectionColour(pair, 'Tenor').colours, {});
  assert.equal(withoutSectionColour(pair, 'Bass'), pair, 'nothing to reset is a no-op');
});

test('split frames: guarded by position, and a section reset drops the key', () => {
  let pair = withSplitColour(blankPair(), 'Bass', 0, '#FF8800');
  pair = withSplitColour(pair, 'Bass', 2, '#008800');
  assert.deepEqual(pair.splitColours, { Bass: { 0: '#ff8800', 2: '#008800' } });
  assert.equal(withSplitColour(pair, 'Bass', -1, '#000000'), pair);
  assert.equal(withSplitColour(pair, 'Bass', 1.5, '#000000'), pair);
  assert.equal(withSplitColour(pair, 'Bass', 0, 'nope'), pair);
  assert.deepEqual(withoutSectionSplitColours(pair, 'Bass').splitColours, {});
});

test('hasCustomColours sees either map, for one section or any', () => {
  assert.equal(hasCustomColours(blankPair()), false);
  const col = withSectionColour(blankPair(), 'Alto', '#123456');
  const frame = withSplitColour(blankPair(), 'Soprano', 0, '#123456');
  assert.equal(hasCustomColours(col), true);
  assert.equal(hasCustomColours(frame), true);
  assert.equal(hasCustomColours(col, 'Alto'), true);
  assert.equal(hasCustomColours(col, 'Bass'), false);
  assert.equal(hasCustomColours(frame, 'Soprano'), true);
});

test('makeScheme copies from a bare colours pair too', () => {
  const pair = withSectionColour(blankPair(), 'Alto', '#112233');
  assert.deepEqual(makeScheme(defaultPalettes(), 'Draft', pair).colours, { Alto: '#112233' });
});
