/*
 * Tests for stable singer ids (schema 7).
 *
 * Run: npm test
 *
 * The verification list for singer ids is mostly regression — "the whole point is that nothing
 * changes" — and most of it is a human looking at a stage. What a test CAN reach is the re-key
 * itself, and that is the part where a bug is unrecoverable: `withSingerIds` runs over every
 * saved plan and every preset in every backup exactly once, and a mistake in it puts the wrong
 * people in the wrong chairs with no way back.
 *
 * So this file is about the conversion and the resolution: that a plan comes out of it seating
 * the same people, that it is idempotent, that the documented duplicate-name rule is the rule it
 * actually follows, and that a name is what reaches anything a user reads. The migration STEP is
 * tested in test/persistence.test.js against the frozen fixtures, where it belongs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKED,
  EMPTY,
  EXAMPLE_COLS,
  EXAMPLE_ROSTER,
  EXAMPLE_ROWS,
  EXAMPLE_SEATS,
  EXAMPLE_SPLITS,
  SECTION_KEY,
  STAGE_ORDER,
  hasSingerIds,
  isSinger,
  makeEngine,
  rosterById,
  seatNames,
  withSingerIds
} from '../src/utils/arranger.js';
import { walkOnFor } from '../src/utils/walkOnList.js';

const EXAMPLE = { roster: EXAMPLE_ROSTER, splits: EXAMPLE_SPLITS, seats: EXAMPLE_SEATS, rows: EXAMPLE_ROWS, cols: EXAMPLE_COLS, sectionOrder: [...STAGE_ORDER] };

/* ---------- minting ---------- */

test('hasSingerIds is true only for a roster that is completely and uniquely keyed', () => {
  assert.equal(hasSingerIds([{ id: 's1' }, { id: 's2' }]), true);
  assert.equal(hasSingerIds([]), true, 'an empty roster is trivially keyed');
  assert.equal(hasSingerIds([{ id: 's1' }, { name: 'no id' }]), false, 'half-keyed is not keyed');
  assert.equal(hasSingerIds([{ id: 's1' }, { id: 's1' }]), false, 'a duplicate id is not a key');
  assert.equal(hasSingerIds([{ id: '' }]), false);
  assert.equal(hasSingerIds([{ id: 7 }]), false);
  assert.equal(hasSingerIds(null), false);
});

/* ---------- the re-key ---------- */

const PLAN = {
  roster: [
    { name: 'Ada', section: 'Soprano', '2way': '1' },
    { name: 'Bea', section: 'Alto', '2way': '2' },
    { name: 'Cal', section: 'Bass', '2way': '1' }
  ],
  seats: ['Bea', EMPTY, 'Ada', BLOCKED, 'Cal'],
  pins: ['Cal']
};

test('a plan is re-keyed onto s1..sN in roster order, seating the same people', () => {
  const out = withSingerIds(PLAN);
  assert.deepEqual(out.roster.map((r) => r.id), ['s1', 's2', 's3']);
  assert.deepEqual(out.seats, ['s2', EMPTY, 's1', BLOCKED, 's3']);
  assert.deepEqual(out.pins, ['s3']);
  // every other field of every record survives
  out.roster.forEach((r, i) => {
    assert.equal(r.name, PLAN.roster[i].name);
    assert.equal(r.section, PLAN.roster[i].section);
    assert.equal(r['2way'], PLAN.roster[i]['2way']);
  });
  // and the input is not written to
  assert.deepEqual(PLAN.seats, ['Bea', EMPTY, 'Ada', BLOCKED, 'Cal']);
});

test('the sentinels are untouched and are never given an id', () => {
  const out = withSingerIds({ roster: [], seats: [EMPTY, BLOCKED, EMPTY], pins: [] });
  assert.deepEqual(out.seats, [EMPTY, BLOCKED, EMPTY]);
  assert.deepEqual(out.roster, []);
});

test('a name in a chair with no roster record becomes EMPTY, as reconcileSeats would make it', () => {
  const out = withSingerIds({ roster: [{ name: 'Ada', section: 'Alto' }], seats: ['Ada', 'Ghost'], pins: ['Ghost'] });
  assert.deepEqual(out.seats, ['s1', EMPTY]);
  assert.deepEqual(out.pins, [], 'and a pin on a name nobody has is dropped rather than kept as a string');
});

test('a name seated twice keeps the first chair and empties the second', () => {
  // The roster form cannot produce this and reconcileSeats already repairs it at load, so the
  // migration is only doing the same thing sooner.
  const out = withSingerIds({ roster: [{ name: 'Ada', section: 'Alto' }], seats: ['Ada', 'Ada'], pins: [] });
  assert.deepEqual(out.seats, ['s1', EMPTY]);
});

test('duplicate names take chairs in seat order, first chair to first record', () => {
  // The documented rule, and arbitrary by necessity: v6 data does not carry the information
  // that would make any rule correct. What matters is that it is DECIDED, so that two John
  // Smiths come out as two independently seatable people rather than as one.
  const out = withSingerIds({
    roster: [
      { name: 'John Smith', section: 'Bass', '2way': '1' },
      { name: 'John Smith', section: 'Tenor', '2way': '2' },
      { name: 'Ada', section: 'Alto', '2way': '1' }
    ],
    seats: ['Ada', 'John Smith', EMPTY, 'John Smith'],
    pins: ['John Smith']
  });
  assert.deepEqual(out.roster.map((r) => r.id), ['s1', 's2', 's3']);
  assert.deepEqual(out.seats, ['s3', 's1', EMPTY, 's2']);
  assert.deepEqual(out.roster[0].section, 'Bass');
  assert.deepEqual(out.roster[1].section, 'Tenor');
  // the pin follows the first record, which is also the one that took the first chair
  assert.deepEqual(out.pins, ['s1']);
});

test('a third duplicate with no chair left simply has no chair', () => {
  const out = withSingerIds({
    roster: [{ name: 'Jo', section: 'Alto' }, { name: 'Jo', section: 'Alto' }, { name: 'Jo', section: 'Alto' }],
    seats: ['Jo', 'Jo'],
    pins: []
  });
  assert.deepEqual(out.seats, ['s1', 's2']);
  assert.deepEqual(out.roster.map((r) => r.id), ['s1', 's2', 's3'], 's3 is on the bench, not lost');
});

test('re-keying is idempotent', () => {
  const once = withSingerIds(PLAN);
  const twice = withSingerIds(once);
  assert.deepEqual(twice, once);
  // and the arrays come back detached either way, so a caller can keep its own copy
  twice.seats[0] = 'tampered';
  assert.equal(once.seats[0], 's2');
});

test('a missing roster, seats or pins is an empty one rather than a throw', () => {
  assert.deepEqual(withSingerIds({}), { roster: [], seats: [], pins: [] });
  assert.deepEqual(withSingerIds(null), { roster: [], seats: [], pins: [] });
  assert.deepEqual(withSingerIds({ roster: PLAN.roster }).roster.map((r) => r.id), ['s1', 's2', 's3']);
});

/* ---------- resolution ---------- */

test('rosterById keys by id and skips a record that has none', () => {
  const m = rosterById([{ id: 's1', name: 'Ada' }, { name: 'no id' }, { id: 's2', name: 'Bea' }]);
  assert.deepEqual(Object.keys(m).sort(), ['s1', 's2']);
  assert.equal(m.s1.name, 'Ada');
});

test('seatNames turns a grid of ids into the grid of names, sentinels intact', () => {
  const out = withSingerIds(PLAN);
  assert.deepEqual(seatNames(out.seats, rosterById(out.roster)), ['Bea', EMPTY, 'Ada', BLOCKED, 'Cal']);
});

test('seatNames reads an unknown id as an empty chair rather than printing the id', () => {
  // The failure that would be worst on paper: a handout reading "s7" where a singer should be.
  assert.deepEqual(seatNames(['s1', 's99'], { s1: { name: 'Ada' } }), ['Ada', EMPTY]);
  assert.deepEqual(seatNames(['s1'], {}), [EMPTY]);
  assert.deepEqual(seatNames(null, {}), []);
});

test('renaming a singer moves them nowhere and keeps their pin', () => {
  // THE case singer ids exist for, at the level a test can reach it: the plan is unchanged by an
  // edit to a name, because nothing in the plan holds one.
  const out = withSingerIds(PLAN);
  const renamed = out.roster.map((r) => (r.id === 's1' ? { ...r, name: 'Ada Lovelace' } : r));
  assert.deepEqual(out.seats, ['s2', EMPTY, 's1', BLOCKED, 's3'], 'the seating is untouched');
  assert.deepEqual(seatNames(out.seats, rosterById(renamed)), ['Bea', EMPTY, 'Ada Lovelace', BLOCKED, 'Cal']);
  assert.deepEqual(out.pins, ['s3'], 'and the pin is on an id, so it cannot go stale');
});

/* ---------- the built-in presets ---------- */

test('the built-ins are keyed, and their seating still seats exactly who the source names', () => {
  // EXAMPLE_SEATS is written out as names in the source and re-keyed by the same withSingerIds
  // the migration uses. If that function can mis-seat somebody, it mis-seats them here, in the
  // plan every other test loads.
  assert.ok(hasSingerIds(EXAMPLE_ROSTER));
  assert.equal(new Set(EXAMPLE_ROSTER.map((r) => r.id)).size, EXAMPLE_ROSTER.length);
  assert.equal(EXAMPLE_SEATS.filter(isSinger).length, EXAMPLE_ROSTER.length, 'everyone has a chair');
  const names = seatNames(EXAMPLE_SEATS, rosterById(EXAMPLE_ROSTER));
  assert.equal(names[0], 'Kim Shelton');
  assert.equal(names[65], 'Julian Barlow');
  assert.equal(new Set(names.filter(isSinger)).size, EXAMPLE_ROSTER.length, 'nobody is seated twice');
});

test('the solver reports ids, and the example seating is still a clean one', () => {
  const byId = rosterById(EXAMPLE.roster);
  const eng = makeEngine({
    DATA: EXAMPLE.roster,
    byId,
    SCH: ['2way', '3way', '4way'],
    seats: EXAMPLE.seats,
    pinned: new Set(),
    order: [...STAGE_ORDER]
  });
  for (const key of [SECTION_KEY, '2way', '3way', '4way']) {
    const { stranded, broken } = eng.evaluate2D(EXAMPLE.seats, EXAMPLE.rows, key);
    assert.deepEqual(stranded, [], `nobody should be alone in ${key}`);
    assert.deepEqual(broken, [], `no group should be split in ${key}`);
  }
  // and when it does report somebody, it reports an id
  const broken2 = eng.evaluate2D(EXAMPLE.seats.slice().reverse(), EXAMPLE.rows, '4way');
  broken2.stranded.forEach((x) => assert.ok(byId[x], `${x} should be an id this roster knows`));
});

/* ---------- what the user receives ---------- */

test('the walk-on list resolves to names, and no id reaches the paper', () => {
  const plan = walkOnFor(
    EXAMPLE.seats,
    EXAMPLE.rows,
    EXAMPLE.cols,
    { enterFrom: 'left', rowFrom: 'back' },
    {},
    'bottom',
    rosterById(EXAMPLE.roster)
  );
  const everyone = plan.list.queues.flatMap((q) => q.groups.flatMap((g) => g.entries));
  assert.equal(everyone.length, EXAMPLE_ROSTER.length);
  for (const e of everyone) assert.ok(!/^s\d+$/.test(e.name), `${e.name} looks like an id, not a person`);
  assert.ok(everyone.some((e) => e.name === 'Julian Barlow'));
});

test('walkOnFor without a lookup treats the grid as names, which is what the geometry tests do', () => {
  const plan = walkOnFor(['Ada', 'Bea'], 1, 2, { enterFrom: 'right' }, {}, 'bottom');
  assert.deepEqual(plan.order.queues.R.map((e) => e.name), ['Ada', 'Bea']);
});
