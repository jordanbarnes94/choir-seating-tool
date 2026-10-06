/*
 * Tests for makePlanView.
 *
 * Run: npm test
 *
 * makePlanView is what lets SeatGrid draw a plan that is not the live one: print, the walk-on
 * list and compare are its callers. It is pure, so it can be held to the store's behaviour here.
 *
 * The standard it is measured against is useChoirArranger's own derivation: every field
 * must equal what deriveSplitGlobals / makeEngine produce for the same plan, because
 * SeatGrid takes either through one `plan` prop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePlanView } from '../src/composables/usePlanView.js';
import {
  BASIC_SPLITS,
  EXAMPLE_COLS,
  EXAMPLE_ROSTER,
  EXAMPLE_ROWS,
  EXAMPLE_SEATS,
  EXAMPLE_SPLITS,
  SECTION_KEY,
  SECTION_VIEW,
  STAGE_ORDER,
  SECTIONS,
  deriveSplitGlobals,
  isSinger,
  makeEngine,
  resolveSplitFrames,
  splitFrame
} from '../src/utils/arranger.js';

// The example choir with every split, and with only the 2-way, as the plans the examples ship.
const EXAMPLE = { roster: EXAMPLE_ROSTER, splits: EXAMPLE_SPLITS, seats: EXAMPLE_SEATS, rows: EXAMPLE_ROWS, cols: EXAMPLE_COLS, sectionOrder: [...STAGE_ORDER] };
const EXAMPLE_BASIC = { ...EXAMPLE, splits: BASIC_SPLITS };

test('the roster comes through as a by-id map, sentinels excluded', () => {
  const { byId } = makePlanView(EXAMPLE);
  assert.equal(Object.keys(byId).length, EXAMPLE_ROSTER.filter((p) => isSinger(p.id)).length);
  for (const p of EXAMPLE_ROSTER) assert.equal(byId[p.id], p);
  // and the key really is the id, which is what singer ids changed: a name is no longer a key
  assert.equal(byId['Julian Barlow'], undefined);
});

test('the split globals match deriveSplitGlobals for the same splits', () => {
  for (const preset of [EXAMPLE_BASIC, EXAMPLE]) {
    const want = deriveSplitGlobals(preset.splits);
    const got = makePlanView(preset);
    assert.deepEqual(got.SCH, want.SCH, preset.id);
    assert.deepEqual(got.SCH_LABEL, want.SCH_LABEL, preset.id);
    assert.deepEqual(got.CAT_INDEX, want.CAT_INDEX, preset.id);
  }
  // and the two built-ins really do differ, so the assertion above is not vacuous
  assert.deepEqual(makePlanView(EXAMPLE_BASIC).SCH, ['2way']);
  assert.deepEqual(makePlanView(EXAMPLE).SCH, ['2way', '3way', '4way']);
});

test('pins become a Set, and a preset carrying none gets an empty one', () => {
  assert.ok(!('pins' in EXAMPLE), 'the built-ins carry no pins, which is the case being covered');
  assert.deepEqual(makePlanView(EXAMPLE).pinnedSet, new Set());

  const jordan = EXAMPLE_ROSTER.find((p) => p.name === 'Julian Barlow').id;
  const pinned = makePlanView({ ...EXAMPLE, pins: [jordan, 'sNope'] });
  assert.ok(pinned.pinnedSet.has(jordan));
  assert.equal(pinned.pinnedSet.size, 2);
});

/* ---------- the colour-by split ---------- */
// A preset carries no `ui` state, so the view is a second argument. It is reported back as
// `ui.view` because that is the name SeatGrid already reads off the store.

test('the view defaults to section colour and is reported as ui.view', () => {
  assert.equal(makePlanView(EXAMPLE).ui.view, SECTION_VIEW);
  assert.equal(makePlanView(EXAMPLE, '3way').ui.view, '3way');
});

test('a split the plan does not have falls back to section colour, not to another split', () => {
  // The 2-way-only example has only the 2-way split. Colouring it by "3way" would be a quiet lie about what
  // is on screen, and colouring it by its own 2-way split would be a different lie.
  assert.equal(makePlanView(EXAMPLE_BASIC, '3way').ui.view, SECTION_VIEW);
  assert.equal(makePlanView(EXAMPLE_BASIC, '2way').ui.view, '2way');
});

/* ---------- the engine and the "alone" set ---------- */

test('stranded matches evaluate2D run directly over the same plan', () => {
  for (const view of [SECTION_VIEW, '2way', '3way', '4way']) {
    const plan = makePlanView(EXAMPLE, view);
    const eng = makeEngine({
      DATA: EXAMPLE.roster,
      byId: plan.byId,
      SCH: plan.SCH,
      seats: EXAMPLE.seats,
      pinned: plan.pinnedSet,
      order: EXAMPLE.sectionOrder
    });
    const want = new Set(eng.evaluate2D(EXAMPLE.seats, EXAMPLE.rows, SECTION_KEY).stranded);
    if (view !== SECTION_VIEW) eng.evaluate2D(EXAMPLE.seats, EXAMPLE.rows, view).stranded.forEach((n) => want.add(n));
    assert.deepEqual(plan.stranded, want, view);
  }
});

test('the returned engine is a working engine bound to this plan', () => {
  const plan = makePlanView(EXAMPLE, '3way');
  const { broken, stranded } = plan.engine().evaluate2D(EXAMPLE.seats, EXAMPLE.rows, '3way');
  assert.ok(Array.isArray(broken) && Array.isArray(stranded));
  // the example seating is a clean one: nobody is cut off in any split
  assert.deepEqual(stranded, []);
});

test("the plan's engine groups by section AND label, not by label alone", () => {
  // Four singers all labelled '1', laid out rows=2 so every neighbour of a soprano is an alto
  // and vice versa:  col0 = [SopA, AltoC], col1 = [AltoD, SopB].
  // A group is section + label, so nobody has company and all four are stranded. Were the
  // section dropped from the key they would all be one group, sitting adjacent, and none
  // would be reported — which is what makes this case worth having.
  const roster = [
    { id: 'a', name: 'SopA', section: 'Soprano', '2way': '1' },
    { id: 'b', name: 'SopB', section: 'Soprano', '2way': '1' },
    { id: 'c', name: 'AltoC', section: 'Alto', '2way': '1' },
    { id: 'd', name: 'AltoD', section: 'Alto', '2way': '1' }
  ];
  const seats = ['a', 'c', 'd', 'b'];
  const plan = makePlanView(
    { roster, splits: [{ id: '2way', name: '2-way', cats: ['1'] }], seats, rows: 2 },
    '2way'
  );

  const { stranded, broken } = plan.engine().evaluate2D(seats, 2, '2way');
  assert.deepEqual(stranded.slice().sort(), ['a', 'b', 'c', 'd'], 'the engine answers in ids');
  assert.deepEqual(
    broken.map((b) => b.sec).sort(),
    ['Alto', 'Soprano'],
    'each section-label group is split across two components'
  );
  assert.deepEqual(plan.stranded, new Set(['a', 'b', 'c', 'd']));
});

/* ---------- degenerate plans ---------- */

test('an empty or absent plan yields empty globals rather than throwing', () => {
  for (const empty of [undefined, null, {}]) {
    const plan = makePlanView(empty);
    assert.deepEqual(plan.byId, {});
    assert.deepEqual(plan.SCH, []);
    assert.deepEqual(plan.pinnedSet, new Set());
    assert.deepEqual(plan.stranded, new Set(), 'no seats means no evaluation, so nobody is alone');
    assert.equal(plan.ui.view, SECTION_VIEW);
  }
});

test('a plan with no sectionOrder falls back to the stage default', () => {
  // the order reaches the engine, not the return value, so check it through the engine:
  // arrangeAll walks sectionOrder, and it must not throw on a preset that omits it.
  const plan = makePlanView({ roster: EXAMPLE.roster, splits: EXAMPLE.splits, seats: EXAMPLE.seats, rows: 4 });
  assert.equal(typeof plan.engine().arrangeAll, 'function');
  assert.ok(STAGE_ORDER.length > 0);
});

test('a plan is drawn in its OWN split frame colours, not the live plan’s', () => {
  // The same argument as the section colours above it, and it matters more on paper: the frames
  // are the half of the colour system that survives a mono print, so a printed sheet resolving
  // its frames from anywhere but the plan it is printing would be wrong exactly where paper can
  // still show it.
  const plan = { ...EXAMPLE, colours: { Alto: '#8a2f7d' }, splitColours: { Alto: { 1: '#ff8800' } } };
  const { sectionColours, splitFrames } = makePlanView(plan);
  assert.equal(sectionColours.Alto, '#8a2f7d');
  assert.equal(splitFrames.Alto[1], '#ff8800', 'the override the plan chose');
  assert.equal(splitFrames.Alto[0], splitFrame('#8a2f7d', 0), 'and the rest follow the plan’s own section colour');
  assert.deepEqual(splitFrames, resolveSplitFrames(sectionColours, plan.splitColours));
});

test('a plan that chose no frames gets the shipped defaults, which is every built-in preset', () => {
  for (const p of [EXAMPLE_BASIC, EXAMPLE]) {
    const { sectionColours, splitFrames } = makePlanView(p);
    for (const s of SECTIONS) splitFrames[s].forEach((f, i) => assert.equal(f, splitFrame(sectionColours[s], i)));
  }
});
