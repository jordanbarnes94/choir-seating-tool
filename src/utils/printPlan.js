/*
 * printPlan: the arithmetic and the wording of the printed seating plan.
 *
 * Almost nothing about printing can be tested — the only honest verification is a human at a
 * print preview — so everything that CAN be decided without a browser is decided here, in a pure
 * module, and covered by test/print.test.js. What is left in `PlanSheet.vue` is markup and
 * CSS. Plain functions over plain data, no Vue, no store, no DOM.
 *
 * ## The sheet is laid out for the page, not shrunk to it
 *
 * The cells are sized to fill the paper: the WIDTH of a cell is the printable width shared out
 * between the columns, which PlanSheet expresses in CSS container units (`cqw`) so it follows
 * whatever margins the print dialogue actually uses, and the HEIGHT is the whole printable depth
 * shared out between the rows. The name is then set as large as the names on that page allow,
 * wrapping at word boundaries onto as many lines as the cell has room for (fitNameFont). A stage,
 * or a section on its own, too wide for its names to print at READABLE_PT goes across as many
 * pages as that takes, or as near to it as the stage's depth allows (printPages). The numbers here assume A4 landscape at 10mm margins.
 *
 * ## The page metrics are constants, and PlanSheet.vue must agree with them
 *
 * Every strip on the sheet is given an explicit height in PlanSheet.vue so this arithmetic is
 * exact and a long section name can never push the plan onto a second page.
 */
import { SECTIONS, isSinger, rosterById } from './arranger.js';
import { cropHeads, cropToSection, stageLayout } from './stageLayout.js';

/** CSS pixels per millimetre at the 96dpi the CSS `mm` unit is defined against. */
export const PX_PER_MM = 96 / 25.4;

/** The heights and widths of everything on the sheet that is not a seat, in CSS pixels. */
export const SHEET = Object.freeze({
  gutter: 32, // the row-heading gutter
  gutterGap: 6,
  bandH: 20, // the section header bands
  bandGap: 6,
  colHeadH: 20, // the column heading strip
  colHeadGap: 4,
  audienceGap: 8,
  audienceH: 22, // the AUDIENCE bar
  headerH: 30, // the one title line above the plan
  footerGap: 10, // the space between the plan and the "Not seated" line
  footerH: 16, // the "Not seated" line
  blockTitleH: 18, // a section's name above its block, in the By-section layout
  blockTitleGap: 4,
  blockGapX: 18, // between two section blocks side by side
  blockGapY: 14 // between two lines of section blocks
});

/**
 * The seat geometry on paper. Since 2026-09-27 a page is filled in BOTH directions: the cells
 * share out the full printable width and the full printable depth, and the name is set as large
 * as the names actually on that page allow. The caps only stop a tiny section from turning into
 * a few giant tiles.
 */
export const PRINT_CELL = Object.freeze({
  gap: 4,
  maxW: 340, // a narrow stage or section is not blown up past this
  maxH: 260,
  maxFontPx: 30,
  minFontPx: 4
});

/** A4 landscape with 10mm margins. */
export const PAGE = Object.freeze({ widthMm: 297, heightMm: 210, marginMm: 10 });

/** The printed name size below which the Print button warns. */
export const LEGIBLE_FLOOR_PT = 6;
/** The size every name is printed at, at least, unless the stage's depth will not allow it. */
export const READABLE_PT = 12;

/** The print options, with the first of each the default. */
export const NAME_STYLES = Object.freeze(['full', 'short']);

// Held back from the page depth, so a rounding in the print engine cannot tip a full-height
// plan onto a second sheet.
const DEPTH_SLACK = 8;

/**
 * The printable area of one sheet, inside the `@page` margins.
 * @param {{ widthMm: number, heightMm: number, marginMm: number }} [page]
 * @returns {{ w: number, h: number }} CSS pixels
 */
export function printableArea(page = PAGE) {
  const p = { ...PAGE, ...(page || {}) };
  return {
    w: Math.max(0, (p.widthMm - 2 * p.marginMm) * PX_PER_MM),
    h: Math.max(0, (p.heightMm - 2 * p.marginMm) * PX_PER_MM)
  };
}

/**
 * The height the title line and the footer take. The footer is reserved whether or not anybody
 * is unseated, so seating the last singer cannot change the size the plan prints at.
 */
export function reservedHeight() {
  return SHEET.headerH + SHEET.footerGap + SHEET.footerH;
}

/* ---------- how wide a name is ----------
   The printer's font is the system UI face, which cannot be measured without a DOM, so a name's
   width is estimated from per-character widths in em (checked against Segoe UI in Chrome, where
   it runs about 10% wide). The table errs wide, and EM_SAFETY on top
   of it, because the failure modes are not symmetric: an estimate that runs narrow breaks a word
   in the middle, one that runs wide costs a fraction of a point. */
const EM_SAFETY = 1.08;
const SPACE_EM = 0.28;
function charEm(ch) {
  if ("iljI.,:;'’!|".includes(ch)) return 0.27;
  if ('ftr()-[]'.includes(ch)) return 0.37;
  if ('mwMW'.includes(ch)) return 0.95;
  if (ch !== ch.toLowerCase()) return 0.68; // any other capital
  return 0.57;
}
/** A string's estimated printed width, in em. */
export function textEm(s) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) w += ch === ' ' ? SPACE_EM : charEm(ch);
  return w * EM_SAFETY;
}
/**
 * How many lines a name takes when wrapped at spaces and hyphens into `maxEm`, or Infinity when
 * one of its words is wider than that: a name broken mid-word is the thing the sizing exists to avoid.
 */
export function linesFor(name, maxEm) {
  const words = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const space = SPACE_EM * EM_SAFETY;
  let lines = 1, cur = 0;
  for (const w of words) {
    // A hyphenated word may break after its hyphen, as the browser will break it: "Morton-" on
    // one line and "Fraser" on the next reads fine, and is not the mid-word break this avoids.
    w.split(/(?<=-)(?=.)/).forEach((piece, i) => {
      const e = textEm(piece);
      const gap = i === 0 ? space : 0;
      if (e > maxEm) lines = Infinity;
      else if (!cur) cur = e;
      else if (cur + gap + e <= maxEm) cur += gap + e;
      else {
        lines++;
        cur = e;
      }
    });
    if (lines === Infinity) return Infinity;
  }
  return lines;
}

// What a cell spends on things other than the name: SeatGrid's 3px frame on each side and the
// sheet's 3px of padding inside it, and at the foot the split label.
const CELL_PAD_X = 12;
const CELL_PAD_Y = 8;
const LINE_H = 1.3; // SeatGrid's .grid.sheet .nm line-height: room for the descenders
const labelRoom = (fontPx, label) => (label ? fontPx * 0.85 + 2 : 0);

/**
 * The largest name size at which every name on the page fits its cell: each word whole on its
 * line, and all its lines clear of the split label. `lines` is how many lines the longest wrap
 * takes at that size, which is what the sheet clamps to.
 *
 * @param {number} cellW
 * @param {number} cellH
 * @param {string[]} names what is printed in the cells, already shortened if it is going to be
 * @param {{ label?: boolean }} [o] whether a split label sits in the cell's foot
 * @returns {{ fontPx: number, lines: number }}
 */
export function fitNameFont(cellW, cellH, names, { label = true } = {}) {
  if (!(cellW > 0 && cellH > 0)) return { fontPx: 0, lines: 1 };
  const list = (names || []).filter((n) => String(n || '').trim());
  const roomAt = (f) => Math.floor((cellH - CELL_PAD_Y - labelRoom(f, label)) / (f * LINE_H));
  const linesAt = (f) => {
    const maxEm = (cellW - CELL_PAD_X) / f;
    let most = 1;
    for (const n of list) most = Math.max(most, linesFor(n, maxEm));
    return most;
  };
  const fits = (f) => {
    const room = roomAt(f);
    return room >= 1 && linesAt(f) <= room;
  };
  let lo = PRINT_CELL.minFontPx, hi = PRINT_CELL.maxFontPx;
  // A cell too narrow for some word at any legible size: the word has to break, so fall back to
  // the old rule of a sixth of the width (never above the floor, so the size still only falls as
  // the stage widens), on as many lines as the depth holds. Tiny either way,
  // which is what the warning and Auto's second page are for.
  if (!fits(lo)) {
    const f = Math.max(0, Math.min(cellW / 6, (cellH - CELL_PAD_Y) / 4.4, PRINT_CELL.minFontPx));
    return { fontPx: f, lines: Math.max(1, roomAt(f)) };
  }
  if (fits(hi)) return { fontPx: hi, lines: linesAt(hi) };
  // quarter-pixel steps are finer than anybody can see on paper
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { fontPx: lo, lines: linesAt(lo) };
}

/** The width a stage page spends on things that are not seats. */
export function stageChromeW(showHeadings = true) {
  return showHeadings ? SHEET.gutter + SHEET.gutterGap : 0;
}
/** ...and the depth: the section bands, the column headings and the AUDIENCE bar. */
export function stageChromeH(showHeadings = true) {
  return SHEET.bandH + SHEET.bandGap + (showHeadings ? SHEET.colHeadH + SHEET.colHeadGap : 0) + SHEET.audienceGap + SHEET.audienceH;
}

/**
 * One page's cells: the full printable width shared between `cols` columns, and the full depth
 * between `rows` rows, then the name size for the names on it.
 *
 * @param {{ cols: number, rows: number, names?: string[], label?: boolean, showHeadings?: boolean, page?: object }} o
 * @returns {{ cellW: number, cellH: number, fontPx: number, namePt: number, lines: number }}
 */
export function sheetGeometry({ cols, rows, names = [], label = true, showHeadings = true, page = PAGE }) {
  const area = printableArea(page);
  const c = Math.max(1, Math.floor(cols) || 1);
  const r = Math.max(1, Math.floor(rows) || 1);
  const availW = area.w - stageChromeW(showHeadings) - (c - 1) * PRINT_CELL.gap;
  const availH = area.h - reservedHeight() - stageChromeH(showHeadings) - DEPTH_SLACK - (r - 1) * PRINT_CELL.gap;
  const cellW = Math.max(0, Math.min(availW / c, PRINT_CELL.maxW));
  const cellH = Math.max(0, Math.min(availH / r, PRINT_CELL.maxH));
  const { fontPx, lines } = fitNameFont(cellW, cellH, names, { label });
  return { cellW, cellH, fontPx, namePt: fontPx * 0.75, lines };
}

/* ---------- the names as printed ---------- */

/**
 * What each singer is called on paper, by id. 'short' is the first name and the surname's
 * initial ("Ekaterina D."), which is what lets a crowded stage print larger. Where two different
 * people would come out the same ("Selma R." for Selma Rowntree and Selma Rose) both are printed
 * in full: a half-length surname like "Selma Row." is one more thing to decode, and the page is
 * read by someone looking for their own name. Two singers with the SAME full name keep the short
 * form: nothing on paper could tell them apart either way.
 *
 * @param {Array<{ id: string, name: string }>} people
 * @param {string} [style] one of NAME_STYLES
 * @returns {Record<string, string>}
 */
export function printNames(people, style = 'full') {
  const list = (people || []).filter((p) => p && p.id != null);
  const out = {};
  if (style !== 'short') {
    for (const p of list) out[p.id] = String(p.name == null ? '' : p.name);
    return out;
  }
  const parts = list.map((p) => {
    const w = String(p.name == null ? '' : p.name).trim().split(/\s+/).filter(Boolean);
    return { id: p.id, full: w.join(' '), first: w[0] || '', rest: w.slice(1).join(' ') };
  });
  // a surname of one or two letters is kept whole: cutting it saves nothing worth the full stop
  const short = (p) => (p.rest.length > 2 ? `${p.first} ${p.rest[0]}.` : p.full);
  const count = new Map();
  for (const p of parts) {
    const t = short(p);
    if (!count.has(t)) count.set(t, new Set());
    count.get(t).add(p.full);
  }
  for (const p of parts) out[p.id] = count.get(short(p)).size > 1 ? p.full : short(p);
  return out;
}

/* ---------- a wide stage over several pages ---------- */

/**
 * Where a block `cols` wide is cut into `n` pages: near each k/n of the way across, on the edge
 * of a section's band if one falls within a fifth of a page's width of that point (a section read
 * whole on one page is worth more than exactly equal pages), and otherwise at the point itself.
 *
 * @param {number} cols
 * @param {number} n pages
 * @param {Array<{ start: number, span: number }>} [bands] stageLayout's bands
 * @returns {number[]} the first column of each page after the first, ascending
 */
export function splitColumns(cols, n, bands = []) {
  const cuts = [];
  const reach = (cols / n) * 0.2;
  const edges = (bands || []).flatMap((b) => [b.start, b.start + b.span]);
  for (let k = 1; k < n; k++) {
    const at = (cols * k) / n;
    // every page keeps at least one column, before and after this cut
    const lo = (cuts.length ? cuts[cuts.length - 1] : 0) + 1;
    const hi = cols - (n - k);
    let best = null;
    for (const e of edges) {
      if (e < lo || e > hi || Math.abs(e - at) > reach) continue;
      if (best == null || Math.abs(e - at) < Math.abs(best - at)) best = e;
    }
    cuts.push(best ?? Math.min(hi, Math.max(lo, Math.ceil(at))));
  }
  return cuts;
}

/**
 * One block across as many pages as it takes for every name on it to print at READABLE_PT: the
 * fewest that reach it, or, when the depth caps the name size below it, the fewest that print
 * as large as any number would. Every page is laid out at the widest page's cell size, fitted to
 * all the block's names, so the pages line up when they are put side by side.
 */
function acrossPages({ key, focus, rows, cols, slots, bands, rowHeads, colHeads }, geoFor) {
  // A one-column page has the widest cell there is, so its name size is the most the depth allows.
  const target = Math.min(READABLE_PT, geoFor(1, rows, slots).namePt) - 0.01;
  let pick;
  for (let n = 1; n <= Math.max(1, cols); n++) {
    const cuts = splitColumns(cols, n, bands);
    const edges = [0, ...cuts, cols];
    const widest = Math.max(...edges.slice(1).map((e, i) => e - edges[i]));
    pick = { edges, widest, geo: geoFor(widest, rows, slots) };
    if (pick.geo.namePt >= target || widest <= 1) break;
  }
  const { edges, widest, geo } = pick;
  const n = edges.length - 1;
  return edges.slice(1).map((c1, k) => {
    const c0 = edges[k];
    const clipped = [];
    for (const b of bands) {
      const s = Math.max(b.start, c0), e = Math.min(b.start + b.span, c1);
      if (s < e) clipped.push({ ...b, start: s - c0, span: e - s, gridColumn: `${s - c0 + 1} / span ${e - s}` });
    }
    const page = n > 1 ? `page ${k + 1} of ${n}` : '';
    return {
      key: n > 1 ? `${key}-${k}` : key,
      part: [focus, page].filter(Boolean).join(', '),
      rows,
      cols: c1 - c0,
      cellCols: widest,
      slots: slots.slice(c0 * rows, c1 * rows),
      bands: clipped,
      rowHeads,
      colHeads: colHeads.slice(c0, c1),
      focus,
      geo
    };
  });
}

/**
 * Every page one plan prints as, laid out. The one place that decides what goes on which sheet,
 * so the sheet and the legibility warning beside the Print button cannot disagree.
 *
 * - `layout: 'stage'` is the whole stage, across as many pages as READABLE_PT needs.
 * - `layout: 'sections'` is each section that has anybody seated, in the order they are drawn,
 *   each filling its own page or pages by the same rule.
 *
 * Each page's `cellCols` is the number of columns its cells are sized for: the widest page of its
 * block, which a narrower page does not stretch past.
 *
 * @param {object} o
 * @param {object} o.stage  stageLayout()'s return for the plan
 * @param {Array<{ sec: string, rows: number, cols: number, slots: Array, rowHeads?: Array,
 *                 colHeads?: Array }>} [o.blocks] the section crops, in drawn order
 * @param {Record<string, string>} o.names  printNames() for the plan
 * @param {Record<string, string>} [o.colours] section colours, for the section pages' bands
 * @returns {Array<{ key: string, part: string, rows: number, cols: number, cellCols: number,
 *   slots: Array, bands: Array, rowHeads: Array, colHeads: Array, focus: string|null, geo: object }>}
 */
export function printPages({ stage, blocks = [], names = {}, colours = {}, layout = 'stage', label = true, showHeadings = true, page = PAGE }) {
  const printed = (slots) => slots.filter((s) => isSinger(s.id) && names[s.id] != null).map((s) => names[s.id]);
  const geoFor = (cols, rows, slots) => sheetGeometry({ cols, rows, names: printed(slots), label, showHeadings, page });

  if (layout === 'sections') {
    return blocks
      .filter((b) => b.slots.length)
      .flatMap((b) =>
        acrossPages(
          {
            key: 'sec-' + b.sec,
            focus: b.sec,
            rows: b.rows,
            cols: b.cols,
            slots: b.slots,
            bands: [{ sec: b.sec, start: 0, span: b.cols, gridColumn: `1 / span ${b.cols}`, color: colours[b.sec] }],
            rowHeads: b.rowHeads || [],
            colHeads: b.colHeads || []
          },
          geoFor
        )
      );
  }

  return acrossPages(
    { key: 'stage', focus: null, rows: stage.rows, cols: stage.cols, slots: stage.slots, bands: stage.bands, rowHeads: stage.rowHeads, colHeads: stage.colHeads },
    geoFor
  );
}

/**
 * A whole plan to its printed pages: the stage, the section crops, the printed names and then
 * printPages(). PlanSheet draws exactly this and the Print button's warning reads its sizes, so
 * the warning is always about the pages that will actually come out.
 *
 * @param {object} plan  the plan shape PlanSheet takes (roster, seats, rows, cols, sectionOrder,
 *                       labels, audienceAt)
 * @param {object} [o]   `layout`, `nameStyle`, `label`, `showHeadings`, and `colours`,
 *                       the section colours to paint the bands with
 * @returns {{ pages: Array, names: Record<string, string> }}
 */
export function planPrintPages(plan, { layout = 'stage', nameStyle = 'full', label = true, showHeadings = true, colours } = {}) {
  const p = plan || {};
  const byId = rosterById(p.roster || []);
  const stage = stageLayout({
    seats: p.seats,
    rows: p.rows,
    cols: p.cols,
    byId,
    sectionOrder: p.sectionOrder,
    labels: p.labels,
    audienceAt: p.audienceAt,
    sectionColours: colours
  });
  // One crop per section, in the order the stage draws them: turned for the viewpoint, as the
  // stage is, with the full stage's row and seat names so a section's page reads against it.
  const order = p.sectionOrder || [];
  const blocks = (p.audienceAt === 'top' ? order.slice().reverse() : order)
    .map((sec) => {
      const crop = cropToSection({ seats: p.seats, rows: p.rows, byId, sec, audienceAt: p.audienceAt });
      const cols = crop.slots.length ? crop.slots.length / crop.rows : 0;
      const heads = cropHeads({ slots: crop.slots, rows: crop.rows, planRows: p.rows, planCols: p.cols, labels: p.labels, audienceAt: p.audienceAt });
      return { sec, rows: crop.rows, cols, slots: crop.slots, ...heads };
    })
    .filter((b) => b.slots.length);
  const names = printNames(p.roster, nameStyle);
  const pages = printPages({ stage, blocks, names, colours: colours || {}, layout, label, showHeadings });
  return { pages, names };
}

/**
 * The CSS for a cell width that shares the ACTUAL printed width between `cols` columns, so the
 * sheet follows the margins the print dialogue uses. `100cqw` is the sheet's own width
 * (PlanSheet is a size container). Each entry of `lines` is `{ cols, chromePx }`, and the
 * tightest of them wins.
 */
export function cellWidthCss(lines) {
  const parts = lines.map(({ cols, chromePx }) => `calc((100cqw - ${Math.round(chromePx * 100) / 100}px) / ${Math.max(1, cols)})`);
  return `min(${PRINT_CELL.maxW}px, ${parts.join(', ')})`;
}

/**
 * One line shown in the print options when the names would print below the legibility floor,
 * or null when they would not. It is a warning, not a block: the sheet still prints.
 */
export function legibilityWarning(namePt, floor = LEGIBLE_FLOOR_PT) {
  if (!(namePt < floor)) return null;
  return `Names will print small (about ${Math.round(namePt * 10) / 10}pt) on this page. First name + initial prints them larger.`;
}

/**
 * Roster members who are not on the stage, in the same section-then-name order the waiting area
 * uses. Ids in (from `seats`), names out.
 *
 * @param {Array<{id: string, name: string, section: string}>} roster
 * @param {Array<string>} seats the column-major grid, holding ids
 * @returns {Array<string>} names
 */
export function unseatedNames(roster, seats) {
  const placed = new Set((seats || []).filter(isSinger));
  return (roster || [])
    .filter((p) => !placed.has(p.id))
    .slice()
    .sort((a, b) => {
      const sa = SECTIONS.indexOf(a.section), sb = SECTIONS.indexOf(b.section);
      return sa !== sb ? sa - sb : a.name.localeCompare(b.name);
    })
    .map((p) => p.name);
}

/**
 * The footer line, or null when everyone is seated. A plan that silently omits five
 * unseated singers is one somebody acts on wrongly on a concert night.
 * @returns {string|null}
 */
export function notSeatedLine(names) {
  const list = (names || []).filter(Boolean);
  return list.length ? `Not seated: ${list.join(', ')}` : null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** `19 September 2026`. Written out rather than left to `toLocaleDateString`, which would print
 *  a different date to a reader in a different locale from the person who saved the PDF. */
export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `2026-09-19`, for the suggested filename, where sorting matters more than reading. */
export function isoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The sheet's title: the plan's name, or a plain description when there is none. */
export function sheetTitle(name) {
  const n = String(name || '').trim();
  return n || 'Choir seating plan';
}

/**
 * What `document.title` is set to before `window.print()`, because that is what browsers seed
 * the save dialogue's filename suggestion from.
 */
export function documentTitle(name, date, what = 'seating plan') {
  const n = String(name || '').trim();
  const iso = isoDate(date);
  return [n ? `${n} ${what}` : `Choir ${what}`, iso].filter(Boolean).join(' ');
}
