<template>
  <!-- The neighbour check entry pinned by a click, named over the stage with a × to unpin it, so
       the ringed and faded stage explains itself even with the report scrolled out of view. -->
  <span v-if="store.ui.marked && store.ui.markedText" class="markpill">
    Marked: {{ store.ui.markedText }}
    <button type="button" class="markclose" aria-label="Stop marking these singers" @click="store.ui.marked = null">×</button>
  </span>
</template>

<script setup>
import { useChoirArranger } from '../composables/useChoirArranger';

const store = useChoirArranger();
</script>

<style scoped>
/* The preview pills' shape, in the blue of the pinned entry and the ringed chairs. */
.markpill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 1px 3px 1px 9px;
  font-size: 11px;
  font-weight: 600;
  color: #1f4fb8;
  background: #eaf1ff;
  border: 1px solid #2f6df0;
  border-radius: 999px;
  vertical-align: middle;
}
.markclose {
  width: 18px;
  height: 18px;
  padding: 0;
  line-height: 1;
  font-size: 13px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #1f4fb8;
  cursor: pointer;
}
.markclose:hover {
  background: #d3e1fd;
}
</style>
