<template>
  <ChoirModal :open="open" :title="title" :tone="tone" @close="emit('close')">
    <!-- ── Before a file: what it has to look like ──────────────────────────────────────── -->
    <template v-if="stage === 'intro'">
      <p class="lead">Choose an Excel workbook (.xlsx) or a CSV file. Only its first sheet is read.</p>
      <ul class="rules">
        <li>A header row, then one row per singer.</li>
        <li>The first column is <b>Name</b> and the second is <b>Section</b>.</li>
        <li>Each section is Soprano, Alto, Tenor or Bass. Just S, A, T or B works too.</li>
        <li v-if="kind === 'concert'">
          Any further columns can become <b>splits</b>: one column per split, each cell holding the
          singer's group in it, such as 1 or 2. You choose which columns to use next.
        </li>
        <li v-else>
          Any further columns are ignored: splits belong to a concert. To bring them in, import
          on the <b>Concert</b> tab instead.
        </li>
      </ul>
      <p class="note">
        <template v-if="kind === 'concert'">The import makes a new roster of the singers and a new concert over it, and you name both.</template>
        <template v-else>You can make a new roster from the file, or replace the singers in one of yours.</template>
        The template shows the layout.
      </p>
    </template>

    <!-- ── Concert: the column picker ─────────────────────────────────────────────────── -->
    <template v-else-if="stage === 'columns'">
      <!-- The question is only asked when there is something to answer it with: a file of just
           Name and Section has no candidate columns, and asking "which columns are splits?"
           above an empty list reads as a broken dialog. -->
      <p class="lead">
        Found <b>{{ found }}</b> {{ found === 1 ? 'singer' : 'singers' }}.<template v-if="columns.length"> Which columns are splits?</template>
      </p>
      <p v-if="!columns.length" class="note">
        That file has only names and sections, so there are no splits to choose.
      </p>
      <ul v-else class="cols">
        <li v-for="c in ticks" :key="c.index" class="col">
          <label>
            <input v-model="c.pick" type="checkbox" >
            <span class="colname" :class="{ nameless: !c.label }">{{ c.display }}</span>
            <span class="groups">{{ c.groups }} {{ c.groups === 1 ? 'group' : 'groups' }}</span>
            <span v-if="c.reason" class="reason">{{ c.reason }}</span>
          </label>
        </li>
      </ul>
      <!-- An import always makes a NEW roster of the singers and a NEW concert over it, which
           holds the splits and is opened on stage. Both names are asked, never guessed from the
           file name (Jordan, 2026-09-19): Import stays disabled until both are filled, and a
           concert name the concert form would refuse is refused here too, with the same
           sentence. -->
      <label class="namefield">
        <span class="namelabel">Save the singers as a new roster named</span>
        <input v-model="rosterName" class="nameinput" placeholder="e.g. Chamber Choir 2027" @keydown.enter="submit" >
      </label>
      <p v-if="nameError.roster" class="nameerr">{{ nameError.roster }}</p>
      <label class="namefield">
        <span class="namelabel">and open it in a new concert named</span>
        <input v-model="concertName" class="nameinput" placeholder="e.g. Spring concert 2027" @keydown.enter="submit" >
      </label>
      <p v-if="nameError.concert" class="nameerr">{{ nameError.concert }}</p>

      <!-- What the import can lose is only the plan on stage — your other concerts are never
           written to — so the warning appears only when that plan has unsaved changes
           (store.hasUnsavedChanges). This dialog IS the confirm, so the user reads it at the
           moment they can still Cancel and Save. -->
      <p v-if="unsaved" class="warn">
        The seating plan on stage has changes you have not saved. The new concert opens on
        stage in its place, so those changes will be lost. Cancel and Save first to keep them.
      </p>
      <p v-else class="note">Your other rosters and concerts are not changed.</p>
    </template>

    <!-- ── Roster: a new roster, or replace the singers in one of yours ───────────────── -->
    <template v-else-if="stage === 'roster'">
      <p class="lead">Found <b>{{ found }}</b> {{ found === 1 ? 'singer' : 'singers' }}.</p>
      <p v-if="columns.length" class="note">
        {{ columns.length === 1 ? 'Its other column' : `Its other ${columns.length} columns` }}
        ({{ columns.map((c) => c.display).join(', ') }}) will be ignored. Splits belong to a
        concert: import on the <b>Concert</b> tab to keep them.
      </p>
      <label class="choice">
        <input v-model="rosterMode" type="radio" value="new" >
        <span class="namelabel">Make a new roster named</span>
      </label>
      <input
        v-model="rosterName"
        class="nameinput indent"
        placeholder="e.g. Chamber Choir 2027"
        :disabled="rosterMode !== 'new'"
        @keydown.enter="submit"
      >
      <p v-if="nameError.roster" class="nameerr indent">{{ nameError.roster }}</p>
      <label class="choice" :class="{ off: !rosters.length }">
        <input v-model="rosterMode" type="radio" value="replace" :disabled="!rosters.length" >
        <span class="namelabel">Replace the singers in</span>
      </label>
      <select v-model="replaceId" class="nameinput indent" :disabled="rosterMode !== 'replace'">
        <option v-for="r in rosters" :key="r.id" :value="r.id">{{ r.name }} ({{ r.singers }})</option>
      </select>
      <p v-if="rosterMode === 'replace'" class="note indent">
        Singers are matched by name, ignoring case and spaces at either end. Everybody still in
        the file keeps their seats and splits in every concert, anybody missing is removed, and
        anybody new is added. The result opens on the Roster tab
        for you to check, and nothing changes until you press <b>Save</b>.
      </p>
      <p v-else-if="!rosters.length" class="note indent">You have no rosters of your own to replace yet.</p>
    </template>

    <!-- ── The result: success, partial or refusal ───────────────────────────────────── -->
    <template v-else>
      <p v-if="result.ok" class="lead ok">{{ successLine }}</p>
      <p v-else class="lead err">{{ result.error }}</p>

      <!-- a replace: who goes, who was matched under another spelling, who is new -->
      <template v-if="result.ok && result.removed">
        <template v-if="result.removed.length">
          <p class="note">Not in the file, so removed when you save:</p>
          <pre class="skipped">{{ result.removed.join('\n') }}</pre>
        </template>
        <template v-if="result.renamed.length">
          <p class="note">Matched with different capitals or spacing; the file's spelling is kept:</p>
          <pre class="skipped">{{ result.renamed.map((x) => `${x.from} → ${x.to}`).join('\n') }}</pre>
        </template>
        <template v-if="result.added.length">
          <p class="note">New to this roster:</p>
          <pre class="skipped">{{ result.added.join('\n') }}</pre>
        </template>
      </template>

      <template v-if="unknown.length">
        <p class="note">
          {{ unknown.length === 1 ? 'This section value was' : 'These section values were' }}
          not recognised. A section has to start with S, A, T or B:
        </p>
        <ul class="values">
          <li v-for="u in unknown" :key="u.value">
            <b>{{ u.value }}</b> — {{ u.count }} {{ u.count === 1 ? 'row' : 'rows' }}
          </li>
        </ul>
      </template>

      <template v-if="skipped.length">
        <p class="note">Skipped {{ skipped.length }} {{ skipped.length === 1 ? 'row' : 'rows' }}:</p>
        <!-- selectable and scrollable, which is the whole reason this is not an alert() -->
        <pre class="skipped">{{ skipped.join('\n') }}</pre>
      </template>
    </template>

    <template #actions>
      <template v-if="stage === 'intro'">
        <button class="pbtn templatebtn" @click="emit('template')">Download a blank template</button>
        <button class="pbtn" @click="emit('close')">Cancel</button>
        <button class="pbtn pbtn-primary" @click="emit('pick')">Choose a file…</button>
      </template>
      <template v-else-if="stage === 'columns' || stage === 'roster'">
        <button class="pbtn" @click="emit('close')">Cancel</button>
        <button class="pbtn pbtn-primary" :disabled="!canSubmit" @click="submit">Import</button>
      </template>
      <template v-else>
        <!-- offered on a refusal only: that user needs the layout, a successful one does not -->
        <button v-if="!result.ok" class="pbtn templatebtn" @click="emit('template')">Download a blank template</button>
        <button class="pbtn pbtn-primary" @click="emit('close')">Close</button>
      </template>
    </template>
  </ChoirModal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
/*
 * ImportDialog — the importer overlay: what the file has to look like, the column picker, and
 * the explicit success and error states that replaced the import alerts.
 *
 * Two kinds. The Concert tab's ('concert') reads the singers AND the splits, into a new roster
 * and a new concert over it. The Roster tab's ('roster') reads names and sections only, into a
 * new roster or as a replacement for the singers in one of the user's own.
 *
 * Presentational. RosterDialog owns the file picking and calls the store; this component
 * shows what came back and emits what the user chose. It never parses anything: the columns
 * it lists were classified in utils/spreadsheet.js, which is pure and tested, so what is on
 * screen and what gets imported are the same judgement rather than two.
 *
 * The picker is the answer to the two ways the old automatic behaviour misfired on real Excel
 * output: a trailing empty column silently became a phantom split, and one free-text column
 * (Email, Notes) took the whole import down with it. Sensible columns arrive pre-ticked, so
 * the ordinary case is still one click.
 */
import ChoirModal from './ChoirModal.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  // 'concert' (singers and splits) or 'roster' (names and sections only)
  kind: { type: String, default: 'concert' },
  // 'intro' before a file is chosen; then 'columns' (concert) or 'roster'; 'result' once the
  // import has been attempted.
  stage: { type: String, default: 'intro' },
  // classifyColumns() output for every column from index 2 on.
  columns: { type: Array, default: () => [] },
  // how many rows carry a name, i.e. how many singers the file appears to hold
  found: { type: Number, default: 0 },
  // the store's import result: { ok, error, roster, concert, imported, splitCount, skipped, unknownSections },
  // and for a replace { singers, matched, renamed, added, removed } as well
  result: { type: Object, default: () => ({}) },
  // does the plan on stage hold work that has not been saved? (store.hasUnsavedChanges)
  unsaved: { type: Boolean, default: false },
  // why a typed name was refused, shown under its box
  nameError: { type: Object, default: () => ({ roster: '', concert: '' }) },
  // the user's own rosters, which a roster import may replace: [{ id, name, singers }]
  rosters: { type: Array, default: () => [] },
  // the one to offer first: the roster loaded on the Roster tab, when it is the user's
  rosterId: { type: String, default: '' }
});
const emit = defineEmits(['confirm', 'close', 'template', 'pick']);

// A local copy, because the tick state is this dialog's and the classification is the
// store's. Re-seeded every time the picker is opened with a fresh set of columns, so the
// pre-tick rules apply to each file rather than to whatever the last one left behind — and
// the name boxes and the roster choice are reset with it, since they belong to one import.
const ticks = ref([]);
const rosterName = ref('');
const concertName = ref('');
const rosterMode = ref('new');
const replaceId = ref('');
watch(
  () => props.columns,
  (cols) => {
    ticks.value = cols.map((c) => ({ ...c }));
    rosterName.value = '';
    concertName.value = '';
    rosterMode.value = 'new';
    const first = props.rosters.find((r) => r.id === props.rosterId) || props.rosters[0];
    replaceId.value = first ? first.id : '';
  },
  { immediate: true }
);
const picked = computed(() => ticks.value.filter((c) => c.pick).map((c) => c.index));
const canSubmit = computed(() => {
  if (props.stage === 'roster') return rosterMode.value === 'new' ? !!rosterName.value.trim() : !!replaceId.value;
  return !!rosterName.value.trim() && !!concertName.value.trim();
});
function submit() {
  if (!canSubmit.value) return;
  if (props.stage === 'roster')
    emit('confirm', rosterMode.value === 'new' ? { mode: 'new', name: rosterName.value.trim() } : { mode: 'replace', rosterId: replaceId.value });
  else emit('confirm', { picked: picked.value, names: { roster: rosterName.value.trim(), concert: concertName.value.trim() } });
}

const skipped = computed(() => props.result.skipped || []);
const unknown = computed(() => props.result.unknownSections || []);
const tone = computed(() => (props.stage === 'result' ? (props.result.ok ? 'ok' : 'error') : 'info'));
const title = computed(() => {
  if (props.stage === 'result') return props.result.ok ? 'Imported' : "That file couldn't be imported";
  return props.kind === 'roster' ? 'Import a roster from a spreadsheet' : 'Import a concert from a spreadsheet';
});
// "Imported 52 singers, 2 splits" — always said, success included, because the roster dialog
// stays open behind this and without a line here nothing on screen confirms it happened.
const successLine = computed(() => {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const r = props.result;
  if (r.removed)
    return `Read ${plural(r.singers.length, 'singer')} into "${r.roster}": ${r.matched} matched, ${r.added.length} new, ${r.removed.length} not in the file. Check them on the Roster tab and press Save to keep them.`;
  const s = `Imported ${plural(r.imported || 0, 'singer')}`;
  if (!r.concert) return s + ` into the new roster "${r.roster}".`;
  return s + (r.splitCount ? ` and ${plural(r.splitCount, 'split')}` : '') + ` into the new roster "${r.roster}" and the new concert "${r.concert}", now open on stage.`;
});
</script>

<style scoped>
/* the template is a side errand: it sits on the left, away from the way on (Cancel, Choose,
   Import) on the right */
.templatebtn {
  margin-right: auto;
}
@media (max-width: 640px) {
  .pbtn.templatebtn {
    flex-basis: 100%;
    margin-right: 0;
  }
}
.lead {
  margin: 0 0 10px;
  font-size: 13.5px;
}
.lead.ok {
  color: #2b7a3e;
  font-weight: 600;
}
.lead.err {
  color: #b4231a;
  font-weight: 600;
}
.note {
  margin: 12px 0 6px;
  color: #5a6573;
  font-size: 12.5px;
}
.cols {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #e2e6ec;
  border-radius: 8px;
  background: #fafbfc;
}
.col + .col {
  border-top: 1px solid #eef1f5;
}
.col label {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 10px;
  cursor: pointer;
}
.col input {
  flex: none;
  align-self: center;
}
.colname {
  flex: 1 1 auto;
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
/* a column with no heading has no name to show, so the position stands in for one and is
   dressed as the placeholder it is */
.colname.nameless {
  font-weight: 400;
  font-style: italic;
  color: #5a6573;
}
.groups {
  flex: none;
  color: #5a6573;
  font-size: 12px;
  white-space: nowrap;
}
.reason {
  flex: none;
  color: #8a5a00;
  font-size: 12px;
  white-space: nowrap;
}
.namefield {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 14px 0 0;
}
.namefield + .nameerr + .namefield,
.namefield + .namefield {
  margin-top: 10px;
}
.namelabel {
  font-size: 12.5px;
  font-weight: 600;
  color: #2f4368;
}
.nameinput {
  height: 34px;
  padding: 0 10px;
  font-size: 13.5px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
}
.nameinput:focus {
  outline: 2px solid #2f4368;
  outline-offset: -1px;
}
.nameerr {
  margin: 6px 0 0;
  color: #b4231a;
  font-size: 12.5px;
}
.pbtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.warn {
  margin: 12px 0 0;
  color: #b4231a;
  font-size: 12.5px;
  line-height: 1.45;
}
.rules {
  margin: 0 0 6px;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.5;
}
.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 4px;
  cursor: pointer;
}
.choice.off {
  opacity: 0.5;
  cursor: not-allowed;
}
.indent {
  margin-left: 24px;
}
.nameinput.indent {
  display: block;
  box-sizing: border-box;
  width: calc(100% - 24px);
}
.nameinput:disabled {
  opacity: 0.55;
}
.values {
  margin: 0;
  padding-left: 20px;
  font-size: 12.5px;
}
.skipped {
  margin: 0;
  max-height: 30vh;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid #e2e6ec;
  border-radius: 6px;
  background: #fafbfc;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pbtn {
  height: 34px;
  padding: 0 13px;
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
}
.pbtn:hover {
  background: #e3e8ef;
}
.pbtn-primary {
  background: #2f4368;
  border-color: #2f4368;
  color: #fff;
}
.pbtn-primary:hover {
  background: #26354f;
}
</style>
