<template>
  <div class="secblock">
    <!-- ONE heading for the block, and it belongs to the working copy: each preview's own
         count and status go under its grid, small, so neither can be mistaken for the other. -->
    <div class="sechead">
      <h2 :style="{ color: store.sectionColours.value[sec] }">{{ sec }}</h2>
      <span class="meta">{{ block.count }} singers</span>
      <button class="cbtn sm" @click="store.autoSeat(sec)">Auto-seat</button>
      <span class="status" :class="block.status.cls">{{ block.status.txt }}</span>
    </div>
    <!-- With previews open, this section sits beside the same section of each previewed plan,
         in a row that scrolls sideways. The split is per BLOCK rather than per pane, which is what
         keeps cropped grids readable where whole stages side by side would not be. -->
    <div class="secsplit" :class="{ compared: previews.length > 0 }">
      <div class="secside">
        <div class="secscroll">
          <SeatGrid
            :slots="block.slots"
            :rows="block.rows"
            :stranded="block.stranded"
            :lateral="store.stageLateral.value"
            :focus-section="sec"
          />
        </div>
        <p v-if="previews.length" class="sidefoot">
          <b>{{ store.openArrangementName.value || 'This plan' }}</b>
          <span class="sidemeta">working copy</span>
        </p>
      </div>
      <!-- Read-only, by construction: no `data-gi`, no press handlers, no cell menu. That is
           what keeps useDragDrop's document-wide [data-gi] hit test unambiguous with two grids
           on screen, and it is asserted in the desk pass rather than trusted. -->
      <div v-for="pv in previews" :key="pv.key" class="secside secref">
        <div class="secscroll">
          <SeatGrid
            :slots="pv.slots"
            :rows="pv.rows"
            :stranded="pv.view.stranded"
            :focus-section="sec"
            :plan="pv.view"
            readonly
          />
        </div>
        <p class="sidefoot">
          <b>{{ pv.label }}</b>
          <span class="sidemeta">{{ pv.count }} singers</span>
          <span class="status" :class="pv.status.cls">{{ pv.status.txt }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { SECTION_KEY } from '../utils/arranger';
import { cropToSection } from '../utils/stageLayout';
import { useChoirArranger } from '../composables/useChoirArranger';
import SeatGrid from './SeatGrid.vue';

const props = defineProps({ sec: { type: String, required: true } });
const store = useChoirArranger();

const block = computed(() => {
  const sec = props.sec;
  const rows = store.gridRows.value;
  const seq = store.seats.value;
  const bn = store.byId.value;

  // status line: this section's isolation/break count across section + every split, read off
  // the single global grid (so it matches the badges and the Full-stage view exactly).
  const eng = store.engine();
  let aloneTotal = 0, brokenTotal = 0;
  [SECTION_KEY, ...store.SCH.value].forEach((key) => {
    const e = eng.evaluate2D(seq, rows, key);
    aloneTotal += e.stranded.filter((id) => bn[id] && bn[id].section === sec).length;
    brokenTotal += e.broken.filter((b) => b.sec === sec).length;
  });
  let status;
  if (aloneTotal) status = { cls: 'warn', txt: (aloneTotal === 1 ? '1 singer has' : aloneTotal + ' singers have') + ' nobody from their group next to them' };
  else if (brokenTotal) status = { cls: 'warn', txt: (brokenTotal === 1 ? '1 group is' : brokenTotal + ' groups are') + ' split up' };
  else status = { cls: 'ok', txt: 'every singer keeps all their groups' };

  // Crop to this section's bounding box — the smallest rectangle of real grid cells that holds
  // all of its singers, with other sections' cells inside the box kept and ghosted so the box
  // stays a true rectangle. The arithmetic is `cropToSection()` in utils/stageLayout.js,
  // because each preview beside this one crops a plan that is not the live one
  // and two copies of a bounding box is how the two views start disagreeing.
  const crop = cropToSection({ seats: seq, rows, byId: bn, sec, audienceAt: store.audienceAt.value });

  const count = store.data.value.filter((p) => p.section === sec).length;
  return { rows: crop.rows, count, status, slots: crop.slots, stranded: store.stageStranded.value };
});

/*
 * The preview halves of the block: the SAME section, cropped out of each previewed arrangement.
 * Each is its own crop, from its own plan — two arrangements may put a section in different
 * columns — and none is scaled to match, so a taller crop is simply taller.
 */
const previews = computed(() =>
  store.previews.value.map(({ key, label, plan, view }) => {
    const crop = cropToSection({ seats: plan.seats, rows: plan.rows, byId: view.byId, sec: props.sec, audienceAt: store.audienceAt.value }); // the open plan's side, as ReferencePane.vue explains
    // Its own status line, from its own engine: the point of the comparison is that it may differ.
    const eng = view.engine();
    let alone = 0, broken = 0;
    [SECTION_KEY, ...view.SCH].forEach((key) => {
      const e = eng.evaluate2D(plan.seats, plan.rows, key);
      alone += e.stranded.filter((sid) => view.byId[sid] && view.byId[sid].section === props.sec).length;
      broken += e.broken.filter((b) => b.sec === props.sec).length;
    });
    const count = (plan.roster || []).filter((p) => p.section === props.sec).length;
    return {
      key,
      label,
      rows: crop.rows,
      slots: crop.slots,
      count,
      view,
      status: alone
        ? { cls: 'warn', txt: alone + ' isolated' }
        : broken
          ? { cls: 'warn', txt: broken + (broken === 1 ? ' group split up' : ' groups split up') }
          : { cls: 'ok', txt: 'all groups kept' }
    };
  })
);
</script>

<style scoped>
.secblock {
  border-top: 1px solid #e2e6ec;
  padding: 12px 16px 14px;
}
/* the first one sits under the view line, which it shares the stage's heading with */
.secblock:first-child {
  border-top: none;
}
/* scroll a wide section grid inside the region. The negative margins cancel the region's
   padding so the scroll area spans it; the matching padding then sits INSIDE the
   scroll region so the cells' overhanging buttons/badges aren't clipped (overflow-x:auto
   forces overflow-y to auto too). Mirrors StageView's .stagewrap. */
.secscroll {
  overflow-x: auto;
  margin: 0 -16px -14px;
  padding: 8px 16px 14px;
}
/* The live crop and each preview's, side by side at their own widths, in one row that scrolls
   sideways. Nothing is scaled, so a taller crop is simply taller and the comparison stays honest. */
.secsplit.compared {
  display: flex;
  gap: 22px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 4px;
}
.secsplit.compared .secscroll {
  overflow: visible;
  margin: 0;
  padding: 8px 0 10px;
}
.secsplit.compared .secside {
  flex: none;
}
/* Which plan each half is, under the grid rather than over it, so the block keeps one heading. */
.sidefoot {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
  font-size: 12px;
  color: #3b4657;
}
.sidefoot .sidemeta {
  color: #5a6573;
}
.secref .sidefoot b {
  color: #5a6573;
  font-weight: 600;
}
.sechead {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.sechead h2 {
  font-size: 15px;
  margin: 0;
}
.sechead .meta {
  font-size: 12px;
  color: #5a6573;
}
.status.ok {
  color: #1a7f3c;
  font-weight: 600;
  font-size: 12px;
}
.status.warn {
  color: #b4601a;
  font-weight: 600;
  font-size: 12px;
}
</style>
