<template>
  <!-- The walk-on order as its own print, on A4 portrait (ChoirArranger's `choir-portrait` page).
       It used to ride on the end of the stage print, but the two are different documents for
       different people: the stage plan is landscape and goes to the choir, this list goes to the
       stewards on the doors and reads better tall. -->
  <div class="walkonsheet">
    <div class="sheethead">
      <strong class="sheetname">{{ title }}</strong>
      <span class="sheetpart">Walk-on order</span>
      <span class="sheetmeta">{{ meta }}</span>
    </div>
    <WalkOnList :list="list" :waiting="waiting" sheet />
  </div>
</template>

<script setup>
import { computed } from 'vue';
// Props only, no store, like WalkOnList and PlanSheet: it prints whatever list it is handed.
import { formatDate, sheetTitle } from '../utils/printPlan';
import WalkOnList from './WalkOnList.vue';

const props = defineProps({
  // the return of walkOnGroups() in utils/walkOnList.js
  list: { type: Object, required: true },
  // singers with no seat
  waiting: { type: Array, default: () => [] },
  // the plan's name, for the title line
  name: { type: String, default: '' },
  date: { type: Date, default: () => new Date() }
});

const title = computed(() => sheetTitle(props.name));
const meta = computed(() => formatDate(props.date));
</script>

<style scoped>
.walkonsheet {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #1d2330;
  background: #fff;
}
.sheethead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 3px solid currentColor;
  white-space: nowrap;
  overflow: hidden;
}
.sheetname {
  font-size: 14pt;
  font-weight: 700;
}
.sheetpart {
  font-size: 12pt;
  font-weight: 600;
  color: #36404f;
}
.sheetmeta {
  font-size: 9pt;
  color: #4a5567;
}
</style>
