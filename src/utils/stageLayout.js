/*
 * stageLayout: the geometry of a drawn stage, as a pure function of a plan.
 *
 * `StageView.vue` worked this out inline — the viewpoint rotation, the section header bands and
 * the two strips of seat headings — reading the live store for every input. The printed
 * sheet draws the same picture for a plan that is not the live one, and the walk-on list and
 * the whole-concert print draw it again, so the arithmetic is lifted here rather than
 * copied. They share one render path; this module and
 * `SeatGrid.vue`'s `plan` / `readonly` props are that path's two halves.
 *
 * Pure in the same sense as utils/labels.js and utils/arranger.js: plain functions over plain
 * data, no Vue, no store and no DOM, so it loads in a bare `node` and is covered by
 * test/stage-layout.test.js.
 *
 * Nothing here is ever written back. The viewpoint rotates the DRAWING and never the stored
 * `seats` array, and every slot carries `gi`, its true index into that array, which is what lets
 * drag and drop, pins and the solver stay ignorant that a rotation happened. The labels are
 * likewise cosmetic and come from utils/labels.js, which is the one place in the app allowed to
 * name a seat.
 *
 * A slot carries the cell's `id` and not a name: the layout is geometry, and who a
 * chair holds is resolved by whoever draws it. `byId` is here only because the section BANDS
 * need each singer's section, which is a roster property and never a function of the seat.
 */
import { SECTION_COLOR, isSinger } from './arranger.js';
import { colLabelAt, rowLabelAt } from './labels.js';

/**
 * The drawn stage: display-ordered slots, the section header bands, and the row and column
 * heading strips.
 *
 * @param {object} plan
 * @param {Array<string>} plan.seats    the column-major grid of singer ids and sentinels, unrotated
 * @param {number} plan.rows            stage depth
 * @param {number} plan.cols            stage width
 * @param {object} plan.byId            roster records keyed by id (a singer's section lives here)
 * @param {Array<string>} plan.sectionOrder  left-to-right section precedence, for band ties
 * @param {object} [plan.labels]        the four seat-labelling settings; absent means the defaults
 * @param {string} [plan.audienceAt]    'top' draws the plan from the stage; anything else, 'bottom'
 * @param {object} [plan.sectionColours] the PLAN's palette. Absent means the defaults,
 *                                       so a caller with no custom colours passes nothing.
 * @returns {{ rows: number, cols: number, slots: Array<{id: string, gi: number}>,
 *             bands: Array<{sec: string, start: number, span: number, gridColumn: string, color: string}>,
 *             rowHeads: Array<{r: number, gridRow: number, text: string}>,
 *             colHeads: Array<{c: number, text: string}>, audienceTop: boolean }}
 */
export function stageLayout({ seats, rows, cols, byId, sectionOrder, labels, audienceAt, sectionColours }) {
  const seq = seats || [];
  const bn = byId || {};
  const order = sectionOrder || [];
  // Colours are plan data, so a band is painted in the PLAN's colour. Falling back to
  // SECTION_COLOR rather than requiring the map keeps every caller that has no custom palette
  // (and every test) unchanged.
  const palette = sectionColours || SECTION_COLOR;

  // The viewpoint. 'top' puts the audience above the plan, which means the plan is
  // rotated 180 degrees: `seats` is one column-major rows*cols array, so the rotation is exactly
  // reverse(). It happens at render time and never to the stored array, with `gi` carrying the
  // true seat index.
  const audienceTop = audienceAt === 'top';
  const slots = seq.map((id, gi) => ({ id, gi }));
  if (audienceTop) slots.reverse();

  // header bands: each DISPLAY column belongs to whichever SECTION (read from the singer, not
  // from where they sit) holds the MOST singers in it. A tie goes to the incoming section, i.e.
  // not the owner of the column to its left, so a column shared evenly across a boundary starts
  // the next heading; any tie left after that goes to the earlier section in the configured
  // order. A column with no singers (all empty/blocked) belongs to nobody. Bands
  // are then the contiguous runs of equal owner, so the header reads as one block per section
  // in stage order and never spills across empty columns.
  const colOwner = [];
  for (let c = 0; c < cols; c++) {
    const tally = {};
    let any = false;
    for (let i = c * rows; i < Math.min((c + 1) * rows, slots.length); i++) {
      const n = slots[i].id;
      if (!isSinger(n)) continue;
      const rec = bn[n];
      if (!rec) continue; // id not (yet) in the roster — skip rather than throw mid-flush
      any = true;
      tally[rec.section] = (tally[rec.section] || 0) + 1;
    }
    if (!any) {
      colOwner[c] = null; // empty column owns no section
      continue;
    }
    const best = Math.max(...Object.values(tally));
    const tied = order.filter((s) => tally[s] === best);
    const prev = c > 0 ? colOwner[c - 1] : null;
    colOwner[c] = tied.find((s) => s !== prev) ?? tied[0] ?? null;
  }
  // collapse equal-owner neighbours into one band each.
  const bands = [];
  for (let c = 0; c < cols; ) {
    const o = colOwner[c];
    if (o == null) {
      c++;
      continue;
    }
    let end = c;
    while (end + 1 < cols && colOwner[end + 1] === o) end++;
    bands.push({ sec: o, start: c, span: end - c + 1, gridColumn: `${c + 1} / span ${end - c + 1}`, color: palette[o] });
    c = end + 1;
  }

  // Row and column headings. Purely cosmetic: row `r` counts from 0 at the front, column `c`
  // from 0 at the stage's left as stored, and utils/labels.js turns each into whatever the
  // plan's four settings say it is called. `gridRow` is SeatGrid's own placement rule
  // (`rows - (k % rows)`), so a heading always sits level with the row it names.
  // Laid out in display order off `slots`; each slot's `gi` gives the true row and column to
  // label. Both axes are measured on the DRAWING, so both take the viewpoint (labels.js rule 2).
  const rowHeads = [];
  for (let k = 0; k < Math.min(rows, slots.length); k++) {
    const r = slots[k].gi % rows;
    rowHeads.push({ r, gridRow: rows - k, text: rowLabelAt(r, rows, labels, audienceAt) });
  }
  const colHeads = [];
  for (let dc = 0; dc * rows < slots.length; dc++) {
    const c = Math.floor(slots[dc * rows].gi / rows);
    colHeads.push({ c, text: colLabelAt(c, cols, labels, audienceAt) });
  }

  return { rows, cols, slots, bands, rowHeads, colHeads, audienceTop };
}

/**
 * One section's bounding box, cropped out of a whole stage.
 *
 * Lifted VERBATIM out of `SectionBlock.vue`, where it was inline, because a preview
 * draws the same crop for a plan that is not the live one and two copies of a bounding-box
 * calculation is exactly the duplication this module exists to prevent. It is
 * here, beside `stageLayout()`, rather than in `utils/arranger.js`, because this is the
 * geometry module.
 *
 * The box is the smallest rectangle of real grid cells that holds every singer of `sec`. Cells
 * inside it belonging to OTHER sections are kept, so the box stays a true rectangle and
 * `SeatGrid` can ghost them — a section's neighbours are half of what a director is looking at.
 *
 * Every slot carries `gi`, its index into the UNCROPPED `seats` array, which is what lets a
 * cropped grid still be dropped on (and what lets a read-only crop carry the same seat labels as
 * the full stage).
 *
 * @param {object} plan
 * @param {Array<string>} plan.seats  the column-major grid, unrotated
 * @param {number} plan.rows          the FULL stage depth, not the crop's
 * @param {object} plan.byId          roster records keyed by id
 * @param {string} plan.sec           the section to crop to
 * @param {string} [plan.audienceAt]  'top' rotates the crop 180°, exactly as stageLayout does
 * @returns {{ rows: number, slots: Array<{id: string, gi: number}> }} the crop's own depth, and
 *          its slots in display order. An empty section returns no slots and the full depth.
 */
export function cropToSection({ seats, rows, byId, sec, audienceAt }) {
  const seq = seats || [];
  const bn = byId || {};
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  seq.forEach((id, i) => {
    if (!isSinger(id) || !bn[id] || bn[id].section !== sec) return;
    const col = Math.floor(i / rows), row = i % rows;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  });
  if (minCol === Infinity) return { rows, slots: [] };

  const localRows = maxRow - minRow + 1;
  const slots = [];
  for (let lc = 0; lc <= maxCol - minCol; lc++)
    for (let lr = 0; lr < localRows; lr++) {
      const gi = (minCol + lc) * rows + (minRow + lr);
      slots.push({ id: seq[gi], gi });
    }
  // The viewpoint. The cropped block is itself a column-major localRows-deep rectangle,
  // so its 180° rotation is the same reverse() stageLayout does to the whole stage.
  if (audienceAt === 'top') slots.reverse();
  return { rows: localRows, slots };
}

/**
 * The row and column headings for a crop, named as the full stage names them: a section printed
 * on its own page keeps "Row C, seat 12", so it can still be read against the whole plan.
 * `gridRow` is SeatGrid's placement rule for the crop's own depth, as in stageLayout().
 *
 * @param {object} o
 * @param {Array<{gi: number}>} o.slots  the crop, in display order (cropToSection's)
 * @param {number} o.rows      the crop's depth
 * @param {number} o.planRows  the full stage's depth, which `gi` is counted in
 * @param {number} o.planCols
 * @param {object} o.labels
 * @param {string} [o.audienceAt]
 * @returns {{ rowHeads: Array<{r: number, gridRow: number, text: string}>, colHeads: Array<{c: number, text: string}> }}
 */
export function cropHeads({ slots, rows, planRows, planCols, labels, audienceAt }) {
  const list = slots || [];
  const rowHeads = [];
  for (let k = 0; k < Math.min(rows, list.length); k++) {
    const r = list[k].gi % planRows;
    rowHeads.push({ r, gridRow: rows - k, text: rowLabelAt(r, planRows, labels, audienceAt) });
  }
  const colHeads = [];
  for (let dc = 0; dc * rows < list.length; dc++) {
    const c = Math.floor(list[dc * rows].gi / planRows);
    colHeads.push({ c, text: colLabelAt(c, planCols, labels, audienceAt) });
  }
  return { rowHeads, colHeads };
}
