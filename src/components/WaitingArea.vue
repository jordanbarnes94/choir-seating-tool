<template>
  <!-- The bench: roster members not currently seated. Drag a chip onto a chair to seat them;
       drag a seated singer here (or use their menu) to send them back. -->
  <div class="bench" :class="{ dragover: store.dragOverBench.value }">
    <div class="benchhead">
      <span class="benchtitle">Waiting area</span>
      <!-- With nobody waiting the region is this one line. -->
      <span class="benchmeta">
        {{ store.waiting.value.length ? `${store.waiting.value.length} unplaced` : 'Everyone is seated' }} · {{ freeChairs }} free chair{{ freeChairs === 1 ? '' : 's' }}
      </span>
    </div>
    <div v-if="store.waiting.value.length" class="benchlist">
      <!-- The bench holds IDS; the name is read off the roster record here, which
           is the same resolution SeatGrid does for a chair. -->
      <div
        v-for="id in store.waiting.value"
        :key="id"
        class="chip"
        :style="chipStyle(id)"
        :data-tip="`${store.byId.value[id].name} — drag onto a chair to seat them`"
        @pointerdown="onChipDown(id, $event)"
        @contextmenu.prevent
      >
        {{ store.byId.value[id].name }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { tint, bolden } from '../utils/arranger';
import { useChoirArranger } from '../composables/useChoirArranger';
import { usePress } from '../composables/useDragDrop';

const store = useChoirArranger();
// Chips are dedicated drag handles (touch-action:none in CSS): the drag starts on the
// first finger movement, no hold needed. Dropping them back on the bench is a no-op.
const press = usePress({ fireOnMove: true });

// free chairs = seats that could hold a singer (capacity) minus those already taken.
const freeChairs = computed(() => Math.max(0, store.capacity.value - store.placedSet.value.size));

function chipStyle(id) {
  const hex = store.sectionColours.value[store.byId.value[id].section];
  return { background: tint(hex), borderColor: bolden(hex) };
}
function onChipDown(id, e) {
  press.down(e, () => ({ id }));
}
</script>

<style scoped>
.bench {
  border-top: 1px solid #e2e6ec;
  padding: 11px 16px 12px;
}
/* inside the region's edge: it has the workspace's rules round it, not air */
.bench.dragover {
  outline: 3px dashed #2f6df0;
  outline-offset: -4px;
}
.benchhead {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.benchtitle {
  font-size: 13px;
  font-weight: 700;
  color: #2f4368;
}
.benchmeta {
  font-size: 12px;
  color: #5a6573;
}
.benchlist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.chip {
  font-size: 11px;
  font-weight: 500;
  color: #11203a;
  padding: 4px 9px;
  border: 2px solid transparent;
  border-radius: 14px;
  cursor: grab;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  white-space: nowrap;
}
.chip:active {
  cursor: grabbing;
}
</style>
