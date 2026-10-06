<template>
  <!-- The mini plan. It is a PICTURE and a CONTROL at once: the audience bar and the two ends of
       the row gutter are real buttons, so the two spatial settings can be pointed at instead of
       read as a sentence. Everything else here follows the settings and is not clickable. -->
  <div class="preview">
    <!-- Both audience slots always exist. The side the audience is on is a solid bar; the other
         is a dashed ghost, which is what makes it read as somewhere the bar could go. -->
    <button
      type="button"
      class="audbtn"
      :class="{ on: view.audienceTop }"
      :aria-pressed="view.audienceTop"
      data-tip="Draw the audience above the plan (the view from the stage)"
      @click="emit('move-audience', 'top')"
    >AUDIENCE</button>

    <div class="pbody" :style="{ gridTemplateColumns: `var(--gutw) repeat(${view.colHeads.length}, var(--cw))` }">
      <span class="corner" />
      <span
        v-for="(h, i) in view.colHeads"
        :key="'c' + i"
        class="chead"
        :class="{ gap: h.gap, on: h.start }"
      >{{ h.gap ? '…' : h.text }}</span>

      <template v-for="(row, t) in view.grid" :key="'r' + t">
        <!-- Row labels, not controls. Which end row 1 starts at is a toggle in the panel: the
             audience bar is the only thing worth clicking in here, because it is the only setting
             that changes the SHAPE of the picture rather than what the picture is called. -->
        <span class="rhead" :class="{ on: view.rowHeads[t].start }">{{ view.rowHeads[t].text }}</span>

        <span
          v-for="(cell, i) in row"
          :key="'s' + i"
          class="cell"
          :class="{ gap: cell.gap }"
          :data-tip="cell.gap ? '' : cell.label"
        />
      </template>
    </div>

    <button
      type="button"
      class="audbtn"
      :class="{ on: !view.audienceTop }"
      :aria-pressed="!view.audienceTop"
      data-tip="Draw the audience below the plan (the view from the audience)"
      @click="emit('move-audience', 'bottom')"
    >AUDIENCE</button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { previewLayout } from '../utils/seatPreview';

// Props and one event, no store: this draws whatever plan it is handed, so print can
// reuse it for a plan that is not the live one.
const props = defineProps({
  rows: { type: Number, required: true },
  cols: { type: Number, required: true },
  labels: { type: Object, required: true },
  audienceAt: { type: String, required: true }
});
const emit = defineEmits(['move-audience']);

const view = computed(() => previewLayout(props.rows, props.cols, props.labels, props.audienceAt));
</script>

<style scoped>
.preview {
  --cw: 22px;
  --ch: 16px;
  --gutw: 18px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: max-content;
  padding: 8px;
  border: 1px solid #e2e6ec;
  border-radius: 8px;
  background: #fff;
}
/* the AUDIENCE bar, in both its states: solid where the audience is, a dashed ghost where it
   could be put. The ghost is the whole affordance, so it keeps the same size as the solid one.
   Indented by the label gutter so the bar spans the CHAIRS and not the row labels: the audience
   sits in front of the seating, not in front of the lettering. */
.audbtn {
  margin-left: calc(var(--gutw) + 2px);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  padding: 4px 6px;
  color: #9aa3b0;
  background: #fff;
  border: 1px dashed #c4ccd6;
  border-radius: 5px;
  cursor: pointer;
}
.audbtn:hover:not(.on) {
  color: #2f4368;
  background: #eef1f5;
}
.audbtn.on {
  color: #fff;
  background: #2f4368;
  border: 1px solid #2f4368;
  cursor: default;
}
.pbody {
  display: grid;
  gap: 2px;
}
.corner {
  width: var(--gutw);
}
.chead,
.rhead {
  height: var(--ch);
  font-size: 9px;
  font-weight: 700;
  color: #8a93a0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}
.chead.on,
.rhead.on {
  color: #2f4368;
}
.cell {
  height: var(--ch);
  border: 1px solid #e2e6ec;
  border-radius: 3px;
  background: #eef1f5;
}
/* the dropped middle of a wide plan: a column of air with one ellipsis in its heading */
.cell.gap,
.chead.gap {
  background: transparent;
  border-color: transparent;
  color: #8a93a0;
}
/* a phone gets slightly bigger chairs and taller tap targets, since the panel stacks there and
   the width is free */
@media (max-width: 640px) {
  .preview {
    --cw: 24px;
    --ch: 18px;
  }
  .audbtn {
    padding: 6px;
  }
}
</style>
