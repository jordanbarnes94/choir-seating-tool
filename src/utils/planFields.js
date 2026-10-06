/*
 * planFields — the validators and clamps that say what one plan's fields may legally hold.
 * Kept apart from utils/persistence.js so utils/library.js can use them; persistence.js
 * re-exports everything here.
 */
import { SECTIONS, DEFAULT_ROWS, isSinger, LIMITS } from './arranger.js';

// Grid-size bounds for the fixed rows×cols stage.
export const ROWS_MIN = 1, ROWS_MAX = 8, COLS_MIN = 1, COLS_MAX = 40;
export const clampRows = (n) => Math.max(ROWS_MIN, Math.min(ROWS_MAX, Math.round(n) || DEFAULT_ROWS));
export const clampCols = (n) => Math.max(COLS_MIN, Math.min(COLS_MAX, Math.round(n) || COLS_MIN));


// The viewpoint, and the second setting that travels with the saved plan. 'bottom' is what
// the app has always done: the AUDIENCE bar sits under the grid and you read the plan from the
// audience's side. 'top' puts the bar above the grid and rotates the drawing 180 degrees, which
// is the view from the stage. It lives here rather than in utils/labels.js on purpose:
// seatLabelFor() must never be able to reach it, because the coupling between viewpoint and
// labelling is a write at the control and not a derivation in the helper.
export const AUDIENCE_DEFAULT = 'bottom';
export const AUDIENCE_OPTIONS = ['bottom', 'top'];
export const validAudienceAt = (v) => AUDIENCE_OPTIONS.includes(v);
export const normaliseAudienceAt = (v) => (validAudienceAt(v) ? v : AUDIENCE_DEFAULT);


// a section order is valid iff it is a permutation of the four sections.
export function validSectionOrder(a) {
  return Array.isArray(a) && a.length === SECTIONS.length && SECTIONS.every((s) => a.includes(s));
}


/* ---------- validators ---------- */
// a name equal to a cell sentinel (EMPTY/BLOCKED) is rejected so a singer can never masquerade
// as an empty or blocked seat. isSinger(name) is false for both sentinels and non-strings.
export const validRosterRow = (p) => p && typeof p.name === 'string' && isSinger(p.name) && SECTIONS.includes(p.section);
export const validSplit = (s) =>
  s &&
  typeof s.id === 'string' &&
  typeof s.name === 'string' &&
  Array.isArray(s.cats) &&
  s.cats.length >= 1 &&
  s.cats.every((c) => typeof c === 'string');

// measure a bulk input against the solver-blowup limits. Returns the reason it is over, or
// null if it is fine. Split out from withinLimits so the preset restore path can apply the
// very same limits silently: one bad preset in a backup is skipped, not announced.
export function limitProblem(roster, theSplits) {
  if (roster.length > LIMITS.singers)
    return `That has ${roster.length} singers; the maximum is ${LIMITS.singers}. Trim the list and try again.`;
  if (theSplits.length > LIMITS.splits) return `That has ${theSplits.length} splits; the maximum is ${LIMITS.splits}.`;
  const over = theSplits.find((s) => s.cats.length > LIMITS.cats);
  if (over) return `The "${over.name}" split has ${over.cats.length} parts; the maximum is ${LIMITS.cats} per split.`;
  return null;
}

