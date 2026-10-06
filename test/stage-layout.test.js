/*
 * Tests for stageLayout, the shared render path.
 *
 * Run: npm test
 *
 * This is the geometry that used to live inside StageView.vue's `view` computed, lifted out so
 * the printed sheet draws the same picture as the screen rather than a second one that looks
 * like it. Two components consume it now and the walk-on list and the whole-concert
 * print will consume it later, so the properties worth nailing down are the ones a second
 * caller could get wrong: that the rotation is a pure reversal with `gi` preserved, that the
 * bands tile the columns exactly, and that every heading comes from utils/labels.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cropToSection, stageLayout } from '../src/utils/stageLayout.js';
import { colLabelAt, rowLabelAt } from '../src/utils/labels.js';
import { BLOCKED, EMPTY, EXAMPLE_COLS, EXAMPLE_ROSTER, EXAMPLE_ROWS, EXAMPLE_SEATS, SECTION_COLOR, STAGE_ORDER, rosterById } from '../src/utils/arranger.js';

const EXAMPLE = { roster: EXAMPLE_ROSTER, seats: EXAMPLE_SEATS, rows: EXAMPLE_ROWS, cols: EXAMPLE_COLS, sectionOrder: [...STAGE_ORDER] };

// the plan argument stageLayout takes, built from a preset the way a caller does.
function planOf(preset, extra = {}) {
  return {
    seats: preset.seats,
    rows: preset.rows,
    cols: preset.cols,
    byId: rosterById(preset.roster || []),
    sectionOrder: preset.sectionOrder || [...STAGE_ORDER],
    labels: preset.labels,
    audienceAt: preset.audienceAt,
    ...extra
  };
}

test('the default viewpoint draws the stored order, each slot carrying its own index', () => {
  const plan = planOf(EXAMPLE, { audienceAt: 'bottom' });
  const { slots } = stageLayout(plan);
  assert.equal(slots.length, plan.seats.length);
  slots.forEach((s, k) => {
    assert.equal(s.gi, k);
    assert.equal(s.id, plan.seats[k]);
  });
});

test("the 'top' viewpoint reverses the drawing and nothing else: gi still names the stored seat", () => {
  const plan = planOf(EXAMPLE, { audienceAt: 'top' });
  const { slots } = stageLayout(plan);
  const n = plan.seats.length;
  slots.forEach((s, k) => {
    assert.equal(s.gi, n - 1 - k);
    assert.equal(s.id, plan.seats[n - 1 - k]);
  });
  // the stored array is untouched: the rotation is a rendering fact, never a write.
  assert.deepEqual(plan.seats, EXAMPLE.seats);
});

test('rotating the plan permutes the slots without changing who is on the stage', () => {
  const sort = (a) => [...a].sort();
  const bottom = stageLayout(planOf(EXAMPLE, { audienceAt: 'bottom' })).slots.map((s) => s.id);
  const top = stageLayout(planOf(EXAMPLE, { audienceAt: 'top' })).slots.map((s) => s.id);
  assert.deepEqual(sort(top), sort(bottom));
});

test('bands are contiguous, non-overlapping and in ascending column order', () => {
  const { bands, cols } = stageLayout(planOf(EXAMPLE));
  let last = 0;
  for (const b of bands) {
    const [start, span] = b.gridColumn.split(' / span ').map(Number);
    assert.ok(start >= last + 1, `band at ${b.gridColumn} overlaps the one before it`);
    assert.ok(start + span - 1 <= cols, `band at ${b.gridColumn} runs past column ${cols}`);
    assert.ok(span >= 1);
    last = start + span - 1;
  }
});

test('a band is coloured by its section and no two neighbouring bands share a section', () => {
  const { bands } = stageLayout(planOf(EXAMPLE));
  assert.ok(bands.length > 1, 'the example should band into several sections');
  bands.forEach((b, i) => {
    assert.equal(b.color, SECTION_COLOR[b.sec]);
    if (i) assert.notEqual(b.sec, bands[i - 1].sec);
  });
});

test('a column of empty and blocked seats owns no section, and splits the band either side', () => {
  // three columns of two: Soprano, nothing at all, Soprano. The middle column belongs to
  // nobody, so it must not be swallowed into one band running 1 to 3.
  const roster = [
    { id: 's1', name: 'Ann', section: 'Soprano' },
    { id: 's2', name: 'Bea', section: 'Soprano' },
    { id: 's3', name: 'Cal', section: 'Soprano' },
    { id: 's4', name: 'Dot', section: 'Soprano' }
  ];
  const { bands } = stageLayout({
    seats: ['s1', 's2', EMPTY, BLOCKED, 's3', 's4'],
    rows: 2,
    cols: 3,
    byId: rosterById(roster),
    sectionOrder: [...STAGE_ORDER]
  });
  assert.deepEqual(bands.map((b) => b.gridColumn), ['1 / span 1', '3 / span 1']);
});

test('a column tied between two sections goes to the incoming one', () => {
  // four columns of two: Soprano, Soprano+Alto, Alto, Alto+Tenor. Both tied columns start the
  // section that follows, so the headings split at columns 2 and 4, not after them.
  const roster = [
    ['s1', 'Soprano'], ['s2', 'Soprano'], ['s3', 'Soprano'],
    ['a1', 'Alto'], ['a2', 'Alto'], ['a3', 'Alto'], ['a4', 'Alto'],
    ['t1', 'Tenor']
  ].map(([id, section]) => ({ id, name: id, section }));
  const { bands } = stageLayout({
    seats: ['s1', 's2', 's3', 'a1', 'a2', 'a3', 'a4', 't1'],
    rows: 2,
    cols: 4,
    byId: rosterById(roster),
    sectionOrder: [...STAGE_ORDER]
  });
  assert.deepEqual(bands.map((b) => [b.sec, b.gridColumn]), [
    ['Soprano', '1 / span 1'],
    ['Alto', '2 / span 2'],
    ['Tenor', '4 / span 1']
  ]);
});

test('an id that is not in the roster is skipped rather than throwing', () => {
  const { bands } = stageLayout({
    seats: ['sGhost', 'sGhost'],
    rows: 2,
    cols: 1,
    byId: {},
    sectionOrder: [...STAGE_ORDER]
  });
  assert.deepEqual(bands, []);
});

test('every heading is utils/labels.js output for that row or column, under all four settings', () => {
  const combos = [];
  for (const rowLabel of ['letters', 'numbers'])
    for (const rowFirst of ['top', 'bottom'])
      for (const colLabel of ['letters', 'numbers'])
        for (const colOrder of ['ltr', 'rtl']) combos.push({ rowLabel, rowFirst, colLabel, colOrder });

  for (const labels of combos) {
    for (const audienceAt of ['bottom', 'top']) {
      const plan = planOf(EXAMPLE, { labels, audienceAt });
      const { rows, cols, rowHeads, colHeads } = stageLayout(plan);
      assert.equal(rowHeads.length, rows);
      assert.equal(colHeads.length, cols);
      for (const h of rowHeads) assert.equal(h.text, rowLabelAt(h.r, rows, labels, audienceAt));
      for (const h of colHeads) assert.equal(h.text, colLabelAt(h.c, cols, labels, audienceAt));
    }
  }
});

test('a row heading sits on the grid row SeatGrid places that row in', () => {
  // SeatGrid positions slot k at grid row `rows - (k % rows)`, and the heading strip is a
  // parallel grid, so heading k must claim `rows - k` or the labels slide off their rows.
  const { rows, rowHeads } = stageLayout(planOf(EXAMPLE));
  rowHeads.forEach((h, k) => assert.equal(h.gridRow, rows - k));
});

test('an empty stage lays out without headings rather than throwing', () => {
  const out = stageLayout({ seats: [], rows: 4, cols: 0, byId: {}, sectionOrder: [...STAGE_ORDER] });
  assert.deepEqual(out.slots, []);
  assert.deepEqual(out.bands, []);
  assert.deepEqual(out.rowHeads, []);
  assert.deepEqual(out.colHeads, []);
});

test('absent optional fields fall back rather than blanking the drawing', () => {
  const { slots, rowHeads, colHeads } = stageLayout({ seats: ['s1'], rows: 1, cols: 1 });
  assert.deepEqual(slots, [{ id: 's1', gi: 0 }]);
  assert.equal(rowHeads[0].text, 'A'); // LABEL_DEFAULTS: rows lettered
  assert.equal(colHeads[0].text, '1'); // LABEL_DEFAULTS: columns numbered
});

// Custom colours landed on one branch while stageLayout landed on another, and the merge of the two is
// where the bands could silently go back to painting from the constants. These two pin the seam.
test("a plan's own section colours reach the bands", () => {
  const mine = { ...SECTION_COLOR, Tenor: '#123456' };
  const { bands } = stageLayout(planOf(EXAMPLE, { sectionColours: mine }));
  const tenor = bands.filter((b) => b.sec === 'Tenor');
  assert.ok(tenor.length, 'the example should band a Tenor section');
  tenor.forEach((b) => assert.equal(b.color, '#123456'));
  bands.filter((b) => b.sec !== 'Tenor').forEach((b) => assert.equal(b.color, SECTION_COLOR[b.sec]));
});

test('a caller that passes no palette still gets the default colours', () => {
  const { bands } = stageLayout(planOf(EXAMPLE));
  assert.ok(bands.length);
  bands.forEach((b) => assert.equal(b.color, SECTION_COLOR[b.sec]));
});

/* ---------- cropToSection ---------- */
/*
 * Lifted out of SectionBlock.vue so the compare view's reference half crops the same way the
 * working half does. It was inline and untested for the whole of v1; these are the properties
 * the By section view has always depended on and nothing asserted.
 */

// A: 3 rows, 3 columns, column-major. Soprano at (r0,c0), (r2,c0) and (r1,c2).
const CROP_SEATS = ['a', EMPTY, 'b', BLOCKED, 'x', EMPTY, EMPTY, 'c', EMPTY];
const CROP_BY = {
  a: { id: 'a', name: 'A', section: 'Soprano' },
  b: { id: 'b', name: 'B', section: 'Soprano' },
  c: { id: 'c', name: 'C', section: 'Soprano' },
  x: { id: 'x', name: 'X', section: 'Bass' }
};

test('cropToSection returns the smallest box holding the section, with its real seat indexes', () => {
  const { rows, slots } = cropToSection({ seats: CROP_SEATS, rows: 3, byId: CROP_BY, sec: 'Soprano' });
  // columns 0..2, rows 0..2 — every Soprano is in the corners, so the box is the whole grid
  assert.equal(rows, 3);
  assert.deepEqual(slots.map((s) => s.gi), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(slots.map((s) => s.id), CROP_SEATS);
});

test('cropToSection keeps other sections inside the box, so the box stays a rectangle', () => {
  const { slots } = cropToSection({ seats: CROP_SEATS, rows: 3, byId: CROP_BY, sec: 'Soprano' });
  assert.ok(slots.some((s) => s.id === 'x'), 'the Bass in the middle is kept, for SeatGrid to ghost');
});

test('cropToSection crops to fewer rows when the section sits in a band', () => {
  // one Soprano, at row 1 of column 1: a 1x1 box whose gi is 4, not 0
  const seats = [EMPTY, EMPTY, EMPTY, EMPTY, 'a', EMPTY];
  const { rows, slots } = cropToSection({ seats, rows: 3, byId: CROP_BY, sec: 'Soprano' });
  assert.equal(rows, 1);
  assert.deepEqual(slots, [{ id: 'a', gi: 4 }]);
});

test('cropToSection takes the viewpoint, and it is exactly a reversal', () => {
  const plain = cropToSection({ seats: CROP_SEATS, rows: 3, byId: CROP_BY, sec: 'Soprano' });
  const flipped = cropToSection({ seats: CROP_SEATS, rows: 3, byId: CROP_BY, sec: 'Soprano', audienceAt: 'top' });
  assert.equal(flipped.rows, plain.rows);
  assert.deepEqual(flipped.slots, plain.slots.slice().reverse());
  // every gi survives the rotation, which is what lets a drop still land on the right chair
  assert.deepEqual(flipped.slots.map((s) => s.gi).sort((x, y) => x - y), plain.slots.map((s) => s.gi));
});

test('a section with nobody in it crops to nothing, at the full depth', () => {
  const { rows, slots } = cropToSection({ seats: CROP_SEATS, rows: 3, byId: CROP_BY, sec: 'Alto' });
  assert.deepEqual(slots, []);
  assert.equal(rows, 3, 'the caller still has a grid depth to render with');
});

test('cropToSection ignores sentinels and ids the roster has not got', () => {
  const { slots } = cropToSection({ seats: [BLOCKED, EMPTY, 'ghost'], rows: 3, byId: CROP_BY, sec: 'Soprano' });
  assert.deepEqual(slots, [], 'a blocked seat is not a Soprano, and neither is an unresolvable id');
});

test('cropToSection is what SectionBlock used to do inline, for a real preset', () => {
  const byId = rosterById(EXAMPLE.roster);
  for (const sec of STAGE_ORDER) {
    const { rows, slots } = cropToSection({ seats: EXAMPLE.seats, rows: EXAMPLE.rows, byId, sec });
    if (!slots.length) continue;
    assert.equal(slots.length % rows, 0, `${sec}: the crop is a whole number of columns`);
    // everyone of this section is inside their own box
    const inBox = new Set(slots.map((s) => s.gi));
    EXAMPLE.seats.forEach((id, gi) => {
      if (byId[id] && byId[id].section === sec) assert.ok(inBox.has(gi), `${sec}: ${id} at ${gi} is outside the box`);
    });
  }
});
