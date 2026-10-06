/*
 * Tests for the walk-on order and its list.
 *
 * Run: npm test    (plain `node --test`, no dependency and no config)
 *
 * What a test can reach here is the STRUCTURE: that everybody is in exactly one queue, that each
 * queue counts itself 1..n with no gaps, that blocked and empty cells consume no position, and
 * that the labels come from utils/labels.js rather than from a second formatter. What
 * a test CANNOT reach is direction by eye — a reversed list is
 * internally consistent and passes every invariant below. The cases that pin direction are
 * therefore written against a hand-worked expected order rather than against a property, so that
 * a reversal fails a test and not only a reading.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKED,
  EMPTY,
  WALKON_DEFAULTS,
  WALKON_OPTIONS,
  blockedColumns,
  isSinger,
  normaliseWalkOn,
  walkOnOrder,
  walkRowSequence
} from '../src/utils/arranger.js';
import { walkOnBadges, walkOnGroups, walkOnRows, walkOnText } from '../src/utils/walkOnList.js';
import { LABEL_OPTIONS, seatLabelFor } from '../src/utils/labels.js';
import { ROWS_MAX } from '../src/utils/persistence.js';

/* ---------- helpers ---------- */

// a rows*cols column-major grid whose every cell is named for its (row, col), so a name says
// exactly where it came from and a mis-ordered list is readable at a glance.
function grid(rows, cols, fill = (r, c) => `r${r}c${c}`) {
  const a = new Array(rows * cols);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) a[c * rows + r] = fill(r, c);
  return a;
}
const names = (q) => q.map((e) => e.name);
const DEFAULTS = { ...WALKON_DEFAULTS };
const LAB = { rowLabel: 'letters', rowFirst: 'bottom', colLabel: 'numbers', colOrder: 'ltr' };

// every rowFrom x enterFrom combination: 2 x 3 = 6.
const MATRIX = WALKON_OPTIONS.rowFrom.flatMap((rowFrom) =>
  WALKON_OPTIONS.enterFrom.map((enterFrom) => ({ ...DEFAULTS, rowFrom, enterFrom }))
);

/* ---------- the invariants, across the matrix ---------- */

function assertInvariants(seats, rows, cols, walkOn, label) {
  const { queues } = walkOnOrder(seats, rows, cols, walkOn);
  const expected = seats.filter(isSinger).length;
  assert.equal(queues.L.length + queues.R.length, expected, `${label}: every singer walks on exactly once`);

  const seen = new Set([...queues.L, ...queues.R].map((e) => e.seatIndex));
  assert.equal(seen.size, expected, `${label}: no seat is emitted twice`);

  const inL = new Set(names(queues.L));
  for (const n of names(queues.R)) assert.ok(!inL.has(n), `${label}: ${n} is in both queues`);

  for (const key of ['L', 'R']) {
    queues[key].forEach((e, i) => {
      assert.equal(e.position, i + 1, `${label}: queue ${key} position ${i + 1} is contiguous from 1`);
      assert.equal(e.seatIndex, e.col * rows + e.row, `${label}: queue ${key} entry carries its true seat index`);
      assert.ok(isSinger(seats[e.seatIndex]), `${label}: queue ${key} emitted a non-singer`);
    });
  }
}

test('the invariants hold across the rowFrom x enterFrom matrix, at 1 row and at 8', () => {
  for (const rows of [1, ROWS_MAX]) {
    for (const cols of [1, 5, 19, 40]) {
      const seats = grid(rows, cols);
      for (const w of MATRIX) assertInvariants(seats, rows, cols, w, `${rows}x${cols} ${w.rowFrom}/${w.enterFrom}`);
    }
  }
});

test('the invariants hold with blocked cells, empty chairs and a sparse grid', () => {
  const rows = 4, cols = 19;
  const seats = grid(rows, cols, (r, c) => {
    if (c === 7) return BLOCKED; // a whole blocked column
    if ((r + c) % 5 === 0) return EMPTY; // scattered free chairs
    if (r === 2 && c === 11) return BLOCKED; // a lone blocked cell mid-row
    return `r${r}c${c}`;
  });
  for (const w of MATRIX) assertInvariants(seats, rows, cols, w, `sparse ${w.rowFrom}/${w.enterFrom}`);
  for (const w of MATRIX) assertInvariants(new Array(rows * cols).fill(EMPTY), rows, cols, w, 'empty stage');
});

test('the invariants hold with per-row directions and a custom row order', () => {
  const rows = 4, cols = 19;
  const seats = grid(rows, cols);
  const w = { ...DEFAULTS, perRow: ['right', 'both', null, 'left'], rowSeq: [1, 3, 0, 2], splitCol: 8 };
  assertInvariants(seats, rows, cols, w, 'advanced');
  assertInvariants(seats, rows, cols, { ...w, rowFrom: 'front' }, 'advanced front-first');
});

/* ---------- direction: the part a property test cannot see ---------- */

test('a row is walked row-major, never in the array order', () => {
  // 2 rows x 3 cols. The array order is column-major (r0c0, r1c0, r0c1, ...), which is a vertical
  // file and is never how anyone walks onto a stage.
  const seats = grid(2, 3);
  const { queues } = walkOnOrder(seats, 2, 3, { ...DEFAULTS, rowFrom: 'front', enterFrom: 'left' });
  assert.deepEqual(names(queues.L), ['r0c2', 'r0c1', 'r0c0', 'r1c2', 'r1c1', 'r1c0']);
  assert.notDeepEqual(names(queues.L), seats.filter(isSinger));
});

test("'back' walks the back row first, 'front' walks the front row first", () => {
  const seats = grid(3, 2);
  const back = walkOnOrder(seats, 3, 2, { ...DEFAULTS, rowFrom: 'back' });
  const front = walkOnOrder(seats, 3, 2, { ...DEFAULTS, rowFrom: 'front' });
  assert.deepEqual(names(back.queues.L), ['r2c1', 'r2c0', 'r1c1', 'r1c0', 'r0c1', 'r0c0']);
  assert.deepEqual(names(front.queues.L), ['r0c1', 'r0c0', 'r1c1', 'r1c0', 'r2c1', 'r2c0']);
  assert.deepEqual(back.rowOrder.map((x) => x.row), [2, 1, 0]);
  assert.deepEqual(front.rowOrder.map((x) => x.row), [0, 1, 2]);
});

test("entering from the left fills right to left; from the right, left to right", () => {
  // Decided entry-relative: the first person on walks furthest, so nobody squeezes past
  // anyone already standing.
  const seats = grid(1, 4);
  const left = walkOnOrder(seats, 1, 4, { ...DEFAULTS, enterFrom: 'left' });
  const right = walkOnOrder(seats, 1, 4, { ...DEFAULTS, enterFrom: 'right' });
  assert.deepEqual(names(left.queues.L), ['r0c3', 'r0c2', 'r0c1', 'r0c0']);
  assert.equal(left.queues.R.length, 0);
  assert.deepEqual(names(right.queues.R), ['r0c0', 'r0c1', 'r0c2', 'r0c3']);
  assert.equal(right.queues.L.length, 0);
});

test("'both' mirrors the two halves of a row and fills from the aisle outward", () => {
  // The request's named case, and the single most important thing here to get right.
  const seats = grid(1, 6);
  const { queues, split } = walkOnOrder(seats, 1, 6, { ...DEFAULTS, enterFrom: 'both' });
  assert.equal(split, 2, 'a 6-wide stage auto-centres its aisle after column index 2');
  assert.deepEqual(names(queues.L), ['r0c2', 'r0c1', 'r0c0']);
  assert.deepEqual(names(queues.R), ['r0c3', 'r0c4', 'r0c5']);
  // the mirroring, stated as itself: each queue's first singer is against the aisle, and each
  // queue's last is at the END of the row nearest the wing it came from.
  assert.equal(queues.L[0].col, split);
  assert.equal(queues.R[0].col, split + 1);
  assert.equal(queues.L[queues.L.length - 1].col, 0);
  assert.equal(queues.R[queues.R.length - 1].col, 5);
});

test('a user-set aisle moves the split, and is clamped to the grid', () => {
  const seats = grid(1, 6);
  const at1 = walkOnOrder(seats, 1, 6, { ...DEFAULTS, enterFrom: 'both', splitCol: 1 });
  assert.deepEqual(names(at1.queues.L), ['r0c1', 'r0c0']);
  assert.deepEqual(names(at1.queues.R), ['r0c2', 'r0c3', 'r0c4', 'r0c5']);
  // past the right-hand edge: the aisle stops before the last column, so neither queue is empty.
  const over = walkOnOrder(seats, 1, 6, { ...DEFAULTS, enterFrom: 'both', splitCol: 99 });
  assert.equal(over.split, 4);
  assert.equal(over.queues.L.length, 5);
  assert.equal(over.queues.R.length, 1);
});

test('numbering restarts at 1 in each queue', () => {
  const { queues } = walkOnOrder(grid(2, 4), 2, 4, { ...DEFAULTS, enterFrom: 'both', splitCol: 1 });
  assert.deepEqual(queues.L.map((e) => e.position), [1, 2, 3, 4]);
  assert.deepEqual(queues.R.map((e) => e.position), [1, 2, 3, 4]);
});

test("the auto-centred aisle halves an even width and gives an odd width's extra column to the left", () => {
  const even = walkOnOrder(grid(1, 6), 1, 6, { ...DEFAULTS, enterFrom: 'both' });
  assert.equal(even.split, 2);
  assert.deepEqual([even.queues.L.length, even.queues.R.length], [3, 3]);
  const four = walkOnOrder(grid(1, 4), 1, 4, { ...DEFAULTS, enterFrom: 'both' });
  assert.deepEqual([four.queues.L.length, four.queues.R.length], [2, 2]);
  const odd = walkOnOrder(grid(1, 19), 1, 19, { ...DEFAULTS, enterFrom: 'both' });
  assert.equal(odd.split, 9);
  assert.deepEqual([odd.queues.L.length, odd.queues.R.length], [10, 9]);
});

/* ---------- gaps ---------- */

test('blocked cells and empty chairs consume no position', () => {
  const seats = grid(1, 5, (r, c) => (c === 1 ? BLOCKED : c === 3 ? EMPTY : `r${r}c${c}`));
  const { queues } = walkOnOrder(seats, 1, 5, { ...DEFAULTS, enterFrom: 'left' });
  assert.deepEqual(names(queues.L), ['r0c4', 'r0c2', 'r0c0']);
  assert.deepEqual(queues.L.map((e) => e.position), [1, 2, 3]);
  assert.deepEqual(queues.L.map((e) => e.col), [4, 2, 0]);
});

test('a fully blocked row emits nothing and shifts nobody else', () => {
  const seats = grid(2, 3, (r, c) => (r === 1 ? BLOCKED : `r${r}c${c}`));
  const { queues } = walkOnOrder(seats, 2, 3, { ...DEFAULTS, rowFrom: 'back' });
  assert.deepEqual(names(queues.L), ['r0c2', 'r0c1', 'r0c0']);
  assert.deepEqual(queues.L.map((e) => e.position), [1, 2, 3]);
});

/* ---------- per-row directions ---------- */

test('perRow is indexed front-first and overrides enterFrom for that row only', () => {
  const seats = grid(3, 3);
  // index 0 is the FRONT row, whatever order the rows are walked in.
  const w = { ...DEFAULTS, rowFrom: 'back', enterFrom: 'left', perRow: ['right', null, null] };
  const { queues, rowOrder } = walkOnOrder(seats, 3, 3, w);
  assert.deepEqual(rowOrder, [{ row: 2, mode: 'left' }, { row: 1, mode: 'left' }, { row: 0, mode: 'right' }]);
  assert.deepEqual(names(queues.L), ['r2c2', 'r2c1', 'r2c0', 'r1c2', 'r1c1', 'r1c0']);
  assert.deepEqual(names(queues.R), ['r0c0', 'r0c1', 'r0c2']);
});

test('a row’s own direction always applies: there is no switch that hides it', () => {
  const seats = grid(2, 2);
  const w = { ...DEFAULTS, enterFrom: 'left', perRow: ['right', 'right'] };
  const { queues } = walkOnOrder(seats, 2, 2, w);
  assert.equal(queues.L.length, 0);
  assert.equal(queues.R.length, 4);
});

/* ---------- the row order ---------- */

test('with no custom order, the rows walk back to front or front to back', () => {
  assert.deepEqual(walkRowSequence({ ...DEFAULTS, rowFrom: 'back' }, 4), [3, 2, 1, 0]);
  assert.deepEqual(walkRowSequence({ ...DEFAULTS, rowFrom: 'front' }, 4), [0, 1, 2, 3]);
});

test('a custom order walks the rows in that order: e.g. the second, third and fourth, then the first', () => {
  const seats = grid(4, 2);
  const w = { ...DEFAULTS, rowSeq: [1, 2, 3, 0] };
  const { rowOrder, queues } = walkOnOrder(seats, 4, 2, w);
  assert.deepEqual(rowOrder.map((x) => x.row), [1, 2, 3, 0]);
  assert.deepEqual(names(queues.L).slice(0, 2), ['r1c1', 'r1c0']);
  assert.deepEqual(names(queues.L).slice(-2), ['r0c1', 'r0c0']);
});

test('a custom order written for a deeper stage keeps the rows that still exist', () => {
  assert.deepEqual(walkRowSequence({ ...DEFAULTS, rowFrom: 'back', rowSeq: [4, 0, 2] }, 3), [0, 2, 1]);
});

test('a row order that is not distinct row indexes is dropped', () => {
  for (const bad of [[0, 0, 1], [0, -1], [0, 1.5], [], 'no', [0, 99]]) assert.equal(normaliseWalkOn({ rowSeq: bad }).rowSeq, null);
  assert.deepEqual(normaliseWalkOn({ rowSeq: [2, 0, 1] }).rowSeq, [2, 0, 1]);
});

test('perRow entries past the current row count are retained and ignored', () => {
  // the retention rule: shrinking the grid must not destroy per-row work, because
  // growing it back has to restore it.
  const w = normaliseWalkOn({ ...DEFAULTS, perRow: ['right', 'both', 'left', 'right'] });
  assert.equal(w.perRow.length, 4);
  const { queues } = walkOnOrder(grid(2, 2), 2, 2, w);
  assert.equal(queues.L.length + queues.R.length, 4);
});

test('per-row directions alone can produce two queues with no row set to both', () => {
  // Queue assignment is per singer, not per plan, which is what makes this fall out rather
  // than need a special case.
  const seats = grid(2, 2);
  const w = { ...DEFAULTS, perRow: ['right', 'left'] };
  const { queues } = walkOnOrder(seats, 2, 2, w);
  assert.equal(queues.L.length, 2);
  assert.equal(queues.R.length, 2);
  assert.ok(!w.perRow.includes('both'));
});

/* ---------- normalisation ---------- */

test('a malformed walk-on block falls back field by field', () => {
  assert.deepEqual(normaliseWalkOn(undefined), { ...WALKON_DEFAULTS, perRow: [] });
  assert.deepEqual(normaliseWalkOn({ rowFrom: 'sideways', enterFrom: 'middle', splitCol: 'x', perRow: 'no' }), {
    ...WALKON_DEFAULTS,
    perRow: []
  });
  // one bad element does not cost the others
  assert.deepEqual(normaliseWalkOn({ perRow: ['left', 'up', 'both'] }).perRow, ['left', null, 'both']);
  // trailing nulls carry nothing and are dropped, so the saved block cannot grow forever
  assert.deepEqual(normaliseWalkOn({ perRow: ['left', null, null] }).perRow, ['left']);
  // and it can never be longer than the deepest stage the app allows
  assert.equal(normaliseWalkOn({ perRow: new Array(40).fill('both') }).perRow.length, ROWS_MAX);
  assert.equal(normaliseWalkOn({ splitCol: -3 }).splitCol, null);
  assert.equal(normaliseWalkOn({ splitCol: 4.7 }).splitCol, 4);
});

test('the generator never writes to the block it is handed', () => {
  const w = { ...DEFAULTS, perRow: ['left'] };
  const before = JSON.stringify(w);
  walkOnOrder(grid(2, 2), 2, 2, w);
  assert.equal(JSON.stringify(w), before);
});

test('a degenerate grid returns two empty queues rather than throwing', () => {
  for (const args of [[null, 4, 4], [[], 0, 4], [[], 4, 0], [grid(2, 2), NaN, 2]]) {
    const { queues } = walkOnOrder(args[0], args[1], args[2], DEFAULTS);
    assert.deepEqual([queues.L.length, queues.R.length], [0, 0]);
  }
});

/* ---------- the aisle suggestion (5.2) ---------- */

test('blockedColumns finds only columns blocked front to back', () => {
  const rows = 4, cols = 6;
  const seats = grid(rows, cols, (r, c) => {
    if (c === 2) return BLOCKED; // a real column
    if (c === 4 && r < 3) return BLOCKED; // three of four: not a column
    if (c === 5) return EMPTY; // a short row's gap is not a block
    return `r${r}c${c}`;
  });
  assert.deepEqual(blockedColumns(seats, rows, cols), [2]);
  assert.deepEqual(blockedColumns(grid(rows, cols), rows, cols), [], 'a full stage suggests nothing');
  assert.deepEqual(blockedColumns(null, rows, cols), []);
});

/* ---------- the list (3.7) ---------- */

test('the list groups by row in walk order and heads each group from seatLabel', () => {
  const rows = 4, cols = 3;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, rowFrom: 'back', enterFrom: 'left' });
  const view = walkOnGroups(order, rows, cols, LAB, 'bottom');
  assert.equal(view.single, true);
  assert.equal(view.total, 12);
  assert.equal(view.queues.length, 1);
  const q = view.queues[0];
  assert.deepEqual(q.groups.map((g) => g.row), [3, 2, 1, 0]);
  // the default labelling letters the rows from the front, so the back row of a 4-row plan is D
  assert.deepEqual(q.groups.map((g) => g.heading), ['Row D', 'Row C', 'Row B', 'Row A']);
  assert.deepEqual(q.groups.map((g) => g.where), ['Back row', '', '', 'Front row']);
  assert.deepEqual(q.groups[0].entries.map((e) => e.seat), ['D-3', 'D-2', 'D-1']);
  assert.deepEqual(q.groups[0].entries.map((e) => e.position), [1, 2, 3]);
});

test('every seat name in the list comes from utils/labels.js, under all sixteen settings', () => {
  const rows = 4, cols = 5;
  const seats = grid(rows, cols);
  const order = walkOnOrder(seats, rows, cols, { ...DEFAULTS, enterFrom: 'both' });
  const fields = Object.keys(LABEL_OPTIONS);
  let combos = [{}];
  for (const f of fields) combos = combos.flatMap((b) => LABEL_OPTIONS[f].map((v) => ({ ...b, [f]: v })));
  assert.equal(combos.length, 16);
  for (const labels of combos) {
    for (const at of ['bottom', 'top']) {
      const view = walkOnGroups(order, rows, cols, labels, at);
      for (const q of view.queues) {
        for (const g of q.groups) {
          for (const e of g.entries) {
            const i = order.queues[q.key].find((x) => x.position === e.position && x.name === e.name).seatIndex;
            assert.equal(e.seat, seatLabelFor(i, rows, cols, labels, at));
          }
        }
      }
    }
  }
});

test('labelling and the viewpoint are cosmetic: neither reorders anybody', () => {
  const rows = 4, cols = 5;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, enterFrom: 'both' });
  const baseline = walkOnGroups(order, rows, cols, LAB, 'bottom');
  const flipped = walkOnGroups(order, rows, cols, { rowLabel: 'numbers', rowFirst: 'top', colLabel: 'letters', colOrder: 'rtl' }, 'top');
  const seq = (v) => v.queues.map((q) => q.groups.flatMap((g) => g.entries.map((e) => `${q.key}${e.position}:${e.name}`)));
  assert.deepEqual(seq(flipped), seq(baseline));
  // what DOES change is what the chairs are called
  assert.notDeepEqual(
    flipped.queues[0].groups[0].entries.map((e) => e.seat),
    baseline.queues[0].groups[0].entries.map((e) => e.seat)
  );
});

test('two queues each keep their own heading and count', () => {
  const rows = 2, cols = 4;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, enterFrom: 'both', splitCol: 1 });
  const view = walkOnGroups(order, rows, cols, LAB, 'bottom');
  assert.equal(view.single, false);
  assert.deepEqual(view.queues.map((q) => q.key), ['L', 'R']);
  assert.deepEqual(view.queues.map((q) => q.count), [4, 4]);
  assert.deepEqual(view.queues.map((q) => q.heading), ['Left queue', 'Right queue']);
  assert.deepEqual(view.queues.map((q) => q.enter), ['enter from the left', 'enter from the right']);
});

test('a one-row plan names neither end of itself', () => {
  const order = walkOnOrder(grid(1, 3), 1, 3, DEFAULTS);
  const view = walkOnGroups(order, 1, 3, LAB, 'bottom');
  assert.deepEqual(view.queues[0].groups.map((g) => g.where), ['']);
  assert.deepEqual(view.queues[0].groups.map((g) => g.heading), ['Row A']);
});

/* ---------- the clipboard text ---------- */

test('the copy text is plain, tab-separated and drops the queue heading when there is one queue', () => {
  const rows = 2, cols = 2;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, enterFrom: 'left' });
  const text = walkOnText(walkOnGroups(order, rows, cols, LAB, 'bottom'), [], 'Schnittke');
  assert.equal(
    text,
    ['Schnittke', '', 'Enter from the left (left and right as the audience sees the stage).', '', 'Back row (Row B)', '1\tr1c1\t\tB-2', '2\tr1c0\t\tB-1', '', 'Front row (Row A)', '3\tr0c1\t\tA-2', '4\tr0c0\t\tA-1'].join('\n') + '\n'
  );
  assert.ok(!/QUEUE/.test(text), 'one queue names no queue');
  assert.ok(!/[|+─-╿]/.test(text), 'no box-drawing, so it survives a paste into Word');
});

test('two queues are headed and counted, and the bench is named at the end', () => {
  const rows = 1, cols = 4;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, enterFrom: 'both', splitCol: 1 });
  const text = walkOnText(walkOnGroups(order, rows, cols, LAB, 'bottom'), ['Dev Patel', 'Erin Shaw']);
  assert.match(text, /^LEFT QUEUE \(enter from the left, 2 singers\)$/m);
  assert.match(text, /^RIGHT QUEUE \(enter from the right, 2 singers\)$/m);
  assert.match(text, /^NOT ON STAGE \(2\)\nDev Patel\nErin Shaw\n$/m);
  assert.ok(text.endsWith('Erin Shaw\n'), 'exactly one trailing newline');
});

test('a queue of one is a singer, not singers', () => {
  const order = walkOnOrder(grid(1, 2), 1, 2, { ...DEFAULTS, enterFrom: 'both', splitCol: 0 });
  const text = walkOnText(walkOnGroups(order, 1, 2, LAB, 'bottom'), []);
  assert.match(text, /LEFT QUEUE \(enter from the left, 1 singer\)/);
});

/* ---------- the seat badge ---------- */

test('a badge on every seated chair, keyed by seat index, and on nothing else', () => {
  const seats = grid(4, 5);
  seats[0] = EMPTY;
  seats[7] = BLOCKED;
  const order = walkOnOrder(seats, 4, 5, DEFAULTS);
  const { bySeat } = walkOnBadges(order);

  const keys = Object.keys(bySeat).map(Number).sort((a, b) => a - b);
  assert.deepEqual(keys, seats.map((n, i) => (isSinger(n) ? i : -1)).filter((i) => i >= 0));
  assert.ok(!(0 in bySeat), 'an empty chair has no place in the queue');
  assert.ok(!(7 in bySeat), 'and neither has a blocked one');
});

test('the badge agrees with the list, entry for entry', () => {
  for (const walkOn of MATRIX) {
    const seats = grid(4, 5);
    const order = walkOnOrder(seats, 4, 5, walkOn);
    const { single, bySeat } = walkOnBadges(order);
    const list = walkOnGroups(order, 4, 5, LAB, 'bottom');
    assert.equal(single, list.single, `${walkOn.rowFrom}/${walkOn.enterFrom}: they must agree about the split`);

    for (const q of ['L', 'R']) {
      for (const e of order.queues[q]) {
        const expected = (single ? '' : q) + e.position;
        assert.equal(bySeat[e.seatIndex], expected, `${walkOn.rowFrom}/${walkOn.enterFrom}: seat ${e.seatIndex}`);
      }
    }
  }
});

test('one queue means a bare number; two queues means a prefix', () => {
  const seats = grid(2, 4);
  const one = walkOnBadges(walkOnOrder(seats, 2, 4, { ...DEFAULTS, enterFrom: 'left' }));
  assert.equal(one.single, true);
  assert.deepEqual(Object.values(one.bySeat).sort(), ['1', '2', '3', '4', '5', '6', '7', '8'].sort());

  const two = walkOnBadges(walkOnOrder(seats, 2, 4, { ...DEFAULTS, enterFrom: 'both' }));
  assert.equal(two.single, false);
  assert.ok(Object.values(two.bySeat).every((v) => /^[LR]\d+$/.test(v)));
  assert.ok(Object.values(two.bySeat).some((v) => v.startsWith('L')));
  assert.ok(Object.values(two.bySeat).some((v) => v.startsWith('R')));
});

test('a badge fits four characters at the singer cap', () => {
  // 250 singers over 5 rows is the widest the app allows. With one queue the longest badge is
  // `250`; with two it is `L125` — four characters, which is what the corner survey budgeted.
  const seats = grid(5, 50);
  for (const enterFrom of ['left', 'both']) {
    const { bySeat } = walkOnBadges(walkOnOrder(seats, 5, 50, { ...DEFAULTS, enterFrom }));
    const longest = Object.values(bySeat).reduce((m, v) => Math.max(m, v.length), 0);
    assert.ok(longest <= 4, `${enterFrom}: longest badge is ${longest} characters`);
  }
});

test('the badge belongs to the CHAIR, not to the person in it', () => {
  // Two seatings of the same people in different chairs: the badge on a given seat index is the
  // same either way, because it says when that seat is filled.
  const a = grid(2, 3, (r, c) => `p${r}${c}`);
  const b = a.slice();
  [b[0], b[5]] = [b[5], b[0]];
  const A = walkOnBadges(walkOnOrder(a, 2, 3, DEFAULTS)).bySeat;
  const B = walkOnBadges(walkOnOrder(b, 2, 3, DEFAULTS)).bySeat;
  assert.deepEqual(A, B);
});

test('junk in, an empty badge map out', () => {
  for (const bad of [undefined, null, {}, { queues: null }, { queues: { L: 'nope' } }]) {
    const out = walkOnBadges(bad);
    assert.deepEqual(out.bySeat, {});
    assert.equal(out.single, true);
  }
});

/* ---------- the CSV download ---------- */

test('the CSV is a flat table in walk order, with no Queue column for one queue', () => {
  const rows = 2, cols = 2;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, enterFrom: 'left' });
  assert.deepEqual(walkOnRows(walkOnGroups(order, rows, cols, LAB, 'bottom'), [], 'Schnittke'), [
    ['Schnittke'],
    ['Enter from the left (left and right as the audience sees the stage).'],
    [],
    ['Order', 'Name', 'Seat', 'Row'],
    ['1', 'r1c1', 'B-2', 'Row B (back row)'],
    ['2', 'r1c0', 'B-1', 'Row B (back row)'],
    ['3', 'r0c1', 'A-2', 'Row A (front row)'],
    ['4', 'r0c0', 'A-1', 'Row A (front row)']
  ]);
});

test('two queues add a Queue column, and the bench is a block at the end', () => {
  const rows = 1, cols = 4;
  const order = walkOnOrder(grid(rows, cols), rows, cols, { ...DEFAULTS, enterFrom: 'both', splitCol: 1 });
  const out = walkOnRows(walkOnGroups(order, rows, cols, LAB, 'bottom'), ['Dev Patel']);
  const head = out.findIndex((r) => r[1] === 'Order');
  assert.deepEqual(out[head], ['Queue', 'Order', 'Name', 'Seat', 'Row']);
  assert.deepEqual(out.slice(head + 1, head + 5).map((r) => r[0]), ['Left queue', 'Left queue', 'Right queue', 'Right queue']);
  assert.deepEqual(out.slice(-3), [[], ['Not seated'], ['Dev Patel']]);
});
