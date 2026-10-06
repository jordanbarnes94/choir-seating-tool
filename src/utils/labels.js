/*
 * labels: the pure half of seat labelling.
 *
 * There is exactly ONE place in this app that turns a seat into a name the user can read, and
 * this is it. Four things consume it (the viewpoint, the seating spreadsheet,
 * the printed plan, the walk-on list) and none of them may format a label of its own:
 * four call sites inventing four conventions is precisely how a printed plan and an exported
 * spreadsheet end up disagreeing about which chair is which.
 *
 * Like utils/arranger.js and utils/persistence.js this module is plain functions over plain
 * data, with no Vue and no DOM, so it is loadable by a bare `node` script and testable under
 * `node --test` (see test/labels.test.js). useChoirArranger.js binds it to the live grid
 * and exposes `seatLabel(i)`.
 *
 * Two rules are load-bearing and are stated here because they are easy to "tidy" away:
 *
 *  1. Labelling is PURELY COSMETIC. Nothing here touches the `seats` array, a seat index, the
 *     solver, pins or a drop target. The internal model is unchanged throughout: `seats` is
 *     column-major, so row is `i % rows` with row 0 physically at the FRONT (nearest the
 *     audience) and column is `Math.floor(i / rows)` counting from the stage's left as stored.
 *     The four settings only decide what those two numbers are *called*.
 *
 *  2. EVERY LABEL IS MEASURED ON THE DRAWING, AS THE USER LOOKS AT IT.
 *
 *     `colOrder: 'ltr'` means column 1 is at the left OF THE PICTURE, and `rowFirst: 'top'`
 *     means row 1 is along the top OF THE PICTURE. Both axes therefore take `audienceAt` as an
 *     argument, and the label grid is nailed to the drawing: A-1 is the same corner of the
 *     picture whichever side the audience is on, and rotating the plan slides the singers around
 *     underneath it.
 *
 *     (Jordan, 2026-09-11: *"left-to-right for column orders means left-to-right, it doesn't
 *     depend on STAGE-left to right"*, and then: *"bring the first row position in line with the
 *     left-to-right concept that it's 'as the user looks' so it could be first row top/bottom"*.
 *     The row axis was 'front'/'back' OF THE STAGE for a day in between, before the concert-model
 *     release reset the stored shape.)
 *
 *     This REVERSES the rule of 2026-09-02, which was that nothing here ever reads the viewpoint
 *     and that flipping it instead WROTE `rowFirst` and `colOrder`. That write is gone: it
 *     silently overwrote a setting the user had chosen, and it made "left to right" mean
 *     whichever way the stage happened to be facing. The viewpoint is now an explicit argument
 *     and never a field of the settings object, so the two cannot be confused — and a caller
 *     that omits it gets the default viewpoint, which is the identity.
 *
 *     The consequence is real and is the accepted cost: the chair a singer is sitting in is named
 *     from the picture, so in a 4x12 plan the singer in `A-1` seen from the audience is in `D-12`
 *     seen from the stage. Whatever prints a plan therefore has to state the viewpoint it was
 *     drawn from, which is what the printed plan's one-line header already does.
 */

// The four independent settings, their legal values, and their defaults. They travel WITH THE
// SAVED PLAN rather than with the user, because a labelling scheme describes a venue and the
// venue belongs to the plan: one hall letters its seats and the next numbers them.
export const LABEL_OPTIONS = Object.freeze({
  rowLabel: ['letters', 'numbers'], // how a row is written
  rowFirst: ['top', 'bottom'], // which end OF THE DRAWING counts as row 1 / row A
  colLabel: ['letters', 'numbers'], // how a column is written
  colOrder: ['ltr', 'rtl'] // which side OF THE DRAWING column 1 / column A is on
});

// The defaults are today's most ordinary convention (rows lettered up from the bottom of the
// picture, columns numbered from its left) and, just as importantly, they are what an absent
// field means. A plan saved before this feature existed carries none of these keys and must
// render exactly as it did, so "absent" resolves here and nowhere else. `rowFirst: 'bottom'` is
// the same drawing the old 'front' default produced under the default viewpoint: audience below,
// row A along the front row at the foot of the picture.
export const LABEL_DEFAULTS = Object.freeze({
  rowLabel: 'letters',
  rowFirst: 'bottom',
  colLabel: 'numbers',
  colOrder: 'ltr'
});

// ALWAYS a separator, never only when both axes are letters. `B-7`, `7-C`, `7-3`, `B-C`. Decided
// by Jordan on 2026-09-02: `B-7` reads a shade worse than `B7` would, and that is accepted in
// exchange for one format rule with no branch in it, here or in any of the four consumers.
export const LABEL_SEP = '-';

/**
 * Spreadsheet-style letters for a 0-based index: A, B, … Z, AA, AB, … The grid allows 40 columns
 * (COLS_MAX in utils/persistence.js), so the AA range is reachable in normal use rather than
 * theoretical, which is why this is bijective base-26 and not a single letter that runs out.
 * @param {number} n 0-based index
 * @returns {string} the letters, or '' for anything that is not a non-negative number
 */
export function alphaLabel(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  let i = Math.floor(n), s = '';
  // Bijective base-26: there is no "zero digit", so each step takes one off the quotient.
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

/**
 * Coerce anything that claims to be a settings object into a complete, legal one. Field by
 * field, because a plan can arrive from a backup written by any earlier version of the app (or
 * hand-edited), so one bad field must not cost the other three.
 * @param {object} raw
 * @returns {{ rowLabel: string, rowFirst: string, colLabel: string, colOrder: string }}
 */
export function normaliseLabels(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of Object.keys(LABEL_DEFAULTS)) out[k] = LABEL_OPTIONS[k].includes(src[k]) ? src[k] : LABEL_DEFAULTS[k];
  return out;
}

// One axis, one rule, shared by both axes. `i` is the 0-based index in stored order, `n` the
// axis length, `reverse` true when the setting counts from the other end, `letters` true when
// the axis is lettered.
function axisLabel(i, n, reverse, letters) {
  const k = reverse ? n - 1 - i : i;
  return letters ? alphaLabel(k) : String(k + 1);
}

/**
 * The label for one stage row. `r` is the internal row index, 0 = the front row (nearest the
 * audience).
 *
 * `rowFirst` names an end of the DRAWING, so this converts the stored row into the display row
 * first: with the audience below, the front row is drawn at the BOTTOM of the picture, and with
 * the audience above it is drawn at the top. See rule 2 at the top.
 *
 * @param {string} [audienceAt] 'top' when the audience is drawn above the plan; anything else
 *                              (including omitted) means the default 'bottom'.
 */
export function rowLabelAt(r, rows, settings, audienceAt) {
  const s = normaliseLabels(settings);
  const dr = audienceAt === 'top' ? r : rows - 1 - r;
  return axisLabel(dr, rows, s.rowFirst === 'bottom', s.rowLabel === 'letters');
}

/**
 * The label for one stage column. `c` is the internal column index, 0 = leftmost AS STORED.
 *
 * `colOrder` is measured on the DRAWING, so this converts the stored column into the display
 * column first: with the audience above, the plan is rotated and stored column 0 is drawn at the
 * right. That is why this takes the viewpoint and `rowLabelAt` does not — see rule 2 at the top.
 *
 * @param {string} [audienceAt] 'top' when the audience is drawn above the plan; anything else
 *                              (including omitted) means the default 'bottom', where the display
 *                              column and the stored column are the same.
 */
export function colLabelAt(c, cols, settings, audienceAt) {
  const s = normaliseLabels(settings);
  const dc = audienceAt === 'top' ? cols - 1 - c : c;
  return axisLabel(dc, cols, s.colOrder === 'rtl', s.colLabel === 'letters');
}

/**
 * The shared seat name. This is the function every consumer calls.
 * @param {number} i    seat index into the column-major `seats` array
 * @param {number} rows grid depth
 * @param {number} cols grid width
 * @param {object} settings the four fields; absent or invalid ones fall back to LABEL_DEFAULTS
 * @param {string} [audienceAt] the viewpoint the plan is drawn from, which BOTH halves of the
 *                              name are measured against. Omitted means 'bottom'.
 * @returns {string} e.g. 'B-7', or '' when `i` is not a cell of a rows*cols grid
 */
export function seatLabelFor(i, rows, cols, settings, audienceAt) {
  if (!Number.isFinite(i) || !Number.isFinite(rows) || !Number.isFinite(cols)) return '';
  if (rows < 1 || cols < 1 || i < 0 || i >= rows * cols) return '';
  const s = normaliseLabels(settings);
  return rowLabelAt(i % rows, rows, s, audienceAt) + LABEL_SEP + colLabelAt(Math.floor(i / rows), cols, s, audienceAt);
}
