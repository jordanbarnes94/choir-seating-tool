<template>
  <!-- The Walk-on order tab: the settings, then the stage they number (read-only, every seat
       carrying its walk-on position), then the list, so the list can be checked against the seats
       above it. Nothing here moves a singer; that is the Arrange tab's job. -->
  <div class="walktab">
    <div class="walkpanel wsettings">
      <div class="wcontrols">
        <label class="clabel">
          First row on
          <!-- A custom row order is neither: it shows as its own entry, which cannot be chosen here. -->
          <select class="csel" :value="w.rowSeq ? 'custom' : w.rowFrom" @change="store.setWalkOn('rowFrom', $event.target.value)">
            <option value="back">Back row</option>
            <option value="front">Front row</option>
            <option v-if="w.rowSeq" value="custom" disabled>Custom order</option>
          </select>
        </label>
        <!-- "Enter from": the choir comes from that wing, and each row fills AWAY from it, so the
             first person on walks furthest and nobody squeezes past anyone already standing. -->
        <label class="clabel">
          Enter from
          <select class="csel" :value="w.enterFrom" @change="store.setWalkOn('enterFrom', $event.target.value)">
            <option v-for="d in DIRS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <div v-if="usesBoth" class="wctl">
          <label class="clabel">
            Queues meet after column
            <!-- Shows the aisle the generator actually used, so an unset aisle reads as the centre column. -->
            <select class="csel" :value="String(plan.order.split)" @change="onAisle">
              <option v-for="c in aisleChoices" :key="c.c" :value="String(c.c)">{{ c.text }}</option>
            </select>
          </label>
          <button v-for="s in suggestions" :key="s.c" class="link" @click="store.setWalkOn('splitCol', s.c)">blocked column {{ s.text }}</button>
        </div>
        <div class="wctl">
          <button class="cbtn" :aria-expanded="showRows" @click="showRows = !showRows">{{ showRows ? 'Hide rows' : 'Set each row' }}</button>
          <span v-if="!showRows && store.walkOnCustomised.value" class="note">Some rows are set individually.</span>
        </div>
        <label class="ccheck labelsopt"><input v-model="store.ui.headings" type="checkbox"> Seat labels</label>
      </div>
      <p class="note">Left and right as the audience sees the stage. Each row fills from the far end, so nobody passes anyone already standing. <b>Both</b> forms a queue at each wing, each filling from the aisle outward.</p>

      <!-- Each row, in the order it walks on. The direction shown is the one the row actually
           uses, whether it follows "Enter from" or has its own. -->
      <div v-if="showRows" class="perrow">
        <div class="perrowhead">
          <span class="clabel">Rows, in the order they walk on</span>
          <button class="cbtn sm" :disabled="!store.walkOnCustomised.value" @click="store.resetWalkOnRows()">Reset to default</button>
        </div>
        <div v-for="(r, i) in store.walkOnRowOrder.value" :key="r" class="rowitem">
          <span class="step">{{ i + 1 }}</span>
          <span class="rowname">Row {{ rowName(r) }}</span>
          <button class="ordbtn" :disabled="i === 0" :data-tip="`Row ${rowName(r)} walks on earlier`" @click="store.moveWalkOnRow(r, -1)">↑</button>
          <button class="ordbtn" :disabled="i === store.walkOnRowOrder.value.length - 1" :data-tip="`Row ${rowName(r)} walks on later`" @click="store.moveWalkOnRow(r, 1)">↓</button>
          <select class="csel rowdir" :value="effective(r)" :aria-label="`Row ${rowName(r)} enters from`" @change="store.setWalkOnRow(r, $event.target.value)">
            <option v-for="d in DIRS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
      </div>
    </div>

    <StageView walk-on />

    <div class="walkpanel">
      <WalkOnList :list="plan.list" :waiting="store.waitingNames.value" />

      <!-- Taking the list away, after it: the list is what gets checked first. -->
      <div class="wactions">
        <button class="cbtn" @click="copy">{{ copied ? 'Copied' : 'Copy as text' }}</button>
        <button class="cbtn" data-tip="The walk-on order as a spreadsheet, one singer per line" @click="store.exportWalkOnCSV">Download spreadsheet</button>
        <button class="cbtn" data-tip="The walk-on order on its own, A4 portrait, in columns" @click="emit('print')">
          <svg class="picon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>Print the list
        </button>
      </div>
      <p v-if="copyFailed" class="note failed">This browser would not let the page write to the clipboard. The list is selectable above, so it can be copied by hand.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import { colLabelAt, rowLabelAt } from '../utils/labels';
import { useChoirArranger } from '../composables/useChoirArranger';
import WalkOnList from './WalkOnList.vue';
import StageView from './StageView.vue';

const store = useChoirArranger();
// Printing belongs to ChoirArranger, which owns the print root and the print dialogue.
const emit = defineEmits(['print']);
const w = store.walkOn;
const plan = computed(() => store.walkOnPlan.value);
const DIRS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' }
];
const showRows = ref(false);

// Every name of a row or a column comes from utils/labels.js.
const rowName = (r) => rowLabelAt(r, store.gridRows.value, store.labels, store.audienceAt.value);
const colName = (c) => colLabelAt(c, store.gridCols.value, store.labels, store.audienceAt.value);
const effective = (r) => w.perRow[r] ?? w.enterFrom;

const usesBoth = computed(() => plan.value.order.rowOrder.some((x) => x.mode === 'both'));
// Never after the last column: that would leave the right queue empty.
const aisleChoices = computed(() => Array.from({ length: Math.max(1, store.gridCols.value - 1) }, (_, c) => ({ c, text: colName(c) })));
// A column blocked front to back is worth offering as the aisle.
const suggestions = computed(() => store.walkOnAisles.value.filter((c) => c !== plan.value.order.split && c < store.gridCols.value - 1).map((c) => ({ c, text: colName(c) })));
function onAisle(e) {
  store.setWalkOn('splitCol', Number(e.target.value));
}

// Plain text on the clipboard, so the list can go into an email or a document.
const copied = ref(false);
const copyFailed = ref(false);
let copyTimer = null;
async function copy() {
  copyFailed.value = false;
  try {
    await navigator.clipboard.writeText(store.walkOnCopyText());
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied.value = false), 1600);
  } catch {
    copyFailed.value = true;
  }
}
onBeforeUnmount(() => clearTimeout(copyTimer));
</script>

<style scoped>
/* Three regions under each other: the settings, the stage they number, the list. */
.walkpanel {
  font-size: 13px;
  border-top: 1px solid #e2e6ec;
  padding: 14px 16px 16px;
}
.walkpanel.wsettings {
  border-top: none;
  border-bottom: 1px solid #e2e6ec;
  padding: 12px 16px;
}
.wactions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.wcontrols {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 28px;
}
.wctl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.note {
  margin: 8px 0 0;
  font-size: 11px;
  color: #8a93a0;
  line-height: 1.45;
}
.wctl .note {
  margin: 0;
}
.note.failed {
  color: #a33;
}
/* The same inline printer as the main Print button. */
.picon {
  display: inline-block;
  width: 1.15em;
  height: 1.15em;
  margin-right: 6px;
}
/* each row's own direction: a size down, to sit in a list of rows */
.csel.rowdir {
  height: 26px;
  font-size: 12px;
  padding: 0 4px;
}
.link {
  border: none;
  background: none;
  padding: 0;
  color: #2f6df0;
  font: inherit;
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}
.perrow {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #eef1f5;
  border-radius: 8px;
  background: #fafbfc;
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
}
.perrowhead {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 4px;
}
.rowitem {
  display: flex;
  align-items: center;
  gap: 8px;
}
.step {
  min-width: 1.4em;
  text-align: right;
  font-weight: 700;
  color: #8a93a0;
}
.rowname {
  min-width: 56px;
  color: #36404f;
}
.ordbtn {
  width: 24px;
  height: 24px;
  padding: 0;
  line-height: 1;
  font-size: 12px;
  font-weight: 700;
  color: #2f4368;
  background: #eef1f5;
  border: 1px solid #c4ccd6;
  border-radius: 5px;
  cursor: pointer;
}
.ordbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
/* Narrow screens drop the stage's headings (see StageView), and the tick box with them. */
@media (max-width: 700px) {
  .labelsopt {
    display: none;
  }
}
@media (max-width: 640px) {
  .walkpanel,
  .walkpanel.wsettings {
    padding-left: 12px;
    padding-right: 12px;
  }
  .wcontrols {
    flex-direction: column;
    align-items: stretch;
  }
  .wcontrols > .clabel,
  .wctl > .clabel {
    justify-content: space-between;
    flex: 1 1 auto;
  }
}
</style>
