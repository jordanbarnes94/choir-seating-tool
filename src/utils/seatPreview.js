/*
 * seatPreview: the pure half of the Settings panel's mini plan.
 *
 * The Settings panel holds five controls whose only visible effect used to be on the stage
 * BEHIND the dialog, which you cannot see while the dialog is open. This module lays out a small
 * picture of the same plan so the panel can draw it beside the controls: no singers, no colours,
 * just the audience, the row and column headings, and which chair counts first.
 *
 * Like utils/arranger.js, utils/persistence.js and utils/labels.js this is plain functions over
 * plain data, with no Vue and no DOM, so it is loadable by a bare `node` script and testable under
 * `node --test` (see test/seat-preview.test.js). components/LabelPreview.vue draws it and
 * turns clicks into the two store writes.
 *
 * Three rules are load-bearing:
 *
 *  1. It lives OUTSIDE utils/labels.js, which formats one name at a time and knows nothing about
 *     a picture: what belongs here is the LAYOUT — which chair is drawn where, and which end of
 *     the drawing each axis counts from. Every name still comes from labels.js, viewpoint and
 *     all (see its rule 2: rows are named physically, columns as drawn).
 *
 *  2. It draws whatever grid it is handed. The Settings panel hands it `SAMPLE_ROWS` x
 *     `SAMPLE_COLS`, a fixed representative plan, so the picture shows what each setting does
 *     however many singers the concert has. Grids wider than `PREVIEW_MAX_COLS` lose their
 *     MIDDLE columns, because the ends are the half that carries the meaning.
 *
 *  3. It reproduces the stage's own two placement rules rather than inventing a third:
 *       - display slot k sits at column floor(k / rows), and at visual row rows-1-(k % rows)
 *         counting from the top      (SeatGrid.vue's posStyle)
 *       - the true seat index is k, or N-1-k when the audience is above  (StageView.vue's
 *         reverse(), which is the 180-degree rotation of a column-major array)
 *     test/seat-preview.test.js pins both, so the preview cannot drift from the drawing.
 */
import { colLabelAt, normaliseLabels, rowLabelAt, seatLabelFor } from './labels.js';
import { clampCols, clampRows, normaliseAudienceAt } from './persistence.js';

// Above this many columns the preview keeps `END_COLS` at each end and drops the middle into one
// gap cell. 40 chairs across (COLS_MAX) will not fit in a settings panel, and the two ends are
// what the four labelling settings are actually about.
export const PREVIEW_MAX_COLS = 6;
// The representative plan the Settings panel draws: deep and wide enough that every labelling
// setting visibly moves something, and narrow enough to draw every column.
export const SAMPLE_ROWS = 4, SAMPLE_COLS = 6;
const END_COLS = 2;

/**
 * The name of the chair the labelling counts from: first row, first column, whichever ends those
 * are. Never reads the viewpoint — rotating the drawing moves this chair around the picture but
 * does not rename it.
 * @returns {string} e.g. 'A-1'
 */
export function startSeatLabel(rows, cols, labels, audienceAt) {
  const r = clampRows(rows), c = clampCols(cols), s = normaliseLabels(labels);
  const at = normaliseAudienceAt(audienceAt), top = at === 'top';
  // Both settings name an end of the DRAWING, so this is a display corner: convert it back to a
  // stored seat, which is what the shared helper names. With the audience above, the top of the
  // picture is the front row and its left is the last stored column.
  const dr0 = s.rowFirst === 'top' ? 0 : r - 1;
  const dc0 = s.colOrder === 'ltr' ? 0 : c - 1;
  const r0 = top ? dr0 : r - 1 - dr0;
  const c0 = top ? c - 1 - dc0 : dc0;
  return seatLabelFor(c0 * r + r0, r, c, s, at);
}

/**
 * Lay the mini plan out, top row first.
 *
 * @param {number} rows  the plan's depth
 * @param {number} cols  the plan's width
 * @param {object} labels the four labelling fields; absent or invalid ones fall back to defaults
 * @param {string} audienceAt 'bottom' or 'top'; anything else means the default
 * @param {number} [maxCols] columns to draw before the middle is dropped
 * @returns {{
 *   rows: number, cols: number, audienceTop: boolean, startLabel: string,
 *   rowHeads: Array<{ r: number, text: string, start: boolean }>,
 *   colHeads: Array<{ c: number, text: string, start: boolean } | { gap: true }>,
 *   grid: Array<Array<{ gi: number, label: string, start: boolean } | { gap: true }>>
 * }}
 */
export function previewLayout(rows, cols, labels, audienceAt, maxCols = PREVIEW_MAX_COLS) {
  const r = clampRows(rows), c = clampCols(cols);
  const lab = normaliseLabels(labels);
  const at = normaliseAudienceAt(audienceAt);
  const audienceTop = at === 'top';
  const n = r * c;

  // the rotation, and the only place the viewpoint is applied.
  const giAt = (k) => (audienceTop ? n - 1 - k : k);

  // Which end of each axis counts first, both as positions IN THE PICTURE (utils/labels.js rule
  // 2). Both are ends, always, so dropping the middle columns below can never hide the chair the
  // labelling starts from.
  const firstDisplayRow = lab.rowFirst === 'top' ? 0 : r - 1;
  const firstDisplayCol = lab.colOrder === 'ltr' ? 0 : c - 1;

  // Display columns, left to right, with `null` standing for the dropped middle. The cap cannot
  // go below what the two ends plus a gap need, or "condensing" would draw more cells than it
  // saves.
  const cap = Math.max(2 * END_COLS + 1, Math.floor(maxCols) || 0);
  const shown = [];
  if (c <= cap) for (let dc = 0; dc < c; dc++) shown.push(dc);
  else {
    for (let dc = 0; dc < END_COLS; dc++) shown.push(dc);
    shown.push(null);
    for (let dc = c - END_COLS; dc < c; dc++) shown.push(dc);
  }

  // The headings. Read off the display the same way StageView does: walk the drawing, and let
  // each cell's true index say what it is called. Every cell in a display row shares its true
  // row, and every cell in a display column its true column, so one probe each is enough.
  const rowHeads = [];
  for (let t = 0; t < r; t++) {
    const tr = giAt(r - 1 - t) % r;
    rowHeads.push({ r: tr, text: rowLabelAt(tr, r, lab, at), start: t === firstDisplayRow });
  }
  const colHeads = shown.map((dc) => {
    if (dc == null) return { gap: true };
    const tc = Math.floor(giAt(dc * r) / r);
    return { c: tc, text: colLabelAt(tc, c, lab, at), start: dc === firstDisplayCol };
  });

  const grid = [];
  for (let t = 0; t < r; t++) {
    grid.push(shown.map((dc) => {
      if (dc == null) return { gap: true };
      const gi = giAt(dc * r + (r - 1 - t));
      return { gi, label: seatLabelFor(gi, r, c, lab, at), start: t === firstDisplayRow && dc === firstDisplayCol };
    }));
  }

  return { rows: r, cols: c, audienceTop, startLabel: startSeatLabel(r, c, lab, at), rowHeads, colHeads, grid };
}
