// makePlanView(preset, view) — the store's derived globals, re-expressed as a pure function
// of a preset object.
//
// `useChoirArranger` derives `byId`, `SCH`, `SCH_LABEL`, `CAT_INDEX`, `pinnedSet`, `engine()`
// and `stageStranded` from the live reactive state (its `/* ---------- derived globals ----------
// */` block). Anything that has to draw a *second* plan — a preview, print,
// the walk-on list — needs the same seven values for a plan that is not the live one, and there
// is only ever one store: `createStore` is module-private and `useChoirArranger()` memoises a
// single instance. So the derivation is lifted here as a plain function.
//
// It is pure in the strict sense: no store, no refs, no reactivity. Call it again when the
// preset changes; the result is a snapshot of plain values, and every field is the unwrapped
// equivalent of the store's ref of the same name, which is what lets `SeatGrid` accept either
// through one `plan` prop.
//
// A preset carries no `ui` state, so the colour-by split cannot come out of it: it is the second
// argument. It is coerced to `SECTION_VIEW` when this preset's splits do not define it, exactly
// as the store's `adoptArrangement` coerces `ui.view` when an opened plan lacks the live one.
import {
  DEFAULT_ROWS,
  SECTION_KEY,
  SECTION_VIEW,
  STAGE_ORDER,
  deriveSplitGlobals,
  makeEngine,
  resolveSectionColours,
  resolveSplitFrames,
  rosterById
} from '../utils/arranger.js';

/**
 * @param {object} preset  a preset-shaped plan: { roster, splits, seats, rows, cols, sectionOrder, pins?, colours? }.
 *                         Built-in presets carry no `pins`; every field is treated as optional.
 *                         `colours` and `splitColours` are the plan's own palette overrides.
 * @param {string} view    the split id to colour by, or SECTION_VIEW. Defaults to SECTION_VIEW.
 * @returns {{ byId, SCH, SCH_LABEL, CAT_INDEX, pinnedSet, sectionColours, splitFrames, engine, stranded, ui: { view } }}
 */
export function makePlanView(preset, view = SECTION_VIEW) {
  const p = preset || {};
  const roster = p.roster || [];
  const splits = p.splits || [];
  const seats = p.seats || [];
  const rows = p.rows || DEFAULT_ROWS;
  const order = p.sectionOrder ? p.sectionOrder.slice() : [...STAGE_ORDER];

  const { SCH, SCH_LABEL, CAT_INDEX } = deriveSplitGlobals(splits);

  // Keyed by id, exactly as the store's own `byId` is: `seats` and `pins` hold
  // ids, and the name is resolved by whoever draws the cell.
  const byId = rosterById(roster);

  const pinnedSet = new Set(p.pins || []);

  // The plan's own section colours, resolved against the defaults exactly as the
  // store's `sectionColours` is. A plan drawn here is drawn in ITS colours, not in the live
  // plan's: a reference pane showing last term's seating in this term's palette would be
  // quietly wrong about what it is showing.
  const sectionColours = resolveSectionColours(p.colours);
  // ...and its own split frame colours, for the same reason and it is not optional: the frames
  // are the half of the colour system that SURVIVES a mono print, so a printed sheet drawing
  // different frames from the screen would be wrong in exactly the place paper can still show.
  const splitFrames = resolveSplitFrames(sectionColours, p.splitColours);

  // a plan can only be coloured by a split it actually has.
  const v = view !== SECTION_VIEW && !SCH.includes(view) ? SECTION_VIEW : view;

  // a fresh engine bound to this plan, matching the store's `engine()` in both shape and cost.
  const engine = () => makeEngine({ DATA: roster, byId, SCH, seats, pinned: pinnedSet, order });

  // the plan's "alone" set: anyone isolated from their section, plus anyone isolated in the
  // colour-by split. Mirrors the store's `stageStranded`.
  let stranded = new Set();
  if (seats.length) {
    const eng = engine();
    stranded = new Set(eng.evaluate2D(seats, rows, SECTION_KEY).stranded);
    if (v !== SECTION_VIEW) eng.evaluate2D(seats, rows, v).stranded.forEach((n) => stranded.add(n));
  }

  return { byId, SCH, SCH_LABEL, CAT_INDEX, pinnedSet, sectionColours, splitFrames, engine, stranded, ui: { view: v } };
}
