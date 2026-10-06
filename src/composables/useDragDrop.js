// One drag-and-drop system for every pointer type (mouse, touch, pen), built on
// Pointer Events. Replaces both the old HTML5 drag/drop path and the hand-rolled
// touch path (useTouchDrag.js + useLongPress.js), so mouse and touch always run the
// same code: one session, one ghost, one drop dispatcher.
//
// How a drag starts:
//   mouse / pen         press and move past `threshold` px (no delay)
//   touch, fireOnMove   move past `threshold` px (dedicated drag handles: bench
//                       chips, Block/Space tools; they carry touch-action:none)
//   touch, default      long-press: hold roughly still for `delay` ms (grid seats,
//                       so a horizontal swipe still scrolls the wide grid)
//
// The scroll handover on touch: seats deliberately do NOT set touch-action, so the
// browser may claim a moving finger for scrolling (it then fires pointercancel,
// which cancels the press: correct, that gesture was a scroll). A long-press only
// fires while the finger has stayed within `threshold`, i.e. before the browser
// claims the gesture. The moment the session starts we attach a window-level
// non-passive touchmove listener whose only job is preventDefault(): that stops the
// browser from ever starting a scroll, so pointermove keeps firing for the whole
// drag. Removing that listener mid-session kills the drag with a pointercancel.

import { onScopeDispose } from 'vue';
import { tint } from '../utils/arranger';
import { useChoirArranger } from './useChoirArranger';

const LP_DELAY_MS = 350; // touch hold time before a seat drag starts
const MOVE_START_PX = 8; // movement that starts a drag (mouse / handles) or cancels a press (touch seat)

/* ---------- module-level singletons: one session at a time, shared guards ---------- */
let session = null; // { payload, pointerId, pointerType, srcEl } while a drag is live
let sMove = null, sUp = null, sCancel = null, sKey = null, sTouchGuard = null;
let ghostEl = null;
let guardsAttached = false;
let ctxGuardUntil = 0; // swallow contextmenu until this timestamp (+ during a session)
let clickGuardUntil = 0; // swallow click until this timestamp (touch tails only)

/* ---------- ghost: the floating label that follows the pointer ---------- */
function buildGhost(store, payload) {
  // The two tools look like the chairs they drop, as their buttons do.
  let bg, label, border = '2px solid rgba(0,0,0,0.12)';
  if (payload.block) {
    bg = 'repeating-linear-gradient(45deg, #e7e3e3 0 7px, #d8d2d2 7px 14px)';
    border = '2px solid #b9aeae';
    label = '⊘ Block';
  } else if (payload.space) {
    bg = '#fff';
    border = '2px dashed #c9d0da';
    label = '⇥ Space';
  } else {
    // the payload carries the singer's ID; the ghost shows a person, so the record
    // is resolved here exactly as a seat's is.
    const rec = store.byId.value[payload.id];
    bg = rec ? tint(store.sectionColours.value[rec.section]) : '#e0e4ec';
    label = rec ? rec.name : '';
  }
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '9999',
    background: bg,
    color: '#11203a',
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '8px',
    border,
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
    transform: 'translate(-50%, -150%)',
    userSelect: 'none',
    left: '-9999px',
    top: '-9999px',
  });
  el.textContent = label;
  document.body.appendChild(el);
  return el;
}

function moveGhost(x, y) {
  if (!ghostEl) return;
  ghostEl.style.left = x + 'px';
  ghostEl.style.top = y + 'px';
}

function removeGhost() {
  ghostEl?.remove();
  ghostEl = null;
}

/* ---------- hit testing ---------- */
// Find the [data-gi] cell under (x, y). The ghost is pointer-events:none, so
// elementFromPoint sees straight through it. If the point lands on the 4px gap
// between cells, fall back to the nearest cell within a small tolerance.
function cellAt(x, y) {
  const direct = document.elementFromPoint(x, y)?.closest('[data-gi]');
  if (direct) return direct;
  let best = null, bestD = 16; // px tolerance
  for (const el of document.querySelectorAll('[data-gi]')) {
    const r = el.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}

// The bench is a drop target for seated singers. elementFromPoint alone proved flaky
// on phones (a finger lifted just past the edge missed it), so test containment
// against the bench's rectangle with a forgiveness margin instead.
function benchAt(x, y) {
  const el = document.querySelector('.bench');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const m = 12;
  return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
}

/* ---------- the one drop dispatcher: every pointer type lands here ---------- */
function dropAt(store, payload, x, y) {
  const cell = cellAt(x, y);
  if (cell && !('blocked' in cell.dataset)) {
    const gi = Number(cell.dataset.gi);
    if (Number.isNaN(gi)) return;
    if (payload.block) store.insertRowBlock(gi); // insert a blocked seat, shift the row right
    else if (payload.space) store.insertRowSpace(gi); // open a gap, shift the row right
    else if (payload.id) store.placeAt(payload.id, gi); // seat / swap / move
  } else if (payload.id && payload.k != null && benchAt(x, y)) {
    store.unseat(payload.id); // seated singer released over (or near) the bench
  }
}

/* ---------- guards: swallow the browser's synthetic contextmenu / click ---------- */
// A touch long-press raises a synthetic contextmenu (~500ms in) and a lifted finger
// raises a synthetic click; either would land on whatever sits under the finger (a
// seat, our own menu backdrop). Swallow them at window capture while a session is
// live or for a short tail after a touch gesture we already handled. Attached lazily
// on the first pointerdown.
function onGuardCtx(ev) {
  if (session || Date.now() < ctxGuardUntil) { ev.preventDefault(); ev.stopPropagation(); }
}
function onGuardClick(ev) {
  if (Date.now() < clickGuardUntil) { ev.preventDefault(); ev.stopPropagation(); }
}
function ensureGuards() {
  if (guardsAttached) return;
  guardsAttached = true;
  window.addEventListener('contextmenu', onGuardCtx, true);
  window.addEventListener('click', onGuardClick, true);
}
function armTouchTail() {
  ctxGuardUntil = Date.now() + 600;
  clickGuardUntil = Date.now() + 400;
}

/* ---------- the drag session ---------- */
function detachSession() {
  if (sMove) { window.removeEventListener('pointermove', sMove); sMove = null; }
  if (sUp) { window.removeEventListener('pointerup', sUp); sUp = null; }
  if (sCancel) { window.removeEventListener('pointercancel', sCancel); sCancel = null; }
  if (sKey) { window.removeEventListener('keydown', sKey); sKey = null; }
  if (sTouchGuard) { window.removeEventListener('touchmove', sTouchGuard); sTouchGuard = null; }
}

function endSession(store) {
  if (!session) return;
  const wasTouch = session.pointerType === 'touch';
  try { session.srcEl?.releasePointerCapture?.(session.pointerId); } catch { /* already released */ }
  session = null;
  detachSession();
  removeGhost();
  store.dragOverGi.value = null;
  store.dragOverBench.value = false;
  document.body.classList.remove('dnd-active');
  if (wasTouch) armTouchTail();
}

function startSession(store, payload, x, y, pointerId, pointerType, srcEl) {
  endSession(store); // a stale session from another component must not linger
  session = { payload, pointerId, pointerType, srcEl };
  ghostEl = buildGhost(store, payload);
  moveGhost(x, y);
  document.body.classList.add('dnd-active');
  // Mouse/pen: capture so the drag keeps tracking (and pointerup still arrives) when
  // the cursor leaves the window. Touch pointers are implicitly captured already.
  // Capturing only now, not in the press phase, keeps ordinary clicks untouched.
  if (pointerType !== 'touch' && srcEl?.isConnected) {
    try { srcEl.setPointerCapture(pointerId); } catch { /* best effort */ }
  }

  sMove = (ev) => {
    if (!session || ev.pointerId !== session.pointerId) return;
    if (ev.pointerType === 'mouse' && ev.buttons === 0) { endSession(store); return; } // missed pointerup
    moveGhost(ev.clientX, ev.clientY);
    const cell = cellAt(ev.clientX, ev.clientY);
    store.dragOverGi.value = cell && !('blocked' in cell.dataset) ? Number(cell.dataset.gi) : null;
    store.dragOverBench.value =
      !cell && payload.id != null && payload.k != null && benchAt(ev.clientX, ev.clientY);
  };
  sUp = (ev) => {
    if (!session || ev.pointerId !== session.pointerId) return;
    const p = session.payload;
    endSession(store);
    try {
      dropAt(store, p, ev.clientX, ev.clientY);
    } catch (err) {
      console.error('drop failed', err);
    }
  };
  sCancel = (ev) => {
    if (!session || ev.pointerId !== session.pointerId) return;
    endSession(store);
  };
  sKey = (ev) => {
    if (ev.key === 'Escape') endSession(store);
  };
  // Non-passive on purpose: its preventDefault is what stops the page / grid
  // scrolling mid-drag on touch. See the header comment.
  sTouchGuard = (ev) => { if (ev.cancelable) ev.preventDefault(); };

  window.addEventListener('pointermove', sMove);
  window.addEventListener('pointerup', sUp);
  window.addEventListener('pointercancel', sCancel);
  window.addEventListener('keydown', sKey);
  window.addEventListener('touchmove', sTouchGuard, { passive: false });
}

/* ---------- the composable: per-element press tracking ---------- */
// usePress({ fireOnMove }) -> { down }. Bind down to @pointerdown only; it attaches
// temporary window listeners (filtered by pointerId) until the press resolves, so a
// fast mouse that leaves the source element before crossing the threshold is still
// tracked. Do not use setPointerCapture here: it would retarget clicks and break the
// blocked-seat hover x button.
export function usePress({ fireOnMove = false, delay = LP_DELAY_MS, threshold = MOVE_START_PX } = {}) {
  const store = useChoirArranger();
  let pid = null, ptype = '', sx = 0, sy = 0, timer = null, srcEl = null;
  let payloadFn = null, tapFn = null;
  let pMove = null, pUp = null, pCancel = null;

  function detach() {
    if (pMove) { window.removeEventListener('pointermove', pMove); pMove = null; }
    if (pUp) { window.removeEventListener('pointerup', pUp); pUp = null; }
    if (pCancel) { window.removeEventListener('pointercancel', pCancel); pCancel = null; }
  }
  function reset() {
    clearTimeout(timer);
    timer = null;
    detach();
    pid = null;
    srcEl = null;
    payloadFn = null;
    tapFn = null;
  }

  function fire(x, y, viaTimer) {
    const getP = payloadFn, tap = tapFn, type = ptype, id = pid, el = srcEl;
    reset();
    const payload = getP ? getP() : null;
    if (payload) {
      if (type === 'touch') navigator.vibrate?.(viaTimer ? 30 : 20);
      startSession(store, payload, x, y, id, type, el);
    } else if (viaTimer && tap) {
      // long-press on a non-draggable cell acts like a tap (opens the menu); arm the
      // tails so the browser's synthetic contextmenu/click can't re-trigger anything.
      armTouchTail();
      tap({ x, y });
    }
    // payload null via move: a mouse dragged an empty/blocked cell; do nothing, and
    // the cleared tapFn means releasing won't open the menu either.
  }

  // down(e, getPayload, onTap):
  //   getPayload() -> drag payload, or null when this element can't start a drag
  //   onTap({x,y}) -> optional: a clean press-and-release (any pointer type), and a
  //                   touch long-press when getPayload returns null
  function down(e, getPayload, onTap = null) {
    if (session) return; // a drag is already live
    if (e.pointerType === 'mouse' && e.button !== 0) return; // right/middle: contextmenu handles those
    if (!e.isPrimary) return; // a second finger never starts anything
    ensureGuards();
    reset();
    pid = e.pointerId;
    ptype = e.pointerType || 'mouse';
    srcEl = e.currentTarget;
    sx = e.clientX;
    sy = e.clientY;
    payloadFn = getPayload;
    tapFn = onTap;
    if (ptype === 'touch' && !fireOnMove) timer = setTimeout(() => fire(sx, sy, true), delay);

    pMove = (ev) => {
      if (ev.pointerId !== pid) return;
      if (ptype === 'mouse' && ev.buttons === 0) { reset(); return; } // button released off-window
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) <= threshold) return;
      if (ptype === 'touch' && !fireOnMove) reset(); // the finger is scrolling, not dragging
      else fire(ev.clientX, ev.clientY, false);
    };
    pUp = (ev) => {
      if (ev.pointerId !== pid) return;
      const tap = tapFn, type = ptype;
      reset();
      if (tap) {
        if (type === 'touch') armTouchTail(); // keep the synthetic click off our menu backdrop
        tap({ x: ev.clientX, y: ev.clientY });
      }
    };
    pCancel = (ev) => {
      if (ev.pointerId === pid) reset();
    };
    window.addEventListener('pointermove', pMove);
    window.addEventListener('pointerup', pUp);
    window.addEventListener('pointercancel', pCancel);
  }

  // If a component tears down mid-gesture (view switch), don't leak listeners or a ghost.
  onScopeDispose(() => {
    reset();
    endSession(store);
  });

  return { down };
}
