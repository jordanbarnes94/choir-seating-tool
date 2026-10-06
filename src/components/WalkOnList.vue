<template>
  <!-- The walk-on list. ONE component, three
       destinations: on screen here, in the shared print path and in the
       whole-concert sheet. It therefore takes a plan and never touches the store, as
       anything must that has to render a plan that is not the live one.
       It is also read-only by construction: no data-gi, no .bench, no press handlers, so it
       cannot be picked up by useDragDrop's document-wide hit test. -->
  <div class="walkon-list" :class="{ sheet }">
    <!-- Which wing, and whose left: the order only works from one side. -->
    <p v-if="list.side" class="side">{{ list.side }}</p>
    <section v-for="q in list.queues" :key="q.key" class="queue">
      <!-- With one queue the heading would name a distinction this plan does not make, and the
           list is a plain 1..N. That is the common case and it must not be made to look
           complicated by a feature it does not use. -->
      <h3 v-if="!list.single" class="qhead">
        {{ q.heading }}
        <span class="qnote">{{ q.enter }}, {{ q.count }} singer{{ q.count === 1 ? '' : 's' }}</span>
      </h3>
      <!-- One column per row of the stage, left to right in walk-on order, wrapping when the width
           runs out, so a long list is not one long strip down the page. -->
      <div class="cols">
        <div v-for="g in q.groups" :key="g.row" class="rowgroup">
          <h4 class="rhead">{{ g.where ? `${g.where} (${g.heading})` : g.heading }}</h4>
          <div v-for="e in g.entries" :key="e.position" class="entry">
            <span class="pos">{{ e.position }}</span>
            <span class="who">{{ e.name }}</span>
            <span class="seat">{{ e.seat }}</span>
          </div>
        </div>
      </div>
    </section>

    <p v-if="!list.total" class="none">Nobody is seated, so there is nobody to walk on yet.</p>

    <!-- Stated, never inferred. `waiting` holds roster members with no seat: they have no walk-on
         position because they have nowhere to walk to, and a name silently missing from a printed
         list is read as a bug on the night. -->
    <section v-if="waiting.length" class="offstage">
      <h3 class="qhead">Not on stage <span class="qnote">{{ waiting.length }}</span></h3>
      <p class="benchnames">{{ waiting.join(', ') }}</p>
    </section>
  </div>
</template>

<script setup>
// Props only, no store: see the note above.
defineProps({
  // the return of walkOnGroups() in utils/walkOnList.js
  list: { type: Object, required: true },
  // singers with no seat, in the store's stable section-then-name order
  waiting: { type: Array, default: () => [] },
  // The printed sheet: larger type, and columns that fill top to bottom before wrapping to the
  // next, which is the order a list is read in on paper.
  sheet: { type: Boolean, default: false }
});
</script>

<style scoped>
/* Each row of the stage is one column — its heading, then position, name and seat — laid out
   left to right in walk-on order and wrapping onto a new line of columns when the width runs
   out. A row is never split between columns, and never shares one: the reading order is simply
   "down this row, then the next row along". Two queues are two such sections, one under the
   other, each headed with its door. */
.walkon-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.cols {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15em, 1fr));
  gap: 14px 32px;
  align-items: start;
}
.rhead {
  break-after: avoid;
}
/* Each line is its own small grid with a fixed first column, so the numbers and names line up
   down a row, and a very long row that runs off a printed page breaks between two singers. */
.entry {
  display: grid;
  grid-template-columns: 2.2em minmax(0, 1fr) auto;
  column-gap: 10px;
  align-items: baseline;
  break-inside: avoid;
}
.qhead {
  margin: 0 0 10px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #2f4368;
  border-bottom: 2px solid #e2e6ec;
  padding-bottom: 5px;
}
/* the count is on the heading so a line forming backstage can check itself against it without
   reading to the end */
.qnote {
  display: block;
  font-size: 11px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: #5a6573;
}
.rhead {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  color: #5a6573;
}
.pos,
.who,
.seat {
  font-size: 13px;
  padding: 2px 0;
  border-bottom: 1px solid #f0f2f5;
}
.pos {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #2f4368;
}
.who {
  overflow-wrap: anywhere;
}
.seat {
  font-size: 11px;
  font-weight: 700;
  color: #8a93a0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.side {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #36404f;
}
.none {
  margin: 0;
  font-size: 13px;
  color: #5a6573;
}
.benchnames {
  margin: 0;
  font-size: 13px;
  color: #36404f;
}

/* ---------- the printed sheet ----------
   A4 portrait takes three rows side by side, about 58mm each, then the next three under them. */
.sheet .cols {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12pt 8mm;
}
.sheet .pos,
.sheet .who {
  font-size: 10pt;
  line-height: 1.2;
  padding: 1pt 0;
  border-bottom-color: #d8dde4;
}
.sheet .seat {
  font-size: 9pt;
  color: #4a5567;
}
.sheet .rhead {
  font-size: 10pt;
  color: #1d2330;
}
.sheet .qhead {
  font-size: 11pt;
  color: #1d2330;
  break-after: avoid;
}
.sheet .side,
.sheet .benchnames {
  font-size: 10.5pt;
}
</style>
