/*
 * plan — what a PLAN is, in one place.
 *
 * A "plan" is the preset-shaped object that `makePlanView()` takes and `PlanSheet` draws:
 * the roster, the splits, the seating, and every setting that travels with a saved plan. It is
 * assembled in several places — the live store (`livePlan`), a stored arrangement joined back to
 * its roster and concert (`concertPlan` in utils/library.js), and the working copy that `save()`
 * and `backupJSON()` write — and before this module existed each kept its own hand-written list
 * of the fields.
 *
 * THAT COST US THE SAME BUG FOUR TIMES, in one afternoon, and it is the reason this file exists:
 *
 *   | missing from livePlan | what the printed sheet did          |
 *   |-----------------------|-------------------------------------|
 *   | `colours`             | printed the DEFAULT palette         |
 *   | `walkOn`              | had no walk-on list to draw         |
 *   | `splitColours`        | right fills, wrong frames           |
 *
 * Every one was two correct features that had never met: A added a plan-level field, B read it
 * on the sheet, both were green, and the object between them knew about neither. Every
 * new plan-level field would meet the same seam, so it is closed here.
 *
 * The closure has two halves, and both are needed:
 *
 *  1. `PLAN_FIELDS` is the list, and `buildPlan()` REFUSES to build a plan with a field missing
 *     from its sources. So adding a name here and nothing else breaks the store loudly at the
 *     first call rather than quietly at the printer.
 *  2. `test/plan.test.js` cross-reads `usePlanView.js` and `PlanSheet.vue` for the fields
 *     they actually read off a plan and fails if any of them is not in this list. So teaching
 *     the sheet a new field fails the suite until the field is declared here — which is the
 *     direction all three bugs above came from.
 *
 * Pure in the same sense as the rest of `utils/`: plain functions over plain data, no Vue and no
 * DOM, so `node --test` can reach it.
 */

/**
 * Every field of a plan, in the order they are written. A field belongs here as soon as it is
 * plan data — i.e. as soon as a saved preset would carry it and a second plan drawn on screen or
 * on paper would be wrong without it.
 */
export const PLAN_FIELDS = Object.freeze([
  'roster',
  'splits',
  'seats',
  'rows',
  'cols',
  'pins',
  'sectionOrder',
  'labels',
  'audienceAt',
  'colours',
  'splitColours',
  'walkOn'
]);

/**
 * The plan fields that belong to a layer ABOVE the arrangement: the singers are the roster's, the
 * splits are the concert's, and the colours are the active colour scheme's (global — see
 * utils/palettes.js). Everything else a plan carries is one arrangement's own.
 */
export const PLAN_SHARED_FIELDS = Object.freeze(['roster', 'splits', 'colours', 'splitColours']);

/**
 * ...and therefore what an ARRANGEMENT owns, derived rather than listed: a new plan-level field
 * becomes part of an arrangement — and so is saved, restored, copied and compared — by being
 * declared in PLAN_FIELDS and nowhere else.
 *
 * An arrangement additionally carries an `id` and a `name`, which are not plan data: they
 * identify the record inside its concert and never reach the drawing.
 */
export const ARRANGEMENT_FIELDS = Object.freeze(PLAN_FIELDS.filter((f) => !PLAN_SHARED_FIELDS.includes(f)));

/**
 * Join the layers back into the one PLAN that `makePlanView()` and `PlanSheet` take.
 *
 * This is deliberately the only place the join happens: a component that draws a concert's
 * arrangement is handed a plan and never has to know that the singers come from the roster, the
 * splits from the concert and the colours from the active scheme.
 *
 * @param {object[]} roster      the concert's singers, already joined to their split categories
 * @param {object[]} splits      the concert's splits list
 * @param {object} arrangement   one arrangement record
 * @param {object} [scheme]      the colour scheme to paint with: `{ colours, splitColours }`
 * @returns {object} a plan
 */
export function planOf(roster, splits, arrangement, scheme) {
  const out = {
    roster: roster || [],
    splits: splits || [],
    colours: (scheme && scheme.colours) || {},
    splitColours: (scheme && scheme.splitColours) || {}
  };
  for (const f of ARRANGEMENT_FIELDS) if (arrangement && arrangement[f] !== undefined) out[f] = arrangement[f];
  return out;
}

/**
 * Build a plan from a map of sources, one per field in PLAN_FIELDS. A source is either a value
 * or a zero-argument getter (the store passes getters, so a plan is re-read fresh every time the
 * computed re-evaluates).
 *
 * THROWS on a missing field. That is the whole point: the alternative is an object-literal whose
 * omissions are invisible until something downstream draws the wrong thing.
 *
 * @param {Record<string, unknown|(() => unknown)>} sources
 * @returns {object} a plan
 */
export function buildPlan(sources) {
  const src = sources || {};
  const out = {};
  for (const f of PLAN_FIELDS) {
    if (!(f in src)) throw new Error(`buildPlan: no source for plan field "${f}"`);
    const v = src[f];
    out[f] = typeof v === 'function' ? v() : v;
  }
  return out;
}
