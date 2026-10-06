/*
 * Tests for utils/plan.js — the plan field list, and the cross-read that keeps it honest.
 *
 * Run: npm test
 *
 * The bug this file exists to catch has landed three times (see the table in utils/plan.js):
 * a new plan-level field is added, something on the printed sheet reads it, and the object
 * BETWEEN them — the one the store hands to PlanSheet — never learns about it. Every unit test
 * passes, because each half is correct; only a human looking at paper can see it.
 *
 * So the test is not over a function. It reads `usePlanView.js`, `PlanSheet.vue` and the
 * `planPrintPages` function of `printPlan.js` as TEXT,
 * pulls out every field they read off a plan, and asserts PLAN_FIELDS declares all of them.
 * Teaching the sheet a new field therefore fails the suite until the field is declared, and
 * declaring it makes `buildPlan()` throw until the store has a source for it. Between the two
 * there is no way to add half of the feature.
 *
 * It is deliberately a grep and not a parse: a parser for a .vue SFC is a dependency, and this
 * module has none. The guards below (a minimum hit count per file) are what stops a rename of
 * the local variable turning the whole test into a no-op that passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ARRANGEMENT_FIELDS, PLAN_FIELDS, PLAN_SHARED_FIELDS, buildPlan, planOf } from '../src/utils/plan.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Every `<expr>.<field>` in `src` whose receiver is the plan, as named by `receiver`.
function fieldsRead(src, receiver) {
  const re = new RegExp(String.raw`\b${receiver}\.([A-Za-z_$][\w$]*)`, 'g');
  return new Set(Array.from(src.matchAll(re), (m) => m[1]));
}

test('PLAN_FIELDS covers every field makePlanView reads off a plan', () => {
  // `const p = preset || {}` is the plan inside makePlanView, so `p.<field>` is a plan read.
  const got = fieldsRead(read('../src/composables/usePlanView.js'), 'p');
  assert.ok(got.size >= 6, `expected makePlanView to read several plan fields, found ${[...got]}`);
  for (const f of got) assert.ok(PLAN_FIELDS.includes(f), `makePlanView reads plan.${f}, which PLAN_FIELDS does not declare`);
});

test('PLAN_FIELDS covers every field PlanSheet reads off the plan it was handed', () => {
  // The script reads it as `props.plan.X`; the template, where props are in scope bare, as `plan.X`.
  const [template, script] = read('../src/components/PlanSheet.vue').split('<script');
  const got = new Set([...fieldsRead(script, 'props\\.plan'), ...fieldsRead(template, 'plan')]);
  // Most of the layout reads moved into planPrintPages (below), so the sheet itself reads fewer.
  assert.ok(got.size >= 4, `expected PlanSheet to read several plan fields, found ${[...got]}`);
  for (const f of got) assert.ok(PLAN_FIELDS.includes(f), `PlanSheet reads plan.${f}, which PLAN_FIELDS does not declare`);
});

test('PLAN_FIELDS covers every field planPrintPages reads off the plan PlanSheet hands it', () => {
  // `const p = plan || {}` is the plan inside planPrintPages, so `p.<field>` is a plan read.
  const src = read('../src/utils/printPlan.js');
  const start = src.indexOf('export function planPrintPages');
  assert.ok(start >= 0, 'expected printPlan.js to export planPrintPages');
  // up to the function's closing brace, in either line ending
  const body = src.slice(start).split(/\r?\n\}\r?\n/)[0];
  const got = fieldsRead(body, 'p');
  assert.ok(got.size >= 6, `expected planPrintPages to read several plan fields, found ${[...got]}`);
  for (const f of got) assert.ok(PLAN_FIELDS.includes(f), `planPrintPages reads plan.${f}, which PLAN_FIELDS does not declare`);
});

test('the store lists a source for every plan field, and the two halves of the split partition it', () => {
  // The store's builder call is the other end of the seam: buildPlan throws on a missing field
  // at runtime, and this catches it in the suite instead of on somebody's first print.
  const src = read('../src/composables/useChoirArranger.js');
  const call = /buildPlan\(\{([\s\S]*?)\n {4}\}\)/.exec(src);
  assert.ok(call, 'expected useChoirArranger to build the live plan with buildPlan({ … })');
  const sources = fieldsRead(call[1].replace(/^\s*/gm, 'SRC.'), 'SRC');
  for (const f of PLAN_FIELDS) assert.ok(sources.has(f), `the store has no source for plan field "${f}"`);
});

test('buildPlan refuses a plan with a field missing, and unwraps getters', () => {
  const sources = Object.fromEntries(PLAN_FIELDS.map((f) => [f, f]));
  assert.deepEqual(buildPlan(sources), sources);

  const lazy = Object.fromEntries(PLAN_FIELDS.map((f) => [f, () => f.toUpperCase()]));
  assert.deepEqual(buildPlan(lazy), Object.fromEntries(PLAN_FIELDS.map((f) => [f, f.toUpperCase()])));

  for (const missing of PLAN_FIELDS) {
    const partial = { ...sources };
    delete partial[missing];
    assert.throws(() => buildPlan(partial), new RegExp(`no source for plan field "${missing}"`));
  }
  // a source whose VALUE is undefined is still a source: absent is the failure, not empty.
  assert.doesNotThrow(() => buildPlan(Object.fromEntries(PLAN_FIELDS.map((f) => [f, undefined]))));
});

test('the arrangement split partitions a plan, and planOf joins the layers back', () => {
  // A plan field is the roster's, the concert's, the colour scheme's, or one arrangement's — it
  // cannot be none of them, and it cannot be two.
  assert.deepEqual([...ARRANGEMENT_FIELDS, ...PLAN_SHARED_FIELDS].sort(), [...PLAN_FIELDS].sort());
  assert.equal(ARRANGEMENT_FIELDS.filter((f) => PLAN_SHARED_FIELDS.includes(f)).length, 0);
  assert.deepEqual([...PLAN_SHARED_FIELDS], ['roster', 'splits', 'colours', 'splitColours']);

  const roster = [{ id: 's1', name: 'Ada', section: 'Alto' }];
  const splits = [{ id: '2way', name: '2-way', cats: ['1', '2'] }];
  const arrangement = { id: 'a1', name: 'Version A', seats: ['s1'], rows: 1, cols: 1 };
  const scheme = { colours: { Alto: '#123456' }, splitColours: {} };
  const plan = planOf(roster, splits, { ...arrangement, colours: { Alto: '#ffffff' } }, scheme);
  assert.equal(plan.roster, roster);
  assert.equal(plan.splits, splits);
  assert.deepEqual(plan.seats, ['s1']);
  assert.equal(plan.colours, scheme.colours, 'the colours come from the scheme, never the arrangement');
  assert.ok(!('id' in plan) && !('name' in plan), 'an arrangement\u2019s identity is not plan data');
  assert.deepEqual(planOf(), { roster: [], splits: [], colours: {}, splitColours: {} }, 'and nothing throws on nothing');
});
