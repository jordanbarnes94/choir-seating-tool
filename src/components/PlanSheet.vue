<template>
  <div class="plansheet">
    <!-- One printed page per entry of printPages(): the whole stage, its two halves when it is
         wide, or one section each. Every page is the same document — title line, stage, footer —
         so each one can be read on its own. -->
    <div v-for="(pg, pi) in pages" :key="pg.key" class="sheetpage">
      <!-- ONE title line — the plan name and the date — and which page this is. -->
      <div class="sheethead">
        <strong class="sheetname">{{ title }}</strong>
        <span v-if="pg.part" class="sheetpart">{{ pg.part }}</span>
        <span class="sheetmeta">{{ meta }}</span>
      </div>

      <!-- The stage, laid out for the page: the cell and name sizes come from printPlan.js as CSS
           on the stack, and every grid, band and heading below sizes itself from them. -->
      <div class="sheetstack" :style="pageVars(pg)">
        <div class="axisrow">
          <div v-if="showHeadings" class="gutter" />
          <div class="seclabels" :style="{ gridTemplateColumns: `repeat(${pg.cols}, var(--cellw))` }">
            <div
              v-for="band in pg.bands"
              :key="band.sec + band.gridColumn"
              class="seclabel"
              :style="{ gridColumn: band.gridColumn, color: band.color }"
            >
              {{ band.sec }}
            </div>
          </div>
        </div>
        <div v-if="showHeadings" class="axisrow colheadrow">
          <div class="gutter" />
          <div class="colheads" :style="{ gridTemplateColumns: `repeat(${pg.cols}, var(--cellw))` }">
            <div v-for="h in pg.colHeads" :key="h.c" class="axislabel">{{ h.text }}</div>
          </div>
        </div>
        <div class="axisrow">
          <div
            v-if="showHeadings"
            class="gutter rowheads"
            :style="{ gridTemplateRows: `repeat(${pg.rows}, var(--cellh))` }"
          >
            <div v-for="h in pg.rowHeads" :key="h.r" class="axislabel" :style="{ gridRow: h.gridRow }">{{ h.text }}</div>
          </div>
          <SeatGrid
            :slots="pg.slots"
            :rows="pg.rows"
            :stranded="planView.stranded"
            :plan="planView"
            :focus-section="pg.focus"
            :names="names"
            readonly
            sheet
          />
        </div>
        <div class="axisrow audiencerow" :class="{ attop: audienceTop }" :style="{ order: audienceTop ? -1 : 1 }">
          <div v-if="showHeadings" class="gutter" />
          <div class="audience" :style="{ width: `calc(var(--cellw) * ${pg.cols} + ${(pg.cols - 1) * 4}px)` }">AUDIENCE</div>
        </div>
      </div>

      <!-- One footer line, only when somebody is not on the stage, and only on the
           last page; its height is reserved on every page so every page lays out alike. -->
      <p class="sheetfoot">{{ pi === pages.length - 1 ? footer : '' }}</p>
    </div>

    <!-- The neighbour check: off by default, and on its own page when asked for, because the sheet the
         choir gets on the night is the one-page handout. -->
    <NeighbourReport
      v-if="showReport"
      class="sheetreport"
      :plan="planView"
      :seats="plan.seats"
      :rows="plan.rows"
      :section-order="plan.sectionOrder"
    />

    <!-- The walk-on order, when asked for: the same sheet the walk-on panel prints on its own,
         on a portrait page while the plan stays landscape (`page: choir-portrait`, below). -->
    <WalkOnSheet
      v-if="showWalkOn && walkOn"
      class="sheetwalkon"
      :list="walkOn.list"
      :waiting="waitingNames"
      :name="name"
    />

  </div>
</template>

<script setup>
import { computed } from 'vue';
/*
 * PlanSheet — the printed seating plan.
 *
 * It renders ONE plan, handed to it as a prop, and reads nothing from the store, so the same
 * component prints the live plan, a sibling arrangement, and every plan of a concert.
 *
 * - **It is not a second renderer.** The grid is `SeatGrid`, read-only, and the geometry —
 *   viewpoint, bands, headings, the section crops — is `utils/stageLayout.js`, shared with the
 *   screen. What is here is the document around them.
 * - **It is laid out for the page.** printPlan.js works out the cell size for the paper and the
 *   sheet sets it as CSS, with the width in container units so it follows the margins the print
 *   dialogue actually uses. Every strip is given an explicit height — see the CSS — so the
 *   arithmetic there is exact.
 */
import { SECTION_VIEW } from '../utils/arranger';
import { makePlanView } from '../composables/usePlanView';
import {
  PRINT_CELL,
  cellWidthCss,
  formatDate,
  notSeatedLine,
  planPrintPages,
  sheetTitle,
  stageChromeW,
  unseatedNames
} from '../utils/printPlan';
import { walkOnFor } from '../utils/walkOnList';
import NeighbourReport from './NeighbourReport.vue';
import WalkOnSheet from './WalkOnSheet.vue';
import SeatGrid from './SeatGrid.vue';

const props = defineProps({
  // A plan: { roster, splits, seats, rows, cols, sectionOrder, pins, labels, audienceAt,
  // colours, splitColours, walkOn }. The same shape concertPlan() returns and makePlanView() takes.
  plan: { type: Object, required: true },
  // Which split to colour by. Coerced to SECTION_VIEW by makePlanView when this plan has no
  // such split.
  view: { type: String, default: SECTION_VIEW },
  // The plan's name for the title line: the open concert's and its arrangement's.
  name: { type: String, default: '' },
  date: { type: Date, default: () => new Date() },
  // 'stage' draws the full stage; 'sections' puts each section on its own page.
  layout: { type: String, default: 'stage' },
  // A wide stage over two pages: 'auto' when one page would print names too small to read,
  // 'one' never, 'two' always. Full stage only.
  split: { type: String, default: 'auto' },
  // 'full' names, or 'short': first name and surname initial (printNames).
  nameStyle: { type: String, default: 'full' },
  showReport: { type: Boolean, default: false },
  // The walk-on order after the plan, on its own PORTRAIT page(s) in the same print job.
  showWalkOn: { type: Boolean, default: false },
  showHeadings: { type: Boolean, default: true }
});

const planView = computed(() => makePlanView(props.plan, props.view));
const audienceTop = computed(() => props.plan.audienceAt === 'top');

// Every page this plan prints as, laid out, and what each singer is called on them. The split
// label only takes room in a cell when the sheet is coloured by a split.
const printed = computed(() =>
  planPrintPages(props.plan, {
    layout: props.layout,
    split: props.split,
    nameStyle: props.nameStyle,
    label: planView.value.ui.view !== SECTION_VIEW,
    showHeadings: props.showHeadings,
    colours: planView.value.sectionColours
  })
);
const pages = computed(() => printed.value.pages);
const names = computed(() => printed.value.names);

// The CSS a page's grid sizes itself from. The width follows the printed width through `cqw`;
// the depth and the name size are printPlan.js's, worked out for A4.
function pageVars(pg) {
  const cols = Math.max(1, geoCols(pg));
  const chromePx = stageChromeW(props.showHeadings) + (cols - 1) * PRINT_CELL.gap;
  const label = planView.value.ui.view !== SECTION_VIEW;
  return {
    '--cellw': cellWidthCss([{ cols, chromePx }]),
    '--cellh': `${Math.floor(pg.geo.cellH * 100) / 100}px`,
    '--namefont': `${Math.floor(pg.geo.fontPx * 100) / 100}px`,
    '--namelines': String(pg.geo.lines),
    '--labelroom': label ? `${Math.round((pg.geo.fontPx * 0.85 + 2) * 100) / 100}px` : '0px'
  };
}
// The halves of a split stage are drawn at the WIDER half's cell size, so the narrower one does
// not stretch to fill its page and the two still line up side by side.
function geoCols(pg) {
  if (!pg.key.startsWith('stage-')) return pg.cols;
  return Math.max(...pages.value.map((p) => p.cols));
}

// Built from the PLAN's walk-on block, not the store's, so a concert pack prints each plan's own
// order, through the same walkOnFor() the live view uses.
const walkOn = computed(() => {
  const w = props.plan.walkOn;
  return w ? walkOnFor(props.plan.seats, props.plan.rows, props.plan.cols, w, props.plan.labels, props.plan.audienceAt, planView.value.byId) : null;
});
// The singers with no seat, for the footer and the walk-on sheet.
const waitingNames = computed(() => unseatedNames(props.plan.roster, props.plan.seats));

const title = computed(() => sheetTitle(props.name));
const meta = computed(() => formatDate(props.date));

// Always in the DOM and empty when everyone is seated: its height is reserved either way.
const footer = computed(() => notSeatedLine(waitingNames.value) || '');
</script>

<style scoped>
/* ---------- the document ----------
   Sizes here are in printPlan.js's SHEET, which is what the page arithmetic is computed from.
   THEY MUST AGREE: change one and change the other, or the sheet stops fitting the page. Each
   strip is given an explicit height rather than left to the text, so that a long section name or
   a font that failed to load can never push the plan onto a second sheet.
   A size container, so the cell width can be written in `cqw` and follow the printed width. */
.plansheet {
  container-type: inline-size;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #1d2330;
  background: #fff;
  /* Force the fills. The section colours are inline `tint()` BACKGROUNDS, and every
     browser omits backgrounds from print unless the user ticks "Background graphics" — so
     without this the sheet keeps the split FRAMES (borders print regardless) and loses the
     section colours, which is exactly backwards for a stage plan. The sheet is still designed to
     be correct in pure mono, because most choir printers are. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Several sheets in one print job — a whole concert's seating plans. Each starts a new
   page, which is what makes a pack of them a pack rather than a run-on. The FIRST does not,
   or every job would open with a blank page, so the rule is on the sibling combinator and not
   on `.plansheet` itself. */
.plansheet + .plansheet {
  break-before: page;
  page-break-before: always; /* the pre-fragmentation spelling, for older print engines */
}
/* Every page after a sheet's first starts a new sheet of paper: a split stage's second half, or
   the next section. */
.sheetpage + .sheetpage {
  break-before: page;
  page-break-before: always;
}
/* Every landscape part names its page itself rather than inheriting it, because the document
   around it is not always landscape: when a walk-on order prints last, ChoirArranger puts the
   whole document on the portrait page, since Chrome ends a print on the DOCUMENT's page and adds
   a blank one if that differs from the last thing printed. */
.sheetpage,
.sheetreport {
  page: choir;
}
.sheethead {
  height: 30px; /* SHEET.headerH */
  display: flex;
  align-items: baseline;
  gap: 10px;
  overflow: hidden;
  white-space: nowrap;
}
.sheetname {
  font-size: 14px;
  font-weight: 700;
}
.sheetpart {
  font-size: 12px;
  font-weight: 600;
  color: #36404f;
}
.sheetmeta {
  font-size: 10px;
  color: #4a5567;
}
.sheetfoot {
  height: 16px; /* SHEET.footerH */
  margin: 10px 0 0; /* SHEET.footerGap */
  font-size: 10px;
  color: #1d2330;
  overflow: hidden;
}
/* ---------- the stage, laid out exactly as StageView does ----------
   The same .axisrow stack, so the bands, the headings, the grid and the AUDIENCE bar stay in one
   column and the bands keep tracking the seats. It is a separate set of rules and not StageView's
   because the printed document has no card, no caption, no legend and no toggle — but the
   geometry it is laying out is stageLayout's, shared with the screen. */
.sheetstack {
  display: flex;
  flex-direction: column;
}
.axisrow {
  display: flex;
  align-items: flex-start;
  gap: 6px; /* SHEET.gutterGap */
}
.gutter {
  width: 26px; /* SHEET.gutter */
  flex: none;
}
.rowheads {
  display: grid;
  gap: 4px;
}
.seclabels {
  display: grid;
  grid-auto-columns: var(--cellw);
  gap: 4px;
  height: 20px; /* SHEET.bandH */
  margin-bottom: 6px; /* SHEET.bandGap */
  width: max-content;
}
.seclabel {
  grid-row: 1;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 3px solid currentColor;
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
}
.colheadrow {
  margin-bottom: 4px; /* SHEET.colHeadGap */
}
.colheads {
  display: grid;
  grid-auto-columns: var(--cellw);
  gap: 4px;
  height: 13px; /* SHEET.colHeadH */
  width: max-content;
}
.axislabel {
  font-size: 11px;
  font-weight: 700;
  color: #36404f;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}
.audiencerow {
  margin-top: 8px; /* SHEET.audienceGap */
}
.audiencerow.attop {
  margin-top: 0;
  margin-bottom: 8px;
}
.audience {
  height: 22px; /* SHEET.audienceH */
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #36404f;
  border: 1px solid #b8c1cd;
  border-radius: 4px;
}
/* ---------- the optional neighbour check ----------
   Its own page: the sheet the choir is handed on the night is the one-page plan, and a QA table
   underneath it would be read as part of the plan. */
.sheetreport {
  break-before: page;
  page-break-before: always; /* the pre-fragmentation spelling, for older print engines */
  margin-top: 16px;
}
/* The walk-on order: its own page, and a portrait one. A change of named page is itself a page
   break, and ChoirArranger defines `choir-portrait` as A4 portrait, so the print job goes
   landscape plan, portrait list. Browsers that ignore named pages (Safari) print it on the
   dialogue's orientation instead. */
.sheetwalkon {
  page: choir-portrait;
  break-before: page;
  page-break-before: always;
}
</style>
