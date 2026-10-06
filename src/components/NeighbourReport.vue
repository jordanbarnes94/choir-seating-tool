<template>
  <!-- a class, not an id: the printed sheet renders a second report for the plan it is drawing,
       and two elements cannot share one id. -->
  <div class="report" :class="{ live }">
    <h3>Neighbour check</h3>
    <table class="reptbl">
      <thead>
        <tr>
          <th />
          <th v-for="c in cols" :key="c.key">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sectionRows" :key="row.sec">
          <th class="repsec" :style="{ color: colours[row.sec] }">{{ row.sec }}</th>
          <td v-for="cell in row.cells" :key="cell.split">
            <!-- One chip per finding. On screen each one points at its singers on the stage while
                 hovered or keyboard-focused, and a click pins it there until clicked again; on
                 paper there is nothing to point at, so the names are written out after it. -->
            <span class="chips">
              <template v-for="f in cell.findings" :key="f.kind + f.label">
                <span
                  class="chip"
                  :class="[f.kind, { pinned: live && isPinned(row.sec, cell.split, f.fid) }]"
                  :tabindex="live ? 0 : undefined"
                  :role="live ? 'button' : undefined"
                  :aria-pressed="live ? isPinned(row.sec, cell.split, f.fid) : undefined"
                  :data-tip="live ? f.tip : undefined"
                  @pointerenter="hover(row.sec, cell.split, f.fid)"
                  @pointerleave="hover(null)"
                  @focus="onFocus($event, row.sec, cell.split, f.fid)"
                  @blur="hover(null)"
                  @click="togglePin(row.sec, cell.split, f.fid)"
                  @keydown.enter.prevent="togglePin(row.sec, cell.split, f.fid)"
                  @keydown.space.prevent="togglePin(row.sec, cell.split, f.fid)"
                >{{ f.label }}</span>
                <span v-if="!live && f.names" class="names">{{ f.names }}</span>
              </template>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="replegend">
      <span><span class="chip key ok">✓</span> everyone has a neighbour</span>
      <span><span class="chip key alone">alone</span> no group-mate beside, in front or behind</span>
      <span><span class="chip key broken">split</span> the group is in separate pieces</span>
      <span><span class="chip key lateral">↕</span> group-mates only in front or behind</span>
      <span v-if="live" class="legendhint">Point at an entry to find those singers on the stage, or click it to keep them marked.</span>
    </p>
  </div>
</template>

<script setup>
import { ref, computed, watchEffect, onBeforeUnmount, unref } from 'vue';
import { SECTION_KEY, SECTION_VIEW } from '../utils/arranger';
import { useChoirArranger } from '../composables/useChoirArranger';

// The same contract SeatGrid has, for the same reason: the printed sheet, the
// walk-on list and the previews all have to render a plan that is not the live one,
// and there is only ever one store. Every prop defaults to the live store, so the existing call
// site in ChoirArranger.vue passes nothing and is unchanged.
//
// `plan` is a plan view (usePlanView.js's makePlanView output, or the store itself); the three
// alongside it are the plan's own fields, which a plan view does not carry — exactly as SeatGrid
// takes `slots` and `rows` beside its `plan`.
const props = defineProps({
  plan: { type: Object, default: null },
  seats: { type: Array, default: null },
  rows: { type: Number, default: null },
  sectionOrder: { type: Array, default: null }
});

const store = useChoirArranger();
// Every plan read goes through here. `unref` covers both shapes: the store's refs and the plain
// values a plan view returns.
const plan = computed(() => props.plan || store);
// Only the live report can point at the stage: the ids of any other plan are not the ones the
// stage is showing, and the printed sheet has no pointer.
const live = computed(() => !props.plan);
const seq = computed(() => props.seats || unref(store.seats));
const depth = computed(() => (props.rows == null ? unref(store.gridRows) : props.rows));
const order = computed(() => props.sectionOrder || unref(store.sectionOrder));
// The colours are plan data, so the report paints from the PLAN's palette rather than the
// live one. makePlanView resolves `sectionColours` against the defaults exactly as the store
// does, so both shapes answer alike and `unref` covers the store's computed.
const colours = computed(() => unref(plan.value.sectionColours));

// section first (always checked), then each user split
const cols = computed(() => {
  const SCH = unref(plan.value.SCH), SCH_LABEL = unref(plan.value.SCH_LABEL);
  return [{ key: SECTION_KEY, label: 'Section' }, ...SCH.map((s) => ({ key: s, label: SCH_LABEL[s] }))];
});

// one row per section. Named for what it is rather than `rows`, which is now the grid-depth prop.
const sectionRows = computed(() => {
  const eng = plan.value.engine();
  const seats = seq.value;
  const r = depth.value;
  const bn = unref(plan.value.byId);
  const seated = seats.filter((id) => bn[id]);
  // one global evaluation per column key; rows then filter it down to each section.
  const evals = {};
  const laterals = {};
  cols.value.forEach(({ key }) => {
    evals[key] = eng.evaluate2D(seats, r, key);
    laterals[key] = eng.lateralIsolated2D(seats, r, key);
  });
  // The engine answers in ids; the report is read by a person, so each list is
  // resolved to names here. `b.lab` is a split category and was never a person, so it is not.
  const inSec = (ids, sec) => ids.filter((id) => bn[id] && bn[id].section === sec);
  const namesOf = (ids) => ids.map((id) => bn[id].name).join(', ');
  // The chairs directly in front and behind (the neighbours in the same column of the stored,
  // column-major seats) holding someone from the same group for `key`.
  const at = new Map(seats.map((id, i) => [id, i]));
  const verticalMates = (id, key) => {
    const i = at.get(id), row = i % r;
    const mate = (j) => bn[seats[j]] && bn[seats[j]].section === bn[id].section && bn[seats[j]][key] === bn[id][key];
    return [row > 0 && mate(i - 1) && seats[i - 1], row < r - 1 && mate(i + 1) && seats[i + 1]].filter(Boolean);
  };
  return order.value.map((sec) => {
    const cells = cols.value.map(({ key }) => {
      const e = evals[key];
      const alone = inSec(e.stranded, sec);
      const broken = e.broken.filter((b) => b.sec === sec);
      // information, not a defect: singers with company in front or behind but nobody
      // beside them. lateralIsolated2D excludes anyone `stranded` lists, so `ok` still
      // means "no defect here" and nobody is named twice.
      const lateral = inSec(laterals[key], sec);
      const findings = [];
      // The ✓ points too: at the whole section, which is what it vouches for.
      if (!alone.length && !broken.length) {
        const ids = seated.filter((id) => bn[id].section === sec);
        findings.push({ kind: 'ok', fid: 'ok', label: '✓', ids, names: '', tip: `Everyone in ${sec} has a group-mate next to them` });
      }
      if (alone.length) {
        findings.push({ kind: 'alone', fid: 'alone', label: `${alone.length} alone`, ids: alone, names: namesOf(alone), tip: `Alone: ${namesOf(alone)}` });
      }
      // A broken group points at every seated member of it, which is what shows its pieces.
      broken.forEach((b) => {
        const ids = seated.filter((id) => bn[id].section === sec && bn[id][key] === b.lab);
        const what = key === SECTION_KEY ? sec : `${sec} ${b.lab}`;
        findings.push({ kind: 'broken', fid: 'broken ' + b.lab, label: key === SECTION_KEY ? 'split' : `split: ${b.lab}`, ids, names: '', tip: `${what} is in more than one piece` });
      });
      if (lateral.length) {
        // It also rings the group-mates in front or behind, so you can see who their company is.
        const ids = [...new Set(lateral.flatMap((id) => [id, ...verticalMates(id, key)]))];
        findings.push({ kind: 'lateral', fid: 'lateral', label: `↕ ${lateral.length}`, ids, names: namesOf(lateral), tip: `Only in front or behind, nobody beside: ${namesOf(lateral)}` });
      }
      return { split: key, findings };
    });
    return { sec, cells };
  });
});

// The entry pointed at, and the one pinned by a click (`ui.marked`, so the pill over the stage
// can unpin it), each as { sec, split, fid }. The stage shows the pointed one, else the pinned
// one. They are looked up afresh in `sectionRows`, so a pinned entry follows its singers as the
// stage changes, and lets go once the problem is gone. A pin keeps them marked while the stage
// is scrolled into view.
const hovered = ref(null);
const pinned = computed({ get: () => store.ui.marked, set: (v) => { store.ui.marked = v; } });
const same = (a, sec, split, fid) => !!a && a.sec === sec && a.split === split && a.fid === fid;
const isPinned = (sec, split, fid) => same(pinned.value, sec, split, fid);
function hover(sec, split, fid) {
  hovered.value = sec ? { sec, split, fid } : null;
}
// Keyboard focus points, like hovering. A tap focuses the chip too, and that must not keep
// pointing at it once the tap has unpinned it.
function onFocus(e, sec, split, fid) {
  if (e.target.matches(':focus-visible')) hover(sec, split, fid);
}
function togglePin(sec, split, fid) {
  if (!live.value) return;
  pinned.value = isPinned(sec, split, fid) ? null : { sec, split, fid };
}
const findingAt = (at) =>
  at && sectionRows.value.find((r) => r.sec === at.sec)?.cells.find((c) => c.split === at.split)?.findings.find((f) => f.fid === at.fid);

watchEffect(() => {
  if (live.value && pinned.value && !findingAt(pinned.value)) pinned.value = null;
});
// Pointing at an entry also colours the stage by that entry's column while it lasts, so the frames
// and ↕ arrows on show are the ones this split has, not the colour-by chosen above the stage.
watchEffect(() => {
  if (!live.value) return;
  const at = findingAt(hovered.value) ? hovered.value : pinned.value;
  const f = findingAt(at);
  store.ui.highlight = f ? new Set(f.ids) : null;
  store.ui.peekView = f ? (at.split === SECTION_KEY ? SECTION_VIEW : at.split) : null;
  const p = pinned.value, pf = findingAt(p);
  const col = p && p.split !== SECTION_KEY ? cols.value.find((c) => c.key === p.split)?.label : null;
  store.ui.markedText = pf ? [p.sec, col, pf.label].filter(Boolean).join(' · ') : null;
});
// A report that goes away while pointing (the panel folded, the plan switched) must not leave
// the stage faded.
onBeforeUnmount(() => {
  if (!live.value) return;
  store.ui.highlight = null;
  store.ui.peekView = null;
  store.ui.marked = null;
  store.ui.markedText = null;
});
</script>

<style scoped>
.report {
  font-size: 13px;
  background: #fff;
  border: 1px solid #e2e6ec;
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 16px;
}
.report h3 {
  margin: 0 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #5a6573;
}
.reptbl {
  border-collapse: collapse;
}
.reptbl th,
.reptbl td {
  text-align: left;
  padding: 5px 16px 5px 0;
  vertical-align: middle;
  font-weight: 400;
}
.reptbl tbody tr + tr > * {
  border-top: 1px solid #f0f2f5;
}
.reptbl thead th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #5a6573;
  border-bottom: 1px solid #e2e6ec;
}
.reptbl th.repsec {
  font-weight: 700;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}
/* Every chip keeps its words: colour is a second signal, never the only one, so the report
   still reads on a black-and-white print. */
.chip {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}
.chip.ok {
  color: #1a7f3c;
  background: #e7f5ec;
}
.chip.alone,
.chip.broken {
  color: #a4520f;
  background: #fdf0e3;
  border-color: #f0c9a0;
}
/* Third severity: information, not a defect, so it sits below the warnings at a
   visibly lower weight in muted grey. */
.chip.lateral {
  color: #4e5665;
  background: #f1f3f6;
  font-weight: 500;
}
.live .chip:not(.key) {
  cursor: pointer;
}
.live .chip:not(.key):hover,
.live .chip:not(.key):focus-visible {
  border-color: #2f6df0;
  outline: none;
}
/* pinned by a click: stays marked on the stage until clicked again */
.live .chip.pinned {
  border-color: #2f6df0;
  box-shadow: 0 0 0 1px #2f6df0;
}
.names {
  font-size: 12px;
  color: #3a4453;
}
.replegend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 10px 0 0;
  font-size: 11.5px;
  color: #5a6573;
}
.replegend .chip {
  font-size: 11px;
  padding: 0 6px;
  margin-right: 3px;
}
.legendhint {
  font-style: italic;
}
</style>
