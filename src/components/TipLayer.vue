<template>
  <!-- The one tooltip for the whole tool. Any element with `data-tip="…"` gets it: shown after a
       short pause on mouse hover or keyboard focus, gone on leave, press or Esc. One
       delegated listener rather than a component per control, so a tip costs one attribute.
       A manual popover, so it sits in the top layer above Choir setup's modal dialog as well. -->
  <div ref="pop" class="tiplayer" popover="manual" role="tooltip" :id="TIP_ID">{{ text }}</div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
const TIP_ID = 'choir-tip';
// Quick enough to feel immediate, slow enough that sweeping the mouse across the toolbar does
// not flash a tip under every button. Once one is showing, moving to the next shows it at once.
const DELAY = 180, WARM = 400;

const pop = ref(null), text = ref('');
let target = null, timer = 0, hiddenAt = 0;

function tipOf(el) {
  // an empty tip is how a binding says "nothing to add here", e.g. `own ? '' : '…'`
  return el?.closest?.('[data-tip]:not([data-tip=""])') || null;
}
function show(el) {
  clearTimeout(timer);
  const run = () => {
    const p = pop.value;
    if (!p || !el.isConnected) return;
    target = el;
    text.value = el.dataset.tip;
    el.setAttribute('aria-describedby', TIP_ID);
    // Re-shown every time, not just toggled: a popover joins the top layer when shown, so this
    // puts it above a dialog that opened after it was last shown.
    if (p.matches(':popover-open')) p.hidePopover();
    p.showPopover();
    nextTick(place);
  };
  if (Date.now() - hiddenAt < WARM || pop.value?.matches(':popover-open')) run();
  else timer = setTimeout(run, DELAY);
}
function hide() {
  clearTimeout(timer);
  if (target) target.removeAttribute('aria-describedby');
  target = null;
  const p = pop.value;
  if (p?.matches(':popover-open')) {
    p.hidePopover();
    hiddenAt = Date.now();
  }
}
// Below the control and centred on it, kept inside the window; above it when there is no room.
// Also the scroll handler: scrolling moves the tip with its control rather than hiding it, since
// a scroll event can land a frame AFTER the hover that scrolled the control into view.
function place() {
  const p = pop.value;
  if (!p || !target) return;
  const b = target.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight, gap = 6, edge = 8;
  const left = Math.min(Math.max(edge, b.left + b.width / 2 - w / 2), window.innerWidth - w - edge);
  const below = b.bottom + gap;
  const top = below + h > window.innerHeight - edge && b.top - gap - h > edge ? b.top - gap - h : below;
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
}

// Mouse only: on touch a tap would show a tip it then covers, and a long press is a drag here.
function onOver(e) {
  if (e.pointerType !== 'mouse') return;
  const el = tipOf(e.target);
  if (el === target) return;
  if (el) show(el);
  else hide();
}
function onOut(e) {
  if (e.pointerType !== 'mouse' || !target) return;
  if (!target.contains(e.relatedTarget)) hide();
}
function onFocusIn(e) {
  const el = tipOf(e.target);
  if (el && el.matches(':focus-visible')) show(el);
}
function onKey(e) {
  if (e.key === 'Escape') hide();
}

const opts = { capture: true, passive: true };
onMounted(() => {
  document.addEventListener('pointerover', onOver, opts);
  document.addEventListener('pointerout', onOut, opts);
  document.addEventListener('pointerdown', hide, opts);
  document.addEventListener('focusin', onFocusIn, opts);
  document.addEventListener('focusout', hide, opts);
  document.addEventListener('scroll', place, opts);
  document.addEventListener('keydown', onKey, opts);
});
onBeforeUnmount(() => {
  hide();
  document.removeEventListener('pointerover', onOver, opts);
  document.removeEventListener('pointerout', onOut, opts);
  document.removeEventListener('pointerdown', hide, opts);
  document.removeEventListener('focusin', onFocusIn, opts);
  document.removeEventListener('focusout', hide, opts);
  document.removeEventListener('scroll', place, opts);
  document.removeEventListener('keydown', onKey, opts);
});
</script>

<style scoped>
.tiplayer {
  position: fixed;
  inset: auto;
  margin: 0;
  max-width: min(18rem, calc(100vw - 16px));
  padding: 6px 9px;
  border: 0;
  border-radius: 6px;
  background: #1e293b;
  color: #f8fafc;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.25);
  font: 400 12.5px/1.4 system-ui, sans-serif;
  text-align: left;
  pointer-events: none;
  overflow: visible;
}
</style>
