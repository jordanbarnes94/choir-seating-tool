<template>
  <!-- The seating plan being edited, and the other plans shown beside it. It sits in the header
       because it names what everything under it is editing, and it lives on the page rather
       than in Choir setup so a plan can be saved, switched and compared while the stage is in
       view: arranging, then opening a dialog to save, was the wrong way round. -->
  <div v-if="store.concert.value" class="planbar">
    <div class="pgroup">
      <span class="pconcert" data-tip="The open concert. Open another in Choir setup.">{{ store.openConcertName.value }}</span>
      <span class="psep" aria-hidden="true">›</span>
      <select class="csel psel" :value="store.openArrangementId.value" aria-label="Seating plan" @change="onPick">
        <option v-for="a in plans" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <!-- What is done to a plan now and then, in a menu beside what is done all the time. -->
      <div ref="moreBox" class="pmore">
        <button class="cbtn morebtn" type="button" :aria-expanded="moreMenu" @click="moreMenu = !moreMenu">More ▾</button>
        <div v-if="moreMenu" class="cmenu moremenu" role="menu" aria-label="More seating plan actions">
          <button class="cmenuitem" type="button" role="menuitem" @click="pick(duplicate)">
            <b>Duplicate</b>
            <span>A new seating plan, copied from what is on screen.</span>
          </button>
          <button class="cmenuitem" type="button" role="menuitem" @click="pick(startRename)">
            <b>Rename…</b>
            <span>A new name for this seating plan.</span>
          </button>
          <button class="cmenuitem danger" type="button" role="menuitem" :disabled="plans.length < 2" @click="pick(del)">
            <b>Delete</b>
            <span>{{ plans.length < 2 ? 'A concert keeps at least one seating plan.' : 'Delete this seating plan, after asking.' }}</span>
          </button>
        </div>
      </div>
      <!-- Last in the group, so nothing beside the picker moves when a change is made. -->
      <button v-if="dirty" class="cbtn primary" @click="save">Save changes</button>
      <span v-else class="psaved">✓ Saved</span>
    </div>

    <!-- Previews: other plans, read-only, beside this one. This concert's plans at the
         top, then every other concert's under its name. The picker is a one-shot: choosing adds
         the preview and it goes back to its prompt. -->
    <div v-if="store.referenceOptions.value.length" class="pgroup">
      <label class="clabel" data-tip="Show another seating plan, read-only, with this one">
        Compare
        <select class="csel psel" value="" aria-label="Add a preview" :disabled="!store.previewChoices.value.length" @change="onAddPreview">
          <option value="" disabled>{{ store.previewChoices.value.length ? 'Add a plan…' : 'All shown' }}</option>
          <option v-for="o in store.previewChoiceGroups.value.current" :key="o.key" :value="o.key">{{ o.name }}</option>
          <optgroup v-for="g in store.previewChoiceGroups.value.groups" :key="g.concertId" :label="g.name">
            <option v-for="o in g.plans" :key="o.key" :value="o.key">{{ o.name }}</option>
          </optgroup>
        </select>
      </label>
      <span v-for="pv in store.previews.value" :key="pv.key" class="pvchip">
        {{ pv.label }}
        <button class="pvclose" :aria-label="`Stop previewing ${pv.label}`" @click="store.removePreview(pv.key)">×</button>
      </span>
    </div>

    <!-- Every question this bar asks, in the one in-page modal (never confirm()/prompt()). -->
    <ChoirModal :open="ask.open" :title="ask.title" @close="closeAsk">
      <p class="asktext">{{ ask.text }}</p>
      <template v-if="ask.naming">
        <input
          ref="nameInput"
          v-model="ask.name"
          class="askinput"
          placeholder="Seating plan name"
          @keydown.enter.prevent="submitRename"
        >
        <p v-if="ask.error" class="askerr">{{ ask.error }}</p>
      </template>
      <template #actions>
        <button class="pbtn" @click="closeAsk">Cancel</button>
        <button v-if="ask.naming" class="pbtn pbtn-primary" @click="submitRename">Rename</button>
        <button
          v-for="a in ask.actions"
          v-else
          :key="a.label"
          class="pbtn"
          :class="a.kind === 'danger' ? 'pbtn-danger-solid' : a.kind === 'primary' ? 'pbtn-primary' : ''"
          @click="doAction(a)"
        >{{ a.label }}</button>
      </template>
    </ChoirModal>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useChoirArranger } from '../composables/useChoirArranger';
import ChoirModal from './ChoirModal.vue';

const store = useChoirArranger();

const plans = computed(() => {
  const c = store.concert.value;
  return c ? c.arrangements.map((a) => ({ id: a.id, name: a.name })) : [];
});
// A computed over the store's own comparison, so it follows a drag and clears on Save.
const dirty = computed(() => store.hasUnsavedChanges());

/* ---------- the More menu ---------- */
const moreMenu = ref(false);
const moreBox = ref(null);
function pick(fn) {
  moreMenu.value = false;
  fn();
}
// Closes on a click anywhere outside it.
function onDocPointer(e) {
  if (moreMenu.value && moreBox.value && !moreBox.value.contains(e.target)) moreMenu.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDocPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer));

/* ---------- the modal ---------- */
const ask = reactive({ open: false, title: '', text: '', actions: [], naming: false, name: '', error: '' });
const nameInput = ref(null);
function askChoice(title, text, actions) {
  Object.assign(ask, { open: true, title, text, actions, naming: false, name: '', error: '' });
}
function closeAsk() {
  ask.open = false;
  ask.actions = [];
}
// The action runs after the modal is closed, so an action that asks the NEXT question (the
// stale-seats check after "Save, then open") opens it afresh rather than being closed by this.
function doAction(a) {
  closeAsk();
  a.run();
}

/*
 * For the plan on stage: opening another plan replaces the working copy, so unsaved
 * seating changes are asked about first — "Save, then open", "Discard changes", or Cancel.
 * Choir setup does the same when it loads another concert.
 */
function replacingStage(run) {
  if (!dirty.value) return run();
  askChoice(
    'Unsaved seating changes',
    `"${store.openArrangementName.value}" has seating changes you have not saved. Open the other seating plan and lose them?`,
    [
      { label: 'Save, then open', kind: 'primary', run: () => (store.saveArrangement(), run()) },
      { label: 'Discard changes', kind: 'danger', run }
    ]
  );
}
// A stored plan may seat somebody the concert no longer has. They are named first.
function openingArrangement(arrangementId, run) {
  const concertId = store.openConcertId.value;
  const stale = store.staleForOpen(concertId, arrangementId);
  if (!stale.length) return run();
  const names = stale.map((p) => p.name);
  const who = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const gone = stale.some((p) => !p.inRoster);
  askChoice(
    'Singers who are not in this concert',
    `That seating plan seats ${who}, who ${names.length === 1 ? 'is' : 'are'} not singing this concert. ` +
      (gone ? 'Some of them are no longer on the roster. ' : 'Tick them back in, in Choir setup, to keep their seats. ') +
      'Opening it empties their seats.',
    [{ label: 'Remove them and open', kind: 'danger', run: () => (store.dropStale(concertId, arrangementId), run()) }]
  );
}

/* ---------- the plan actions ---------- */
function onPick(e) {
  const id = e.target.value;
  // The select shows the OPEN plan until the switch actually happens: a Cancel leaves it right.
  e.target.value = store.openArrangementId.value;
  if (id === store.openArrangementId.value) return;
  replacingStage(() => openingArrangement(id, () => store.openArrangementById(store.openConcertId.value, id)));
}
function save() {
  if (store.saveArrangement()) store.showToast(`Saved "${store.openArrangementName.value}"`);
}
function duplicate() {
  const base = store.openArrangementName.value || 'Plan';
  let n = 2, name;
  do {
    name = `${base} (${n++})`;
  } while (plans.value.some((a) => a.name === name));
  // A duplicate copies what is ON SCREEN, unsaved changes and all, and the plan it came from
  // keeps what it had saved.
  const a = store.addArrangement(name, { from: 'working' });
  if (!a) return;
  store.openArrangementById(store.openConcertId.value, a.id);
  store.showToast(`Created "${name}" from what is on screen`);
}
function startRename() {
  Object.assign(ask, {
    open: true,
    title: 'Rename seating plan',
    text: `A new name for "${store.openArrangementName.value}".`,
    actions: [],
    naming: true,
    name: store.openArrangementName.value,
    error: ''
  });
  nextTick(() => nameInput.value && (nameInput.value.focus(), nameInput.value.select()));
}
function submitRename() {
  const name = ask.name.trim();
  if (!name) {
    ask.error = 'Enter a name.';
    return;
  }
  store.renameArrangement(store.openArrangementId.value, name);
  closeAsk();
  store.showToast(`Renamed to "${name}"`);
}
function del() {
  const name = store.openArrangementName.value;
  askChoice('Delete seating plan', `Delete the seating plan "${name}"? This can't be undone.`, [
    {
      label: 'Delete',
      kind: 'danger',
      run: () => store.deleteArrangement(store.openArrangementId.value) && store.showToast(`Deleted "${name}"`)
    }
  ]);
}
function onAddPreview(e) {
  store.addPreview(e.target.value);
  e.target.value = '';
}
</script>

<style scoped>
/* Two groups on the header's line, the plan and what it is compared with, each wrapping whole. */
.planbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 28px;
  min-width: 0;
}
.pgroup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* the concert, then its plan: the path to what is on the stage */
.pconcert {
  font-size: 14px;
  font-weight: 600;
  color: #1d2330;
  max-width: 28ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.psep {
  color: #8a94a2;
  font-size: 15px;
  line-height: 1;
  margin: 0 -2px;
}
.psel {
  min-width: 150px;
  max-width: min(100%, 32ch);
}
.psaved {
  font-size: 13px;
  font-weight: 600;
  color: #1a7f3c;
  padding: 0 4px;
}
.pmore {
  position: relative;
}
.cmenu.moremenu {
  left: 0;
  right: auto;
  width: 250px;
}
/* the modal's buttons: the same as Choir setup's */
.pbtn {
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
.pbtn:hover:not(:disabled, [aria-disabled='true']) {
  background: #e3e8ef;
}
.pbtn:disabled,
.pbtn[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
.pbtn-primary {
  background: #2f4368;
  border-color: #2f4368;
  color: #fff;
}
.pbtn-primary:hover:not(:disabled, [aria-disabled='true']) {
  background: #26354f;
}
.pbtn-danger-solid {
  background: #b4231a;
  border-color: #b4231a;
  color: #fff;
}
.pbtn-danger-solid:hover:not(:disabled) {
  background: #9c1d15;
}
/* a previewed plan, with its own close */
.pvchip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #2f4368;
  background: #eef1f5;
  border: 1px solid #c4ccd6;
  border-radius: 999px;
}
.pvclose {
  width: 20px;
  height: 20px;
  padding: 0;
  line-height: 1;
  font-size: 14px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #5a6573;
  cursor: pointer;
}
.pvclose:hover {
  background: #dfe4ea;
}
.asktext {
  margin: 0 0 10px;
  font-size: 13.5px;
}
.askinput {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 10px;
  font-size: 14px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
}
.askinput:focus {
  outline: 2px solid #2f6df0;
  outline-offset: -1px;
}
.askerr {
  margin: 6px 0 0;
  color: #b4231a;
  font-size: 12.5px;
}
/* narrow screens: one column, each picker the full width with Save and More sharing the line
   under the plan's */
@media (max-width: 640px) {
  .planbar {
    flex-direction: column;
    align-items: stretch;
  }
  .pgroup {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .pconcert,
  .pgroup > .psel,
  .pgroup > .clabel,
  .pvchip {
    grid-column: 1 / -1;
  }
  .psep {
    display: none;
  }
  .psel {
    width: 100%;
    max-width: none;
  }
  .clabel .psel {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
  }
  .pmore .morebtn {
    width: 100%;
  }
  .moremenu {
    left: auto;
    right: 0;
  }
  .pvchip {
    justify-content: space-between;
  }
}
</style>
