<template>
  <div class="stageregion">
    <div class="stagewrap">
      <!-- Everything above the footer key is a stack of `.axisrow`s: an optional heading gutter
           on the left, then the thing itself. They all carry the gutter (or all drop it together)
           so the bands, the column headings, the grid and the AUDIENCE bar stay in one column.
           The stack is a flex column purely so the AUDIENCE bar can change ends with an `order`;
           nothing else in here needs to know which viewpoint is selected. -->
      <div class="stagestack">
        <div class="axisrow">
          <div v-if="showHeadings" class="gutter" />
          <div class="seclabels-grid" :style="{ gridTemplateColumns: `repeat(${view.cols}, var(--cellw))` }">
            <div
              v-for="band in view.bands"
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
          <div class="colheads" :style="{ gridTemplateColumns: `repeat(${view.cols}, var(--cellw))` }">
            <div v-for="h in view.colHeads" :key="h.c" class="axislabel">{{ h.text }}</div>
          </div>
        </div>
        <div class="axisrow">
          <div
            v-if="showHeadings"
            class="gutter rowheads"
            :style="{ gridTemplateRows: `repeat(${view.rows}, var(--cellh))` }"
          >
            <div v-for="h in view.rowHeads" :key="h.r" class="axislabel" :style="{ gridRow: h.gridRow }">{{ h.text }}</div>
          </div>
          <!-- The walk-on order's stage is read-only, coloured by section, and numbered: no
               neighbour marks, and nothing to drag, since a move would renumber everyone after it. -->
          <SeatGrid
            v-if="walkOn"
            :slots="view.slots"
            :rows="view.rows"
            :view="SECTION_VIEW"
            :badges="store.walkOnBadgeMap.value"
            readonly
          />
          <SeatGrid v-else :slots="view.slots" :rows="view.rows" :stranded="view.stranded" :lateral="store.stageLateral.value" />
        </div>
        <div class="axisrow audiencerow" :class="{ attop: view.audienceTop }" :style="{ order: view.audienceTop ? -1 : 1 }">
          <div v-if="showHeadings" class="gutter" />
          <div class="audience" :style="{ width: `calc(var(--cellw) * ${view.cols} + ${(view.cols - 1) * 4}px)` }">AUDIENCE</div>
        </div>
      </div>
    </div>
    <!-- Under the plan and outside its scroller, so a wide stage scrolls without it. -->
    <div class="footrow">
      <span v-for="s in store.sectionOrder.value" :key="s" class="seckey">
        <span class="secdot" :style="{ background: store.sectionColours.value[s] }" />{{ s }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { SECTION_VIEW } from '../utils/arranger';
import { stageLayout } from '../utils/stageLayout';
import { useChoirArranger } from '../composables/useChoirArranger';
import SeatGrid from './SeatGrid.vue';

const store = useChoirArranger();
// The Walk-on order tab's stage, rather than the one being arranged.
const props = defineProps({ walkOn: { type: Boolean, default: false } });
const walkOn = computed(() => props.walkOn);

// Row and column headings on the stage, so the labelling controls in Settings have a visible
// effect where the user is actually working. On by default here and dropped entirely below the
// narrow breakpoint in the stylesheet, where vertical space is worth more than the labels are.
// This is a view affordance and not plan data, so it
// deliberately does not persist and does not travel in a backup: the four settings it displays
// do. It lives in `store.ui` rather than here so the previews below the stage follow it, and
// the "Seat labels" tick box over the stage (in each tab's own controls) sets it.
const showHeadings = computed(() => store.ui.headings);

const view = computed(() => {
  // The whole drawing — the viewpoint rotation, the section header bands and the two heading
  // strips — is utils/stageLayout.js, shared with the printed sheet so the paper and the screen
  // cannot drift apart. This component's remaining job is to bind it to the live store.
  const layout = stageLayout({
    seats: store.seats.value,
    rows: store.gridRows.value,
    cols: store.gridCols.value,
    byId: store.byId.value,
    sectionOrder: store.sectionOrder.value,
    labels: store.labels,
    audienceAt: store.audienceAt.value,
    // the bands take the plan's own colours, not the constants
    sectionColours: store.sectionColours.value
  });

  return { ...layout, stranded: props.walkOn ? null : store.stageStranded.value };
});
</script>

<style scoped>
.stageregion {
  padding: 12px 16px 14px;
}
/* The plan scrolls sideways across the whole region: the negative margins cancel the region's
   padding, and the matching padding sits inside the scroller. */
.stagewrap {
  margin: 0 -16px;
  /* the bottom is air between the AUDIENCE bar and the scrollbar, when there is one */
  padding: 0 16px 10px;
  overflow-x: auto;
  --cellw: 92px;
  /* mirrors SeatGrid's own --cellh: the heading gutter has to line its cells up with the grid's
     rows, and the grid owns that variable inside its own scope. */
  --cellh: 40px;
}
/* a flex column purely so the AUDIENCE bar can swap ends with `order`. Everything else
   in the stack stays at the default order 0 and never has to think about the viewpoint. */
.stagestack {
  display: flex;
  flex-direction: column;
  /* As wide as the plan, with its own right-hand air: when the plan is wider than the page and
     scrolls, the wrapper's padding is not part of what scrolls, so the last column would sit
     hard against the edge. */
  width: max-content;
  padding-right: 16px;
}
/* the heading gutter plus one row of the plan. `gap` is the grid's own 4px plus a little air so
   the labels read as a margin and not as an extra column of chairs. */
.axisrow {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
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
/* Narrow screens drop the headings altogether: on a phone the plan is already scrolling
   sideways and the vertical space the column strip costs is worth more than the labels are.
   Hiding the gutter as well is what keeps every .axisrow aligned with the grid. */
@media (max-width: 700px) {
  .colheadrow,
  .gutter {
    display: none;
  }
}
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
/* the bar's air belongs to the row, not to the bar, so it follows the bar to the other end */
.audiencerow {
  margin-top: 8px;
}
.audiencerow.attop {
  margin-top: 0;
  margin-bottom: 8px;
}
.audience {
  /* never shrunk to the visible width when the plan scrolls: always the width of the grid */
  flex: none;
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
.footrow {
  font-size: 12px;
  color: #5a6573;
  margin-top: 10px;
  display: flex;
  gap: 4px 14px;
  flex-wrap: wrap;
  align-items: center;
}
.footrow .seckey {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.footrow .secdot {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  display: inline-block;
}
</style>
