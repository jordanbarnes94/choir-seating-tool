<template>
  <dialog ref="dlg" class="choirmodal" :class="'tone-' + tone" @close="emit('close')" @cancel.prevent="emit('close')">
    <div class="cm-head">
      <h3>{{ title }}</h3>
    </div>
    <div class="cm-body">
      <slot />
    </div>
    <div class="cm-foot">
      <slot name="actions" />
    </div>
  </dialog>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
/*
 * ChoirModal — the one in-page message/confirm surface for the Choir Seating Tool.
 *
 * It exists because the whole io panel moved off `alert()` (Jordan, 2026-09-02):
 * import, restore and every limit message. A wall of skipped rows in an
 * `alert()` is unscrollable, uncopyable and truncated by the browser, which is the actual
 * argument rather than aesthetics.
 *
 * A native <dialog> rather than an absolutely-positioned div, and this matters: RosterDialog
 * is itself a modal <dialog> in the top layer, so anything rendered inside it in normal flow
 * paints BEHIND it. (That is the same trap the inline preset UI documents: the toast is
 * painted behind this dialog, which is why the preset messages went inline instead of
 * becoming toasts.) A nested showModal() stacks on the top layer above its opener, so this
 * one is legible over the roster dialog and over the page alike.
 *
 * Presentational only: it owns no state and decides nothing. `open` is the caller's, Esc and
 * the dialog closing route back through @close so there is exactly one way out. (A click on the
 * backdrop does nothing.)
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // Colours the header rule only. 'info' for a question, 'ok' for a result that worked,
  // 'error' for one that did not.
  tone: { type: String, default: 'info' }
});
const emit = defineEmits(['close']);

const dlg = ref(null);
function sync(open) {
  const el = dlg.value;
  if (!el) return;
  if (open && !el.open) el.showModal();
  if (!open && el.open) el.close();
}
watch(() => props.open, sync);
onMounted(() => sync(props.open));
</script>

<style scoped>
.choirmodal {
  margin: auto;
  width: min(560px, 92vw);
  max-height: 86vh;
  max-height: 86dvh;
  padding: 0;
  border: 1px solid #d3d9e0;
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
  background: #fff;
  color: #1d2330;
  font-size: 13px;
  /* head and foot are fixed; only the body scrolls, so a 200-row skipped list stays usable */
  display: flex;
  flex-direction: column;
}
.choirmodal:not([open]) {
  display: none;
}
.choirmodal::backdrop {
  background: rgba(20, 25, 40, 0.42);
}
.cm-head {
  flex: none;
  padding: 12px 16px;
  border-bottom: 2px solid #e2e6ec;
  background: #fafbfc;
}
.tone-ok .cm-head {
  border-bottom-color: #2b7a3e;
}
.tone-error .cm-head {
  border-bottom-color: #b4231a;
}
.cm-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.cm-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  line-height: 1.5;
}
.cm-foot {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid #e2e6ec;
  background: #fafbfc;
}
@media (max-width: 640px) {
  .cm-foot {
    justify-content: stretch;
  }
  .cm-foot :deep(button) {
    flex: 1 1 40%;
  }
}
</style>
