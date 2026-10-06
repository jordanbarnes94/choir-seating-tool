/*
 * Tests for utils/printPlan.js.
 *
 * Run: npm test
 *
 * The sheet itself can only be judged at a print preview, so everything decidable without a
 * browser is in a pure module: that the laid-out plan fits the page, that the names get larger
 * than the old shrink-to-fit gave them, what goes on which page, and the wording of the lines of
 * copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGIBLE_FLOOR_PT,
  PAGE,
  PRINT_CELL,
  PX_PER_MM,
  SHEET,
  cellWidthCss,
  documentTitle,
  formatDate,
  isoDate,
  READABLE_PT,
  fitNameFont,
  legibilityWarning,
  linesFor,
  notSeatedLine,
  printNames,
  printPages,
  printableArea,
  reservedHeight,
  sheetGeometry,
  splitColumn,
  textEm,
  sheetTitle,
  stageChromeW,
  unseatedNames
} from '../src/utils/printPlan.js';
import { BLOCKED, EMPTY } from '../src/utils/arranger.js';

const A3 = { widthMm: 420, heightMm: 297, marginMm: 10 };
// A realistic spread of names to size the text by.
const CHOIR = ['Ekaterina De Vere', 'Piers Ravenscroft', 'Kaya Quinlivan', 'Joy Tobin', 'Margot Battersby', 'Alastair Waite'];
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/* ---------- the page ---------- */

test('A4 landscape at 10mm margins is 277 x 190 mm of printable area', () => {
  const { w, h } = printableArea();
  near(w, 277 * PX_PER_MM);
  near(h, 190 * PX_PER_MM);
});

test('a page smaller than its own margins gives no printable area rather than a negative one', () => {
  assert.deepEqual(printableArea({ widthMm: 10, heightMm: 10, marginMm: 10 }), { w: 0, h: 0 });
});

/* ---------- the full stage, laid out for the page ---------- */

// The height the full stage takes at a given geometry, restated from PlanSheet's CSS.
function stageHeight(rows, g) {
  return SHEET.bandH + SHEET.bandGap + SHEET.colHeadH + SHEET.colHeadGap + rows * g.cellH + (rows - 1) * PRINT_CELL.gap + SHEET.audienceGap + SHEET.audienceH;
}

test('the laid-out stage fits inside the page, on every stage the app allows', () => {
  const area = printableArea();
  for (let rows = 1; rows <= 8; rows++)
    for (let cols = 1; cols <= 40; cols++) {
      const g = sheetGeometry({ cols, rows, names: CHOIR });
      assert.ok(stageChromeW() + cols * g.cellW + (cols - 1) * PRINT_CELL.gap <= area.w + 0.01, `${cols}x${rows} is too wide`);
      assert.ok(stageHeight(rows, g) + reservedHeight() <= area.h + 0.01, `${cols}x${rows} is too deep`);
    }
});

test('a page is filled: the full width across, and the full depth down', () => {
  const area = printableArea();
  const g = sheetGeometry({ cols: 19, rows: 4, names: CHOIR });
  near(stageChromeW() + 19 * g.cellW + 18 * PRINT_CELL.gap, area.w, 0.01);
  near(stageHeight(4, g) + reservedHeight(), area.h, 10); // less the few pixels of slack held back
});

test('only a tiny stage is held back, and then by the caps', () => {
  const g = sheetGeometry({ cols: 2, rows: 1, names: CHOIR });
  assert.equal(g.cellW, PRINT_CELL.maxW);
  assert.equal(g.cellH, PRINT_CELL.maxH);
  assert.ok(g.fontPx <= PRINT_CELL.maxFontPx);
});

test('the name size shrinks as the stage widens', () => {
  let last = Infinity;
  for (let cols = 1; cols <= 40; cols++) {
    const pt = sheetGeometry({ cols, rows: 4, names: CHOIR }).namePt;
    assert.ok(pt <= last + 1e-9);
    last = pt;
  }
});

test('a bigger sheet takes a bigger stage: A3 prints 40 columns larger than A4 does', () => {
  assert.ok(sheetGeometry({ cols: 40, rows: 8, names: CHOIR, page: A3 }).namePt > sheetGeometry({ cols: 40, rows: 8, names: CHOIR }).namePt);
});

test('the CSS width shares the printed width, less the chrome, between the columns', () => {
  assert.equal(cellWidthCss([{ cols: 19, chromePx: 104 }]), `min(${PRINT_CELL.maxW}px, calc((100cqw - 104px) / 19))`);
  assert.equal(
    cellWidthCss([{ cols: 9, chromePx: 50 }, { cols: 10, chromePx: 54 }]),
    `min(${PRINT_CELL.maxW}px, calc((100cqw - 50px) / 9), calc((100cqw - 54px) / 10))`
  );
});

/* ---------- the name size, from the names ---------- */

test('a name wraps at its spaces, and a word wider than the cell does not fit at all', () => {
  assert.equal(linesFor('Ekaterina De Vere', 100), 1);
  assert.equal(linesFor('Ekaterina De Vere', textEm('Ekaterina') + 0.01), 2);
  assert.equal(linesFor('Ekaterina De Vere', textEm('Ekaterina') - 0.01), Infinity);
  assert.equal(linesFor('', 5), 0);
});

test('capitals and wide letters are estimated wider than narrow ones', () => {
  assert.ok(textEm('WWW') > textEm('aaa'));
  assert.ok(textEm('aaa') > textEm('iii'));
  assert.ok(textEm('Aaa') > textEm('aaa'));
});

test('the name size is the largest at which every word fits its line and every name its cell', () => {
  const names = ['Piers Ravenscroft', 'Joy Tobin'];
  const { fontPx, lines } = fitNameFont(60, 200, names);
  // the longest word fits at that size, and a little larger it would not
  assert.ok(textEm('Ravenscroft') * fontPx <= 60 - 12 + 1e-9);
  assert.ok(textEm('Ravenscroft') * (fontPx + 0.5) > 60 - 12);
  assert.equal(lines, 2, 'Piers / Ravenscroft');
});

test('a shallow cell is limited by its depth instead: the lines have to fit above the label', () => {
  const deep = fitNameFont(200, 200, ['Ann Poole']);
  const shallow = fitNameFont(200, 30, ['Ann Poole']);
  assert.ok(shallow.fontPx < deep.fontPx);
  assert.ok(shallow.lines * shallow.fontPx * 1.3 + shallow.fontPx * 0.85 + 2 + 8 <= 30 + 1e-9);
});

test('shorter names print larger in the same cell', () => {
  const full = sheetGeometry({ cols: 19, rows: 4, names: ['Alexandra Montgomery-Smythe'] });
  const short = sheetGeometry({ cols: 19, rows: 4, names: ['Alexandra M.'] });
  assert.ok(short.namePt >= full.namePt);
});

test('with no names the size is simply the largest the cell allows', () => {
  assert.equal(fitNameFont(300, 260, []).fontPx, PRINT_CELL.maxFontPx);
  assert.equal(fitNameFont(0, 100, ['A']).fontPx, 0);
});

/* ---------- the names as printed ---------- */

test('full names are printed as they are', () => {
  assert.deepEqual(printNames([{ id: 'a', name: 'Ekaterina De Vere' }]), { a: 'Ekaterina De Vere' });
});

test('short names are the first name and the surname initial', () => {
  assert.deepEqual(
    printNames([{ id: 'a', name: 'Ekaterina De Vere' }, { id: 'b', name: 'Joy Tobin' }, { id: 'c', name: 'Cher' }], 'short'),
    { a: 'Ekaterina D.', b: 'Joy T.', c: 'Cher' }
  );
});

test('two people who would look the same are both printed in full', () => {
  const out = printNames(
    [{ id: 'a', name: 'Selma Rowntree' }, { id: 'b', name: 'Selma Rose' }, { id: 'c', name: 'Selma Teal' }],
    'short'
  );
  assert.deepEqual(out, { a: 'Selma Rowntree', b: 'Selma Rose', c: 'Selma T.' });
});

test('a very short surname is kept whole, and a shared full name keeps the short form', () => {
  assert.deepEqual(printNames([{ id: 'a', name: 'Ann Ng' }], 'short'), { a: 'Ann Ng' });
  assert.deepEqual(printNames([{ id: 'a', name: 'Ann Lee' }, { id: 'b', name: 'Ann Lee' }], 'short'), { a: 'Ann L.', b: 'Ann L.' });
});

/* ---------- the pages ---------- */

// A stage `cols` wide and `rows` deep, filled with singers whose ids are also their names.
function stageOf(cols, rows, bands = []) {
  const slots = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) slots.push({ id: `S${c}-${r}`, gi: c * rows + r });
  const colHeads = Array.from({ length: cols }, (_, c) => ({ c, text: String(c + 1) }));
  const rowHeads = Array.from({ length: rows }, (_, r) => ({ r, gridRow: rows - r, text: String(r) }));
  return { rows, cols, slots, bands, colHeads, rowHeads };
}
const namesOf = (stage, name = 'Ekaterina Battersby') => Object.fromEntries(stage.slots.map((s) => [s.id, name]));

test('a stage that prints readably stays on one page', () => {
  const stage = stageOf(8, 4);
  const pages = printPages({ stage, names: namesOf(stage) });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].part, '');
  assert.ok(pages[0].geo.namePt >= READABLE_PT);
});

test('Auto puts a wide stage on two pages, only when one would be too small to read', () => {
  const stage = stageOf(24, 4);
  const one = printPages({ stage, names: namesOf(stage), split: 'one' });
  assert.equal(one.length, 1);
  assert.ok(one[0].geo.namePt < READABLE_PT);
  const auto = printPages({ stage, names: namesOf(stage) });
  assert.equal(auto.length, 2);
  assert.ok(auto[0].geo.namePt > one[0].geo.namePt);
});

test('the two halves share every column once, in order, at one cell size', () => {
  const stage = stageOf(19, 4);
  const [a, b] = printPages({ stage, names: namesOf(stage), split: 'two' });
  assert.equal(a.cols + b.cols, 19);
  assert.deepEqual([...a.slots, ...b.slots], stage.slots);
  assert.deepEqual([...a.colHeads, ...b.colHeads], stage.colHeads);
  assert.deepEqual(a.geo, b.geo);
  assert.match(a.part, /left/);
  assert.match(b.part, /right/);
});

test('the cut falls on a section edge near the middle, and at the middle when none is near', () => {
  assert.equal(splitColumn(19, [{ start: 0, span: 7 }, { start: 7, span: 4 }, { start: 11, span: 4 }, { start: 15, span: 4 }]), 11);
  assert.equal(splitColumn(19, [{ start: 0, span: 3 }, { start: 3, span: 16 }]), 10);
  assert.equal(splitColumn(2), 1);
});

test('a band cut by the split is drawn on both pages, clipped to each', () => {
  const stage = stageOf(10, 2, [{ sec: 'Alto', start: 0, span: 10, gridColumn: '1 / span 10' }]);
  const [a, b] = printPages({ stage, names: namesOf(stage), split: 'two' });
  assert.deepEqual(a.bands.map((x) => x.gridColumn), ['1 / span 5']);
  assert.deepEqual(b.bands.map((x) => x.gridColumn), ['1 / span 5']);
});

test('Page per section is one page per section with anybody in it, each laid out on its own', () => {
  const blocks = [
    { sec: 'Soprano', rows: 2, cols: 3, slots: stageOf(3, 2).slots },
    { sec: 'Alto', rows: 1, cols: 1, slots: [] },
    { sec: 'Tenor', rows: 3, cols: 6, slots: stageOf(6, 3).slots }
  ];
  const names = Object.fromEntries(blocks.flatMap((b) => b.slots).map((s) => [s.id, 'Joy Tobin']));
  const pages = printPages({ stage: stageOf(1, 1), blocks, names, layout: 'sections', colours: { Soprano: '#c00' } });
  assert.deepEqual(pages.map((p) => p.part), ['Soprano', 'Tenor']);
  assert.deepEqual(pages.map((p) => p.focus), ['Soprano', 'Tenor']);
  assert.equal(pages[0].bands[0].color, '#c00');
  assert.ok(pages[0].geo.cellW > pages[1].geo.cellW, 'each section fills its own page');
});

test('a section on its own page prints larger than the same singers on the whole stage', () => {
  const stage = stageOf(19, 4);
  const names = namesOf(stage);
  const whole = printPages({ stage, names, split: 'one' })[0];
  const block = { sec: 'Soprano', rows: 4, cols: 5, slots: stage.slots.slice(0, 20) };
  const sec = printPages({ stage, blocks: [block], names, layout: 'sections' })[0];
  assert.ok(sec.geo.namePt > whole.geo.namePt);
});

/* ---------- the warning ---------- */

test('a readable size gets no warning, and a small one gets one line saying what to do', () => {
  assert.equal(legibilityWarning(LEGIBLE_FLOOR_PT), null);
  const warn = legibilityWarning(4.26);
  assert.match(warn, /4\.3pt/);
  assert.match(warn, /By section/);
  assert.ok(!/\n/.test(warn), 'one line');
});

/* ---------- the footer ---------- */

test('the footer line names who is not seated, and is null when everyone is seated', () => {
  assert.equal(notSeatedLine(['Ann Poole', 'Ben Shaw']), 'Not seated: Ann Poole, Ben Shaw');
  assert.equal(notSeatedLine([]), null);
  assert.equal(notSeatedLine(undefined), null);
});

test('the unseated list skips the sentinels and is ordered section then name, as the bench is', () => {
  // ids IN (the seats hold them), names OUT (the sheet is read by a person)
  const roster = [
    { id: 's1', name: 'Zoe', section: 'Soprano' },
    { id: 's2', name: 'Ann', section: 'Soprano' },
    { id: 's3', name: 'Bob', section: 'Bass' },
    { id: 's4', name: 'Cal', section: 'Alto' },
    { id: 's5', name: 'Dee', section: 'Alto' }
  ];
  const seats = ['s5', EMPTY, BLOCKED];
  assert.deepEqual(unseatedNames(roster, seats), ['Ann', 'Zoe', 'Cal', 'Bob']);
});

test('renaming a singer does not move them onto the unseated list', () => {
  // The whole point of singer ids in one assertion: who is seated is decided on the id, so correcting a
  // name cannot make the printed footer claim they have nowhere to stand.
  const seats = ['s1'];
  assert.deepEqual(unseatedNames([{ id: 's1', name: 'Helen Mar', section: 'Alto' }], seats), []);
  assert.deepEqual(unseatedNames([{ id: 's1', name: 'Helen Marr', section: 'Alto' }], seats), []);
});

test('two singers sharing a name are listed independently', () => {
  const roster = [
    { id: 's1', name: 'John Smith', section: 'Bass' },
    { id: 's2', name: 'John Smith', section: 'Bass' }
  ];
  assert.deepEqual(unseatedNames(roster, ['s1']), ['John Smith'], 'only the unseated one');
  assert.deepEqual(unseatedNames(roster, []), ['John Smith', 'John Smith']);
});

test('an empty stage leaves the whole roster unseated; a full one leaves nobody', () => {
  const roster = [{ id: 's1', name: 'Ann', section: 'Soprano' }, { id: 's2', name: 'Bob', section: 'Bass' }];
  assert.deepEqual(unseatedNames(roster, []), ['Ann', 'Bob']);
  assert.deepEqual(unseatedNames(roster, ['s1', 's2']), []);
  assert.deepEqual(unseatedNames([], ['s1']), []);
});

/* ---------- the title line ---------- */

test('the sheet is titled by the loaded preset, and described when none is loaded', () => {
  assert.equal(sheetTitle('Schnittke'), 'Schnittke');
  assert.equal(sheetTitle('  '), 'Choir seating plan');
  assert.equal(sheetTitle(null), 'Choir seating plan');
});

test('document.title carries the plan name and an ISO date, for the save dialogue', () => {
  const d = new Date(2026, 8, 19);
  assert.equal(documentTitle('Schnittke', d), 'Schnittke seating plan 2026-09-19');
  assert.equal(documentTitle('', d), 'Choir seating plan 2026-09-19');
  assert.equal(isoDate(d), '2026-09-19');
  assert.equal(formatDate(d), '19 September 2026');
});

test('an unusable date is left out rather than printed as Invalid Date', () => {
  assert.equal(formatDate('not a date'), '');
  assert.equal(isoDate('not a date'), '');
  assert.equal(documentTitle('Schnittke', 'not a date'), 'Schnittke seating plan');
});

/* ---------- the paper is not a setting ---------- */

test('the default page is A4 landscape at 10mm', () => {
  assert.equal(PAGE.widthMm, 297);
  assert.equal(PAGE.heightMm, 210);
  assert.equal(PAGE.marginMm, 10);
});

test('a hyphenated surname may break after its hyphen, as the browser breaks it', () => {
  const max = textEm('Morton-') + 0.01;
  assert.equal(linesFor('Elsie Morton-Fraser', max), 3, 'Elsie / Morton- / Fraser');
  assert.equal(linesFor('Morton-Fraser', textEm('Fraser') - 0.01), Infinity);
});
