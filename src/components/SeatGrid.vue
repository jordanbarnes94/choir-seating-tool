<template>
  <div class="grid" :class="{ readonly: props.readonly, sheet: props.sheet }" :style="gridStyle">
    <div
      v-for="(slot, k) in slots"
      :key="k"
      class="cell"
      :class="cellClass(slot, k)"
      :style="[cellStyle(slot), posStyle(k)]"
      :data-tip="cellTitle(slot)"
      :data-gi="props.readonly ? undefined : gid(k)"
      :data-blocked="slot.id === BLOCKED ? '' : undefined"
      v-on="cellHandlers(slot, k)"
    >
      <template v-if="slot.id === BLOCKED">
        <span class="blocktag">blocked</span>
      </template>
      <template v-else-if="slot.id === EMPTY">
        <span class="emptytag">empty</span>
      </template>
      <template v-else>
        <!-- The cell holds an ID. THIS is the resolution point — the name is read off
             the roster record here, at the last moment, which is what makes a rename in the
             roster reach every chair for free. -->
        <div class="nm">{{ (props.names && props.names[slot.id]) ?? singer(slot)?.name }}</div>
        <!-- the walk-on badge takes this corner while the walk-on panel is open -->
        <small v-if="!sectionOnly && !props.badges" class="splitlab">{{ singer(slot)?.[view] }}</small>
        <!-- the only mark on a singer: a lock badge shown when pinned. Clicking or tapping opens
             the menu that toggles it; it isn't itself a button. -->
        <span v-if="pinnedSet.has(slot.id)" class="lockmark" aria-label="Locked">🔒</span>
        <!-- the lateral mark: a connector in the gap to each vertical group-mate, see lateralTags -->
        <span v-for="t in lateralTags(slot, k)" :key="t.edge" class="latmark" :class="t.edge" aria-hidden="true">{{ t.arrow }}</span>
        <!-- The walk-on position of this CHAIR, bottom-right in place of the split label: by
             the time the walk-on order is being checked the arrangement is settled, which is
             when the split matters. Bottom-right keeps it off the start of a name's second line.
             The lock badge and the "alone" tag share top-right. Opt-in per call site, so print,
             the compare reference and every other caller are unchanged unless they ask for it. -->
        <span v-if="badgeAt(k)" class="walkbadge" :data-tip="badgeTitle">{{ badgeAt(k) }}</span>
      </template>
    </div>
    <div v-if="focusBox" class="focusbox" :style="focusBox" />
  </div>

  <!-- action menu: click or tap any cell (a right-click works too). A singer offers lock/unlock and
       remove-from-stage; an empty or blocked seat offers remove (closing the gap). -->
  <Teleport v-if="!props.readonly" to="body">
    <div v-if="menu" class="cellmenu-back" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="cellmenu" :style="menuStyle" @click.stop>
        <div class="cellmenu-name">{{ menuTitle }}</div>
        <button v-if="menu.kind === 'singer'" type="button" @click="menuPin">
          {{ pinnedSet.has(menu.id) ? '🔒 Unlock' : '○ Lock' }}
        </button>
        <button type="button" @click="menuRemove">{{ menuRemoveLabel }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, unref } from 'vue';
import { SECTION_VIEW, EMPTY, BLOCKED, isSinger, tint, bolden, splitFrame } from '../utils/arranger';
import { useChoirArranger } from '../composables/useChoirArranger';
import { usePress } from '../composables/useDragDrop';

const props = defineProps({
  slots: { type: Array, required: true }, // [{ id }] in column-major order (index = seat index); id is a singer's id, EMPTY or BLOCKED
  rows: { type: Number, required: true },
  stranded: { type: Object, default: () => new Set() }, // Set of singer IDS isolated in the current view
  // Map of singer id -> the keys (section, split) under which their group-mates are only in front
  // or behind: the milder, dashed mark, with an arrow at those group-mates. Empty by default, so
  // the printed sheet and the previews draw nothing new.
  lateral: { type: Object, default: () => new Map() },
  focusSection: { type: String, default: null }, // when set, grey other sections + draw a bounding box
  // The plan to draw. Defaults to the live store, so every existing call site is unchanged.
  // Anything else is a plan view from makePlanView(): the same fields, unwrapped.
  plan: { type: Object, default: null },
  // A read-only grid draws the plan and nothing else: no data-gi, no pointer handlers, no cell
  // menu, no drag highlight. useDragDrop hit-tests [data-gi] across the whole document, so a
  // second grid that carried them would steal drops from the live one.
  // Set once, at mount: `press` below is resolved from it in setup, so a grid that flipped
  // read-only off afterwards would bind handlers against no press session.
  readonly: { type: Boolean, default: false },
  // The walk-on seat badge: `{ single, bySeat }` from walkOnBadges(), keyed by the seat's
  // index into the unrotated array — which is what `gi` carries, so one map serves the full
  // stage and a By-section crop without being recomputed for either. Absent means no badge, so
  // every existing call site draws exactly what it drew before.
  badges: { type: Object, default: null },
  // The printed sheet: the cell size comes from the sheet (inherited), not from this grid's own
  // screen-sized declaration, and the name wraps onto as many lines as the sheet allows.
  sheet: { type: Boolean, default: false },
  // What each singer is called in the cell, by id, when that is not simply their name: the
  // printed sheet's "First name + initial". Absent, or an id it does not hold, means the name.
  names: { type: Object, default: null },
  // The colour-by to draw with, in place of the plan's own: the walk-on order's stage passes
  // SECTION_VIEW, since it hides the split labels and has no colour-by control of its own.
  view: { type: String, default: null }
});

const store = useChoirArranger();
const gridStyle = computed(() => ({
  gridTemplateRows: `repeat(${props.rows}, var(--cellh))`,
  position: 'relative',
  ...(props.sheet ? { '--cellw': 'inherit', '--cellh': 'inherit' } : {})
}));
// Every plan read goes through here. `unref` covers both shapes: the store's refs and the
// plain values a plan view returns.
const plan = computed(() => props.plan || store);
const byId = computed(() => unref(plan.value.byId));
// The one lookup from a cell to the person in it. `null` for a sentinel, and for the one frame
// after a roster swap in which a cell can still name somebody the new roster has not got.
const singer = (slot) => (isSinger(slot.id) ? byId.value[slot.id] : null) || null;
const pinnedSet = computed(() => unref(plan.value.pinnedSet));
const catIndex = computed(() => unref(plan.value.CAT_INDEX));
// The section colours to paint with. Off the plan like everything else here, so a
// read-only grid showing another plan shows ITS colours.
const sectionColours = computed(() => unref(plan.value.sectionColours));
// The split frame per section and category position, the plan's own overrides already resolved
// against splitFrame(). Off the plan for the same reason as the fills above.
const splitFrames = computed(() => unref(plan.value.splitFrames));
const schLabel = computed(() => unref(plan.value.SCH_LABEL));
// The live store draws with `stageView`, which follows the neighbour check's pointed-at column; a
// plan view has no such thing and draws with its own colour-by.
const view = computed(() => props.view ?? unref(plan.value.stageView) ?? plan.value.ui.view);
const sectionOnly = computed(() => view.value === SECTION_VIEW);
// The real seat index for a cell. Cropped By-Section grids set slot.gi to the cell's index in
// the full grid; the full stage view positions cells by their array index, so gi falls back to k.
const gid = (k) => props.slots[k].gi ?? k;

// Keyed by seat index rather than by singer, because the badge is a property of the CHAIR:
// it says when the person in this seat walks on, and moving somebody to another chair gives them
// that chair's place in the queue.
const badgeAt = (k) => (props.badges ? props.badges.bySeat[gid(k)] : undefined);
// One explanation, on every badge, because a bare number on a seat is the kind of thing a user
// has to be told once. The prefix only exists when the entrance is split, so the wording follows.
const badgeTitle = computed(() =>
  props.badges && props.badges.single
    ? 'Walk-on order: this seat is filled in this position'
    : 'Walk-on order: which queue this seat is filled from, and in what position'
);

// slots arrive in column-major order with row 0 = front. We draw from the audience's
// view, so the front row goes at the BOTTOM: column-major still, but row index r is
// placed at visual grid row (rows - r) so r=0 lands on the last row.
function posStyle(k) {
  return { gridColumn: Math.floor(k / props.rows) + 1, gridRow: props.rows - (k % props.rows) };
}

const HATCH = 'repeating-linear-gradient(45deg, rgba(36,44,64,.18) 0 5px, rgba(36,44,64,0) 5px 11px)';

const isFocusGhost = (slot) =>
  props.focusSection && isSinger(slot.id) && singer(slot)?.section !== props.focusSection;
// The neighbour check pointing at some singers (hovering one of its entries). Live grid only:
// the ids are the live plan's, and a preview or the printed sheet is showing a different one.
const highlight = computed(() => (props.readonly || props.sheet ? null : store.ui.highlight));

function cellClass(slot, k) {
  // the drag highlight is live-plan state; a read-only grid is never a drop target.
  const over = !props.readonly && store.dragOverGi.value === gid(k) ? ' dragover' : '';
  if (slot.id === BLOCKED) return 'blockslot' + over;
  if (slot.id === EMPTY) return 'empty' + over;
  const isPinned = pinnedSet.value.has(slot.id);
  const alone = props.stranded.has(slot.id);
  const lateral = !alone && props.lateral.has(slot.id);
  const hl = highlight.value;
  const lit = hl ? (hl.has(slot.id) ? ' hl' : ' ghost') : isFocusGhost(slot) ? ' ghost' : '';
  // A tag reaching up into the chair above would be painted under it, since that chair comes
  // later in the page, so a chair drawing one sits above every other marked chair.
  const latup = lateral && lateralTags(slot, k).some((t) => t.edge === 'up') ? ' latup' : '';
  return 'solo' + (alone ? ' stranded' : lateral ? ' lateral' : '') + latup + (isPinned ? ' pinned' : '') + lit + over;
}

// The lateral mark, drawn as connectors: one tag centred in the gap between a lateral singer and
// each group-mate directly above or below them, pointing from the singer at the group-mate. When
// the two are each other's vertical group-mate (both lateral), the gap gets one ↕, drawn by the
// upper of the two, rather than an ↑ and a ↓ on top of each other. The upper one because it comes
// later in the page, so its tag paints over the chair below; the lower one's would be covered.
//
// The chairs above and below are read off the drawn slots, not the stored seats, so the arrows
// are right whichever side the audience is drawn on and in a By-section crop. Slots are
// column-major and drawn bottom-up (posStyle), so k + 1 in the same column is the chair above
// and k - 1 the chair below.
function isLateralAt(j) {
  const id = props.slots[j]?.id;
  return props.lateral.has(id) && !props.stranded.has(id);
}
// Does the lateral singer at `k` count the singer at `j` as a vertical group-mate?
function mateOf(k, j) {
  if (j < 0 || j >= props.slots.length || Math.floor(j / props.rows) !== Math.floor(k / props.rows)) return false;
  const p = singer(props.slots[k]), q = singer(props.slots[j]);
  const keys = props.lateral.get(props.slots[k].id) || [];
  return !!p && !!q && keys.some((key) => q.section === p.section && q[key] === p[key]);
}
function lateralTags(slot, k) {
  if (!isLateralAt(k)) return [];
  const tags = [];
  const above = k + 1, below = k - 1;
  // a mutual pair's gap is drawn by the upper singer, below, so the lower one leaves it
  if (mateOf(k, above) && !(isLateralAt(above) && mateOf(above, k))) tags.push({ edge: 'up', arrow: '↑' });
  if (mateOf(k, below)) tags.push({ edge: 'down', arrow: isLateralAt(below) && mateOf(below, k) ? '↕' : '↓' });
  return tags;
}

function cellStyle(slot) {
  const p = singer(slot);
  if (!p) return {}; // sentinel, or an id not (yet) in the roster — render plain for that frame
  const sec = sectionColours.value[p.section];
  const style = { background: tint(sec) };
  // Not on paper: the lock is a mark for whoever builds the plan, and the sheet has no key for it.
  if (pinnedSet.value.has(slot.id) && !props.sheet) style.backgroundImage = HATCH;
  const i = catIndex.value[view.value]?.[p[view.value]];
  style.borderColor = sectionOnly.value
    ? bolden(sec)
    // splitFrames is LIMITS.cats long; splitFrame() is the fallback for a plan handed to us
    // without one, and for a category position beyond the limit that only a hand-edited file
    // could reach.
    : i == null ? bolden('#9aa3b0') : splitFrames.value?.[p.section]?.[i] ?? splitFrame(sec, i);
  return style;
}

// A read-only grid offers none of the interactions the live tooltips describe, so it names the
// cell and stops there. The "Alone" title is a fact about the plan, not an offer, and stays.
function cellTitle(slot) {
  if (slot.id === BLOCKED) {
    return props.readonly
      ? 'Blocked seat'
      : 'Blocked seat — click or tap for a menu to remove it and close the gap (shift the row left)';
  }
  if (slot.id === EMPTY) {
    return props.readonly
      ? 'Empty chair'
      : 'Empty chair — drag a singer here, or click or tap for a menu to close the gap (shift the row left)';
  }
  if (props.stranded.has(slot.id)) {
    const p = singer(slot);
    if (!p) return undefined;
    const lab = view.value === SECTION_VIEW
      ? `${p.section} neighbour`
      : `${schLabel.value[view.value]} "${p[view.value]}" neighbour`;
    return `Alone: no ${lab} on the same line (left/right/front/back).`;
  }
  if (props.lateral.has(slot.id)) return 'Only has a group-mate in front or behind, nobody beside them.';
  return undefined;
}

// the dashed bounding box around the focused section's members (in display coordinates).
const focusBox = computed(() => {
  if (!props.focusSection) return null;
  const rows = props.rows;
  let minCol = Infinity, maxCol = -Infinity, minVRow = Infinity, maxVRow = -Infinity;
  props.slots.forEach((slot, k) => {
    if (!isSinger(slot.id)) return;
    if (singer(slot)?.section !== props.focusSection) return;
    const col = Math.floor(k / rows), vrow = rows - (k % rows); // visual row (1-based, front at bottom)
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (vrow < minVRow) minVRow = vrow;
    if (vrow > maxVRow) maxVRow = vrow;
  });
  if (minCol === Infinity) return null;
  const span = maxCol - minCol + 1, vspan = maxVRow - minVRow + 1;
  const m = 6; // outward padding so the dashed box clears the singers' cell frames
  return {
    left: `calc((var(--cellw) + 4px) * ${minCol} - ${m}px)`,
    top: `calc((var(--cellh) + 4px) * ${minVRow - 1} - ${m}px)`,
    width: `calc((var(--cellw) + 4px) * ${span} - 4px + ${2 * m}px)`,
    height: `calc((var(--cellh) + 4px) * ${vspan} - 4px + ${2 * m}px)`,
    borderColor: sectionColours.value[props.focusSection]
  };
});

// touch action menu for a cell: { kind: 'singer'|'empty'|'blocked', id?, gi?, x, y } or null.
const menu = ref(null);
function openMenu(info, x, y) { menu.value = { ...info, x, y }; }
function closeMenu() { menu.value = null; }
function menuPin() { store.togglePin(menu.value.id); closeMenu(); }
function menuRemove() {
  const m = menu.value;
  if (m.kind === 'singer') store.unseat(m.id);
  else if (m.kind === 'empty') store.removeRowSpace(m.gi);
  else if (m.kind === 'blocked') store.removeRowBlock(m.gi);
  closeMenu();
}
const menuTitle = computed(() => {
  const m = menu.value;
  if (!m) return '';
  if (m.kind === 'blocked') return 'Blocked seat';
  if (m.kind === 'empty') return 'Empty seat';
  return byId.value[m.id]?.name || '';
});
const menuRemoveLabel = computed(() => {
  const m = menu.value;
  if (!m) return '';
  if (m.kind === 'blocked') return '✕ Remove (close gap)';
  if (m.kind === 'empty') return '✕ Remove (close gap)';
  return '✕ Remove';
});
const menuStyle = computed(() => {
  const m = menu.value;
  if (!m) return {};
  const W = 168, H = 104, pad = 10;
  const left = Math.min(Math.max(m.x - W / 2, pad), window.innerWidth - W - pad);
  let top = m.y + 16; // below the finger so it isn't covered
  if (top + H > window.innerHeight - pad) top = m.y - H - 16; // flip above when there's no room
  if (top < pad) top = pad;
  return { left: left + 'px', top: top + 'px', width: W + 'px' };
});

/* ---------- input: one pointer path for mouse, touch and pen ---------- */
// Drag a singer to move them (touch: long-press first, so a swipe still scrolls the
// grid). Click or tap any cell (or right-click it) for the action menu.
// A read-only grid binds no pointer handlers at all, so it needs no press session either
// (usePress reaches into the live store, which a reference plan must never touch).
const press = props.readonly ? null : usePress();

// The cell's listeners, or none when read-only: dropped rather than made inert, so a read-only
// cell is not a pointer target in any sense.
const cellHandlers = (slot, k) =>
  props.readonly
    ? {}
    : { pointerdown: (e) => onCellDown(slot, k, e), contextmenu: (e) => onContext(slot, k, e) };

function onCellDown(slot, k, e) {
  if (isSinger(slot.id)) {
    press.down(e,
      () => ({ k: gid(k), id: slot.id }),
      ({ x, y }) => openMenu({ kind: 'singer', id: slot.id }, x, y));
  } else {
    const info = slot.id === BLOCKED ? { kind: 'blocked', gi: gid(k) } : { kind: 'empty', gi: gid(k) };
    press.down(e, () => null, ({ x, y }) => openMenu(info, x, y));
  }
}

function onContext(slot, k, e) {
  e.preventDefault(); // never the browser menu on the stage
  if (menu.value) return; // a touch long-press already opened ours
  if (isSinger(slot.id)) openMenu({ kind: 'singer', id: slot.id }, e.clientX, e.clientY);
  else if (slot.id === BLOCKED) openMenu({ kind: 'blocked', gi: gid(k) }, e.clientX, e.clientY);
  else openMenu({ kind: 'empty', gi: gid(k) }, e.clientX, e.clientY);
}
</script>

<style scoped>
:root,
.grid {
  --cellw: 92px;
  --cellh: 40px;
}
.grid {
  display: grid;
  grid-auto-columns: var(--cellw);
  gap: 4px;
  width: max-content;
}
.cell {
  width: var(--cellw);
  height: var(--cellh);
  box-sizing: border-box;
  border-radius: 6px;
  border: 3px solid transparent;
  cursor: grab;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  background: #eef1f5;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.07);
  position: relative;
  display: flex;
  align-items: flex-start;
}
/* read-only: nothing on the grid is a pointer target, so nothing advertises itself as one */
.grid.readonly .cell,
.grid.readonly .cell.empty,
.grid.readonly .cell.blockslot {
  cursor: default;
}
.cell.stranded,
.cell.lateral,
.cell.hl,
.cell.atomsplit {
  z-index: 3;
}
.cell.latup {
  z-index: 5;
}
.cell.ghost {
  opacity: 0.32;
}
.cell .nm {
  padding: 3px 6px 0;
  font-weight: 500;
  font-size: 10.5px;
  /* The box clips at its last line, so the line has to be tall enough for descenders: at 1.12
     the g of "Lang" was cut off. 1.3 as on the printed sheet; two lines still fit a 40px chair. */
  line-height: 1.3;
  color: #11203a;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cell .splitlab {
  position: absolute;
  right: 6px;
  bottom: 3px;
  font-size: 10.5px;
  font-weight: 600;
  color: #11203a;
  opacity: 0.55;
  line-height: 1;
  pointer-events: none;
}
.cell.stranded {
  outline: 2px solid #d8392b;
  outline-offset: 1px;
}
.cell.stranded::after {
  content: 'alone';
  position: absolute;
  top: -8px;
  right: 4px;
  font-size: 9px;
  line-height: 1;
  font-weight: 700;
  background: #d8392b;
  color: #fff;
  padding: 2px 5px;
  border-radius: 4px;
  z-index: 4;
  white-space: nowrap;
  pointer-events: none;
}
/* The dashed ring is a pseudo-element and not an `outline`: an outline is painted after
   everything inside the chair, so it would cut across the chair's own arrow tags. */
.cell.lateral::before {
  content: '';
  position: absolute;
  inset: -6px;
  border: 2px dashed #d08a1e;
  border-radius: 9px;
  pointer-events: none;
}
/* The report's ↕ chip as a connector: centred in the gap between a singer and a group-mate above
   or below, straddling both chairs' edges. */
.latmark {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  line-height: 1;
  font-weight: 700;
  background: #d08a1e;
  color: #fff;
  padding: 1px 4px;
  border-radius: 4px;
  z-index: 4;
  pointer-events: none;
}
/* Centred in the 4px gap to the chair above or below. The offset is measured from inside the
   chair's 3px border, so: half the tag (14px) + half the gap + the border. */
.latmark.up {
  top: -12px;
}
.latmark.down {
  bottom: -12px;
}
/* the singers the neighbour check is pointing at; everyone else fades through .ghost */
/* a box-shadow ring rather than an outline, for the same reason: it stays under the arrow tags */
.cell.hl {
  box-shadow: 0 0 0 2px #fff, 0 0 0 5px #2f6df0;
}
.cell.dragover {
  outline: 3px dashed #2f6df0;
  outline-offset: 1px;
}
.cell.empty {
  background: transparent;
  box-shadow: none;
  /* not draggable, but a click opens the remove menu, so it is a pointer target */
  cursor: pointer;
  border: 2px dashed #e2e6ec;
  align-items: center;
  justify-content: center;
}
.emptytag {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #c2c8d2;
  pointer-events: none;
}
.cell.blockslot {
  background: repeating-linear-gradient(45deg, #e7e3e3 0 7px, #d8d2d2 7px 14px);
  border: 2px solid #b9aeae;
  box-shadow: none;
  /* same as an empty seat: no drag, but clicking opens the remove menu */
  cursor: pointer;
  align-items: center;
  justify-content: center;
}
.blocktag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8a7f7f;
  pointer-events: none;
}
.cell.pinned .nm {
  color: #1d2330;
}
/* The walk-on badge. Bottom-right, in place of the split label, which is hidden while the
   badges show: there it covers the end of a name's second line rather than its start. Sized to hold four characters at 92x40: `R120` at the 250-singer cap, and a bare
   number in the common case where the entrance is not split.

   It is a CHIP and not bare text, unlike the split label whose corner it takes, because it is a number
   sitting next to a name and the two must not read as one string. The chip is what tells the eye
   it is a different kind of thing, and it is what keeps it legible in mono print and against
   every section tint — the tint varies, the chip's own background does not. */
.walkbadge {
  position: absolute;
  right: 4px;
  bottom: 2px;
  min-width: 15px;
  padding: 0 3px;
  font-size: 9.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 13px;
  text-align: center;
  color: #f4f6f9;
  background: rgba(29, 35, 48, 0.72);
  border-radius: 3px;
  pointer-events: none;
}
/* lock badge — the only adornment on a singer, shown only when pinned (non-interactive) */
.lockmark {
  position: absolute;
  top: 2px;
  right: 3px;
  font-size: 11px;
  line-height: 1;
  pointer-events: none;
}
.focusbox {
  position: absolute;
  border: 2px dashed currentColor;
  border-radius: 8px;
  pointer-events: none;
  z-index: 2;
}
/* touch action menu (teleported to <body>; scoped styles still apply via the data attribute) */
.cellmenu-back {
  position: fixed;
  inset: 0;
  z-index: 400;
}
.cellmenu {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #fff;
  border: 1px solid #d3d9e0;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
}
.cellmenu-name {
  font-size: 12px;
  font-weight: 700;
  color: #2f4368;
  padding: 2px 6px 5px;
  border-bottom: 1px solid #eef1f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cellmenu button {
  font-size: 14px;
  text-align: left;
  padding: 10px;
  border: 1px solid #d8dde4;
  border-radius: 7px;
  background: #fff;
  color: #1d2330;
  cursor: pointer;
}
.cellmenu button:active {
  background: #eef1f5;
}

/* ---------- print ----------
   This block has to be HERE and cannot be written from outside. Everything in this file compiles
   to `.cell[data-v-xxxxxx]`, so a global print stylesheet using plain `.cell` loses on
   specificity and would need `!important` on every rule; and `--cellw` / `--cellh` are declared
   on `.grid` ITSELF at the top of this file, which shadows anything inherited from an ancestor.
   That is the single most important implementation fact about printing this grid,
   and it is why the `sheet` prop sets `--cellw` / `--cellh` to `inherit` inline rather than
   PlanSheet setting them from outside.

   What changes on paper is only what is an interaction or a diagnostic:
   - the drop-shadow under every cell, which prints as grey mud at any scale;
   - the drag-over highlight, which is live-plan state a read-only grid never has anyway;
   - the 🔒 lock badge and the red "alone" badge. Both are marks for the person BUILDING the
     plan, and the printed plan is a "minimal grid, just names and positions". The neighbour check is
     where "alone" belongs, and it has its own checkbox.
   The split label stays: when the plan is coloured by a split it is the singer's category, not
   an adornment, and in mono those labels are load-bearing.

   `print-color-adjust` forces the fills: the section fills are inline `tint()` backgrounds and the
   blocked hatch is a `repeating-linear-gradient`, so both vanish unless the user ticks
   "Background graphics" — which nobody does. Forcing them is what keeps an empty chair reading
   as empty and a blocked seat as blocked on paper. */
/* the printed sheet (PlanSheet): the name at the size the sheet works out for its page, on as
   many lines as printPlan.js's fitNameFont found it needs, and centred in the cell, which on a
   page filled top to bottom is usually deeper than the name. The foot is kept clear for the split
   label, as fitNameFont assumes. */
.grid.sheet .cell {
  align-items: center;
  justify-content: center;
  padding-bottom: var(--labelroom, 0px);
}
.grid.sheet .cell .nm {
  padding: 1px 3px;
  font-size: var(--namefont, 10.5px);
  /* The screen's 1.3 too: the box clips at its last line, and the system face's
     descenders (g, y, p) reach below 1.12. printPlan.js's LINE_H must match. */
  line-height: 1.3;
  -webkit-line-clamp: var(--namelines, 3);
  line-clamp: var(--namelines, 3);
  overflow-wrap: break-word;
  text-align: center;
}
.grid.sheet .cell .splitlab {
  right: 3px;
  bottom: 2px;
  font-size: calc(var(--namefont, 10.5px) * 0.85);
}
@media print {
  .cell {
    box-shadow: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cell.dragover {
    outline: none;
  }
  .cell.stranded {
    outline: none;
  }
  .cell.stranded::after,
  .lockmark {
    display: none;
  }
}
</style>
