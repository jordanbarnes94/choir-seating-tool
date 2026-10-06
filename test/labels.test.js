/*
 * Tests for the shared seat-labelling helper.
 *
 * Run: npm test    (plain `node --test`, no dependency and no config)
 *
 * seatLabelFor() is the single place in the app that turns a chair into a name, and four later
 * items (orientation, the seating spreadsheet, print, the walk-on list) call it rather than
 * formatting their own. So the cases worth pinning are the ones a second implementation would
 * get wrong: the separator that is always there, the spreadsheet letters past Z, the fact that
 * an absent setting means the default rather than a blank, and that the internal seat index is
 * never touched by any of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LABEL_DEFAULTS,
  LABEL_OPTIONS,
  alphaLabel,
  colLabelAt,
  normaliseLabels,
  rowLabelAt,
  seatLabelFor
} from '../src/utils/labels.js';
import { COLS_MAX } from '../src/utils/persistence.js';

/* ---------- the settings themselves ---------- */

test('every default is a legal value for its own field', () => {
  for (const [field, value] of Object.entries(LABEL_DEFAULTS)) {
    assert.ok(LABEL_OPTIONS[field].includes(value), `${field} default must be legal`);
  }
  assert.deepEqual(Object.keys(LABEL_DEFAULTS).sort(), Object.keys(LABEL_OPTIONS).sort());
});

test('normaliseLabels: anything that is not an object comes back on the defaults', () => {
  for (const bad of [null, undefined, 'letters', 7, []]) assert.deepEqual(normaliseLabels(bad), { ...LABEL_DEFAULTS });
});

test('normaliseLabels: an absent or unrecognised field defaults without costing the others', () => {
  // This is the "a plan saved before the bump renders exactly as before" rule, in one assertion:
  // absence resolves to the default, field by field, so one bad key cannot take the rest with it.
  const out = normaliseLabels({ rowLabel: 'numbers', rowFirst: 'sideways', colOrder: 'rtl' });
  assert.equal(out.rowLabel, 'numbers');
  assert.equal(out.rowFirst, LABEL_DEFAULTS.rowFirst, 'an illegal value falls back');
  assert.equal(out.colLabel, LABEL_DEFAULTS.colLabel, 'an absent field falls back');
  assert.equal(out.colOrder, 'rtl');
});

/* ---------- spreadsheet letters ---------- */

test('alphaLabel: A to Z, then AA, AB and on', () => {
  assert.equal(alphaLabel(0), 'A');
  assert.equal(alphaLabel(25), 'Z');
  assert.equal(alphaLabel(26), 'AA');
  assert.equal(alphaLabel(27), 'AB');
  assert.equal(alphaLabel(51), 'AZ');
  assert.equal(alphaLabel(52), 'BA');
  assert.equal(alphaLabel(701), 'ZZ');
  assert.equal(alphaLabel(702), 'AAA');
});

test('alphaLabel: the past-Z range is reachable inside the real grid, not theoretical', () => {
  // COLS_MAX is 40, so a lettered column axis runs into AA at column 27 in normal use. This is
  // the case that makes bijective base-26 worth having rather than one letter that runs out.
  assert.ok(COLS_MAX > 26);
  assert.equal(alphaLabel(26), 'AA');
  assert.equal(alphaLabel(COLS_MAX - 1), 'AN');
});

test('alphaLabel: nonsense in, empty string out', () => {
  for (const bad of [-1, NaN, Infinity, null, undefined, 'A']) assert.equal(alphaLabel(bad), '');
});

/* ---------- the axes ---------- */

test('rowLabelAt: rowFirst decides which end OF THE DRAWING is row 1', () => {
  const rows = 4;
  const top = { rowLabel: 'letters', rowFirst: 'top' };
  const bottom = { rowLabel: 'letters', rowFirst: 'bottom' };
  // `r` is the stored row, 0 = the front row. With the audience below, the front row is drawn at
  // the FOOT of the picture, so 'bottom' names it A and 'top' names it D.
  assert.deepEqual([0, 1, 2, 3].map((r) => rowLabelAt(r, rows, bottom, 'bottom')), ['A', 'B', 'C', 'D']);
  assert.deepEqual([0, 1, 2, 3].map((r) => rowLabelAt(r, rows, top, 'bottom')), ['D', 'C', 'B', 'A']);
  // With the audience above, the front row is drawn at the top, so the same two settings name it
  // the other way round. The PICTURE reads A-at-the-top under 'top' either way, which is the point.
  assert.deepEqual([0, 1, 2, 3].map((r) => rowLabelAt(r, rows, top, 'top')), ['A', 'B', 'C', 'D']);
  assert.deepEqual([0, 1, 2, 3].map((r) => rowLabelAt(r, rows, bottom, 'top')), ['D', 'C', 'B', 'A']);
});

test('colLabelAt: colOrder decides which side is column 1', () => {
  const cols = 3;
  assert.deepEqual([0, 1, 2].map((c) => colLabelAt(c, cols, { colLabel: 'numbers', colOrder: 'ltr' })), ['1', '2', '3']);
  assert.deepEqual([0, 1, 2].map((c) => colLabelAt(c, cols, { colLabel: 'numbers', colOrder: 'rtl' })), ['3', '2', '1']);
});

/* ---------- the seat label ---------- */

// a 4-row, 3-column grid; `seats` is column-major, so index = col * rows + row.
const ROWS = 4, COLS = 3;
const at = (row, col, settings) => seatLabelFor(col * ROWS + row, ROWS, COLS, settings);

test('seatLabelFor: always row, separator, column, never a special case', () => {
  // Decided by Jordan, 2026-09-02: the separator is unconditional, including when both axes are
  // letters, so no consumer has to know which combination it is looking at.
  assert.equal(at(1, 1, { rowLabel: 'letters', colLabel: 'numbers' }), 'B-2');
  assert.equal(at(1, 1, { rowLabel: 'numbers', colLabel: 'letters' }), '2-B');
  assert.equal(at(1, 1, { rowLabel: 'numbers', colLabel: 'numbers' }), '2-2');
  assert.equal(at(1, 1, { rowLabel: 'letters', colLabel: 'letters' }), 'B-B');
});

test('seatLabelFor: all sixteen combinations of the four settings are distinct rules', () => {
  // The seat itself never moves: row 1 of 4, column 1 of 3, i.e. seat index 5 throughout. Only
  // the name changes, which is the whole claim of "purely cosmetic".
  const seen = new Map();
  for (const rowLabel of LABEL_OPTIONS.rowLabel)
    for (const rowFirst of LABEL_OPTIONS.rowFirst)
      for (const colLabel of LABEL_OPTIONS.colLabel)
        for (const colOrder of LABEL_OPTIONS.colOrder) {
          const key = [rowLabel, rowFirst, colLabel, colOrder].join('/');
          seen.set(key, seatLabelFor(5, ROWS, COLS, { rowLabel, rowFirst, colLabel, colOrder }));
        }
  assert.equal(seen.size, 16);
  assert.equal(seen.get('letters/bottom/numbers/ltr'), 'B-2');
  assert.equal(seen.get('letters/top/numbers/ltr'), 'C-2');
  assert.equal(seen.get('letters/bottom/numbers/rtl'), 'B-2'); // column 1 of 3 is the middle either way
  assert.equal(seen.get('numbers/top/letters/rtl'), '3-B');
});

test('seatLabelFor: absent settings render the plan exactly as the defaults do', () => {
  // A plan saved before schema 3 carries no settings at all. It must label itself as it always
  // did, so an absent object and the explicit defaults have to agree seat for seat.
  for (let i = 0; i < ROWS * COLS; i++) {
    assert.equal(seatLabelFor(i, ROWS, COLS, undefined), seatLabelFor(i, ROWS, COLS, { ...LABEL_DEFAULTS }));
  }
  assert.equal(seatLabelFor(0, ROWS, COLS, undefined), 'A-1');
});

test('seatLabelFor: every seat in a grid gets its own label', () => {
  const labels = new Set();
  for (let i = 0; i < ROWS * COLS; i++) labels.add(seatLabelFor(i, ROWS, COLS, { rowLabel: 'letters', colLabel: 'letters' }));
  assert.equal(labels.size, ROWS * COLS, 'two chairs must never share a name');
});

test('seatLabelFor: a lettered column axis crosses Z inside a legal grid', () => {
  const cols = COLS_MAX; // 40, the widest stage the app allows
  assert.equal(seatLabelFor(26 * ROWS, ROWS, cols, { rowLabel: 'letters', colLabel: 'letters' }), 'A-AA');
  assert.equal(seatLabelFor(26 * ROWS, ROWS, cols, { colLabel: 'letters', colOrder: 'rtl' }), 'A-N');
});

test('seatLabelFor: an index outside the grid has no label rather than a wrong one', () => {
  for (const bad of [-1, ROWS * COLS, ROWS * COLS + 1, NaN, undefined, 'seven']) {
    assert.equal(seatLabelFor(bad, ROWS, COLS, {}), '');
  }
  assert.equal(seatLabelFor(0, 0, 0, {}), '');
});

/* ---------- the viewpoint, which only the COLUMN axis is measured against ----------
   Reversed by Jordan on 2026-09-11: "left-to-right for column orders means left-to-right, it
   doesn't depend on STAGE-left to right". Until then nothing here read the viewpoint, and moving the
   audience instead WROTE rowFirst and colOrder. */

test('the viewpoint is an argument, never a field of the settings object', () => {
  // Passing it in the settings object must do nothing at all: that is what stops the two frames
  // from being confused, and it keeps `labels` exactly the four fields the plan saves.
  const settings = { ...LABEL_DEFAULTS };
  assert.equal(seatLabelFor(5, ROWS, COLS, { ...settings, audienceAt: 'top' }), seatLabelFor(5, ROWS, COLS, settings));
  assert.ok(!('audienceAt' in normaliseLabels({ ...settings, audienceAt: 'top' })));
});

test('an omitted viewpoint means the default one, so older callers are unaffected', () => {
  const settings = { ...LABEL_DEFAULTS };
  for (let i = 0; i < ROWS * COLS; i++)
    assert.equal(seatLabelFor(i, ROWS, COLS, settings), seatLabelFor(i, ROWS, COLS, settings, 'bottom'));
  assert.equal(colLabelAt(0, 3, { colOrder: 'ltr' }), colLabelAt(0, 3, { colOrder: 'ltr' }, 'bottom'));
});

test('colLabelAt: column 1 is a side of the DRAWING, so a rotation mirrors it', () => {
  const cols = 3, ltr = { colLabel: 'numbers', colOrder: 'ltr' };
  // stored column 0 is drawn at the left from the audience, and at the right from the stage.
  assert.deepEqual([0, 1, 2].map((c) => colLabelAt(c, cols, ltr, 'bottom')), ['1', '2', '3']);
  assert.deepEqual([0, 1, 2].map((c) => colLabelAt(c, cols, ltr, 'top')), ['3', '2', '1']);
  // and 'rtl' is the other side of the picture, under either viewpoint.
  const rtl = { colLabel: 'numbers', colOrder: 'rtl' };
  assert.deepEqual([0, 1, 2].map((c) => colLabelAt(c, cols, rtl, 'bottom')), ['3', '2', '1']);
  assert.deepEqual([0, 1, 2].map((c) => colLabelAt(c, cols, rtl, 'top')), ['1', '2', '3']);
});

test('the label grid is nailed to the DRAWING, so a rotation renames no position', () => {
  // The whole of "as the user looks at it": display position (dr, dc) always gets the same name,
  // whichever side the audience is on. Walk the picture and compare the two viewpoints cell for
  // cell, converting each display position to the stored seat it holds.
  const s = { ...LABEL_DEFAULTS };
  for (let dr = 0; dr < ROWS; dr++)
    for (let dc = 0; dc < COLS; dc++) {
      // audience below: display row dr from the top is stored row ROWS-1-dr, column dc as stored.
      const below = seatLabelFor(dc * ROWS + (ROWS - 1 - dr), ROWS, COLS, s, 'bottom');
      // audience above: the drawing is rotated, so the same corner holds the mirrored seat.
      const above = seatLabelFor((COLS - 1 - dc) * ROWS + dr, ROWS, COLS, s, 'top');
      assert.equal(above, below, `display cell ${dr},${dc} must keep its name`);
    }
});

test('seatLabelFor: a rotation therefore renames the CHAIR, on both axes', () => {
  // The accepted cost, pinned so nobody "fixes" it by accident: a name identifies a position in
  // the picture, not a physical chair, so whatever prints a plan must say which viewpoint it used.
  const s = { ...LABEL_DEFAULTS };
  assert.equal(seatLabelFor(0, ROWS, COLS, s, 'bottom'), 'A-1');
  assert.equal(seatLabelFor(0, ROWS, COLS, s, 'top'), 'D-3');
  // and the mirror is exact: seat i seen from the stage is named for seat N-1-i seen from the house
  const n = ROWS * COLS;
  for (let i = 0; i < n; i++)
    assert.equal(seatLabelFor(i, ROWS, COLS, s, 'top'), seatLabelFor(n - 1 - i, ROWS, COLS, s, 'bottom'));
});
