// The solver: the snake it seeds with, and what Auto-arrange must hold on the shipped example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEngine, rosterById, snakeOrder, rowOf, colOf, idxOf,
  EXAMPLE_ROSTER, EXAMPLE_SPLITS, EXAMPLE_ROWS, EXAMPLE_COLS, BLOCKED, EMPTY, isSinger
} from '../src/utils/arranger.js';

const SCH = EXAMPLE_SPLITS.map((s) => s.id);
const byId = rosterById(EXAMPLE_ROSTER);
const everyone = EXAMPLE_ROSTER.map((p) => p.id);
const engine = (seats = [], pinned = new Set()) => makeEngine({ DATA: EXAMPLE_ROSTER, byId, SCH, seats, pinned });
const arrange = (seats, pinned) =>
  engine(seats, pinned).arrangeAll(EXAMPLE_ROWS, EXAMPLE_COLS, seats ? everyone.filter((id) => !seats.includes(id)) : everyone).seats;

test('rowOf / colOf / idxOf are the column-major layout, row 0 at the front', () => {
  assert.deepEqual([rowOf(7, 3), colOf(7, 3)], [1, 2]);
  for (let i = 0; i < 12; i++) assert.equal(idxOf(rowOf(i, 4), colOf(i, 4), 4), i);
});

test('snakeOrder walks rows, turning at each end, so every step is to a neighbour', () => {
  const cells = [...Array(9).keys()];
  assert.deepEqual(snakeOrder(cells, 3), [0, 3, 6, 7, 4, 1, 2, 5, 8]);
  // A slice that starts part-way down a column: the rows are the STAGE's rows, not the slice's.
  const sliced = snakeOrder([...Array(7).keys()], 3, 1);
  for (let k = 1; k < sliced.length; k++) {
    const a = sliced[k - 1], b = sliced[k];
    const sameRow = rowOf(1 + a, 3) === rowOf(1 + b, 3);
    if (sameRow) assert.equal(Math.abs(colOf(1 + a, 3) - colOf(1 + b, 3)), 1, `${a}→${b} skips a chair`);
  }
  // Rows in order from the front.
  assert.deepEqual(sliced.map((l) => rowOf(1 + l, 3)), [0, 0, 1, 1, 1, 2, 2]);
});

test('Auto-arrange is deterministic and seats everyone exactly once', () => {
  const a = arrange(), b = arrange();
  assert.deepEqual(a, b);
  const seated = a.filter(isSinger);
  assert.equal(seated.length, EXAMPLE_ROSTER.length);
  assert.equal(new Set(seated).size, seated.length);
});

test('on the example with every split: nobody stranded, no group broken, fewer than 15 with nobody beside them', () => {
  // The lateral target. The previous solver left 35 singers with company only in front or behind.
  const seats = arrange(), eng = engine();
  let lateral = 0;
  for (const s of ['section', ...SCH]) {
    const e = eng.evaluate2D(seats, EXAMPLE_ROWS, s);
    assert.deepEqual(e.stranded, [], `${s}: stranded`);
    assert.deepEqual(e.broken, [], `${s}: broken`);
    lateral += eng.lateralIsolated2D(seats, EXAMPLE_ROWS, s).length;
  }
  assert.ok(lateral < 15, `${lateral} singers have nobody beside them`);
});

test('pins and blocked chairs stay exactly where they were', () => {
  const seats = arrange();
  const pinnedId = seats[20];
  // The example stage is full, so add a column of free chairs for the blocked chair's occupant.
  const withBlock = [...seats, ...new Array(EXAMPLE_ROWS).fill(EMPTY)];
  // Block a chair by moving its occupant to the bench.
  const benched = withBlock[41];
  withBlock[41] = BLOCKED;
  const out = engine(withBlock, new Set([pinnedId])).arrangeAll(EXAMPLE_ROWS, EXAMPLE_COLS + 1, [benched]).seats;
  assert.equal(out[20], pinnedId);
  assert.equal(out[41], BLOCKED);
  assert.equal(out.filter(isSinger).length, EXAMPLE_ROSTER.length);
});

test('a section re-seated on its own stays inside its own chairs', () => {
  const seats = arrange();
  const alto = (id) => isSinger(id) && byId[id].section === 'Alto';
  const before = seats.map((id, i) => (alto(id) ? i : -1)).filter((i) => i >= 0);
  const out = engine(seats).arrangeSection(EXAMPLE_ROWS, 'Alto');
  assert.deepEqual(out.map((id, i) => (alto(id) ? i : -1)).filter((i) => i >= 0), before);
  seats.forEach((id, i) => {
    if (!alto(id)) assert.equal(out[i], id, `seat ${i} is not an alto's and must not change`);
  });
});
