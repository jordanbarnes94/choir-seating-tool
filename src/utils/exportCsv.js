import { isBlocked, isSinger } from './arranger.js';
import { colLabelAt, rowLabelAt } from './labels.js';

/*
 * exportCsv — the pure half of the two spreadsheet exports.
 *
 * Two things live here: the seating grid, and what an exported file is called. Both are plain
 * functions over plain data, with no Vue, no DOM and no Blob, so they are loadable by a bare
 * `node` script and testable under `node --test` (test/export.test.js). The same split as
 * utils/spreadsheet.js, which owns the CSV *writing* primitives this module hands its rows to,
 * and which useChoirArranger.js reaches for at the download itself.
 *
 * THE SEATING EXPORT IS A GRID, NOT A LIST. One file row per stage row, one column per stage
 * column, one name per cell (Jordan: "just an excel grid with names filled"). Opening the file
 * should look like the stage, which is the whole reason the grid shape beat a sortable
 * per-singer list — that list is a different tool, a second button, and explicitly out of
 * scope here, because a CSV cannot hold two sheets.
 *
 * Three rules are load-bearing:
 *
 *  1. IT FORMATS NO LABEL OF ITS OWN. Every row and column heading comes from rowLabelAt() and
 *     colLabelAt() in utils/labels.js, so the exported headings cannot disagree with the ones
 *     on screen or on the printed plan. The shared labels exist precisely so that four consumers do not
 *     invent four conventions.
 *
 *  2. THE FILE IS THE PICTURE. File row 0 is the top of the drawing and file column 0 its left,
 *     whichever side the audience is on, because that is what "opening the file should look
 *     like the stage" means and it is the only layout that can match what is printed. Since
 *     2026-09-11 the labels are nailed to the drawing too (utils/labels.js rule 2), so the
 *     headings come out the same either way and it is the SINGERS that rotate underneath them.
 *
 *  3. NO SENTINEL REACHES THE FILE. __EMPTY__ is a blank cell and __BLOCKED__ reads
 *     "[blocked]": a blank says "no one here" without explanation, which is
 *     exactly what an empty chair means, while a blocked seat is a deliberate physical gap and
 *     a director has to see that it is not merely unfilled.
 */

// A blocked seat. Bracketed so it cannot be mistaken for a singer called Blocked, and lower
// case to match what SeatGrid already draws in the cell.
export const BLOCKED_CELL = '[blocked]';
// The heading over the bench block. The same words the printed footer uses, on purpose.
export const NOT_SEATED = 'Not seated';

/**
 * One cell of the grid. Anything that is not a real singer is blank, so a sentinel this module
 * has never heard of fails safe as an empty chair rather than leaking `__SOMETHING__` into a
 * file a director is about to email.
 */
function seatCell(v) {
  if (isBlocked(v)) return BLOCKED_CELL;
  return isSinger(v) ? String(v) : '';
}

/**
 * The one caption line above the grid. It carries the two things a reader cannot
 * recover from the cells: which way round the plan was drawn — the labels are measured on
 * the drawing, so a plan seen from the stage names the same chair differently — and which split
 * was being coloured by when it was exported, since a CSV carries no colour at all.
 * @param {{ planName?: string, audienceAt?: string, colourBy?: string }} o
 * @returns {string}
 */
export function seatingTitle({ planName, audienceAt, colourBy } = {}) {
  const name = String(planName || '').trim() || 'Choir';
  const from = audienceAt === 'top' ? 'as seen from the stage' : 'as seen from the audience';
  const by = String(colourBy || '').trim();
  return `${name} — seating, ${from}` + (by ? `, coloured by ${by}` : '');
}

/**
 * Decompose the column-major `seats` rectangle into the rows of a CSV grid.
 *
 * `seats` is stored column-major over `rows`, with row 0 physically at the FRONT of the stage
 * and column 0 at the stage's left as stored (utils/arranger.js). The drawing rotates 180
 * degrees when the audience moves to the top, so both axes are converted here — the same
 * conversion utils/labels.js makes for the headings, which is why the two agree.
 *
 * @param {object} o
 * @param {string[]} o.seats      the column-major grid
 * @param {number} o.rows         stage depth
 * @param {number} o.cols         stage width
 * @param {object} o.labels       the four labelling settings; absent or invalid ones fall back
 * @param {string} [o.audienceAt] 'top' when the audience is drawn above the plan
 * @param {string[]} [o.waiting]  singers with no seat, in the order they should be listed
 * @param {string} [o.title]      the caption line, omitted when empty
 * @returns {string[][]} rows ready for csvText()
 */
export function seatingRows({ seats, rows, cols, labels, audienceAt, waiting, title } = {}) {
  const out = [];
  if (title) out.push([title]);
  const n = Number.isFinite(rows) ? Math.floor(rows) : 0;
  const m = Number.isFinite(cols) ? Math.floor(cols) : 0;
  const cells = Array.isArray(seats) ? seats : [];
  const fromStage = audienceAt === 'top';
  // stored index <- position in the picture. p counts rows from the TOP of the drawing, q
  // counts columns from its LEFT.
  const rowAt = (p) => (fromStage ? p : n - 1 - p);
  const colAt = (q) => (fromStage ? m - 1 - q : q);
  if (n >= 1 && m >= 1) {
    const head = ['']; // the corner, where the two heading axes meet
    for (let q = 0; q < m; q++) head.push(colLabelAt(colAt(q), m, labels, audienceAt));
    out.push(head);
    for (let p = 0; p < n; p++) {
      const r = rowAt(p);
      const line = [rowLabelAt(r, n, labels, audienceAt)];
      for (let q = 0; q < m; q++) line.push(seatCell(cells[colAt(q) * n + r]));
      out.push(line);
    }
  }
  // The bench, as a labelled block after ONE blank row. "Who has no seat" is one
  // of the first questions asked of a plan, and a file that silently drops five unseated
  // singers is one somebody will act on wrongly. Omitted entirely when everyone is seated: a
  // heading with nothing under it says less than no heading at all.
  const bench = (Array.isArray(waiting) ? waiting : []).filter(isSinger);
  if (bench.length) {
    out.push([]);
    out.push([NOT_SEATED]);
    bench.forEach((name) => out.push([String(name)]));
  }
  return out;
}

/**
 * Every seating plan of one concert, in one file.
 *
 * ONE FILE AND NOT ONE PER PLAN, deliberately. A concert's plans are the thing a director
 * compares — first half against second half — and four downloads to be opened in four windows
 * and lined up by hand is the comparison made harder, not easier. A .zip would need a writer
 * library on a static site for a file the user then has to unpack. One CSV opens in one window
 * and scrolls.
 *
 * Each plan is its own block: a heading naming it, then exactly what `seatingRows()` would
 * write for that plan on its own, so a block is byte-identical to the single-plan export of
 * the same plan minus its caption. Blocks are separated by a blank row, which is what
 * spreadsheet software needs to keep them as separate regions.
 *
 * @param {object} o
 * @param {string} o.concertName   heads the file; falls back to 'Choir'
 * @param {Array<object>} o.plans  `{ name, seats, rows, cols, labels, audienceAt, waiting, colourBy }`
 *                                 per arrangement, in the concert's own order. `seats` holds
 *                                 NAMES, not ids: the store resolves them, as it does for every
 *                                 other export.
 * @returns {string[][]} rows ready for csvText()
 */
export function concertSeatingRows(o) {
  // Destructured from a local rather than in the signature, because a default parameter covers
  // `undefined` and not `null`, and this one is reached from a click: an export that throws
  // produces no file and no error the user can see, which is the worst of the three outcomes.
  const src = o && typeof o === 'object' ? o : {};
  const name = String(src.concertName || '').trim() || 'Choir';
  const list = Array.isArray(src.plans) ? src.plans : [];
  const out = [[`${name} — ${list.length} seating plan${list.length === 1 ? '' : 's'}`]];
  for (const p of list) {
    out.push([]);
    // The plan's own heading, then its own grid in its OWN viewpoint and labelling: those are
    // arrangement data, so two plans of one concert may legitimately name the same chair
    // differently, and rewriting one into the other's scheme would be the file lying about
    // what was saved.
    const plan = p && typeof p === 'object' ? p : {};
    out.push([seatingTitle({ planName: plan.name, audienceAt: plan.audienceAt, colourBy: plan.colourBy })]);
    for (const row of seatingRows({ ...plan, title: '' })) out.push(row);
  }
  return out;
}

/* ---------- what the file is called ---------- */

// Flatten a plan's name into something safe in a filename and in a URL. Moved here from
// useChoirArranger.js when the filename builder below arrived: its only two callers are that
// builder and the preset lookup, and both want the same answer for the same name.
export function slugify(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents dropped, so "Così" is "cosi"
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Today, as the user's own calendar has it. Local rather than UTC on purpose: the date in the
 * filename is the date the director exported, and at 23:30 in London that is not tomorrow.
 * @param {Date} [d] for tests; anything that is not a usable Date means now
 */
export function isoDate(d) {
  const t = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/**
 * Name and date, e.g. `spring-concert-seating-2026-09-19.csv`. A director exporting
 * every week needs to tell the files apart, and an unnamed plan still has to produce a legal
 * filename, so the base falls back to `choir`.
 * @param {string} planName the loaded plan's name, or '' when nothing is loaded
 * @param {string} kind     'seating', 'roster' or 'backup'
 * @param {string} ext      'csv' or 'json'
 * @param {Date} [date]     for tests
 */
export function exportFilename(planName, kind, ext, date) {
  const base = slugify(planName) || 'choir';
  return `${base}-${kind}-${isoDate(date)}.${ext}`;
}
