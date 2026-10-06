/*
 * Tests for the roster / concert / arrangement model. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignmentsFrom,
  concertPlan,
  concertSingers,
  emptyLibrary,
  seedLibrary,
  findArrangement,
  findConcert,
  findRoster,
  importPlan,
  isMember,
  makeArrangement,
  makeConcert,
  makeRoster,
  mintId,
  moveGuestToRoster,
  normaliseArrangement,
  normaliseLibrary,
  normaliseRoster,
  openView,
  seedCounter,
  staleSeated,
  staleSeatedIds,
  validSinger,
  withMember,
  withoutSingers
} from '../src/utils/library.js';
import { ARRANGEMENT_FIELDS, PLAN_FIELDS, PLAN_SHARED_FIELDS } from '../src/utils/plan.js';
import {
  BLOCKED,
  EMPTY,
  EXAMPLE_CONCERTS,
  EXAMPLE_ROSTER,
  EXAMPLE_SEATS,
  EXAMPLE_SEATS_2,
  SECTION_KEY,
  STAGE_ORDER,
  isSinger,
  walkOnOrder
} from '../src/utils/arranger.js';
import { LABEL_DEFAULTS } from '../src/utils/labels.js';
import { makePlanView } from '../src/composables/usePlanView.js';

const SINGERS = [
  { id: 's1', name: 'Ada', section: 'Soprano' },
  { id: 's2', name: 'Bea', section: 'Alto' },
  { id: 's3', name: 'Cal', section: 'Bass' }
];
const SPLITS = [{ id: '2way', name: '2-way', cats: ['1', '2'] }];

// a library with one roster, one concert over it, one arrangement in that
function fixture() {
  const lib = emptyLibrary();
  const roster = makeRoster(lib, 'Choir', SINGERS);
  lib.rosters.push(roster);
  const concert = makeConcert(lib, 'Winter', roster, {
    splits: SPLITS,
    assign: { s1: { '2way': '2' }, s2: { '2way': '1' } }
  });
  concert.arrangements.push(makeArrangement(lib, 'Version A', { seats: ['s1', 's2', EMPTY, 's3'], rows: 2, cols: 2 }));
  lib.concerts.push(concert);
  return { lib, roster, concert, arrangement: concert.arrangements[0] };
}

/* ---------- what a singer is now ---------- */

test('a roster singer is id, name and section, and nothing else', () => {
  assert.ok(validSinger({ id: 's1', name: 'Ada', section: 'Alto' }));
  assert.ok(!validSinger({ name: 'Ada', section: 'Alto' }), 'no id');
  assert.ok(!validSinger({ id: '', name: 'Ada', section: 'Alto' }));
  assert.ok(!validSinger({ id: 's1', name: 'Ada', section: 'Descant' }));
  assert.ok(!validSinger({ id: 's1', name: EMPTY, section: 'Alto' }), 'a sentinel cannot be a name');

  // the categories are stripped: they are a fact about one CONCERT, not about the singer
  const [only] = normaliseRoster({ id: 'r1', name: 'R', singers: [{ id: 's1', name: 'Ada', section: 'Alto', '2way': '1' }] }).singers;
  assert.deepEqual(Object.keys(only).sort(), ['id', 'name', 'section']);
});

/* ---------- the join ---------- */

test('concertSingers joins the roster, the membership and the assignments into one flat record', () => {
  const { lib, concert } = fixture();
  assert.deepEqual(concertSingers(lib, concert), [
    { id: 's1', name: 'Ada', section: 'Soprano', '2way': '2' },
    { id: 's2', name: 'Bea', section: 'Alto', '2way': '1' },
    { id: 's3', name: 'Cal', section: 'Bass', '2way': '1' }
  ]);
  // s3 had no assignment at all and was snapped to the split's first category, which is exactly
  // what rebuildFromRoster did before this and is why `assign` may be sparse in storage.
});

test('a category the split no longer offers snaps to the first, so deleting one stays safe', () => {
  const { lib, concert } = fixture();
  concert.assign.s1 = { '2way': 'Descant' };
  assert.equal(concertSingers(lib, concert)[0]['2way'], '1');
});

test('the order is the ROSTER’s, so ticking somebody out and back in cannot shuffle the bench', () => {
  const { lib, concert } = fixture();
  concert.members = [{ singerId: 's3' }, { singerId: 's1' }, { singerId: 's2' }];
  assert.deepEqual(concertSingers(lib, concert).map((p) => p.id), ['s1', 's2', 's3']);
});

test('a singer who is not a member of the concert is not in it', () => {
  const { lib, concert } = fixture();
  concert.members = concert.members.filter((m) => m.singerId !== 's2');
  assert.deepEqual(concertSingers(lib, concert).map((p) => p.name), ['Ada', 'Cal']);
});

test('renaming in the roster reaches every concert over it, with no fan-out', () => {
  // The shared-roster test, at the level a unit test can reach it: two concerts, one roster, one
  // edit. Each concert used to hold its own copy and the other one went stale.
  const { lib, roster, concert } = fixture();
  const second = makeConcert(lib, 'Summer', roster, { splits: SPLITS });
  second.arrangements.push(makeArrangement(lib, 'Plan 1', { seats: ['s1'], rows: 1, cols: 1 }));
  lib.concerts.push(second);

  roster.singers.find((p) => p.id === 's1').name = 'Ada Lovelace';
  assert.equal(concertSingers(lib, concert)[0].name, 'Ada Lovelace');
  assert.equal(concertSingers(lib, second)[0].name, 'Ada Lovelace');
  assert.deepEqual(second.arrangements[0].seats, ['s1'], 'and nobody moved chair');
});

test('assignmentsFrom is the inverse, and drops a split the concert no longer has', () => {
  const rows = [
    { id: 's1', name: 'Ada', section: 'Soprano', '2way': '2', gone: 'x' },
    { id: 's2', name: 'Bea', section: 'Alto', '2way': '1' }
  ];
  assert.deepEqual(assignmentsFrom(rows, ['2way']), { s1: { '2way': '2' }, s2: { '2way': '1' } });
  assert.deepEqual(assignmentsFrom(rows, []), {}, 'no splits means no assignments to keep');
  assert.deepEqual(assignmentsFrom(null, ['2way']), {});
});

/* ---------- the plan seam ---------- */

test('an arrangement plus its concert and roster is a PLAN, which is what the sheet already takes', () => {
  const { lib, concert, arrangement } = fixture();
  const plan = concertPlan(lib, concert, arrangement);
  assert.deepEqual(Object.keys(plan).sort(), [...PLAN_FIELDS].sort(), 'a plan, complete');
  assert.deepEqual(plan.roster, concertSingers(lib, concert));
  assert.deepEqual(plan.splits, concert.splits);
  assert.deepEqual(plan.seats, ['s1', 's2', EMPTY, 's3']);
  assert.equal(plan.rows, 2);
});

test('a stored plan that seats somebody who has left draws their chair empty rather than throwing', () => {
  const { lib, concert, arrangement } = fixture();
  arrangement.pins = ['s2'];
  concert.members = withMember(lib, concert, 's2', false);
  const plan = concertPlan(lib, concert, arrangement);
  assert.deepEqual(plan.seats, ['s1', EMPTY, EMPTY, 's3']);
  assert.deepEqual(plan.pins, []);
  assert.deepEqual(arrangement.seats, ['s1', 's2', EMPTY, 's3'], 'the stored record is untouched');
  // every consumer of a plan builds a view of it; this is what used to throw
  assert.doesNotThrow(() => makePlanView(plan, '2way'));
});

test('ARRANGEMENT_FIELDS and PLAN_SHARED_FIELDS partition a plan exactly', () => {
  // The guard that keeps the three layers honest: a new plan-level field is either the roster's,
  // the concert's, or the arrangement's, and it cannot be none of them.
  assert.deepEqual([...ARRANGEMENT_FIELDS, ...PLAN_SHARED_FIELDS].sort(), [...PLAN_FIELDS].sort());
  assert.equal(ARRANGEMENT_FIELDS.filter((f) => PLAN_SHARED_FIELDS.includes(f)).length, 0);
});

test('normaliseArrangement refuses to hand back a record missing an arrangement field', () => {
  // ...which is the same refusal buildPlan() makes at the other end of the seam. Between them
  // there is no way to teach the sheet a field and forget to store it.
  const out = normaliseArrangement({ id: 'a1', name: 'A' });
  for (const f of ARRANGEMENT_FIELDS) assert.ok(f in out, f);
  assert.deepEqual(out.labels, { ...LABEL_DEFAULTS });
  assert.deepEqual(out.sectionOrder, [...STAGE_ORDER]);
  assert.ok(!('colours' in out), 'colours are global, not arrangement data');
  assert.equal(out.audienceAt, 'bottom');
});

/* ---------- normalisation ---------- */

test('a concert naming a roster that is not in the library is dropped, not drawn', () => {
  const lib = normaliseLibrary({
    rosters: [{ id: 'r1', name: 'R', singers: SINGERS }],
    concerts: [
      { id: 'c1', name: 'Good', rosterId: 'r1', members: [{ singerId: 's1' }], splits: SPLITS, arrangements: [] },
      { id: 'c2', name: 'Dangling', rosterId: 'r9', members: [], splits: [], arrangements: [] }
    ]
  });
  assert.deepEqual(lib.concerts.map((c) => c.name), ['Good']);
});

test('membership is narrowed to singers the roster actually has', () => {
  const lib = normaliseLibrary({
    rosters: [{ id: 'r1', name: 'R', singers: SINGERS }],
    concerts: [{ id: 'c1', name: 'C', rosterId: 'r1', members: [{ singerId: 's1' }, { singerId: 's9' }, { singerId: 's1' }], splits: [], arrangements: [] }]
  });
  assert.deepEqual(lib.concerts[0].members, [{ singerId: 's1' }]);
});

test('a bare singer id is accepted as a membership row, so the shape can grow without a bump', () => {
  const lib = normaliseLibrary({
    rosters: [{ id: 'r1', name: 'R', singers: SINGERS }],
    concerts: [{ id: 'c1', name: 'C', rosterId: 'r1', members: ['s2'], splits: [], arrangements: [] }]
  });
  assert.deepEqual(lib.concerts[0].members, [{ singerId: 's2' }]);
});

test('duplicate ids keep the first, at every level', () => {
  const lib = normaliseLibrary({
    rosters: [
      { id: 'r1', name: 'first', singers: [{ id: 's1', name: 'Ada', section: 'Alto' }, { id: 's1', name: 'Twin', section: 'Bass' }] },
      { id: 'r1', name: 'second', singers: [] }
    ],
    concerts: [
      { id: 'c1', name: 'first', rosterId: 'r1', members: [], splits: [], arrangements: [{ id: 'a1', name: 'one' }, { id: 'a1', name: 'two' }] },
      { id: 'c1', name: 'second', rosterId: 'r1', members: [], splits: [], arrangements: [] }
    ]
  });
  assert.deepEqual(lib.rosters.map((r) => r.name), ['first']);
  assert.deepEqual(lib.rosters[0].singers.map((s) => s.name), ['Ada']);
  assert.deepEqual(lib.concerts.map((c) => c.name), ['first']);
  assert.deepEqual(lib.concerts[0].arrangements.map((a) => a.name), ['one']);
});

test('an assignment for a split the concert has not got, or a singer the roster has not got, is dropped', () => {
  const [c] = normaliseLibrary({
    rosters: [{ id: 'r1', name: 'R', singers: SINGERS }],
    concerts: [{
      id: 'c1', name: 'C', rosterId: 'r1', members: [{ singerId: 's1' }], splits: SPLITS, arrangements: [],
      assign: { s1: { '2way': '2', gone: '1' }, s9: { '2way': '1' }, s2: { '2way': '1' } }
    }]
  }).concerts;
  // s2 is on the roster but ticked out: their category is kept for when they are ticked back in
  assert.deepEqual(c.assign, { s1: { '2way': '2' }, s2: { '2way': '1' } });
});

test('junk is an empty library rather than a throw', () => {
  for (const bad of [null, undefined, 7, 'library', {}, { rosters: 'no' }]) assert.deepEqual(normaliseLibrary(bad), emptyLibrary());
});

/* ---------- lookups ---------- */

test('the lookups answer null rather than undefined, so a caller can test one way', () => {
  const { lib, roster, concert, arrangement } = fixture();
  assert.equal(findRoster(lib, roster.id), roster);
  assert.equal(findConcert(lib, concert.id), concert);
  assert.equal(findArrangement(concert, arrangement.id), arrangement);
  assert.equal(findRoster(lib, 'r9'), null);
  assert.equal(findConcert(lib, 'c9'), null);
  assert.equal(findArrangement(concert, 'a9'), null);
  assert.equal(findConcert(null, 'c1'), null);
});

test('openView falls back to the first arrangement rather than to nothing', () => {
  const { lib, concert } = fixture();
  const v = openView(lib, concert.id, 'a-does-not-exist');
  assert.equal(v.arrangement, concert.arrangements[0]);
  assert.ok(v.plan);
  assert.equal(openView(lib, 'c9', 'a1').plan, null);
});

/* ---------- ids ---------- */

test('every kind of id comes off one counter, which never goes back', () => {
  const lib = emptyLibrary();
  lib.rosters.push(makeRoster(lib, 'one', []));
  lib.rosters.push(makeRoster(lib, 'two', []));
  assert.deepEqual(lib.rosters.map((r) => r.id), ['r1', 'r2']);
  lib.rosters.splice(1, 1);
  assert.equal(makeRoster(lib, 'three', []).id, 'r3', 'r2 was deleted, and is not handed out again');

  const c = makeConcert(lib, 'C', lib.rosters[0]);
  assert.equal(c.id, 'c4');
  c.arrangements.push(makeArrangement(lib, 'A'));
  assert.equal(c.arrangements[0].id, 'a5');
  assert.equal(mintId(lib, 's'), 's6');
  assert.equal(mintId(lib, 'g'), 'g7');
  assert.equal(lib.seq, 8);
});

test('the counter is seeded past every id a library holds, references included', () => {
  const lib = {
    rosters: [{ id: 'r2', name: 'R', singers: [{ id: 's9', name: 'Ada', section: 'Alto' }] }],
    concerts: [{ id: 'c1', name: 'C', rosterId: 'r2', members: [], guests: [], splits: [], assign: {}, arrangements: [{ id: 'a3', seats: ['s40', 'Another_Split'], pins: ['s41'] }] }]
  };
  assert.equal(seedCounter(lib).seq, 42, 'a chair still naming s41 keeps s41 from coming back');
  assert.equal(seedCounter({ ...lib, seq: 100 }).seq, 100, 'a counter already past them is left alone');
  assert.equal(seedCounter({ rosters: [{ id: 'ex:r7', singers: [] }], concerts: [], seq: 'junk' }).seq, 1, 'a prefixed or junk value is ignored');
  assert.equal(normaliseLibrary({ rosters: lib.rosters, concerts: [], seq: 3 }).seq, 10, 'a load or a restore seeds it');
  assert.equal(emptyLibrary().seq, 1);
});

test('a new concert has everyone in by default, and untick is how you take them out', () => {
  const lib = emptyLibrary();
  const roster = makeRoster(lib, 'R', SINGERS);
  lib.rosters.push(roster);
  assert.deepEqual(makeConcert(lib, 'All', roster).members.map((m) => m.singerId), ['s1', 's2', 's3']);
  assert.deepEqual(makeConcert(lib, 'Some', roster, { memberIds: ['s1', 's3'] }).members.map((m) => m.singerId), ['s1', 's3']);
});

test('importPlan turns a flat plan into a roster, a concert and one arrangement', () => {
  const lib = emptyLibrary();
  const made = importPlan(lib, { roster: 'Choir', concert: 'Spring' }, { roster: SINGERS, splits: SPLITS, seats: ['s1'], rows: 1, cols: 1 }, 'First');
  assert.equal(lib.rosters.length, 1);
  assert.equal(lib.concerts.length, 1);
  assert.equal(lib.rosters[0].name, 'Choir');
  assert.equal(lib.concerts[0].name, 'Spring');
  assert.equal(lib.concerts[0].rosterId, lib.rosters[0].id);
  assert.equal(findArrangement(findConcert(lib, made.concertId), made.arrangementId).name, 'First');
  assert.deepEqual(concertSingers(lib, lib.concerts[0]).map((p) => p.name), ['Ada', 'Bea', 'Cal']);
});

/* ---------- membership, and the people who have left ---------- */
/*
 * The tick list and the stale-singer prompt: the two things the model was built for and once had
 * no screen. These are the pure half, and the properties that matter are the ones a screen
 * cannot be trusted to keep — that untick is not delete, and that a chair is never emptied
 * without somebody saying so.
 */

test('withMember ticks somebody out of the concert without touching the choir', () => {
  const { lib, concert, roster } = fixture();
  concert.members = withMember(lib, concert, 's2', false);

  assert.ok(!isMember(concert, 's2'));
  assert.deepEqual(concertSingers(lib, concert).map((p) => p.name), ['Ada', 'Cal']);
  // the whole point: she is still in the choir, and still in every other concert over it
  assert.deepEqual(roster.singers.map((p) => p.name), ['Ada', 'Bea', 'Cal']);
});

test('withMember puts somebody back in roster order', () => {
  const { lib, concert } = fixture();
  concert.members = withMember(lib, concert, 's2', false);
  concert.members = withMember(lib, concert, 's2', true);
  assert.deepEqual(concert.members.map((m) => m.singerId), ['s1', 's2', 's3'], 'roster order, not append order');
  // the split assignment survives, because it is keyed by singer and not by membership
  assert.deepEqual(concert.assign.s2, { '2way': '1' });
});

test('withMember cannot invent a member the roster has not got', () => {
  const { lib, concert } = fixture();
  assert.deepEqual(withMember(lib, concert, 'nobody', true).map((m) => m.singerId), ['s1', 's2', 's3']);
});

test("a ticked-out singer's assignments survive, because they may be back", () => {
  const { lib, concert } = fixture();
  concert.members = withMember(lib, concert, 's1', false);
  assert.deepEqual(concert.assign.s1, { '2way': '2' });
  concert.members = withMember(lib, concert, 's1', true);
  assert.equal(concertSingers(lib, concert).find((p) => p.id === 's1')['2way'], '2');
});

test('staleSeated names who an arrangement seats that the concert has not got', () => {
  const { lib, concert, arrangement } = fixture();
  assert.deepEqual(staleSeatedIds(concert, arrangement), [], 'nothing stale to start with');

  concert.members = withMember(lib, concert, 's2', false);
  assert.deepEqual(staleSeatedIds(concert, arrangement), ['s2']);
  assert.deepEqual(staleSeated(lib, concert, arrangement), [{ id: 's2', name: 'Bea', inRoster: true }]);

  // removed from the CHOIR, not just the concert: the name is gone with the record, and the
  // prompt has to say something honest rather than an id
  lib.rosters[0].singers = lib.rosters[0].singers.filter((p) => p.id !== 's2');
  assert.equal(staleSeated(lib, concert, arrangement)[0].inRoster, false);
  assert.ok(!staleSeated(lib, concert, arrangement)[0].name.includes('s2'));
});

test('a pinned singer counts as stale even when they are not seated', () => {
  const { lib, concert, arrangement } = fixture();
  arrangement.pins = ['s3'];
  arrangement.seats = [EMPTY, EMPTY, EMPTY, EMPTY];
  concert.members = withMember(lib, concert, 's3', false);
  assert.deepEqual(staleSeatedIds(concert, arrangement), ['s3']);
});

test('staleSeatedIds reports each person once, and ignores the sentinels', () => {
  const { lib, concert, arrangement } = fixture();
  arrangement.seats = ['s2', 's2', BLOCKED, EMPTY];
  arrangement.pins = ['s2'];
  concert.members = withMember(lib, concert, 's2', false);
  assert.deepEqual(staleSeatedIds(concert, arrangement), ['s2']);
});

test('withoutSingers empties their chairs in place and drops their pins', () => {
  const { arrangement } = fixture();
  arrangement.pins = ['s1', 's2'];
  const next = withoutSingers(arrangement, ['s2']);

  assert.deepEqual(next.seats, ['s1', EMPTY, EMPTY, 's3'], 'the others do not shuffle along');
  assert.deepEqual(next.pins, ['s1']);
  assert.deepEqual(arrangement.seats, ['s1', 's2', EMPTY, 's3'], 'the original is untouched');
  // every other field of the arrangement comes through, or opening it would lose a setting
  for (const f of ARRANGEMENT_FIELDS) assert.ok(f in next, f);
  assert.equal(next.id, arrangement.id);
  assert.equal(next.name, arrangement.name);
});

test('normaliseConcert drops a member the roster has lost, so a stale tick cannot persist', () => {
  const { lib } = fixture();
  lib.rosters[0].singers = lib.rosters[0].singers.filter((p) => p.id !== 's2');
  const out = normaliseLibrary(lib);
  assert.deepEqual(out.concerts[0].members.map((m) => m.singerId), ['s1', 's3']);
});

/* ---------- the seed ---------- */

const EXAMPLES = seedLibrary({ roster: EXAMPLE_ROSTER, concerts: EXAMPLE_CONCERTS });

test('the examples are one roster, and two concerts over it with two seating plans each', () => {
  assert.deepEqual(EXAMPLES.rosters.map((r) => r.name), ['Example Choir']);
  assert.deepEqual(EXAMPLES.concerts.map((c) => c.name), ["Schnittke's Concerto for Choir", 'Così fan tutte']);
  const [schnittke, cosi] = EXAMPLES.concerts;
  for (const c of EXAMPLES.concerts) assert.equal(c.rosterId, EXAMPLES.rosters[0].id);
  assert.deepEqual(schnittke.splits.map((s) => s.id), ['2way', '3way', '4way']);
  assert.deepEqual(cosi.splits.map((s) => s.id), ['2way']);
  assert.deepEqual(schnittke.arrangements.map((a) => a.name), ['Option 1', 'Option 2']);
  assert.deepEqual(cosi.arrangements.map((a) => a.name), ['Two lines', 'One line']);
});

test('Così fan tutte is sixteen of the roster and four guests, entering from both wings', () => {
  const cosi = EXAMPLES.concerts[1];
  assert.equal(cosi.members.length, 16);
  assert.deepEqual(cosi.guests.map((g) => g.name), ['Gavin Whitaker', 'Winston Kerr', 'Omar Pickering', 'Seb Laing']);
  const singers = concertSingers(EXAMPLES, cosi);
  assert.equal(singers.length, 20);
  assert.equal(singers.filter((p) => p.guest).length, 4);
  assert.ok(!EXAMPLES.rosters[0].singers.some((p) => cosi.guests.some((g) => g.name === p.name)), 'guests are not on the roster');
  assert.deepEqual(cosi.arrangements.map((a) => [a.rows, a.cols]), [[2, 10], [1, 20]]);
  for (const a of cosi.arrangements) {
    assert.equal(a.walkOn.enterFrom, 'both');
    // the aisle falls after the last soprano column, so the left queue is exactly the sopranos
    const order = walkOnOrder(a.seats, a.rows, a.cols, a.walkOn);
    const by = Object.fromEntries(singers.map((p) => [p.id, p]));
    assert.ok(order.queues.L.every((e) => by[e.name].section === 'Soprano'));
    assert.equal(order.queues.L.length, 8);
  }
});

test('every example concert has its own id', () => {
  const ids = EXAMPLES.concerts.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('the seed is ordinary library records, and its counter is past every id it holds', () => {
  assert.deepEqual(normaliseLibrary(JSON.parse(JSON.stringify(EXAMPLES))), EXAMPLES);
  const seed = seedLibrary({ roster: EXAMPLE_ROSTER, concerts: EXAMPLE_CONCERTS });
  const most = Math.max(...seed.rosters[0].singers.map((p) => Number(p.id.slice(1))));
  assert.ok(seed.seq > most, `seq ${seed.seq} must be past s${most}`);
  assert.ok(!seed.rosters[0].singers.some((p) => p.id === mintId(seed, 's')));
});

test('every example seating plan seats everyone and passes the neighbour check on every split', () => {
  for (const c of EXAMPLES.concerts)
    for (const a of c.arrangements) {
      const plan = concertPlan(EXAMPLES, c, a);
      const view = makePlanView(plan);
      assert.equal(plan.seats.filter(isSinger).length, plan.roster.length, `${c.name} / ${a.name} seats everyone`);
      const eng = view.engine();
      for (const key of [SECTION_KEY, ...view.SCH]) {
        const { stranded, broken } = eng.evaluate2D(plan.seats, plan.rows, key);
        assert.deepEqual(stranded, [], `${c.name} / ${a.name}: nobody isolated in ${key}`);
        assert.deepEqual(broken, [], `${c.name} / ${a.name}: no group split in ${key}`);
      }
    }
});

test('Option 2 is a visibly different seating from Option 1', () => {
  const moved = EXAMPLE_SEATS.filter((id, i) => id !== EXAMPLE_SEATS_2[i]).length;
  assert.ok(moved > EXAMPLE_SEATS.length / 2, `${moved} seats differ`);
});

/* ---------- guests ---------- */

function guestLibrary() {
  const lib = emptyLibrary();
  const r = makeRoster(lib, 'Choir', [
    { id: 's1', name: 'Ada', section: 'Soprano' },
    { id: 's2', name: 'Bea', section: 'Alto' }
  ]);
  lib.rosters.push(r);
  const c = makeConcert(lib, 'Gala', r, {
    splits: [{ id: '2way', name: '2-way', cats: ['1', '2'] }],
    assign: { s1: { '2way': '2' }, g1: { '2way': '2' } },
    guests: [{ id: 'g1', name: 'Gus', section: 'Bass' }]
  });
  c.arrangements.push(makeArrangement(lib, 'Plan 1', { rows: 1, cols: 3, seats: ['s1', 'g1', 's2'], pins: ['g1'] }));
  lib.concerts.push(c);
  return { lib, r, c };
}

test('a guest sings the concert without being on the roster', () => {
  const { lib, r, c } = guestLibrary();
  assert.ok(!r.singers.some((p) => p.id === 'g1'));
  const singers = concertSingers(lib, c);
  assert.deepEqual(singers.map((p) => p.id), ['s1', 's2', 'g1'], 'members in roster order, then guests');
  assert.equal(singers[2].guest, true);
  assert.equal(singers[2]['2way'], '2', 'a guest keeps their category');
  assert.equal(singers[0].guest, undefined);
  assert.deepEqual(staleSeatedIds(c, c.arrangements[0]), [], 'a seated guest is not stale');
});

test('guests and their categories survive normalisation; a guest whose id is on the roster does not', () => {
  const { lib, c } = guestLibrary();
  c.guests.push({ id: 's2', name: 'Impostor', section: 'Tenor' }, { id: 'g2', name: 'Nobody', section: 'Kazoo' });
  const out = normaliseLibrary(JSON.parse(JSON.stringify(lib)));
  assert.deepEqual(out.concerts[0].guests, [{ id: 'g1', name: 'Gus', section: 'Bass' }]);
  assert.deepEqual(out.concerts[0].assign.g1, { '2way': '2' });
  assert.deepEqual(normaliseLibrary({ rosters: lib.rosters, concerts: [{ ...c, guests: undefined }] }).concerts[0].guests, []);
});

test('moving a guest to the roster keeps their seat, pin and category under a roster id', () => {
  const { lib, r, c } = guestLibrary();
  assert.equal(moveGuestToRoster(lib, c, 'g1', 's3'), 's3');
  assert.deepEqual(r.singers.map((p) => p.id), ['s1', 's2', 's3']);
  assert.deepEqual(c.guests, []);
  assert.ok(isMember(c, 's3'));
  assert.deepEqual(c.assign.s3, { '2way': '2' });
  assert.equal(c.assign.g1, undefined);
  assert.deepEqual(c.arrangements[0].seats, ['s1', 's3', 's2']);
  assert.deepEqual(c.arrangements[0].pins, ['s3']);
  assert.equal(moveGuestToRoster(lib, c, 'g1', 's4'), null, 'no such guest any more');
});
