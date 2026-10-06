/*
 * manual-shots — retake the screenshots in the Choir Seating Tool user manual.
 *
 *   npm run dev                       (in another terminal)
 *   node tools/manual-shots.mjs [base-url]
 *
 * Drives the real app in a headless Chromium (the `playwright` devDependency; the first time,
 * `npx playwright install chromium`) and writes every image the pages in manual/ use, beside
 * them. Each run starts from an empty browser profile, so the app opens on the seed library's
 * first concert and the shots never show anybody's own choir.
 *
 * Rerun it after changing anything the manual shows. A page that names an image this script
 * does not take shows a broken image, so a new shot goes in both places.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = fileURLToPath(new URL('../manual/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
// An element is shot without its own border, corners and shadow: the manual draws its own frame
// round every image, and a second, differently rounded one inside it looks misaligned.
const shot = async (name, target, opts = {}) => {
  await page.waitForTimeout(250); // let a transition or a tooltip settle
  const path = OUT + name + '.png';
  if (!target) {
    await page.screenshot({ path, ...opts });
  } else {
    const was = await target.evaluate((el) => {
      // Transparent rather than none, so the element keeps its size and the shot its alignment.
      const s = el.style, old = { borderColor: s.borderColor, borderRadius: s.borderRadius, boxShadow: s.boxShadow };
      Object.assign(s, { borderColor: 'transparent', borderRadius: '0', boxShadow: 'none' });
      return old;
    });
    // Clipped to the whole device pixels inside the element's border: the border is now see-through
    // (and shows the page on an element with no background of its own), and an element at a
    // fractional position would bring a half-pixel sliver of the page round an edge. One that fits
    // the window is clipped in window terms; a taller one in page terms, from a full-page shot.
    await target.scrollIntoViewIfNeeded();
    const r = await target.evaluate((el) => {
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el), px = (v) => parseFloat(v) || 0;
      return {
        x: b.x + px(cs.borderLeftWidth), y: b.y + px(cs.borderTopWidth),
        r: b.right - px(cs.borderRightWidth), b: b.bottom - px(cs.borderBottomWidth),
        sx: scrollX, sy: scrollY, vw: innerWidth, vh: innerHeight
      };
    });
    const fits = r.x >= 0 && r.y >= 0 && r.r <= r.vw && r.b <= r.vh;
    const dx = fits ? 0 : r.sx, dy = fits ? 0 : r.sy;
    const x = Math.ceil((r.x + dx) * 2) / 2, y = Math.ceil((r.y + dy) * 2) / 2;
    const clip = { x, y, width: Math.floor((r.r + dx) * 2) / 2 - x, height: Math.floor((r.b + dy) * 2) / 2 - y };
    await page.screenshot({ path, ...opts, clip, fullPage: !fits });
    await target.evaluate((el, old) => { Object.assign(el.style, old); }, was);
  }
  console.log('  ' + name);
};
// A few px of breathing room round an element, which an element screenshot does not give.
const around = async (loc, pad = 8, extra = {}) => {
  const b = await loc.boundingBox();
  return { clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad + (extra.w || 0), height: b.height + 2 * pad + (extra.h || 0) } };
};
// Shoot an element narrowed to `width` (a CSS width), for a panel that is mostly empty at full
// width, with anything inside it matching `hide` left out. The element is put back afterwards.
const narrowShot = async (name, loc, width, hide = null) => {
  await loc.evaluate((el, [w, h]) => {
    el.style.width = w;
    if (h) el.querySelectorAll(h).forEach((c) => { c.style.display = 'none'; });
  }, [width, hide]);
  await shot(name, loc);
  await loc.evaluate((el, h) => {
    el.style.width = '';
    if (h) el.querySelectorAll(h).forEach((c) => { c.style.display = ''; });
  }, hide);
};
const button = (name) => page.getByRole('button', { name, exact: true });
const tipOff = () => page.mouse.move(2, 2);

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.locator('.cell').first().waitFor();
  await shot('overview', null);
  // After the overview, which shows the page as it is: the fixed top bar would sit over any
  // element shot taken under it, and a toast from one step ("Arranged …") would still be
  // showing in the next step's shot.
  await page.addStyleTag({ content: '.topbar, .toast { display: none !important; }' });
  // With a little air round it: the bar has no padding of its own, and the manual's rounded
  // frame would otherwise cut across the corners of the concert's name and the Compare picker.
  const planbar = page.locator('.planbar');
  await planbar.evaluate((el) => { el.style.padding = '12px 16px'; });
  await narrowShot('planbar', planbar, 'fit-content');
  await planbar.evaluate((el) => { el.style.padding = ''; });
  // The More menu, with the button it hangs from.
  await page.locator('.morebtn').click();
  const mb = await page.locator('.morebtn').boundingBox(), mm = await page.locator('.moremenu').boundingBox();
  await shot('plan-more', null, { clip: { x: mb.x - 12, y: mb.y - 12, width: mm.width + 24, height: mm.y + mm.height - mb.y + 24 } });
  await page.locator('.morebtn').click();
  // View, Colour by split and Seat labels: the line over the stage.
  await narrowShot('viewbar', page.locator('.viewline'), 'fit-content');
  // The tool strip a group at a time. Its children are the grid size, Insert, the two arrange
  // buttons and Section order: one shot is the grid size, one Insert, one the last two.
  const controls = page.locator('.toolstrip');
  await narrowShot('gridsize', controls, 'fit-content', ':scope > :not(:first-child)');
  await narrowShot('insert', controls, 'fit-content', ':scope > :not(:nth-child(2))');
  await narrowShot('arrange', controls, 'fit-content', ':scope > :nth-child(-n+2)');

  // The stage coloured by a split, so the frames and the ↕ marks show. The stage scrolls rather
  // than wraps, so the shot is taken in a wider window with its region shrunk to its columns; the
  // manual shows it at full size in a scroller (`{.wide}`).
  await page.locator('.viewline select').nth(1).selectOption({ label: '3-way' });
  await tipOff();
  await page.setViewportSize({ width: 2400, height: 860 });
  const stage = page.locator('.sections .stageregion').first();
  await stage.evaluate((el) => { el.style.width = 'max-content'; });
  await shot('stage', stage);
  await stage.evaluate((el) => { el.style.width = ''; });
  await page.setViewportSize({ width: 1280, height: 860 });

  // A singer's menu. Scrolled to the top first so the menu is drawn in the viewport.
  const singer = page.locator('.sections .cell', { hasText: 'Keira Lang' }).first();
  await singer.click();
  await page.locator('.cellmenu').waitFor();
  await shot('cell-menu', null, await around(page.locator('.cellmenu'), 70, { w: 60 }));

  // Remove them, so the waiting area has somebody in it.
  await page.locator('.cellmenu button', { hasText: 'Remove' }).click();
  await narrowShot('waiting-area', page.locator('.benchwrap'), '480px');

  // Put them back on a spare chair, then swap a soprano into the basses, so the neighbour check
  // has something to say.
  await page.getByRole('button', { name: /Auto-arrange/ }).click();
  await page.waitForTimeout(600);
  const from = page.locator('.sections .cell', { hasText: 'Kitty Symonds' }).first();
  const to = page.locator('.sections .cell', { hasText: 'Des Wyatt' }).first();
  const fb = await from.boundingBox(), tb = await to.boundingBox();
  await page.mouse.move(fb.x + 20, fb.y + 20);
  await page.mouse.down();
  await page.mouse.move(fb.x + 40, fb.y + 30, { steps: 5 });
  await page.mouse.move(tb.x + 20, tb.y + 20, { steps: 20 });
  await page.mouse.up();
  await tipOff();
  const report = page.locator('.fold').first();
  await report.scrollIntoViewIfNeeded();
  // The region is as wide as the page and the table is not: narrow it to the table for the
  // shot, so the key wraps under it instead of trailing off to the right.
  await report.evaluate((el) => { el.style.maxWidth = el.querySelector('.reptbl').offsetWidth + 60 + 'px'; });
  await shot('report', report);
  await report.evaluate((el) => { el.style.maxWidth = ''; });

  // Pointing at an entry: the stage and the report together.
  await page.locator('.report .chip.alone').first().hover();
  await page.waitForTimeout(300);
  // Bounding boxes are in viewport terms and a full-page clip is in page terms: add the scroll.
  const scrollY = await page.evaluate(() => window.scrollY);
  const s = await page.locator('.sections').boundingBox(), r = await report.boundingBox();
  await shot('report-hover', null, {
    fullPage: true,
    clip: { x: s.x - 8, y: s.y + scrollY, width: s.width + 16, height: r.y + r.height - s.y + 8 }
  });
  await tipOff();

  // Undo the swap: every later shot shows the sections whole again.
  await page.getByRole('button', { name: /Auto-arrange/ }).click();
  await page.waitForTimeout(600);

  // The Walk-on order tab: its settings, the numbered stage and the list, shot with a little air
  // round them. Taken wide like the stage and shrunk to its columns;
  // the manual shows it at full size in a scroller (`{.wide}`).
  await page.getByRole('tab', { name: 'Walk-on order' }).click();
  const walk = page.locator('.walktab');
  await walk.locator('.cell').first().waitFor();
  await page.setViewportSize({ width: 2400, height: 860 });
  await walk.evaluate((el) => { el.style.padding = '10px'; });
  await narrowShot('walkon', walk, 'fit-content');
  await walk.evaluate((el) => { el.style.padding = ''; });
  await page.setViewportSize({ width: 1280, height: 860 });

  // Set each row, the rows alternating Left and Right and the front row on Both (so the aisle
  // picker shows too): the settings card on its own. Put back to the default afterwards.
  const settings = walk.locator('.walkpanel').first();
  await settings.getByRole('button', { name: 'Set each row' }).click();
  for (const [row, dir] of [['E', 'Left'], ['D', 'Right'], ['C', 'Left'], ['B', 'Right'], ['A', 'Both']]) {
    await settings.locator('.rowitem', { hasText: 'Row ' + row }).locator('select').selectOption({ label: dir });
  }
  await tipOff();
  await narrowShot('walkon-rows', settings, '760px');
  await settings.getByRole('button', { name: 'Reset to default' }).click();
  await settings.getByRole('button', { name: 'Hide rows' }).click();
  await page.getByRole('tab', { name: 'Arrange' }).click();

  // Print options and the export menu.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.printmore').click();
  await shot('print-options', null, await around(page.locator('.printmenu').first(), 12));
  await page.locator('.printmore').click();
  await page.locator('.exportbtn').click();
  await shot('export-menu', null, await around(page.locator('.exportmenu'), 12));
  await page.locator('.exportbtn').click();

  // A plan previewed alongside: Schnittke's second plan under the working stage, both in the
  // shot. Taken wide like the stage, and shown in a scroller too.
  const pick = page.locator('.planbar select.psel').nth(1);
  const value = await pick.locator('option:not([disabled])').first().getAttribute('value');
  await pick.selectOption(value);
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 2400, height: 860 });
  const both = page.locator('.sections');
  await narrowShot('preview', both, 'max-content');
  await page.setViewportSize({ width: 1280, height: 860 });

  // Choir setup, each tab.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.rosterbtn', { hasText: 'Choir setup' }).click();
  const dlg = page.locator('dialog.rosterdialog');
  await dlg.waitFor();
  // Narrowed to its widest row (the roster buttons): at full width the tables leave most of it empty.
  for (const [tab, name] of [['Roster', 'setup-roster'], ['Concert', 'setup-concert'], ['Splits', 'setup-splits']]) {
    await dlg.getByRole('tab', { name: new RegExp('^' + tab) }).click();
    await tipOff();
    await narrowShot(name, dlg, '770px');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Settings, and its audience and seat labelling panel on its own.
  await page.locator('.cogbtn').click();
  await dlg.waitFor();
  await shot('settings', dlg);
  const labels = dlg.locator('.panel', { hasText: 'Audience & seat labelling' });
  await labels.scrollIntoViewIfNeeded();
  await narrowShot('labels', labels, 'fit-content');
} finally {
  // Leave the page before closing, so the dev server sees its sockets close rather than drop.
  await page.goto('about:blank').catch(() => {});
  await browser.close();
}
