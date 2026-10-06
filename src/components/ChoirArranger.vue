<template>
  <div class="choir-app">
    <!-- One surface, built like Choir setup's dialog: a header naming the plan, the two tabs, then
         the open tab's regions under each other with a rule between them. -->
    <div class="workspace">
      <header class="apphead">
        <h1>Choir Splits Arranger</h1>
        <!-- the seating plan being edited: switch, save, duplicate, and compare others with it -->
        <PlanBar />
        <!-- Apart from the plan beside them: these change the whole app (the roster, the concerts,
             colours, backup), where everything under them works on the plan on screen. -->
        <div class="setupbtns">
          <button class="cbtn rosterbtn" :class="{ on: store.rosterOpen.value && store.setupScreen.value === 'setup' }" @click="openSetup('setup')">
            Choir setup
          </button>
          <button
            class="cbtn iconbtn cogbtn"
            :class="{ on: store.rosterOpen.value && store.setupScreen.value === 'settings' }"
            data-tip="Settings: colours, seat labelling, backup"
            aria-label="Settings"
            @click="openSetup('settings')"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button class="cbtn iconbtn helpbtn" type="button" aria-label="Getting started" data-tip="Getting started" @click="openHelp">?</button>
        </div>
      </header>

      <!-- The two jobs, one tab each: arranging the seating, and the walk-on order once the seating
           is settled. Neither needs the other on screen. Print and Download take the plan off the
           screen whichever tab is open, so they sit on the strip with the tabs. No overflow on the
           strip: it would clip their menus. -->
      <div class="tabstrip">
        <div class="tabs" role="tablist" aria-label="Arrange or walk-on order">
          <button class="tab" role="tab" :aria-selected="store.ui.tab === 'arrange'" :class="{ on: store.ui.tab === 'arrange' }" @click="store.ui.tab = 'arrange'">Arrange</button>
          <button class="tab" role="tab" :aria-selected="store.ui.tab === 'walkon'" :class="{ on: store.ui.tab === 'walkon' }" @click="store.ui.tab = 'walkon'">Walk-on order</button>
        </div>
        <div v-if="store.data.value.length" class="outputs">
          <!-- Print. The button, and its options in a small popover beside it. A
               legibility warning shows as a mark on the options button. -->
          <div ref="printBox" class="outbox">
            <button class="cbtn printbtn" type="button" @click="printPlan">
              <svg class="picon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>Print / Save as PDF
            </button>
            <button
              class="cbtn printmore"
              type="button"
              :aria-expanded="printMenu"
              :data-tip="printWarning || 'Print options'"
              @click="printMenu = !printMenu"
            >Options<span v-if="printWarning" class="warnmark" aria-label="warning">!</span> ▾</button>
            <div v-if="printMenu" class="cmenu printmenu" role="group" aria-label="Print options">
              <label class="pmrow">
                <span class="pmlabel">Layout</span>
                <select v-model="printLayout" class="csel">
                  <option value="stage">Full stage</option>
                  <option value="sections">Page per section</option>
                </select>
              </label>
              <!-- Full stage only: By section is a page per section already. Auto goes to two pages
                   when one would print the names too small to read. -->
              <label v-if="printLayout === 'stage'" class="pmrow">
                <span class="pmlabel">Pages</span>
                <select v-model="printSplit" class="csel">
                  <option value="auto">Auto: two if one prints too small</option>
                  <option value="one">One</option>
                  <option value="two">Two: left half and right half</option>
                </select>
              </label>
              <label class="pmrow">
                <span class="pmlabel">Names</span>
                <select v-model="printNameStyle" class="csel">
                  <option value="full">Full</option>
                  <option value="short">First name + initial (prints larger)</option>
                </select>
              </label>
              <label class="ccheck"><input v-model="printReport" type="checkbox"> Include the neighbour check</label>
              <label class="ccheck"><input v-model="printWalkOn" type="checkbox"> Include the walk-on order (on a portrait page)</label>
              <!-- Only when there is more than one plan to print. -->
              <label v-if="store.concertPlans.value.length > 1" class="ccheck">
                <input v-model="printConcert" type="checkbox"> Every seating plan in this concert ({{ store.concertPlans.value.length }})
              </label>
              <span class="printhint">A4 landscape, each page filled. For a PDF, choose <b>Save as PDF</b> in the print dialogue.</span>
              <span v-if="printWarning" class="printwarn">{{ printWarning }}</span>
            </div>
          </div>
          <!-- Exports, beside Print because both take the plan off the screen, and in a menu because
               there are up to three of them. A seating export is for printing or emailing and can't
               be read back in; moving plans between devices is Settings' backup. -->
          <div ref="exportBox" class="outbox">
            <button class="cbtn exportbtn" type="button" :aria-expanded="exportMenu" @click="exportMenu = !exportMenu">Download spreadsheet ▾</button>
            <div v-if="exportMenu" class="cmenu exportmenu" role="menu" aria-label="Download spreadsheet">
              <button class="cmenuitem" type="button" role="menuitem" @click="doExport(store.exportSeatingCSV)">
                <b>Current plan</b>
                <span>The seating plan on screen, laid out like the stage.</span>
              </button>
              <button v-if="store.concertPlans.value.length > 1" class="cmenuitem" type="button" role="menuitem" @click="doExport(store.exportConcertSeatingCSV)">
                <b>All plans</b>
                <span>Every seating plan of this concert, one block each.</span>
              </button>
              <button class="cmenuitem" type="button" role="menuitem" @click="doExport(store.exportWalkOnCSV)">
                <b>Walk-on order</b>
                <span>The current plan's walk-on order, one singer per line.</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <template v-if="store.ui.tab === 'arrange'">
        <!-- tools: these change the stage and where people sit. -->
        <div class="toolstrip">
          <div class="tgroup">
            <label class="clabel">
              Rows
              <input class="num" type="number" min="1" max="8" :value="store.gridRows.value" @change="onRows" />
            </label>
            <label class="clabel">
              Columns
              <input class="num" type="number" min="1" max="40" :value="store.gridCols.value" @change="onCols" />
            </label>
          </div>

          <div class="tgroup">
            <span class="clabel" data-tip="Drag one onto a seat">Insert</span>
            <div
              class="spacetool block"
              data-tip="Drag onto a seat to insert a blocked seat there — everyone in that row shifts one seat to the right (nobody can sit on a blocked seat). Click or tap a blocked seat for a menu to remove it."
              @pointerdown="onBlockDown"
              @contextmenu.prevent
            >⊘ Block</div>
            <div
              class="spacetool space"
              data-tip="Drag onto a seat to open a gap — everyone in that row shifts one seat to the right."
              @pointerdown="onSpaceDown"
              @contextmenu.prevent
            >⇥ Space</div>
          </div>

          <!-- Both reseat singers as soon as they are clicked. -->
          <div class="tgroup">
            <button class="cbtn primary" @click="store.autoArrange" data-tip="Seat everyone, the waiting area too, so each singer has a group-mate next to them. Locked singers and blocked chairs stay put.">↻ Auto-arrange</button>
            <button class="cbtn" @click="store.compact" data-tip="Close up the gaps, packing everyone toward the front-left. Locked singers and blocked chairs stay put.">⇤ Compact</button>
          </div>

          <!-- Saved with the plan, and read by Auto-arrange: changing it moves nobody until the next
               arrange. Left to right as the audience sees it, whichever way round the plan is drawn. -->
          <div class="tgroup">
            <span class="clabel" data-tip="Left to right from the audience. Auto-arrange follows it: changing it moves nobody until the next arrange.">Section order</span>
            <div class="secorder">
              <!-- An arrow only where the section can move: none outward at either end. -->
              <span v-for="(s, i) in store.sectionOrder.value" :key="s" class="secchip">
                <button v-if="i" class="secmove" type="button" :data-tip="`Move ${s} left`" :aria-label="`Move ${s} left`" @click="store.moveSection(s, -1)">←</button>
                <span class="secname"><span class="secdot" :style="{ background: store.sectionColours.value[s] }" />{{ s }}</span>
                <button v-if="i < store.sectionOrder.value.length - 1" class="secmove" type="button" :data-tip="`Move ${s} right`" :aria-label="`Move ${s} right`" @click="store.moveSection(s, 1)">→</button>
              </span>
            </div>
          </div>
        </div>

        <p v-if="!store.data.value.length" class="emptyhint">
          No singers yet — open <b>Choir setup</b> to add singers or import a spreadsheet.
        </p>
        <template v-else>
          <!-- how the plan is displayed. Nothing here moves a singer. -->
          <div class="viewline">
            <label class="clabel">
              View
              <select v-model="store.ui.mode" class="csel">
                <option value="stage">Full stage</option>
                <option value="bysection">By section</option>
              </select>
            </label>
            <label class="clabel" :data-tip="store.SCH.value.length ? '' : 'No splits yet: add them in Choir setup'">
              Colour by split
              <select v-model="store.ui.view" class="csel" :disabled="!store.SCH.value.length">
                <option v-for="chip in colourChips" :key="chip.id" :value="chip.id">{{ chip.label }}</option>
              </select>
            </label>
            <label v-if="store.ui.mode === 'stage'" class="ccheck labelsopt"><input v-model="store.ui.headings" type="checkbox"> Seat labels</label>
            <MarkedPill />
          </div>

          <div class="sections">
            <template v-if="store.ui.mode === 'stage'">
              <StageView />
              <!-- In stage mode each preview is a region BELOW the working stage, at the same cell size.
                   In by-section mode they are not here at all: each SectionBlock draws them beside itself. -->
              <ReferencePane v-for="pv in store.previews.value" :key="pv.key" :preview="pv" />
            </template>
            <template v-else>
              <SectionBlock v-for="s in store.sectionOrder.value" :key="s" :sec="s" />
            </template>
          </div>

          <WaitingArea class="benchwrap" />

          <!-- Under the stage, the neighbour check, which folds away: open by default because it is
               read while arranging. Its header says enough while folded that it need not be opened just
               to check. -->
          <section class="fold" :class="{ open: store.ui.report }">
            <button class="foldhead" type="button" :aria-expanded="store.ui.report" @click="store.ui.report = !store.ui.report">
              <!-- The title first, on the waiting area's indent, and the chevron after it. -->
              <span class="foldtitle">Neighbour check</span>
              <svg class="foldarrow" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="2.5 4.5 6 8 9.5 4.5" />
              </svg>
              <span class="foldsum" :class="{ bad: !neighbourOk }">{{ neighbourText }}</span>
            </button>
            <NeighbourReport v-if="store.ui.report" class="foldbody" />
          </section>
        </template>
      </template>

      <!-- The Walk-on order tab: its settings, a read-only stage numbered with them, and the list. -->
      <template v-else>
        <WalkOnPanel v-if="store.data.value.length" @print="printWalkOnSheet" />
        <p v-else class="emptyhint">
          No singers yet — open <b>Choir setup</b> to add singers or import a spreadsheet.
        </p>
      </template>
    </div>

    <RosterDialog />

    <!-- The printed sheet. Mounted only while printing, and `display: none` on screen:
         it is a second SeatGrid of up to 320 cells and there is no reason to carry it the rest
         of the time. It is handed the live plan as one plain object, exactly as any
         other caller would hand it one — the walk-on list and the whole-concert print
         inherit this path and must be able to pass a plan that is not the live one. -->
    <div id="choir-print-root">
      <!-- The same sheet, repeated, each on its own page. A
           whole-concert print is this component repeated per plan and never a third renderer,
           which is why the only thing that changes here is the list it is fed. -->
      <!-- The walk-on order prints on its own, portrait, from the Walk-on order tab's "Print the list". -->
      <WalkOnSheet
        v-if="printing && printKind === 'walkon'"
        :list="store.walkOnPlan.value.list"
        :waiting="store.waitingNames.value"
        :name="planName"
      />
      <template v-else-if="printing">
        <PlanSheet
          v-for="sheet in printSheets"
          :key="sheet.id"
          :plan="sheet.plan"
          :view="store.ui.view"
          :name="sheet.name"
          :layout="printLayout"
          :split="printSplit"
          :name-style="printNameStyle"
          :show-report="printReport"
          :show-walk-on="printWalkOn"
        />
      </template>
    </div>

    <!-- help: how the arranger works + the controls -->
    <dialog ref="helpDlg" class="help" @cancel.prevent="closeHelp" @click="onHelpClick">
      <div class="helpbox">
        <header class="helphead">
          <h2>Getting started</h2>
          <button class="helpclose" type="button" aria-label="Close" @click="closeHelp">×</button>
        </header>
        <div class="helpbody">
          <p>
            The arranger seats a choir so that everyone has someone from their own group next to them, across every way the
            sections are split at once. It prefers a neighbour beside you over one in front or behind.
          </p>
          <ol class="helpsteps">
            <li><b>Set up the choir.</b> In <b>Choir setup</b>, add your singers (or import a spreadsheet), make a concert, and add its splits: for each piece, how the parts divide.</li>
            <li><b>Arrange.</b> Set the rows and columns to your stage and press <b>Auto-arrange</b>.</li>
            <li><b>Adjust by hand.</b> Drag a singer onto another chair to swap them. On a phone, hold a chair for a moment first. Click or tap a singer for a menu to <b>lock</b> them in place before arranging again.</li>
            <li><b>Share it.</b> <b>Print / Save as PDF</b>, or <b>Download spreadsheet</b>. The <b>Walk-on order</b> tab gives the order to file on.</li>
          </ol>
          <p>The example choir and its two concerts are there to try things on: change them or delete them as you like. Hover over a button for a short note on what it does.</p>
          <p><a class="helplink" href="manual/getting-started.html" target="_blank">Read the full user manual →</a></p>
          <p class="helpnote">Everything is saved in this browser, on this device only. Use <b>Save backup file</b> in <b>Settings</b> (the cogwheel) to keep a copy or move to another device.</p>
        </div>
      </div>
    </dialog>

    <!-- What is stored was written by a newer version of the tool (storedIsNewer in the store).
         A modal that cannot be dismissed: everything behind it is inert, and nothing is saved. -->
    <dialog ref="newerDlg" class="newer" aria-labelledby="newer-title" @cancel.prevent>
      <div class="newerbox">
        <h2 id="newer-title">Your choirs were saved by a newer version</h2>
        <p>This is version {{ appVersion }} of Choir Seating Tool, which cannot read them. Nothing has been changed: your choirs are still there.</p>
        <p><a :href="appHomepage" target="_blank" rel="noopener">Update Choir Seating Tool</a> to carry on with them.</p>
        <p class="newerout">Or delete them and start again in this version, from the example choir. <button class="cbtn newerdelete" type="button" @click="discardStored">Delete my choirs</button></p>
      </div>
    </dialog>

    <!-- busy overlay: a top-layer <dialog> so the spinner shows above the roster modal too -->
    <dialog ref="busyDlg" class="busy" @cancel.prevent>
      <div class="busybox"><div class="spinner" /><div class="busylabel">{{ store.busy.text }}</div></div>
    </dialog>

    <!-- toast -->
    <div class="toast" :class="{ show: store.toast.show, nochange: store.toast.nochange }" role="status" aria-live="polite">
      {{ store.toast.text }}
    </div>

    <TipLayer />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { SECTION_VIEW, rosterById } from '../utils/arranger';
import { documentTitle, legibilityWarning, planPrintPages } from '../utils/printPlan';
import { cropToSection } from '../utils/stageLayout';
import { useChoirArranger } from '../composables/useChoirArranger';
import { usePress } from '../composables/useDragDrop';
import StageView from './StageView.vue';
import MarkedPill from './MarkedPill.vue';
import WalkOnPanel from './WalkOnPanel.vue';
import SectionBlock from './SectionBlock.vue';
import ReferencePane from './ReferencePane.vue';
import WaitingArea from './WaitingArea.vue';
import NeighbourReport from './NeighbourReport.vue';
import PlanSheet from './PlanSheet.vue';
import WalkOnSheet from './WalkOnSheet.vue';
import RosterDialog from './RosterDialog.vue';
import PlanBar from './PlanBar.vue';
import TipLayer from './TipLayer.vue';

function openSetup(screen) {
  store.setupScreen.value = screen;
  store.rosterOpen.value = true;
}

const store = useChoirArranger();

// The tools are dedicated drag handles (touch-action:none): a move starts the drag.
const blockPress = usePress({ fireOnMove: true });
const spacePress = usePress({ fireOnMove: true });
const busyDlg = ref(null);
const newerDlg = ref(null);
const appVersion = __APP_VERSION__;
const appHomepage = __APP_HOMEPAGE__;
// Shown the moment the store finds newer work, at startup or at a later save.
watch(() => store.storedIsNewer.value, (newer) => {
  if (newer && !newerDlg.value.open) newerDlg.value.showModal();
}, { flush: 'post' });
function discardStored() {
  if (!confirm('Delete every roster, concert, seating plan and colour scheme stored here? This cannot be undone.')) return;
  store.discardStoredWork();
  location.reload();
}
const helpDlg = ref(null);

function openHelp() {
  helpDlg.value?.showModal();
}
function closeHelp() {
  helpDlg.value?.close();
}
// close when the backdrop (the dialog element itself, outside .helpbox) is clicked.
function onHelpClick(e) {
  if (e.target === helpDlg.value) closeHelp();
}

// drive the busy <dialog> in/out of the top layer to mirror store.busy.open.
watch(() => store.busy.open, (open) => {
  const el = busyDlg.value;
  if (!el) return;
  if (open && !el.open) el.showModal();
  if (!open && el.open) el.close();
});

// The folded panels' one-line headers.
const neighbourOk = computed(() => !store.neighbourSummary.value.alone && !store.neighbourSummary.value.broken);
const neighbourText = computed(() => {
  const { alone, broken } = store.neighbourSummary.value;
  if (!alone && !broken) return '✓ everyone has a neighbour';
  const parts = [];
  if (alone) parts.push(`${alone} singer${alone === 1 ? '' : 's'} alone`);
  if (broken) parts.push(`${broken} split group${broken === 1 ? '' : 's'}`);
  return parts.join(' · ');
});
// Which tab is open, and whether the neighbour check is, are remembered per browser: a
// preference about the screen, so it is not saved with the plan, and it has to be allowed to
// fail (private windows, blocked storage) without the page caring.
const FOLD_KEY = 'choir-folds';
function restoreFolds() {
  try {
    const f = JSON.parse(localStorage.getItem(FOLD_KEY) || 'null');
    if (f && typeof f === 'object') {
      if (typeof f.report === 'boolean') store.ui.report = f.report;
      if (f.tab === 'arrange' || f.tab === 'walkon') store.ui.tab = f.tab;
    }
  } catch {}
}
watch(() => [store.ui.report, store.ui.tab], ([report, tab]) => {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify({ report, tab }));
  } catch {}
});

const colourChips = computed(() => [
  { id: SECTION_VIEW, label: 'No split' },
  ...store.SCH.value.map((s) => ({ id: s, label: store.SCH_LABEL.value[s] }))
]);

function onRows(e) {
  store.setGridRows(Number(e.target.value));
  e.target.value = store.gridRows.value; // reflect the clamped value back into the input
}
function onCols(e) {
  store.setGridCols(Number(e.target.value));
  e.target.value = store.gridCols.value;
}
function onBlockDown(e) { blockPress.down(e, () => ({ block: true })); }
function onSpaceDown(e) { spacePress.down(e, () => ({ space: true })); }

/* ---------- printing ---------- */
// The plan the sheet draws, as one plain object. This is the seam printing
// turns on: PlanSheet reads nothing from the store, so the same component draws the live plan
// here, a sibling arrangement for a preview, and every arrangement of a concert in one print.
// It used to be an object literal here, and it lost a field to each of three features in
// turn: the sheet printed the default palette, then had no walk-on list to draw, then drew the
// wrong frames — three times two correct features that had never met. The list now lives in
// utils/plan.js, the store builds it, and `test/plan.test.js` fails if this component's
// sheet learns to read a field the list does not declare.
const livePlan = store.livePlan;
// A concert and its arrangement are both named, so
// the sheet can say which plan it is AND which version of it.
const planName = computed(() => {
  const c = store.openConcertName.value, a = store.openArrangementName.value;
  return c && a ? `${c} — ${a}` : c || '';
});
// The smallest name size a plan would print at with the options chosen, from the same page
// plan the sheet draws itself from.
function printedNamePt(plan) {
  const { pages } = planPrintPages(plan, {
    layout: printLayout.value,
    split: printSplit.value,
    nameStyle: printNameStyle.value,
    label: store.ui.view !== SECTION_VIEW
  });
  return pages.length ? Math.min(...pages.map((p) => p.geo.namePt)) : Infinity;
}
// The warning, across every sheet that is going to print, naming the first offender, and shown
// BEFORE the dialogue opens, which is the only moment the user can still do something about it.
const printWarning = computed(() => {
  for (const sheet of printSheets.value) {
    const warn = legibilityWarning(printedNamePt(sheet.plan));
    if (warn) return printSheets.value.length > 1 ? `${sheet.name}: ${warn}` : warn;
  }
  return '';
});

const printing = ref(false);
const printMenu = ref(false);
const printBox = ref(null);
// The Export menu: one button in the bar, the three downloads under it.
const exportMenu = ref(false);
const exportBox = ref(null);
function doExport(fn) {
  exportMenu.value = false;
  fn();
}
// Full stage, or each section on its own page.
const printLayout = ref('stage');
// A wide stage over two pages: 'auto' (when one page would be too small to read), 'one', 'two'.
const printSplit = ref('auto');
// Full names, or first name and surname initial.
const printNameStyle = ref('full');
const printReport = ref(false); // off by default
// Off by default for the same reason the other two are: the common print is the one plan on
// screen, and a director who wanted four pages asks for them.
const printConcert = ref(false);
// What actually goes on the paper: one sheet, or one per seating plan in the concert. The open
// plan's sheet is drawn from the WORKING COPY either way (see `concertPlans` in the store), so a
// printed pack always matches the screen for the plan the screen is showing.
const printSheets = computed(() => {
  if (!printConcert.value || store.concertPlans.value.length < 2)
    return [{ id: store.openArrangementId.value || 'live', plan: livePlan.value, name: planName.value }];
  const concertName = store.openConcertName.value;
  return store.concertPlans.value.map((a) => ({ id: a.id, plan: a.plan, name: concertName ? `${concertName} — ${a.name}` : a.name }));
});
// What is being printed: the seating plan ('plan'), or the walk-on order on its own ('walkon').
// The walk-on order used to be an option on the plan's print; it is its own print now, portrait,
// because it is a different document for different people. Only the walk-on panel's Print
// button sets 'walkon'; Ctrl+P and the browser's own print always get the plan.
const printKind = ref('plan');
// The walk-on order after the plan in the same print, off by default: the plan is the choir's
// handout, the list is the stewards'. Printed portrait either way.
const printWalkOn = ref(false);
let titleBeforePrint = null;

function endPrint() {
  printing.value = false;
  printKind.value = 'plan';
  document.documentElement.classList.remove('choir-portrait');
  if (titleBeforePrint !== null) {
    document.title = titleBeforePrint;
    titleBeforePrint = null;
  }
}

// The two popovers close on a click anywhere outside them.
function onDocPointer(e) {
  if (printMenu.value && printBox.value && !printBox.value.contains(e.target)) printMenu.value = false;
  if (exportMenu.value && exportBox.value && !exportBox.value.contains(e.target)) exportMenu.value = false;
}

// Mount the sheet and set the title. The filename is the browser's to choose and `document.title`
// is the only lever we have on its suggestion, so it is set before the dialogue
// opens and put back after.
function startPrint() {
  if (printing.value) return;
  titleBeforePrint = document.title;
  // A walk-on order is the last thing on the paper when it is included, and the document has to
  // end on the page type of its last section or Chrome adds a blank page (see the print CSS).
  document.documentElement.classList.toggle('choir-portrait', printWalkOn.value);
  // The filename the browser suggests names the PACK when there is one, not its first sheet.
  document.title = printSheets.value.length > 1
    ? documentTitle(`${store.openConcertName.value} — all`, new Date(), 'seating plans')
    : documentTitle(planName.value, new Date());
  printing.value = true;
}

// The walk-on order, on its own, on A4 portrait. `choir-portrait` on <html> switches the named
// page the whole document prints on (see the print CSS below).
async function printWalkOnSheet() {
  if (printing.value) return;
  printKind.value = 'walkon';
  document.documentElement.classList.add('choir-portrait');
  titleBeforePrint = document.title;
  document.title = documentTitle(planName.value, new Date(), 'walk-on order');
  printing.value = true;
  await nextTick();
  window.print();
}

async function printPlan() {
  printMenu.value = false;
  startPrint();
  await nextTick(); // the sheet has to be in the DOM before the print dialogue reads it
  window.print();
  // The sheet comes down on `afterprint`, not here: on an engine whose print() returns before
  // the page is rendered, unmounting now would print a blank page.
}

onMounted(() => {
  store.init();
  restoreFolds();
  // Ctrl+P, File > Print and a share-sheet print never reach the button, and the print CSS hides
  // everything but the sheet, so the sheet is mounted for them too.
  window.addEventListener('beforeprint', startPrint);
  window.addEventListener('afterprint', endPrint);
  document.addEventListener('pointerdown', onDocPointer);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', startPrint);
  window.removeEventListener('afterprint', endPrint);
  document.removeEventListener('pointerdown', onDocPointer);
});
</script>

<style scoped>
.choir-app {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #1d2330;
}
/* The one surface. No overflow: the Print, Download and More menus hang out of their rows. */
.workspace {
  background: #fff;
  border: 1px solid #d3d9e0;
  border-radius: 12px;
}
/* In a window of its own the surface is the window, not a card on a page (see App.vue). */
:root.app-window .workspace {
  border: 0;
  border-radius: 0;
}
:root.app-window .apphead,
:root.app-window .fold:not(.open) .foldhead,
:root.app-window .fold .foldbody {
  border-radius: 0;
}
/* The title, the plan, and the app-level buttons. The plan takes the middle and wraps inside it. */
.apphead {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px 20px;
  padding: 12px 16px;
  background: #fafbfc;
  border-bottom: 1px solid #e2e6ec;
  border-radius: 11px 11px 0 0;
}
.choir-app h1 {
  font-size: 17px;
  margin: 0;
  white-space: nowrap;
}
.setupbtns {
  grid-column: 3;
  display: flex;
  gap: 6px;
}
.setupbtns .iconbtn {
  width: 34px;
  padding: 0;
}
.setupbtns .helpbtn {
  font-size: 15px;
  font-weight: 700;
}
/* ---------- the tab strip: Choir setup's folder tabs ---------- */
.tabstrip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0 16px;
  padding: 6px 16px 0;
  background: #fafbfc;
  /* the rule under the tabs is an inset shadow, which the open tab's white bottom border covers */
  box-shadow: inset 0 -1px 0 #e2e6ec;
}
.tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.tab {
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 600;
  color: #5a6573;
  background: transparent;
  cursor: pointer;
}
.tab:hover:not(.on) {
  color: #2f4368;
  background: #eef1f5;
}
.tab.on {
  color: #2f4368;
  background: #fff;
  border-color: #e2e6ec;
  border-bottom: 1px solid #fff;
}
/* Print and Download: the right-hand end of the strip, apart from the tabs */
.outputs {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 7px;
}
.outbox {
  position: relative;
  display: flex;
  gap: 6px;
}
/* An inline printer, not the 🖨 emoji: Windows draws that as a flat, unreadable glyph. */
.picon {
  display: inline-block;
  width: 1.15em;
  height: 1.15em;
  margin-right: 6px;
}
.warnmark {
  display: inline-block;
  margin-left: 5px;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  color: #fff;
  background: #c77700;
}
/* the print options: what has to be chosen, and the two lines that have to be read, before the
   print dialogue opens rather than found on the paper afterwards */
.cmenu.printmenu {
  width: 320px;
  gap: 8px;
  padding: 12px;
}
.cmenu.exportmenu {
  width: 280px;
}
.pmrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pmrow .csel {
  flex: 1 1 auto;
  min-width: 0;
}
.pmlabel {
  flex: none;
  width: 44px;
  font-size: 12px;
  font-weight: 600;
  color: #5a6573;
}
.printmenu .ccheck {
  font-size: 12px;
}
.printhint {
  font-size: 11px;
  color: #5a6573;
  line-height: 1.35;
}
/* a warning, not a block: the sheet still prints on one page */
.printwarn {
  font-size: 11px;
  line-height: 1.35;
  color: #9a5b00;
  background: #fdf2dc;
  border: 1px solid #f0d9a8;
  border-radius: 6px;
  padding: 5px 8px;
}
/* ---------- the tool strip: one row of labelled groups, wrapping a whole group at a time ---------- */
.toolstrip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 24px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e6ec;
}
.tgroup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
input.num {
  width: 54px;
  height: 34px;
  padding: 0 0 0 8px;
  font-size: 13px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #fff;
  color: #1d2330;
}
.spacetool {
  height: 34px;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  font-size: 13px;
  font-weight: 600;
  padding: 0 12px;
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  white-space: nowrap;
}
.spacetool:active {
  cursor: grabbing;
}
/* Each tool looks like the chair it drops: SeatGrid's blocked seat and empty seat. */
.spacetool.block {
  border: 2px solid #b9aeae;
  background: repeating-linear-gradient(45deg, #e7e3e3 0 7px, #d8d2d2 7px 14px);
  color: #6f6464;
}
.spacetool.space {
  border: 2px dashed #c9d0da;
  background: #fff;
  color: #6b7688;
}
/* the section order: each section as a chip, with an arrow each way it can move */
.secorder {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.secchip {
  height: 34px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 13px;
  font-weight: 600;
  color: #36404f;
  padding: 0 2px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #fff;
}
/* The dot and the name. line-height 1 and a lift at the bottom: this font's capitals sit low
   in a line box, and the lift puts their middle on the chip's centre line. */
.secname {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
  padding: 0 2px 4px;
}
/* as tall as a capital; pushed back down by the name's lift, onto the centre line */
.secdot {
  position: relative;
  top: 2px;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
/* flex-centred and lifted: the arrow glyphs sit low on the text baseline */
.secmove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  padding: 0 0 3px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  color: #2f4368;
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}
.secmove:hover {
  background: #e2e7ee;
}
/* the name gets its own space between the arrows; a chip at the end has padding instead */
.secchip:first-child {
  padding-left: 9px;
}
.secchip:last-child {
  padding-right: 9px;
}
/* ---------- the stage and what hangs under it ---------- */
/* how the plan is drawn: the stage's own heading line, so it carries no rule under it */
.viewline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  padding: 12px 16px 0;
}
.emptyhint {
  color: #5a6573;
  font-size: 14px;
  padding: 44px 24px;
  text-align: center;
  margin: 0;
}
/* The neighbour check's fold. The fold is the region; the report inside it drops its own card
   chrome and its heading, which the fold's header carries. */
.fold {
  border-top: 1px solid #e2e6ec;
}
.foldhead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 11px 16px;
  border: none;
  background: transparent;
  color: #1d2330;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.foldhead:hover {
  background: #f7f8fa;
}
/* folded, the header is the workspace's last line and takes its corners */
.fold:not(.open) .foldhead {
  border-radius: 0 0 11px 11px;
}
/* Down to open, up to fold away, in a small box so it reads as something to press. The 1px drop
   sets it on the middle of the lettering beside it, which sits below the middle of its line. */
.foldarrow {
  flex: none;
  align-self: center;
  position: relative;
  top: 1px;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  padding: 3px;
  color: #2f4368;
  background: #eef1f5;
  border: 1px solid #c4ccd6;
  border-radius: 5px;
}
.foldhead:hover .foldarrow {
  background: #e3e8ef;
}
.fold.open .foldarrow polyline {
  transform: rotate(180deg);
  transform-origin: 6px 6px;
}
.foldtitle {
  font-size: 13px;
  font-weight: 700;
  color: #2f4368;
}
.foldsum {
  font-size: 12px;
  font-weight: 500;
  color: #1a7f3c;
  min-width: 0;
}
.foldsum.bad {
  color: #b4601a;
  font-weight: 600;
}
.fold .foldbody {
  margin: 0;
  border: none;
  border-radius: 0 0 11px 11px;
  padding: 0 16px 14px;
}
.fold :deep(.report > h3) {
  display: none;
}
/* help dialog */
.help {
  border: none;
  background: transparent;
  padding: 0;
  margin: auto;
  inset: 0;
  position: fixed;
  max-width: 100vw;
  max-height: 100vh;
}
.help::backdrop {
  background: rgba(29, 35, 48, 0.45);
}
.helpbox {
  width: min(640px, 92vw);
  max-height: 86vh;
  max-height: 86dvh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e2e6ec;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.helphead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid #e2e6ec;
}
.helphead h2 {
  margin: 0;
  font-size: 16px;
  color: #1d2330;
}
.helpclose {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: #5a6573;
  cursor: pointer;
  padding: 0 4px;
}
.helpclose:hover {
  color: #1d2330;
}
.helpbody {
  padding: 16px 18px 20px;
  overflow: auto;
  color: #36404f;
  font-size: 14px;
  line-height: 1.5;
}
.helpbody p {
  margin: 0 0 12px;
}
.helpsteps {
  margin: 10px 0 12px;
  padding-left: 1.3em;
  list-style: decimal;
}
.helpsteps li {
  margin: 0 0 6px;
}
.helplink {
  color: #2e74d9;
  font-weight: 600;
  text-decoration: none;
}
.helplink:hover {
  text-decoration: underline;
}
.helpnote {
  color: #5a6573;
  font-size: 13px;
}
/* busy overlay */
.newer {
  max-width: min(34rem, calc(100vw - 2rem));
  margin: auto;
  padding: 0;
  border: 1px solid #e2e6ec;
  border-radius: 10px;
  background: #fff;
  color: #1d2330;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.14);
}
.newer::backdrop {
  background: rgba(245, 246, 248, 0.9);
}
.newerbox {
  display: grid;
  gap: 12px;
  padding: 22px 24px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.newerbox h2 {
  font-size: 17px;
  font-weight: 600;
}
.newerbox a {
  color: #1d4ed8;
  text-decoration: underline;
}
.newerout {
  padding-top: 12px;
  border-top: 1px solid #e2e6ec;
  color: #4b5563;
}
.newerdelete {
  margin-left: 6px;
  color: #b42318;
}
.busy {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: 100vw;
  height: 100vh;
  max-height: 100vh;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: progress;
}
.busy:not([open]) {
  display: none;
}
.busy::backdrop {
  background: rgba(245, 246, 248, 0.62);
  backdrop-filter: blur(1px);
}
.busybox {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid #e2e6ec;
  border-radius: 10px;
  padding: 16px 22px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.14);
}
.spinner {
  width: 22px;
  height: 22px;
  flex: none;
  border: 3px solid #d3d9e0;
  border-top-color: #2f6df0;
  border-radius: 50%;
  animation: choir-spin 0.7s linear infinite;
}
@keyframes choir-spin {
  to {
    transform: rotate(360deg);
  }
}
.busylabel {
  font-size: 14px;
  font-weight: 600;
  color: #2f4368;
}
/* toast */
.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  z-index: 320;
  max-width: 80vw;
  transform: translateX(-50%) translateY(10px);
  opacity: 0;
  pointer-events: none;
  background: #1d2330;
  color: #fff;
  padding: 9px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.toast.nochange {
  background: #4a5567;
}
/* Narrow screens drop the stage's headings (see StageView), and the tick box with them. */
@media (max-width: 700px) {
  .labelsopt {
    display: none;
  }
}
/* The plan drops under the title and the app-level buttons once the three no longer fit a line. */
@media (max-width: 900px) {
  .apphead {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .setupbtns {
    grid-column: 2;
    grid-row: 1;
  }
  .apphead > :deep(.planbar) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
/* ---------- narrow screens ----------
   Every row of controls becomes one column of groups, and each group the same two-column grid, so
   the buttons line up down the page whatever their labels say. */
@media (max-width: 640px) {
  .tabstrip {
    padding: 6px 12px 0;
  }
  .tab {
    padding: 9px 12px;
  }
  /* Print and Download take a full-width line each under the tabs */
  .outputs {
    flex-basis: 100%;
    margin-left: 0;
    padding: 10px 0;
    flex-direction: column;
  }
  .outbox > .printbtn,
  .outbox > .exportbtn {
    flex: 1 1 auto;
  }
  /* the menus span the strip instead of hanging off one button */
  .printmenu,
  .exportmenu {
    left: 0;
    right: 0;
    width: auto;
  }
  .toolstrip,
  .viewline {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .toolstrip {
    padding: 12px;
  }
  .viewline {
    padding: 12px 12px 0;
  }
  .tgroup {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  /* a group's own label takes the whole line, and so do the section chips under theirs */
  .tgroup > span.clabel,
  .tgroup > .secorder {
    grid-column: 1 / -1;
  }
  /* the title wraps beside the app-level buttons rather than running under them */
  .apphead {
    padding: 12px;
  }
  .choir-app h1 {
    white-space: normal;
    line-height: 1.2;
  }
  /* each label pinned left with its box filling the rest */
  .tgroup > label.clabel,
  .viewline > label.clabel {
    justify-content: space-between;
  }
  input.num,
  .viewline .csel {
    width: auto;
    flex: 1 1 auto;
    min-width: 0;
  }
  .viewline .csel {
    max-width: 70%;
  }
  .spacetool {
    justify-content: center;
  }
  .foldhead {
    flex-wrap: wrap;
    row-gap: 2px;
    padding: 11px 12px;
  }
  /* The neighbour check is a table one column per split, which a phone cannot fit: it scrolls
     sideways inside its region rather than crushing each column to one word a line. */
  .fold :deep(.report) {
    overflow-x: auto;
    padding: 0 12px 14px;
  }
  .fold :deep(.reptbl td) {
    min-width: 9em;
  }
}
</style>

<style>
/* ---------- the main window's controls ----------
   Global, so every component of the main window draws the same button, picker, label, tick box and
   menu: the look of Choir setup's own. Each is under .choir-app and named with a c, so nothing
   here reaches the dialogs or the page shell. */
.choir-app .cbtn {
  height: 34px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #eef1f5;
  color: #2f4368;
  cursor: pointer;
  white-space: nowrap;
}
.choir-app .cbtn:hover:not(:disabled) {
  background: #e3e8ef;
}
.choir-app .cbtn:disabled {
  opacity: 0.45;
  cursor: default;
}
.choir-app .cbtn.primary,
.choir-app .cbtn.on {
  background: #2f4368;
  border-color: #2f4368;
  color: #fff;
}
.choir-app .cbtn.primary:hover:not(:disabled),
.choir-app .cbtn.on:hover {
  background: #26354f;
}
/* a button inside a region's heading line */
.choir-app .cbtn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}
.choir-app .csel {
  height: 34px;
  max-width: 100%;
  padding: 0 8px;
  font-size: 13px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #fff;
  color: #1d2330;
  text-overflow: ellipsis;
}
.choir-app .csel:disabled {
  color: #8a94a2;
  background: #f5f6f8;
}
.choir-app .cbtn:focus-visible,
.choir-app .csel:focus-visible {
  outline: 2px solid #2f6df0;
  outline-offset: 1px;
}
/* a control's name, to its left */
.choir-app .clabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #5a6573;
  white-space: nowrap;
}
.choir-app .ccheck {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #36404f;
  cursor: pointer;
}
.choir-app .ccheck input {
  accent-color: #2f4368;
}
/* a menu under its button, which sits in a position: relative box */
.choir-app .cmenu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 30;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: #fff;
  border: 1px solid #d3d9e0;
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
}
.choir-app .cmenuitem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  border: none;
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 13px;
  background: #fff;
  color: #1d2330;
  cursor: pointer;
}
.choir-app .cmenuitem:hover:not(:disabled) {
  background: #eef1f5;
}
.choir-app .cmenuitem:disabled {
  opacity: 0.5;
  cursor: default;
}
.choir-app .cmenuitem b {
  font-weight: 600;
}
.choir-app .cmenuitem span {
  font-size: 11px;
  color: #5a6573;
  line-height: 1.35;
}
.choir-app .cmenuitem.danger b {
  color: #b4231a;
}

/* global on purpose: applied to <body> while a pointer drag session is live
   (set by useDragDrop) so mouse drags don't select text under the pointer.
   The descendant rule is what makes the cursor read as "grabbing" for the whole
   drag: the pointer sits over a .cell the entire time, and the cell's own
   cursor:grab is a scoped rule that outranks a plain body selector. */
body.dnd-active,
body.dnd-active * {
  cursor: grabbing !important;
  user-select: none;
  -webkit-user-select: none;
}

/* ---------- print ----------
   Global rather than scoped, for two reasons. The paper geometry (`@page`) has no element to
   hang off at all; and the rules have to reach a sibling's root and an ancestor's children,
   which scoped CSS cannot do without guessing which elements happen to inherit this component's
   data attribute.

   Each layer resets what it owns: the page shell in App.vue, the app here, the sheet in
   PlanSheet.vue. */
@media print {
  /* A4 landscape, fixed, no paper picker. A NAMED page, because the walk-on order
     prints on another. */
  @page choir {
    size: A4 landscape;
    margin: 10mm;
  }
  /* The walk-on order's page: portrait. Two rules about named pages, both learned from blank
     pages in Chrome's output:
     - a change of page name is a page break, so anything on a different page than the plan
       adds a page (the page shell names the whole document's page);
     - the print ENDS on the document's own page, so if that differs from the last section
       printed, Chrome adds one more, blank. So while a walk-on order prints last — on its own,
       or included after the plan — <html> carries `choir-portrait` and the whole document is on
       this page, and PlanSheet names `choir` on each landscape part explicitly. */
  @page choir-portrait {
    size: A4 portrait;
    margin: 12mm;
  }
  html.choir-portrait,
  html.choir-portrait body,
  html.choir-portrait .choir-app {
    page: choir-portrait;
  }
  /* The arranger is a LIGHT app inside a dark page shell, so what has to go white is the shell
     (App.vue does its half) and the card this component draws. */
  .choir-app {
    page: choir;
    background: #fff !important;
    color: #1d2330;
    padding: 0 !important;
    border-radius: 0 !important;
  }
  /* Everything that is the application rather than the plan: the heading and blurb, the view
     bar, the controls, the stage card, the bench, the on-screen neighbour check and the toast.
     The <dialog>s only render when open, so they are covered by the same rule. */
  .choir-app > :not(#choir-print-root) {
    display: none !important;
  }
  #choir-print-root {
    display: block !important;
  }
}
/* The sheet is mounted only while printing, but it must not flash on screen in the frame between
   mounting it and the dialogue opening. */
#choir-print-root {
  display: none;
}
</style>
