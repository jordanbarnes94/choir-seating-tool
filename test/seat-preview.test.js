/*
 * Tests for the Settings panel's mini plan.
 *
 * Run: npm test    (plain `node --test`, no dependency and no config)
 *
 * previewLayout() draws a SECOND picture of the plan, in a dialog that covers the first one. The
 * cases worth pinning are therefore the ones where the two could quietly disagree: the placement
 * rules it copies from SeatGrid and StageView, the fact that every name comes from labels.js
 * rather than from a second formatter, and that a wide plan loses its middle rather than its ends.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PREVIEW_MAX_COLS, previewLayout, startSeatLabel } from '../src/utils/seatPreview.js';
import { LABEL_OPTIONS, colLabelAt, rowLabelAt, seatLabelFor } from '../src/utils/labels.js';
import { COLS_MAX, ROWS_MAX } from '../src/utils/persistence.js';

// every legal combination of the four labelling settings: 2^4 = 16.
function allLabelCombos() {
  const fields = Object.keys(LABEL_OPTIONS);
  let out = [{}];
  for (const f of fields) out = out.flatMap((base) => LABEL_OPTIONS[f].map((v) => ({ ...base, [f]: v })));
  return out;
}
const COMBOS = allLabelCombos();
const DEFAULTS = { rowLabel: 'letters', rowFirst: 'bottom', colLabel: 'numbers', colOrder: 'ltr' };
const cellsOf = (layout) => layout.grid.flat().filter((c) => !c.gap);

/* ---------- the drawing, under the default settings ---------- */

test('with the audience below, the front row is drawn at the bottom', () => {
  const v = previewLayout(4, 3, DEFAULTS, 'bottom');
  assert.equal(v.audienceTop, false);
  assert.deepEqual(v.rowHeads.map((h) => h.text), ['D', 'C', 'B', 'A']);
  assert.deepEqual(v.colHeads.map((h) => h.text), ['1', '2', '3']);
  // row A, column 1 is the front-left chair, so it is the bottom-left cell of the drawing.
  assert.equal(v.grid[3][0].label, 'A-1');
  assert.equal(v.grid[3][0].start, true);
});

test('with the audience above, the plan is the same drawing rotated 180 degrees', () => {
  const below = previewLayout(4, 3, DEFAULTS, 'bottom');
  const above = previewLayout(4, 3, DEFAULTS, 'top');
  assert.equal(above.audienceTop, true);
  for (let t = 0; t < 4; t++)
    for (let dc = 0; dc < 3; dc++)
      assert.equal(above.grid[t][dc].gi, below.grid[3 - t][2 - dc].gi);
  // The names are nailed to the PICTURE, so every display cell keeps its name and only the
  // chairs move: A-1 stays the bottom-left corner of the drawing under either viewpoint.
  for (let t = 0; t < 4; t++)
    for (let dc = 0; dc < 3; dc++) assert.equal(above.grid[t][dc].label, below.grid[t][dc].label);
  assert.equal(above.grid[3][0].label, 'A-1');
  assert.equal(above.startLabel, below.startLabel);
  // ...and it is a different chair sitting in it.
  assert.notEqual(above.grid[3][0].gi, below.grid[3][0].gi);
});

/* ---------- the two placement rules it copies from the stage ---------- */

test('an unrotated cell sits where SeatGrid would put it', () => {
  const rows = 5, cols = 4;
  const v = previewLayout(rows, cols, DEFAULTS, 'bottom');
  // SeatGrid.vue: slot k is drawn at column floor(k/rows), visual row rows-(k%rows) from the
  // bottom — so display row t from the top holds k = dc*rows + (rows-1-t).
  for (let t = 0; t < rows; t++)
    for (let dc = 0; dc < cols; dc++)
      assert.equal(v.grid[t][dc].gi, dc * rows + (rows - 1 - t));
});

test('a rotated cell is StageView reverse(): gi = N-1-k', () => {
  const rows = 5, cols = 4, n = rows * cols;
  const v = previewLayout(rows, cols, DEFAULTS, 'top');
  for (let t = 0; t < rows; t++)
    for (let dc = 0; dc < cols; dc++)
      assert.equal(v.grid[t][dc].gi, n - 1 - (dc * rows + (rows - 1 - t)));
});

test('every seat index is drawn exactly once, under either viewpoint', () => {
  for (const at of ['bottom', 'top']) {
    const v = previewLayout(6, 5, DEFAULTS, at);
    const seen = cellsOf(v).map((c) => c.gi).sort((a, b) => a - b);
    assert.deepEqual(seen, Array.from({ length: 30 }, (_, i) => i));
  }
});

/* ---------- the names all come from labels.js ---------- */

test('every label matches utils/labels.js for the same seat, in all 16 combinations', () => {
  const rows = 3, cols = 4;
  for (const labels of COMBOS)
    for (const at of ['bottom', 'top']) {
      const v = previewLayout(rows, cols, labels, at);
      for (const cell of cellsOf(v)) assert.equal(cell.label, seatLabelFor(cell.gi, rows, cols, labels, at));
      v.rowHeads.forEach((h) => assert.equal(h.text, rowLabelAt(h.r, rows, labels, at)));
      v.colHeads.forEach((h) => assert.equal(h.text, colLabelAt(h.c, cols, labels, at)));
    }
});

test('exactly one chair counts first, and it is the one the note names', () => {
  const rows = 3, cols = 4;
  for (const labels of COMBOS)
    for (const at of ['bottom', 'top']) {
      const v = previewLayout(rows, cols, labels, at);
      const starts = cellsOf(v).filter((c) => c.start);
      assert.equal(starts.length, 1);
      assert.equal(starts[0].label, v.startLabel);
      assert.equal(v.startLabel, startSeatLabel(rows, cols, labels, at));
      assert.equal(v.rowHeads.filter((h) => h.start).length, 1);
      assert.equal(v.colHeads.filter((h) => h.start).length, 1);
    }
});

test('the first chair is always at a corner, so condensing can never hide it', () => {
  for (const labels of COMBOS)
    for (const at of ['bottom', 'top']) {
      const v = previewLayout(4, COLS_MAX, labels, at);
      const row = v.grid.findIndex((r) => r.some((c) => c.start));
      const col = v.grid[row].findIndex((c) => c.start);
      assert.ok(row === 0 || row === v.rows - 1);
      assert.ok(col === 0 || col === v.grid[row].length - 1);
    }
});

/* ---------- which end of the drawing row 1 lands on ---------- */

test('rowFirst puts row 1 at that end of the picture, under either viewpoint', () => {
  for (const at of ['bottom', 'top']) {
    const top = previewLayout(4, 3, { ...DEFAULTS, rowFirst: 'top' }, at);
    assert.equal(top.rowHeads[0].start, true, 'first heading is the top one');
    assert.equal(top.rowHeads[0].text, 'A');
    const bottom = previewLayout(4, 3, { ...DEFAULTS, rowFirst: 'bottom' }, at);
    assert.equal(bottom.rowHeads[3].start, true, 'first heading is the bottom one');
    assert.equal(bottom.rowHeads[3].text, 'A');
  }
});

/* ---------- wide plans lose their middle, never their ends ---------- */

test('a plan wider than the cap keeps two columns at each end and one gap', () => {
  const v = previewLayout(2, 12, DEFAULTS, 'bottom');
  assert.equal(v.colHeads.length, 5);
  assert.deepEqual(v.colHeads.map((h) => h.gap === true), [false, false, true, false, false]);
  assert.deepEqual(v.colHeads.map((h) => h.text || '…'), ['1', '2', '…', '11', '12']);
  v.grid.forEach((row) => assert.equal(row[2].gap, true));
});

test('the column names follow the picture; the chairs behind them are what swap', () => {
  const below = previewLayout(2, 12, DEFAULTS, 'bottom');
  const above = previewLayout(2, 12, DEFAULTS, 'top');
  const names = (v) => v.colHeads.map((h) => h.text || '…');
  // "left to right" means left to right under either viewpoint — the 2026-09-11 decision.
  assert.deepEqual(names(above), ['1', '2', '…', '11', '12']);
  assert.deepEqual(names(above), names(below));
  // what changed is which stored column the left of the picture is.
  assert.equal(below.colHeads[0].c, 0);
  assert.equal(above.colHeads[0].c, 11);
});

test('a plan at or under the cap is drawn whole', () => {
  const v = previewLayout(2, PREVIEW_MAX_COLS, DEFAULTS, 'bottom');
  assert.equal(v.colHeads.length, PREVIEW_MAX_COLS);
  assert.equal(v.colHeads.some((h) => h.gap), false);
  assert.equal(previewLayout(2, PREVIEW_MAX_COLS + 1, DEFAULTS, 'bottom').colHeads.some((h) => h.gap), true);
});

test('a cap too small for two ends and a gap is raised rather than obeyed', () => {
  const v = previewLayout(2, 20, DEFAULTS, 'bottom', 1);
  assert.equal(v.colHeads.length, 5);
});

/* ---------- junk in, a drawable plan out ---------- */

test('the grid size is clamped exactly as the store clamps it', () => {
  assert.equal(previewLayout(99, 99, DEFAULTS, 'bottom').rows, ROWS_MAX);
  assert.equal(previewLayout(99, 99, DEFAULTS, 'bottom').cols, COLS_MAX);
  assert.equal(previewLayout(0, 0, DEFAULTS, 'bottom').rows, 4); // DEFAULT_ROWS
  assert.equal(previewLayout(0, 0, DEFAULTS, 'bottom').cols, 1);
});

test('a one-chair plan draws, and an unknown viewpoint means the default', () => {
  const v = previewLayout(1, 1, DEFAULTS, 'sideways');
  assert.equal(v.audienceTop, false);
  assert.equal(v.grid.length, 1);
  assert.equal(v.grid[0].length, 1);
  assert.equal(v.grid[0][0].start, true);
  assert.equal(v.grid[0][0].label, seatLabelFor(0, 1, 1, DEFAULTS));
});

test('absent or invalid settings fall back rather than blanking the drawing', () => {
  const v = previewLayout(3, 3, { rowLabel: 'runes' }, 'bottom');
  assert.deepEqual(v.rowHeads.map((h) => h.text), ['C', 'B', 'A']);
  assert.equal(v.grid[2][0].label, 'A-1');
});

test('the settings object handed in is never written to', () => {
  const labels = { rowLabel: 'numbers', rowFirst: 'back', colLabel: 'letters', colOrder: 'rtl' };
  const before = { ...labels };
  previewLayout(4, 12, labels, 'top');
  startSeatLabel(4, 12, labels);
  assert.deepEqual(labels, before);
});
