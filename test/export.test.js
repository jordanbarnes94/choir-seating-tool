/*
 * Tests for the seating CSV and the export filenames.
 *
 * Run: npm test    (plain `node --test`, no dependency and no config)
 *
 * The download itself needs a Blob and an anchor, so it stays in useChoirArranger.js and no
 * test can reach it. Everything a test CAN reach is here: the decomposition of the
 * column-major `seats` rectangle into a grid that looks like the stage, the three things a
 * cell may be, the bench block, the caption, and what the file is called.
 *
 * The cases worth pinning are the ones a second implementation would get wrong, and the ones
 * where this file could quietly stop agreeing with something else:
 *
 *  - a heading is never formatted here, so every one of them must equal seatLabelFor()'s own
 *    halves for the same chair, under all sixteen labelling combinations and both viewpoints;
 *  - the grid must be laid out the way SeatGrid and StageView draw it, which is re-derived
 *    below from their placement rule rather than from exportCsv.js's;
 *  - neither internal sentinel may appear in the output, ever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKED_CELL,
  NOT_SEATED,
  concertSeatingRows,
  exportFilename,
  isoDate,
  seatingRows,
  seatingTitle,
  slugify
} from '../src/utils/exportCsv.js';
import { BLOCKED, EMPTY } from '../src/utils/arranger.js';
import { LABEL_OPTIONS, LABEL_SEP, seatLabelFor } from '../src/utils/labels.js';
import { csvText } from '../src/utils/spreadsheet.js';

// every legal combination of the four labelling settings: 2^4 = 16.
function allLabelCombos() {
  const fields = Object.keys(LABEL_OPTIONS);
  let out = [{}];
  for (const f of fields) out = out.flatMap((base) => LABEL_OPTIONS[f].map((v) => ({ ...base, [f]: v })));
  return out;
}
const COMBOS = allLabelCombos();
const DEFAULTS = { rowLabel: 'letters', rowFirst: 'bottom', colLabel: 'numbers', colOrder: 'ltr' };

// A grid with one distinguishable singer per chair, so a cell can be traced back to its seat
// index without trusting the module's own arithmetic.
const numbered = (rows, cols) => Array.from({ length: rows * cols }, (_, i) => `S${i}`);

// Where SeatGrid and StageView actually draw seat `i`, re-derived from their own rules rather
// than from exportCsv.js: the display array is `seats` reversed when the audience is at the
// top (StageView), and display index k sits at gridRow `rows - (k % rows)` and grid column
// `floor(k / rows) + 1` (SeatGrid.posStyle). Returns [p, q], 0-based from the TOP LEFT of the
// picture, which is the corner the exported grid starts at.
function drawnAt(i, rows, cols, audienceAt) {
  const k = audienceAt === 'top' ? rows * cols - 1 - i : i;
  return [rows - 1 - (k % rows), Math.floor(k / rows)];
}

// the grid part of the output: everything between the caption/heading row and the bench.
const gridOf = (out, hasTitle) => out.slice(hasTitle ? 1 : 0);

/* ---------- the shape of the file ---------- */

test('the grid is one file row per stage row and one column per stage column, plus headings', () => {
  const out = seatingRows({ seats: numbered(4, 6), rows: 4, cols: 6, labels: DEFAULTS });
  assert.equal(out.length, 5); // one heading row, four stage rows, nobody on the bench
  for (const row of out) assert.equal(row.length, 7); // one heading column, six stage columns
  assert.equal(out[0][0], ''); // the corner where the two heading axes meet is blank
});

test('a caption line sits above the grid, and only when there is one', () => {
  const opts = { seats: numbered(2, 2), rows: 2, cols: 2, labels: DEFAULTS };
  assert.deepEqual(seatingRows({ ...opts, title: 'Schnittke — seating' })[0], ['Schnittke — seating']);
  assert.equal(seatingRows(opts)[0][0], ''); // no caption: the heading row is first
});

test('a grid with no rows or columns still produces a file rather than throwing', () => {
  for (const [rows, cols] of [[0, 4], [4, 0], [0, 0]]) {
    assert.deepEqual(seatingRows({ seats: [], rows, cols, labels: DEFAULTS, title: 'T' }), [['T']]);
  }
  assert.deepEqual(seatingRows(), []);
});

/* ---------- the grid is the picture ---------- */

test('every chair lands where SeatGrid and StageView draw it, under both viewpoints', () => {
  const rows = 4, cols = 5, seats = numbered(rows, cols);
  for (const audienceAt of ['bottom', 'top']) {
    const grid = gridOf(seatingRows({ seats, rows, cols, labels: DEFAULTS, audienceAt }), false);
    for (let i = 0; i < rows * cols; i++) {
      const [p, q] = drawnAt(i, rows, cols, audienceAt);
      assert.equal(grid[p + 1][q + 1], `S${i}`, `seat ${i} at ${audienceAt}`);
    }
  }
});

test('moving the audience rotates the names 180 degrees and leaves the headings alone', () => {
  // The two files are NOT byte-identical, and cannot be: since 2026-09-11 the labelling measures
  // both label axes on the DRAWING, so the label grid is nailed to the picture and the
  // singers slide around underneath it. The older "byte-identical" requirement
  // predates that reversal; what survives of it is this — flipping the viewpoint may not
  // touch a single heading, so the file cannot come out silently upside down.
  const rows = 4, cols = 5, seats = numbered(rows, cols);
  for (const labels of COMBOS) {
    const a = gridOf(seatingRows({ seats, rows, cols, labels, audienceAt: 'bottom' }), false);
    const b = gridOf(seatingRows({ seats, rows, cols, labels, audienceAt: 'top' }), false);
    assert.deepEqual(b[0], a[0], 'column headings');
    assert.deepEqual(b.map((r) => r[0]), a.map((r) => r[0]), 'row headings');
    for (let p = 0; p < rows; p++) {
      for (let q = 0; q < cols; q++) {
        assert.equal(b[p + 1][q + 1], a[rows - p][cols - q], `cell ${p},${q}`);
      }
    }
  }
});

/* ---------- the headings come from utils/labels.js, never from this module ---------- */

test('row heading + separator + column heading is exactly seatLabelFor() for that chair', () => {
  const rows = 3, cols = 4, seats = numbered(rows, cols);
  for (const labels of COMBOS) {
    for (const audienceAt of ['bottom', 'top']) {
      const grid = gridOf(seatingRows({ seats, rows, cols, labels, audienceAt }), false);
      for (let i = 0; i < rows * cols; i++) {
        // find the chair by its occupant, so the lookup does not reuse the module's arithmetic
        let found = null;
        grid.forEach((row, p) => row.forEach((cell, q) => { if (cell === `S${i}`) found = [p, q]; }));
        assert.ok(found, `seat ${i} is in the file`);
        const [p, q] = found;
        assert.equal(
          grid[p][0] + LABEL_SEP + grid[0][q],
          seatLabelFor(i, rows, cols, labels, audienceAt),
          `seat ${i}, ${JSON.stringify(labels)}, audience ${audienceAt}`
        );
      }
    }
  }
});

test('a 40-column grid labels past Z the same way utils/labels.js does', () => {
  const rows = 1, cols = 40;
  const labels = { ...DEFAULTS, colLabel: 'letters' };
  const head = seatingRows({ seats: numbered(rows, cols), rows, cols, labels })[0];
  assert.equal(head[1], 'A');
  assert.equal(head[26], 'Z');
  assert.equal(head[27], 'AA');
  assert.equal(head[40], 'AN');
});

/* ---------- what a cell may contain ---------- */

test('empty is blank, blocked reads [blocked], and no sentinel reaches the file', () => {
  const seats = ['Ann Poole', EMPTY, BLOCKED, 'Ben Shaw'];
  const out = seatingRows({ seats, rows: 2, cols: 2, labels: DEFAULTS, title: 'T', waiting: ['Cara Fitt'] });
  const flat = out.flat();
  assert.ok(flat.includes(BLOCKED_CELL));
  assert.equal(BLOCKED_CELL, '[blocked]');
  assert.equal(flat.filter((c) => c === '').length, 2); // the corner, and the one empty chair
  for (const cell of flat) {
    assert.ok(!cell.includes('__EMPTY__'), `no EMPTY sentinel in ${cell}`);
    assert.ok(!cell.includes('__BLOCKED__'), `no BLOCKED sentinel in ${cell}`);
  }
  assert.ok(!csvText(out).includes('__'));
});

test('a cell carries the name alone — no section, no split, no seat label', () => {
  const out = seatingRows({ seats: ['Ann Poole'], rows: 1, cols: 1, labels: DEFAULTS });
  assert.deepEqual(out[1], ['A', 'Ann Poole']);
});

test('anything that is neither a singer nor blocked fails safe as an empty chair', () => {
  const seats = [null, undefined, '', '__SOMETHING__'];
  const grid = seatingRows({ seats, rows: 2, cols: 2, labels: DEFAULTS });
  assert.deepEqual(grid[1].slice(1).concat(grid[2].slice(1)).filter((c) => c !== ''), ['__SOMETHING__']);
  // an unknown `__X__` string is a name as far as isSinger is concerned, so it is written as
  // one; the two real sentinels are the ones the guard above pins.
});

/* ---------- the bench ---------- */

test('the waiting area is a labelled block after one blank row', () => {
  const out = seatingRows({
    seats: ['Ann Poole'], rows: 1, cols: 1, labels: DEFAULTS, waiting: ['Ben Shaw', 'Cara Fitt']
  });
  assert.deepEqual(out.slice(2), [[], [NOT_SEATED], ['Ben Shaw'], ['Cara Fitt']]);
  assert.equal(NOT_SEATED, 'Not seated');
  // the blank row really is blank in the text, not a lone comma
  const lines = csvText(out).split('\r\n');
  assert.equal(lines[2], '');
});

test('nobody on the bench means no block at all, not an empty heading', () => {
  for (const waiting of [[], undefined, null, 'nonsense']) {
    const out = seatingRows({ seats: ['Ann Poole'], rows: 1, cols: 1, labels: DEFAULTS, waiting });
    assert.equal(out.length, 2, JSON.stringify(waiting));
  }
});

/* ---------- the caption ---------- */

test('the caption names the plan, the viewpoint and the split being coloured by', () => {
  assert.equal(
    seatingTitle({ planName: 'Schnittke', audienceAt: 'bottom', colourBy: '2-way' }),
    'Schnittke — seating, as seen from the audience, coloured by 2-way'
  );
  assert.equal(
    seatingTitle({ planName: 'Schnittke', audienceAt: 'top', colourBy: 'section' }),
    'Schnittke — seating, as seen from the stage, coloured by section'
  );
});

test('an unnamed plan and an absent split still produce a sensible caption', () => {
  assert.equal(seatingTitle(), 'Choir — seating, as seen from the audience');
  assert.equal(seatingTitle({ planName: '   ' }), 'Choir — seating, as seen from the audience');
});

/* ---------- escaping ---------- */

test('a name that would break or hijack a spreadsheet is written safely', () => {
  const seats = ['Poole, Ann', 'Ben "Benny" Shaw', '=SUM(A1)', '-Bob'];
  const text = csvText(seatingRows({ seats, rows: 2, cols: 2, labels: DEFAULTS }));
  assert.ok(text.includes('"Poole, Ann"'));
  assert.ok(text.includes('"Ben ""Benny"" Shaw"'));
  assert.ok(text.includes("'=SUM(A1)"));
  assert.ok(text.includes("'-Bob"));
});

/* ---------- what the file is called ---------- */

test('an exported file is named for the plan and the day', () => {
  const day = new Date(2026, 8, 19); // 19 September 2026, local
  assert.equal(exportFilename('Schnittke', 'seating', 'csv', day), 'schnittke-seating-2026-09-19.csv');
  assert.equal(exportFilename('Schnittke', 'roster', 'csv', day), 'schnittke-roster-2026-09-19.csv');
  assert.equal(exportFilename('Schnittke', 'backup', 'json', day), 'schnittke-backup-2026-09-19.json');
});

test('an unnamed plan falls back to `choir` rather than to a filename starting with a dash', () => {
  const day = new Date(2026, 8, 19);
  for (const name of ['', null, undefined, '   ', '!!!']) {
    assert.equal(exportFilename(name, 'seating', 'csv', day), 'choir-seating-2026-09-19.csv');
  }
});

test('slugify flattens a name the same way for a filename and for a preset lookup', () => {
  assert.equal(slugify("St Mary's Singers"), 'st-marys-singers');
  assert.equal(slugify('  Schnittke — Requiem  '), 'schnittke-requiem');
  assert.equal(slugify('Ännchen'), 'annchen'); // accents folded to ASCII: the slug is not the display name
  assert.equal(slugify('Così fan tutte'), 'cosi-fan-tutte');
});

test('the date is the local day, zero-padded, and anything unusable means today', () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(isoDate(new Date(2026, 11, 31)), '2026-12-31');
  for (const bad of [undefined, null, 'yesterday', new Date('nope')]) {
    assert.match(isoDate(bad), /^\d{4}-\d{2}-\d{2}$/);
  }
});

/* ---------- the whole concert, in one file ---------- */
/*
 * The property that matters: a plan's block here must be exactly what the single-plan export
 * writes for the same plan. Two code paths that ALMOST agree is how a user ends up comparing a
 * first half exported one way against a second half exported another, so it is asserted against
 * `seatingRows()` itself rather than against a transcript of what it currently emits.
 */
const PLAN_A = { name: 'First half', seats: ['a', EMPTY, BLOCKED, 'b'], rows: 2, cols: 2, labels: DEFAULTS, audienceAt: 'bottom', waiting: ['c'], colourBy: 'section' };
const PLAN_B = { name: 'Second half', seats: ['b', 'a', EMPTY, EMPTY], rows: 2, cols: 2, labels: DEFAULTS, audienceAt: 'top', waiting: [], colourBy: '2-way' };

test("each plan's block is exactly its own single-plan export", () => {
  const out = concertSeatingRows({ concertName: 'Winter Tour', plans: [PLAN_A, PLAN_B] });
  for (const p of [PLAN_A, PLAN_B]) {
    const own = seatingRows({ ...p, title: '' });
    const at = out.findIndex((r) => r.length === 1 && r[0] === seatingTitle({ planName: p.name, audienceAt: p.audienceAt, colourBy: p.colourBy }));
    assert.ok(at > 0, `${p.name}: no heading in the file`);
    assert.deepEqual(out.slice(at + 1, at + 1 + own.length), own);
  }
});

test('the file heads with the concert and counts its plans', () => {
  assert.deepEqual(concertSeatingRows({ concertName: 'Winter Tour', plans: [PLAN_A, PLAN_B] })[0], ['Winter Tour — 2 seating plans']);
  assert.deepEqual(concertSeatingRows({ concertName: 'Winter Tour', plans: [PLAN_A] })[0], ['Winter Tour — 1 seating plan']);
  assert.deepEqual(concertSeatingRows({ plans: [] })[0], ['Choir — 0 seating plans']);
});

test('blocks are separated by a blank row, so a spreadsheet keeps them apart', () => {
  const out = concertSeatingRows({ concertName: 'Winter Tour', plans: [PLAN_A, PLAN_B] });
  const headings = out.map((r, i) => [r, i]).filter(([r]) => r.length === 1 && /— seating,/.test(r[0])).map(([, i]) => i);
  assert.equal(headings.length, 2);
  for (const i of headings) assert.deepEqual(out[i - 1], [], 'a blank row precedes every block');
});

test("a plan keeps its OWN viewpoint, so the file does not rewrite one plan into the other's scheme", () => {
  const out = csvText(concertSeatingRows({ concertName: 'Winter Tour', plans: [PLAN_A, PLAN_B] }));
  assert.ok(out.includes('as seen from the audience'), "A's viewpoint");
  assert.ok(out.includes('as seen from the stage'), "B's viewpoint");
});

test('neither sentinel reaches the concert file', () => {
  const out = csvText(concertSeatingRows({ concertName: 'W', plans: [PLAN_A, PLAN_B] }));
  assert.ok(!out.includes(EMPTY));
  assert.ok(!out.includes(BLOCKED));
  assert.ok(out.includes(BLOCKED_CELL));
  assert.ok(out.includes(NOT_SEATED), "A's bench still has its block");
});

test('junk in, a file out', () => {
  for (const bad of [undefined, null, { plans: 'nope' }, { plans: [null] }]) {
    const out = concertSeatingRows(bad);
    assert.ok(Array.isArray(out) && out.length >= 1);
    assert.doesNotThrow(() => csvText(out));
  }
});
