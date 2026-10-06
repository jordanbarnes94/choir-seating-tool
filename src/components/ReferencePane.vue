<template>
  <!-- One read-only preview of a sibling seating plan, in FULL STAGE mode: a panel below the
       working stage, same cell size, neither side scaled. A panel on the page and never a dialog:
       "keep version A while I try out version B" is a working session. In By section mode the
       same preview is drawn beside each SectionBlock instead. -->
  <div class="refpane">
    <div class="refhead">
      <b class="refname">
        <span v-if="!preview.current" class="refconcert">{{ preview.concertName }} —</span>
        {{ preview.name }}
      </b>
      <span class="refhint">
        Preview, read-only{{ preview.current ? '' : ', from another concert' }} — {{ preview.current ? 'open it with the plan picker at the top to edit it.' : 'open its concert in Choir setup to edit it.' }}
      </span>
      <button class="cbtn sm" type="button" :aria-label="`Close the preview of ${preview.label}`" @click="store.removePreview(preview.key)">Close</button>
    </div>

    <div v-if="layout" class="refwrap">
      <!-- The same stack StageView draws, through the same pure `stageLayout()`, so the two
           pictures cannot drift: the reference is not a simplified rendering of a plan, it is
           the same rendering of a different plan. It faces the same way as the stage above it and
           labels its seats the same way, following the stage's "Seat labels" tick box, so the
           two can be compared chair for chair; the AUDIENCE bar says which way that is. -->
      <div class="refstack">
        <div class="axisrow">
          <div v-if="headings" class="gutter" />
          <div class="seclabels-grid" :style="{ gridTemplateColumns: `repeat(${layout.cols}, var(--cellw))` }">
            <div
              v-for="band in layout.bands"
              :key="band.sec + band.gridColumn"
              class="seclabel"
              :style="{ gridColumn: band.gridColumn, color: band.color }"
            >
              {{ band.sec }}
            </div>
          </div>
        </div>
        <div v-if="headings" class="axisrow colheadrow">
          <div class="gutter" />
          <div class="colheads" :style="{ gridTemplateColumns: `repeat(${layout.cols}, var(--cellw))` }">
            <div v-for="h in layout.colHeads" :key="h.c" class="axislabel">{{ h.text }}</div>
          </div>
        </div>
        <div class="axisrow">
          <div
            v-if="headings"
            class="gutter rowheads"
            :style="{ gridTemplateRows: `repeat(${layout.rows}, var(--cellh))` }"
          >
            <div v-for="h in layout.rowHeads" :key="h.r" class="axislabel" :style="{ gridRow: h.gridRow }">{{ h.text }}</div>
          </div>
          <SeatGrid
            :slots="layout.slots"
            :rows="layout.rows"
            :stranded="preview.view.stranded"
            :plan="preview.view"
            readonly
          />
        </div>
        <div
          class="axisrow audiencerow"
          :class="{ attop: layout.audienceTop }"
          :style="{ order: layout.audienceTop ? -1 : 1 }"
        >
          <div v-if="headings" class="gutter" />
          <div class="audience" :style="{ width: `calc(var(--cellw) * ${layout.cols} + ${(layout.cols - 1) * 4}px)` }">AUDIENCE</div>
        </div>
      </div>
      <p class="reffoot">
        <span :class="status.cls" class="status">{{ status.txt }}</span>
        <span v-if="unseated" class="refmeta">{{ unseated }} not seated in this plan</span>
        <span v-if="shapeDiffers" class="refmeta">{{ layout.rows }} × {{ layout.cols }}, against your {{ store.gridRows.value }} × {{ store.gridCols.value }}</span>
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { SECTION_KEY, isSinger } from '../utils/arranger';
import { stageLayout } from '../utils/stageLayout';
import { useChoirArranger } from '../composables/useChoirArranger';
import SeatGrid from './SeatGrid.vue';

const props = defineProps({
  // `{ key, id, name, label, concertName, current, plan, view }` from the store's `previews`
  preview: { type: Object, required: true }
});
const store = useChoirArranger();

// The reference's geometry, from ITS plan: its own grid, its own section order and its own
// palette — see `usePlanView.js` on the same point for colours. The exceptions are the viewpoint
// and the seat labelling, which are the OPEN plan's: a preview facing the other way from the
// stage above it, or naming the same chair differently, cannot be compared with it at a glance,
// which is the pane's whole job.
const headings = computed(() => store.ui.headings);
const layout = computed(() => {
  const { plan, view } = props.preview;
  if (!plan || !view) return null;
  return stageLayout({
    seats: plan.seats,
    rows: plan.rows,
    cols: plan.cols,
    byId: view.byId,
    sectionOrder: plan.sectionOrder,
    labels: store.labels,
    audienceAt: store.audienceAt.value,
    sectionColours: view.sectionColours
  });
});

// The reference's own neighbour status, from its own engine — never the working copy's, since
// the whole point of the comparison is that the two numbers may differ.
const status = computed(() => {
  const { plan, view } = props.preview;
  if (!plan || !view) return { cls: 'ok', txt: '' };
  const eng = view.engine();
  let alone = 0, broken = 0;
  [SECTION_KEY, ...view.SCH].forEach((key) => {
    const e = eng.evaluate2D(plan.seats, plan.rows, key);
    alone += e.stranded.length;
    broken += e.broken.length;
  });
  if (alone) return { cls: 'warn', txt: alone === 1 ? '1 singer has nobody from their group next to them' : `${alone} singers have nobody from their group next to them` };
  if (broken) return { cls: 'warn', txt: broken === 1 ? '1 group is split up' : `${broken} groups are split up` };
  return { cls: 'ok', txt: 'every singer keeps all their groups' };
});

// How many of the concert's singers this plan leaves off the stage. Worth saying: a saved plan
// that seats five fewer people is a different plan in a way the grid alone does not show.
const unseated = computed(() => {
  const plan = props.preview.plan;
  const placed = new Set((plan.seats || []).filter(isSinger));
  return (plan.roster || []).filter((p) => !placed.has(p.id)).length;
});

// Two plans of different shapes are legitimate and are NOT scaled to match, so the pane says so
// rather than leaving the reader to measure two grids by eye.
const shapeDiffers = computed(() => {
  const l = layout.value;
  return !!l && (l.rows !== store.gridRows.value || l.cols !== store.gridCols.value);
});
</script>

<style scoped>
/* tinted, unlike the stage above it: a preview is there to be read, not worked on */
.refpane {
  border-top: 1px solid #e2e6ec;
  background: #fafbfc;
  padding: 10px 16px 14px;
}
.refhead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.refname {
  font-size: 13px;
  color: #1d2330;
}
.refconcert {
  font-weight: 400;
  color: #5a6573;
}
.refhint {
  font-size: 12px;
  color: #5a6573;
  flex: 1 1 220px;
}
/* Mirrors StageView's .stagewrap: the grid scrolls inside the region rather than widening it. */
.refwrap {
  overflow-x: auto;
  margin: 0 -16px -14px;
  padding: 4px 16px 14px;
  /* SeatGrid's cell width, which the bands and the AUDIENCE bar are sized against, and its
     height, which the row headings line up with */
  --cellw: 92px;
  --cellh: 40px;
}
/* StageView's heading strips, copied so a preview's labels sit exactly where the stage's do */
.gutter {
  width: 26px;
  flex: none;
}
.rowheads {
  display: grid;
  gap: 4px;
}
.colheadrow {
  margin-bottom: 4px;
}
.colheads {
  display: grid;
  grid-auto-columns: var(--cellw);
  gap: 4px;
  width: max-content;
}
.axislabel {
  font-size: 11px;
  font-weight: 700;
  color: #5a6573;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}
/* dropped on a phone, as on the stage */
@media (max-width: 700px) {
  .colheadrow,
  .gutter {
    display: none;
  }
}
.refstack {
  display: flex;
  flex-direction: column;
  width: max-content;
  /* right-hand air that scrolls with the plan (see StageView) */
  padding-right: 16px;
}
.axisrow {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
/* the same bands and AUDIENCE bar as StageView's, so a preview reads like the stage */
.seclabels-grid {
  display: grid;
  grid-auto-columns: var(--cellw);
  gap: 4px;
  margin-bottom: 6px;
  width: max-content;
}
.seclabel {
  grid-row: 1;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  padding: 3px 4px;
  border-radius: 5px 5px 0 0;
  border-bottom: 3px solid currentColor;
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
}
.audiencerow {
  margin-top: 8px;
}
.audiencerow.attop {
  margin-top: 0;
  margin-bottom: 8px;
}
.audience {
  flex: none; /* never shrunk to the visible width when the plan scrolls */
  padding: 5px 0;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #3f4957;
  background: #dbe1e9;
  border: 1px solid #c5cdd8;
  border-radius: 6px;
}
.reffoot {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin: 8px 0 0;
  font-size: 12px;
}
.refmeta {
  color: #5a6573;
}
.status.ok {
  color: #1a7f3c;
  font-weight: 600;
}
.status.warn {
  color: #b4601a;
  font-weight: 600;
}
</style>
