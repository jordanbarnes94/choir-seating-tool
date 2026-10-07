<template>
  <dialog ref="dlg" class="rosterdialog" @close="onNativeClose" @cancel.prevent="requestClose">
    <div class="rosterdialog-head">
      <h2>{{ dialogTitle }}</h2>
      <span v-if="!settingsScreen" class="head-count">{{ headCount }}</span>
      <button class="autobtn rosterclose" @click="requestClose">Close</button>
    </div>

    <!-- The tab strip. Plain buttons over a `v-if` below: this is a dialog, not a page, so the
         tabs are never a router — routing them would couple the dialog to browser history and
         break the mobile back gesture that closes it. -->
    <div v-if="!settingsScreen" class="rostertabs" role="tablist" aria-label="Choir setup screens" @keydown="onTabKey">
      <button
        v-for="t in TABS"
        :id="'rostertab-' + t.id"
        :key="t.id"
        :ref="(el) => (tabEls[t.id] = el)"
        type="button"
        class="rostertab"
        :class="{ on: tab === t.id }"
        role="tab"
        aria-controls="rosterpanel"
        :aria-selected="tab === t.id"
        :tabindex="tab === t.id ? 0 : -1"
        @click="goTab(t.id)"
      >
        {{ t.label }}<span v-if="layerDirty(t.id)" class="dirtydot" data-tip="Unsaved changes" aria-label="unsaved changes">•</span>
      </button>
    </div>

    <div ref="scroller" class="rosterbody">
      <div
        id="rosterpanel"
        class="rosterwrap"
        :role="settingsScreen ? null : 'tabpanel'"
        :aria-labelledby="settingsScreen ? null : 'rostertab-' + tab"
        tabindex="0"
      >
        <!-- ── The inline name form, confirm and messages, shared by every tab ──
             Replaces native prompt/confirm, which would paint behind this top-layer modal. -->
        <div v-if="presetUI.mode !== 'idle' || presetUI.error || presetUI.note" class="panel noticepanel">
          <div v-if="namingModes.includes(presetUI.mode)" ref="presetInline" class="presetinline">
            <input
              ref="presetInput"
              v-model="presetUI.name"
              class="presetinput"
              :placeholder="namePlaceholder"
              @keydown.enter.prevent="submitName"
              @keydown.esc.prevent="cancelPreset"
            >
            <!-- The roster picker for a new concert. An existing one changes roster with the
                 Concert tab's Singers from picker, which restarts it. -->
            <template v-if="presetUI.mode === 'create'">
              <span class="planlabel">Singers from</span>
              <select v-model="presetUI.rosterId" class="presetsel">
                <option value="">A new, empty roster</option>
                <option v-for="r in store.rosterOptions.value" :key="r.id" :value="r.id">{{ r.name }} ({{ r.singers }})</option>
              </select>
            </template>
            <button class="pbtn pbtn-primary" @click="submitName">{{ submitLabel }}</button>
            <button class="pbtn" @click="cancelPreset">Cancel</button>
          </div>
          <!-- A question with its own ways out, then Cancel. There is no undo anywhere in this
               module, so anything that throws work away asks first. -->
          <div v-else-if="presetUI.mode === 'confirm'" ref="presetInline" class="presetinline">
            <span class="presetconfirmtext">{{ presetUI.confirm.text }}</span>
            <button
              v-for="a in presetUI.confirm.actions"
              :key="a.label"
              class="pbtn"
              :class="{ 'pbtn-primary': a.kind === 'primary', 'pbtn-danger-solid': a.kind === 'danger' }"
              @click="doAction(a)"
            >{{ a.label }}</button>
            <button class="pbtn" @click="cancelPreset">Cancel</button>
          </div>
          <p v-if="presetUI.error" ref="presetMsg" class="presetmsg presetmsg-err">{{ presetUI.error }}</p>
          <p v-else-if="presetUI.note" class="presetmsg presetmsg-ok">{{ presetUI.note }}</p>
        </div>

        <!-- ════════ Roster: lists of singers ════════ -->
        <template v-if="tab === 'roster'">
          <div class="panel">
            <div class="panel-head">
              <b>Roster</b>
              <span class="hint">a list of singers — each concert takes its singers from one roster</span>
            </div>
            <div class="ctlrow">
              <button class="pbtn" :disabled="busyUI" @click="guardLayer('roster', () => startNaming('newroster'), 'Make a new roster and lose them?')">New…</button>
              <!-- Picking only chooses; Load is what replaces the roster being edited. -->
              <select v-model="pickedRosterId" class="presetsel grpstart" :disabled="busyUI">
                <option v-for="r in store.rosterOptions.value" :key="r.id" :value="r.id">{{ r.name }} ({{ r.singers }})</option>
              </select>
              <button class="pbtn" :disabled="busyUI || !pickedRosterOther" @click="loadRoster">Load</button>
              <button class="pbtn pbtn-primary" :disabled="busyUI || pickedRosterOther || !rosterDirty" @click="saveRoster">
                {{ rosterDirty ? 'Save' : 'Saved' }}
              </button>
              <button class="pbtn" :disabled="busyUI || pickedRosterOther || !loadedRoster" @click="startNaming('saverosteras', loadedRoster.name + ' (copy)')">Save as…</button>
              <!-- Rename and Delete act on the roster chosen in the picker, loaded or not. -->
              <button class="pbtn grpstart" :disabled="busyUI || !pickedRosterOwn" @click="startNaming('renameroster', pickedRosterOwn.name, pickedRosterOwn.id)">Rename</button>
              <button class="pbtn pbtn-danger" :disabled="busyUI || !pickedRosterOwn" @click="delRoster">Delete</button>
            </div>
            <!-- Follows the picker, so a roster's concerts can be seen before loading or deleting it. -->
            <div v-if="pickedRosterConcerts.length" class="ionote">
              <b>{{ pickedRoster.name }}</b> appears in {{ pickedRosterConcerts.length === 1 ? 'this concert' : 'these concerts' }}:
              <ul class="concertlist">
                <li v-for="c in pickedRosterConcerts" :key="c.id"><b>{{ c.name }}</b></li>
              </ul>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <b>Singers</b>
              <span class="hint">names and sections are the same in every concert that uses this roster</span>
            </div>
            <div v-if="!rosterTabRows.length" class="emptynote">No singers yet. Add one below, or import a spreadsheet.</div>
            <div v-else class="rosterscroll">
              <table class="roster">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Section</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rosterTabRows" :key="row.id">
                    <td><input class="rname" :value="row.name" @change="renameSinger(row, $event)"></td>
                    <td>
                      <select v-model="row.section" class="rfield">
                        <option v-for="o in SECTIONS" :key="o" :value="o">{{ o }}</option>
                      </select>
                    </td>
                    <td><button class="delrow" :data-tip="`Remove ${row.name} from this roster`" @click="deleteSinger(row)">×</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="ctlrow addrow">
              <button
                class="pbtn"
                :disabled="!loadedRoster || atSingerLimit"
                :data-tip="atSingerLimit ? `Maximum ${LIMITS.singers} singers` : ''"
                @click="addSinger"
              >+ Add singer</button>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <b>Spreadsheet</b>
            </div>
            <div class="ctlrow">
              <button class="pbtn" data-tip="Read names and sections from an Excel workbook (.xlsx) or a CSV file" @click="guardLayer('roster', () => openImport('roster'), 'Import and lose them?')">Import roster…</button>
              <button class="pbtn" :disabled="!loadedRoster" data-tip="This roster, as last saved, as a spreadsheet you can open in Excel or import again" @click="store.exportRosterCSV(rosterDraft.id)">Export roster</button>
            </div>
            <p class="ionote">
              Names and sections only. Splits belong to a concert: to import or export them, use
              the <b>Concert</b> tab.
            </p>
          </div>
        </template>

        <!-- ════════ Concert: the concert, its splits, who is singing, the spreadsheet ════════ -->
        <template v-if="tab === 'concert'">
          <div class="panel">
            <div class="panel-head">
              <b>Concert</b>
              <span class="hint">who is singing, how they split, and as many seating plans as you like</span>
            </div>
            <div class="ctlrow">
              <button class="pbtn" :disabled="busyUI" @click="guardLayer('concert', startCreate, 'Make a new concert and lose them?')">New…</button>
              <!-- Picking only chooses; Load is what replaces the stage, so a stray pick costs nothing. -->
              <select v-model="pickedConcertId" class="presetsel grpstart" :disabled="busyUI">
                <option v-for="o in store.concertOptions.value" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
              <button class="pbtn" :disabled="busyUI || !pickedOther" @click="loadConcert">Load</button>
              <button class="pbtn pbtn-primary" :disabled="busyUI || pickedOther || !concertOpen || !concertDirty" @click="saveConcert">
                {{ concertDirty ? 'Save' : 'Saved' }}
              </button>
              <button class="pbtn" :disabled="busyUI || pickedOther || !concertOpen" @click="startNaming('saveconcertas', store.openConcertName.value + ' (copy)')">Save as…</button>
              <!-- Rename and Delete act on the concert chosen in the picker, open or not. -->
              <button class="pbtn grpstart" :disabled="busyUI || !pickedConcertOwn" @click="startNaming('rename', pickedConcertOwn.name, pickedConcertOwn.id)">Rename</button>
              <button class="pbtn pbtn-danger" :disabled="busyUI || !pickedConcertOwn" @click="delConcert">Delete</button>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <b>Splits</b>
              <span class="hint">how this concert's singers divide — put each singer in a part on the <b>Splits</b> tab</span>
            </div>
            <div class="splitcards">
              <div v-for="(s, si) in concertDraft.splits" :key="s.id" class="splitcard">
                <div class="splitcard-head">
                  <input class="splitname" :value="s.name" @change="renameSplit(si, $event)">
                  <button class="splitdel autobtn" data-tip="Delete this split" @click="deleteSplit(si)">Delete split</button>
                </div>
                <div class="cats">
                  <span v-for="(c, ci) in s.cats" :key="c" class="catchip">
                    <input class="catname" :value="c" @change="renameCat(si, ci, $event)">
                    <button
                      class="catdel"
                      data-tip="Delete part"
                      :disabled="s.cats.length <= 1"
                      @click="deleteCat(si, ci)"
                    >×</button>
                  </span>
                  <button
                    class="catadd autobtn"
                    :disabled="s.cats.length >= LIMITS.cats"
                    :data-tip="s.cats.length >= LIMITS.cats ? `Maximum ${LIMITS.cats} parts per split` : ''"
                    @click="addCat(si)"
                  >+ Part</button>
                </div>
              </div>
            </div>
            <button
              class="autobtn addsplit"
              :disabled="!concertOpen || atSplitLimit"
              :data-tip="atSplitLimit ? `Maximum ${LIMITS.splits} splits` : ''"
              @click="addSplit"
            >+ Add split</button>
          </div>

          <div class="panel">
            <div class="panel-head">
              <b>Who is singing</b>
              <span class="hint">untick anyone sitting this concert out — they stay on the roster</span>
            </div>
            <!-- Picking only chooses; Apply is what puts that roster into the concert, and it
                 restarts the concert, so it asks first. -->
            <div class="ctlrow rosterrow">
              <span class="planlabel">Singers from</span>
              <select v-model="pickedConcertRosterId" class="presetsel" :disabled="busyUI || !concertOpen || pickedOther">
                <option v-for="r in store.rosterOptions.value" :key="r.id" :value="r.id">{{ r.name }} ({{ r.singers }})</option>
              </select>
              <button class="pbtn" :disabled="busyUI || !concertOpen || pickedOther || !pickedRosterForConcertOther" @click="applyConcertRoster">Apply</button>
            </div>
            <div v-if="!memberRows.length" class="emptynote">
              This roster has no singers yet. Add them on the <b>Roster</b> tab, or import a spreadsheet there.
            </div>
            <div v-else class="rosterscroll">
              <table class="roster">
                <thead>
                  <tr>
                    <th class="inhead">In</th>
                    <th>Name</th>
                    <th>Section</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in memberRows" :key="row.id" :class="{ rowout: !row.in }">
                    <td class="incell">
                      <input
                        type="checkbox"
                        class="intick"
                        :checked="row.in"
                        :aria-label="`${row.name} is singing this concert`"
                        @change="toggleMember(row, $event)"
                      >
                    </td>
                    <td class="rread rread-name">{{ row.name }}</td>
                    <td class="rread"><span class="orderdot" :style="{ background: store.sectionColours.value[row.section] }" />{{ row.section }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="memberRows.length" class="ctlrow addrow">
              <button class="pbtn" :disabled="!outCount" @click="tickAllIn">Tick everyone in</button>
              <span v-if="outCount" class="hint">{{ outCount }} not singing</span>
            </div>

            <!-- Guests sing this concert only, so they are edited here and never on the roster. -->
            <div class="subhead">
              <b>Guests</b>
              <span class="hint">singing this concert only — they do not belong to the roster</span>
            </div>
            <div v-if="!concertDraft.guests.length" class="emptynote">No guests.</div>
            <div v-else class="rosterscroll">
              <table class="roster">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Section</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in concertDraft.guests" :key="row.id">
                    <td><input class="rname" :value="row.name" @change="renameGuest(row, $event)"></td>
                    <td>
                      <select v-model="row.section" class="rfield">
                        <option v-for="o in SECTIONS" :key="o" :value="o">{{ o }}</option>
                      </select>
                    </td>
                    <td class="guestacts">
                      <button
                        class="autobtn"
                        :disabled="busyUI"
                        :data-tip="`Add ${row.name} to the roster &quot;${store.openRosterName.value}&quot;, keeping their seats in this concert`"
                        @click="moveGuest(row)"
                      >Move to roster</button>
                      <button class="delrow" :data-tip="`Remove ${row.name} from this concert`" @click="removeGuest(row)">×</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="concertOpen" class="ctlrow addrow">
              <button
                class="pbtn"
                :disabled="atConcertLimit"
                :data-tip="atConcertLimit ? `Maximum ${LIMITS.singers} singers` : ''"
                @click="addGuest"
              >+ Add guest</button>
            </div>

            <!-- The balance of who is singing, as ticked and added above. -->
            <div v-if="draftCounts.total" class="sectioncounts">
              <span v-for="c in draftCounts.sections" :key="c.section" class="countchip">
                <span class="orderdot" :style="{ background: store.sectionColours.value[c.section] }" />{{ c.count }} {{ c.section }}
              </span>
              <span class="counttotal">{{ draftCounts.total }} singing{{ draftCounts.guests ? `, ${draftCounts.guests} of them ${draftCounts.guests === 1 ? 'a guest' : 'guests'}` : '' }}</span>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <b>Spreadsheet</b>
              <span class="hint">the concert's singers and their splits</span>
            </div>
            <div class="ctlrow">
              <button class="pbtn" data-tip="Read singers and splits from an Excel workbook (.xlsx) or a CSV file into a new roster and concert" @click="guardLayer('concert', () => openImport('concert'), 'Import and lose them?')">Import…</button>
              <button class="pbtn" data-tip="This concert, as last saved: everybody singing in it and their group in each split, as a spreadsheet you can open in Excel or import again" @click="store.exportConcertCSV">Export concert</button>
            </div>
            <p class="ionote">
              Export and import again to copy a concert with its singers and splits. For a
              printable seating plan, use <b>Print</b> or <b>Download spreadsheet</b> beside the stage.
            </p>
          </div>

        </template>

        <!-- ════════ Splits: put each singer in a category ════════ -->
        <template v-if="tab === 'splits'">
          <div v-if="splitRows.length" class="panel">
            <div class="panel-head">
              <b>Summary</b>
              <span class="hint">who is singing {{ store.openConcertName.value || 'this concert' }}, by section and by split</span>
            </div>
            <div class="sectioncounts">
              <span v-for="b in balance.rows" :key="b.section" class="countchip">
                <span class="orderdot" :style="{ background: store.sectionColours.value[b.section] }" />{{ b.count }} {{ b.section }}
              </span>
              <span class="counttotal">{{ balance.total.count }} singing{{ splitGuests ? `, ${splitGuests} of them ${splitGuests === 1 ? 'a guest' : 'guests'}` : '' }}</span>
            </div>
            <!-- How each section divides in every split, as the categories below currently stand. -->
            <div v-if="store.splits.value.length" class="rosterscroll balance">
              <table class="roster balancetable">
                <thead>
                  <tr>
                    <th rowspan="2">Section</th>
                    <th rowspan="2" class="num">Singers</th>
                    <th v-for="s in store.splits.value" :key="s.id" :colspan="s.cats.length" class="splitgroup">{{ s.name }}</th>
                  </tr>
                  <tr>
                    <template v-for="s in store.splits.value" :key="s.id">
                      <th v-for="(c, ci) in s.cats" :key="c" class="num" :class="{ splitstart: ci === 0 }">{{ c }}</th>
                    </template>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in balance.rows" :key="b.section">
                    <td class="rread"><span class="orderdot" :style="{ background: store.sectionColours.value[b.section] }" />{{ b.section }}</td>
                    <td class="num">{{ b.count }}</td>
                    <template v-for="s in store.splits.value" :key="s.id">
                      <td v-for="(c, ci) in s.cats" :key="c" class="num" :class="{ splitstart: ci === 0, zero: !b.cats[s.id][c] }">{{ b.cats[s.id][c] }}</td>
                    </template>
                  </tr>
                  <tr class="totalrow">
                    <td class="rread">Total</td>
                    <td class="num">{{ balance.total.count }}</td>
                    <template v-for="s in store.splits.value" :key="s.id">
                      <td v-for="(c, ci) in s.cats" :key="c" class="num" :class="{ splitstart: ci === 0 }">{{ balance.total.cats[s.id][c] }}</td>
                    </template>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head">
              <b>Splits</b>
              <span class="hint">a part for every singer in every split of {{ store.openConcertName.value || 'this concert' }}</span>
            </div>
            <div v-if="splitRows.length && store.splits.value.length" class="ctlrow splitsave">
              <button class="pbtn pbtn-primary" :disabled="busyUI || !assignDirty" @click="saveAssign">{{ assignDirty ? 'Save' : 'Saved' }}</button>
              <button class="pbtn" :disabled="busyUI || !assignDirty" @click="loadAssignDraft">Discard changes</button>
            </div>
            <div v-if="!store.splits.value.length" class="emptynote">This concert has no splits. Add them on the <b>Concert</b> tab.</div>
            <div v-else-if="!splitRows.length" class="emptynote">Nobody is singing this concert yet. Tick them in on the <b>Concert</b> tab.</div>
            <div v-else class="rosterscroll">
              <table class="roster">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Section</th>
                    <th v-for="id in store.SCH.value" :key="id">{{ store.SCH_LABEL.value[id] }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in splitRows" :key="row.id">
                    <td class="rread rread-name">{{ row.name }} <span v-if="row.guest" class="guesttag">guest</span></td>
                    <td class="rread"><span class="orderdot" :style="{ background: store.sectionColours.value[row.section] }" />{{ row.section }}</td>
                    <td v-for="id in store.SCH.value" :key="id">
                      <select class="rfield" :value="catOf(row.id, id)" @change="editCategory(row.id, id, $event)">
                        <option v-for="o in store.SPLIT_OPTIONS.value[id]" :key="o" :value="o">{{ o }}</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <!-- ════════ Settings ════════ -->
        <template v-if="tab === 'settings'">
          <!-- ── Colours: global, in named schemes ──
               Native `<input type="color">` (Jordan, 2026-09-02): a curated swatch set would stop
               a user matching their own choir's colours. The safeguard against an unusable choice
               is the preview under the pickers, which shows what will actually be DRAWN. -->
          <div class="panel">
            <div class="panel-head">
              <b>Colours</b>
              <span class="hint">used for every concert and seating plan</span>
            </div>
            <div class="ctlrow">
              <button class="pbtn" :disabled="busyUI" @click="guardLayer('settings', () => startNaming('newscheme'), 'Make a new colour scheme and lose them?')">New…</button>
              <!-- Picking only chooses; Load is what changes the colours the stage paints with. -->
              <select v-model="pickedSchemeId" class="presetsel grpstart" :disabled="busyUI">
                <option v-for="s in store.palettes.value.schemes" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <button class="pbtn" :disabled="busyUI || !pickedSchemeOther" @click="loadScheme">Load</button>
              <button class="pbtn pbtn-primary" :disabled="busyUI || pickedSchemeOther || !colourDirty" @click="saveScheme">
                {{ colourDirty ? 'Save' : 'Saved' }}
              </button>
              <button class="pbtn" :disabled="busyUI || pickedSchemeOther" @click="startNaming('saveasscheme', activeSchemeName + ' (copy)')">Save as…</button>
              <!-- Rename and Delete act on the scheme chosen in the picker, in use or not. -->
              <button class="pbtn grpstart" :disabled="busyUI || !pickedScheme" @click="startNaming('renamescheme', pickedScheme.name, pickedScheme.id)">Rename</button>
              <button class="pbtn pbtn-danger" :disabled="busyUI || !pickedScheme || store.palettes.value.schemes.length < 2" @click="delScheme">Delete</button>
            </div>
            <!-- Three parts, each in SATB order: the section colours, the split frames as bare
                 pickers, and a preview of what they draw. The scheme is global, so it does not
                 follow any one plan's section order. -->
            <p class="colsub">Section colours</p>
            <div class="seccols">
              <span v-for="row in colourRows" :key="row.section" class="seccol">
                <label class="colname" :for="'seccol-' + row.section" :style="{ color: row.hex }">{{ row.section }}</label>
                <input :id="'seccol-' + row.section" class="colpick" type="color" :value="row.hex" :aria-label="row.section + ' colour'" @input="onColour(row.section, $event)">
                <span class="colseat" :style="{ background: row.fill, borderColor: row.plain }">Singer</span>
              </span>
            </div>

            <p class="colsub">Split frames <span class="hint">the frame for each part of a split</span></p>
            <div class="coltable-wrap">
              <table class="coltable">
                <thead>
                  <tr>
                    <th />
                    <th v-for="p in framePositions" :key="p.pos" :class="{ grpgap: p.pos && p.pos % 4 === 0 }" :data-tip="p.names.join(' · ')">{{ p.pos + 1 }}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in colourRows" :key="row.section">
                    <td><span class="colname" :style="{ color: row.hex }">{{ row.section }}</span></td>
                    <td v-for="cell in row.frames" :key="cell.pos" :class="{ grpgap: cell.pos && cell.pos % 4 === 0 }">
                      <input
                        class="colpick small"
                        type="color"
                        :value="cell.frame"
                        :aria-label="`${row.section}, part ${cell.pos + 1}`"
                        @input="onSplitColour(row.section, cell.pos, $event)"
                      >
                    </td>
                    <td>
                      <button class="pbtn smallbtn" :disabled="!row.custom" :data-tip="`Put ${row.section} back to its default colours`" @click="resetSection(row.section)">Reset</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p class="colsub">Preview <span class="hint">a singer's frame, a quarter per part, numbered at each corner</span></p>
            <div class="coltable-wrap">
              <table class="coltable">
                <thead>
                  <tr>
                    <th />
                    <th v-for="g in previewGroups" :key="g.from">Parts {{ g.from + 1 }}–{{ g.from + 4 }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in colourRows" :key="row.section">
                    <td><span class="colname" :style="{ color: row.hex }">{{ row.section }}</span></td>
                    <td v-for="g in previewGroups" :key="g.from">
                      <!-- The frame is a conic gradient behind the fill: from the left edge,
                           clockwise, so the quarters are top-left, top-right, bottom-right,
                           bottom-left, in part order. -->
                      <span class="qseat" :style="{ background: quarters(row.frames.slice(g.from, g.from + 4)) }">
                        <span class="qfill" :style="{ background: row.fill }">
                          <i class="qn tl">{{ g.from + 1 }}</i><i class="qn tr">{{ g.from + 2 }}</i>
                          <i class="qn br">{{ g.from + 3 }}</i><i class="qn bl">{{ g.from + 4 }}</i>
                          Singer
                        </span>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="ctlrow addrow">
              <button class="pbtn" :disabled="!anyCustomColour" @click="resetAllColours">Reset all to defaults</button>
            </div>
            <p class="ionote">
              A split's first part is drawn with frame <b>1</b>, its second with frame <b>2</b>,
              and so on, up to {{ LIMITS.cats }}. The defaults are all different up to 8, and 9 to
              {{ LIMITS.cats }} repeat 1 to {{ LIMITS.cats - 8 }} unless you pick them. Changing a
              section's colour changes the frames you have not picked yourself to match it.
            </p>
          </div>

          <!-- The audience position and the four labelling settings, beside a small
               drawing of the plan. It is a second face on the same store writes rather than a
               second copy of the state, so the preview and the toggles cannot drift apart. -->
          <div class="panel">
            <div class="panel-head">
              <b>Audience &amp; seat labelling</b>
              <span class="hint">click the plan to move the audience — saved with this seating plan</span>
            </div>
            <div class="setbody">
              <div class="setrows">
                <div class="setrow">
                  <span class="setlabel">Audience position</span>
                  <div class="seg" role="group" aria-label="Audience position">
                    <button
                      v-for="o in VIEWPOINT_OPTIONS"
                      :key="o.value"
                      type="button"
                      class="segbtn"
                      :class="{ on: store.audienceAt.value === o.value }"
                      :aria-pressed="store.audienceAt.value === o.value"
                      @click="store.setAudienceAt(o.value)"
                    >{{ o.label }}</button>
                  </div>
                </div>
                <div v-for="c in LABEL_CONTROLS" :key="c.field" class="setrow">
                  <span class="setlabel">{{ c.label }}</span>
                  <div class="seg" role="group" :aria-label="c.label">
                    <button
                      v-for="o in c.options"
                      :key="o.value"
                      type="button"
                      class="segbtn"
                      :class="{ on: store.labels[c.field] === o.value }"
                      :aria-pressed="store.labels[c.field] === o.value"
                      @click="store.setLabel(c.field, o.value)"
                    >{{ o.label }}</button>
                  </div>
                </div>
              </div>
              <LabelPreview
                :rows="SAMPLE_ROWS"
                :cols="SAMPLE_COLS"
                :labels="store.labels"
                :audience-at="store.audienceAt.value"
                @move-audience="store.setAudienceAt($event)"
              />
            </div>
            <p class="ionote">
              Seats are named row then column, so the first chair is <b>{{ startLabel }}</b>.
              Moving the audience rotates the drawing; nobody is reseated or renamed.
            </p>
          </div>

          <div class="panel">
            <div class="panel-head">
              <b>Backup &amp; restore</b>
              <span class="hint">everything the tool holds, in one file</span>
            </div>
            <div class="ctlrow">
              <button class="pbtn" data-tip="Every roster, concert, seating plan and colour scheme in one file — the file to take to a new device" @click="store.backupJSON">Save backup file</button>
              <button class="pbtn" data-tip="Replaces everything this tool holds with the backup" @click="onRestore">Restore from backup</button>
              <button class="pbtn pbtn-danger" data-tip="Delete every roster, concert and seating plan and start again from the example choir" @click="onClearAll">Clear everything</button>
            </div>
            <p class="ionote">
              <b>Save backup file</b> writes every roster, concert, seating plan and colour scheme
              into one file, which <b>Restore from backup</b> puts back — replacing everything here.
              It is the only file this tool can read back in.
            </p>
          </div>
        </template>
      </div>
    </div>

    <!-- ── The overlays ──
         Both are nested modal <dialog>s, which is why they sit here at the end rather than
         inside the panel that opens them: anything in normal flow inside this top-layer modal
         paints behind it. See ChoirModal.vue. -->
    <ImportDialog
      :open="importUI.open"
      :kind="importUI.kind"
      :stage="importUI.stage"
      :columns="importUI.columns"
      :found="importUI.found"
      :result="importUI.result"
      :unsaved="importUI.unsaved"
      :name-error="importUI.nameError"
      :rosters="store.rosterOptions.value"
      :roster-id="rosterDraft.id"
      @pick="pickImportFile"
      @confirm="runImport"
      @template="store.downloadTemplate(importUI.kind)"
      @close="importUI.open = false"
    />
    <ChoirModal :open="msgUI.open" :title="msgUI.title" :tone="msgUI.tone" @close="msgUI.open = false">
      <p class="msgtext">{{ msgUI.text }}</p>
      <template #actions>
        <button class="pbtn pbtn-primary" @click="msgUI.open = false">Close</button>
      </template>
    </ChoirModal>
  </dialog>
</template>

<script setup>
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { SECTIONS, isSinger, LIMITS, bolden, resolveSectionColours, resolveSplitFrames, splitCatPositions, tint } from '../utils/arranger';
import { activeScheme, hasCustomColours, withSectionColour, withSplitColour, withoutSectionColour, withoutSectionSplitColours } from '../utils/palettes';
import { SAMPLE_COLS, SAMPLE_ROWS, startSeatLabel } from '../utils/seatPreview';
import { useChoirArranger } from '../composables/useChoirArranger';
import ChoirModal from './ChoirModal.vue';
import ImportDialog from './ImportDialog.vue';
import LabelPreview from './LabelPreview.vue';

const store = useChoirArranger();
const dlg = ref(null);
// The one element that scrolls, whichever screen or tab is showing.
const scroller = ref(null);
const toTop = () => { if (scroller.value) scroller.value.scrollTop = 0; };

/*
 * EVERY TAB EDITS A WORKING COPY. The Roster tab edits a draft of one roster, the Concert tab a
 * draft of the open concert's membership and splits, and the Splits tab a draft of its singers'
 * categories. Nothing reaches the library until that tab's Save, and nothing leaves a tab — to
 * another tab, to another roster or concert, or out of the dialog — while it has unsaved
 * changes, without asking Save / Discard / Cancel (guardLayer). The stage's seating plan is the
 * fourth working copy and keeps its own Save, in the store.
 *
 * Because a tab cannot be left dirty, whatever a tab READS from another layer is always saved:
 * the Concert tab's member list is the saved roster, and the Splits tab's rows are the saved
 * concert.
 */

/* ---------- tabs ----------
   Roster edits lists of singers; Concert says which roster a concert uses, who of it is singing,
   the concert's splits and its seating plans; Splits puts each singer in a category. Settings is
   not a tab: the cogwheel opens this dialog on it alone, with no tab strip. */
const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'concert', label: 'Concert' },
  { id: 'splits', label: 'Splits' }
];
const settingsScreen = computed(() => store.setupScreen.value === 'settings');
const tab = ref('roster');
// Roving tabindex plus Left/Right/Home/End, because declaring role="tablist" promises a
// screen reader "tab, 1 of 3" and the arrow keys are the other half of that promise.
const tabEls = {};
function onTabKey(e) {
  const keys = { ArrowLeft: -1, ArrowRight: 1 };
  let next;
  if (e.key in keys) {
    const i = TABS.findIndex((t) => t.id === tab.value);
    next = TABS[(i + keys[e.key] + TABS.length) % TABS.length].id;
  } else if (e.key === 'Home') next = TABS[0].id;
  else if (e.key === 'End') next = TABS[TABS.length - 1].id;
  else return;
  e.preventDefault();
  goTab(next, () => nextTick(() => tabEls[next]?.focus()));
}
function goTab(next, after) {
  if (next === tab.value || busyUI.value) return;
  guardLayer(tab.value, () => {
    tab.value = next;
    reloadLayer(next);
    toTop();
    if (after) after();
  }, 'Save them before leaving this tab?');
}

/* ---------- dialog open/close wiring ---------- */
function syncDialog(open) {
  const el = dlg.value;
  if (!el) return;
  if (open && !el.open) el.showModal();
  if (!open && el.open) el.close();
  lockPage(open);
}
// While the dialog is open the page behind it cannot scroll, so the wheel only ever moves the
// dialog. The gutter is kept only if the page had a scrollbar, so nothing behind shifts sideways.
function lockPage(on) {
  const html = document.documentElement;
  if (on) {
    html.style.scrollbarGutter = window.innerWidth > html.clientWidth ? 'stable' : '';
    html.style.overflow = 'hidden';
  } else {
    html.style.overflow = '';
    html.style.scrollbarGutter = '';
  }
}
onBeforeUnmount(() => lockPage(false));
watch(() => store.rosterOpen.value, (open) => {
  if (open) {
    tab.value = settingsScreen.value ? 'settings' : 'roster';
    resetOrder();
    loadRosterDraft(store.openRoster.value ? store.openRoster.value.id : '');
    loadConcertDraft();
    loadAssignDraft();
    loadColourDraft();
  } else {
    cancelPreset();
    presetUI.note = '';
    // The two overlays are nested <dialog>s inside this one, so closing this one hides them
    // without closing them: without this they would still be open the next time it is reopened.
    importUI.open = false;
    msgUI.open = false;
  }
  syncDialog(open);
  if (open) toTop();
});
onMounted(() => {
  if (store.rosterOpen.value) {
    loadRosterDraft(store.openRoster.value ? store.openRoster.value.id : '');
    loadConcertDraft();
    loadAssignDraft();
    loadColourDraft();
    syncDialog(true);
  }
});
// Close and Esc both come here, so neither can drop a tab's unsaved changes.
function requestClose() {
  // A field commits its edit on change, which fires as it loses focus: blur it first, so the
  // check below sees an edit still in a focused field.
  const el = document.activeElement;
  if (el instanceof HTMLElement && dlg.value && dlg.value.contains(el)) el.blur();
  if (busyUI.value) {
    cancelPreset();
    return;
  }
  guardLayer(tab.value, () => (store.rosterOpen.value = false), 'Save them before closing?');
}
function onNativeClose() {
  if (!store.rosterOpen.value) return;
  // A cancel the browser will not let us stop (a second Esc, the back gesture) still closes the
  // dialog. With a draft unsaved it is reopened and asked about instead of dropping the draft.
  if (busyUI.value || layerDirty(tab.value)) {
    dlg.value.showModal();
    requestClose();
    return;
  }
  store.rosterOpen.value = false;
}
// A reload would lose a draft silently, so the browser asks while one is unsaved.
function onBeforeUnload(e) {
  if (store.rosterOpen.value && [...TABS.map((t) => t.id), 'settings'].some(layerDirty)) e.preventDefault();
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));

const dialogTitle = computed(() => (settingsScreen.value ? 'Settings' : store.openConcertName.value || 'Choir setup'));
const headCount = computed(() => {
  const guests = store.data.value.filter((p) => p.guest).length;
  const inC = store.data.value.length - guests, all = store.rosterSingers.value.length;
  const word = all === 1 ? 'singer' : 'singers';
  const base = inC === all ? `${all} ${word}` : `${inC} of ${all} ${word} singing`;
  return guests ? `${base}, plus ${guests} ${guests === 1 ? 'guest' : 'guests'}` : base;
});

/* ---------- row order ----------
   Each table is sorted by the section order and then by name WHEN IT IS FIRST SHOWN, and keeps
   that order while it is open: a row must not jump away from the cursor because its name was
   edited. A singer added meanwhile goes at the end. Cached per roster, and re-sorted when the
   dialog opens or the section order changes. */
const orderCache = new Map();
const orderEpoch = ref(0);
function resetOrder() {
  orderCache.clear();
  orderEpoch.value++;
}
watch(() => store.sectionOrder.value, resetOrder, { deep: true });
// A roster deleted or restored away takes its cached order with it.
watch(() => store.library.value.rosters.map((r) => r.id).join(), resetOrder);
// `key` keeps the Roster tab's draft apart from the saved roster the other tabs list.
function ordered(rosterId, list, key_ = rosterId) {
  void orderEpoch.value;
  let ord = orderCache.get(key_);
  if (!ord) {
    const secs = store.sectionOrder.value;
    const rank = (s) => (secs.includes(s) ? secs.indexOf(s) : secs.length + SECTIONS.indexOf(s));
    // By surname within each section: everything after the first name, so "De Vere" files under D.
    const key = (p) => p.name.trim().replace(/^\S+\s+/, '');
    ord = list
      .slice()
      .sort((a, b) => rank(a.section) - rank(b.section) || key(a).localeCompare(key(b)) || a.name.localeCompare(b.name))
      .map((p) => p.id);
  }
  const present = new Set(list.map((p) => p.id));
  ord = ord.filter((id) => present.has(id));
  const have = new Set(ord);
  for (const p of list) if (!have.has(p.id)) ord.push(p.id);
  orderCache.set(key_, ord);
  const by = new Map(list.map((p) => [p.id, p]));
  return ord.map((id) => by.get(id));
}

/* ---------- the layers: load a draft, tell whether it differs, save it ---------- */
const snap = (v) => JSON.stringify(v);

// Roster: which roster is loaded, and its singers as edited.
const rosterDraft = reactive({ id: '', singers: [] });
const rosterBase = ref('');
const rosterOf = (id) => store.library.value.rosters.find((r) => r.id === id) || null;
const loadedRoster = computed(() => rosterOf(rosterDraft.id));
const rosterDirty = computed(() => snap(rosterDraft.singers) !== rosterBase.value);
function loadRosterDraft(id) {
  const r = rosterOf(id) || store.openRoster.value || store.library.value.rosters[0] || null;
  rosterDraft.id = r ? r.id : '';
  rosterDraft.singers = r ? r.singers.map((p) => ({ id: p.id, name: p.name, section: p.section })) : [];
  orderCache.delete('draft:' + rosterDraft.id);
  rosterBase.value = snap(rosterDraft.singers);
  pickedRosterId.value = rosterDraft.id;
}

// Concert: who is singing (roster ids, and the guests), the splits, and the categories carried
// with them so a renamed or deleted category is remapped in the same draft.
const concertDraft = reactive({ members: [], guests: [], splits: [], assign: {} });
const concertBase = ref('');
const concertSnap = () =>
  snap({ members: concertDraft.members.slice().sort(), guests: concertDraft.guests, splits: concertDraft.splits, assign: concertDraft.assign });
const concertDirty = computed(() => concertSnap() !== concertBase.value);
function loadConcertDraft() {
  const c = store.concert.value;
  concertDraft.members = c ? c.members.map((m) => m.singerId) : [];
  concertDraft.guests = c ? c.guests.map((p) => ({ id: p.id, name: p.name, section: p.section })) : [];
  concertDraft.splits = c ? c.splits.map((s) => ({ id: s.id, name: s.name, cats: s.cats.slice() })) : [];
  concertDraft.assign = c ? JSON.parse(JSON.stringify(c.assign)) : {};
  concertBase.value = concertSnap();
}

// Splits tab: the categories alone.
const assignDraft = ref({});
const assignBase = ref('');
const assignDirty = computed(() => snap(assignDraft.value) !== assignBase.value);
function loadAssignDraft() {
  const c = store.concert.value;
  assignDraft.value = c ? JSON.parse(JSON.stringify(c.assign)) : {};
  assignBase.value = snap(assignDraft.value);
}

// Settings is not a tab, but it is `tab` while the cogwheel's screen is open, so its colour draft
// rides the same gate.
const LAYER_NAME = { roster: 'the roster', concert: 'the concert', splits: 'the splits', settings: 'the colour scheme' };
function layerDirty(id) {
  return (
    (id === 'roster' && rosterDirty.value) ||
    (id === 'concert' && concertDirty.value) ||
    (id === 'splits' && assignDirty.value) ||
    (id === 'settings' && colourDirty.value)
  );
}
// Entering a tab reads its layer afresh: it was clean when it was left, and another tab's Save
// may have changed what it shows since.
function reloadLayer(id) {
  if (id === 'roster') loadRosterDraft(rosterDraft.id);
  if (id === 'concert') loadConcertDraft();
  if (id === 'splits') loadAssignDraft();
  if (id === 'settings') loadColourDraft();
}
// The save the unsaved-changes question offers, without a second confirm on top of it.
function commitLayer(id) {
  if (id === 'roster') return commitRosterDraft();
  if (id === 'concert') return commitConcertDraft();
  if (id === 'splits') return commitAssignDraft();
  if (id === 'settings') return commitColourDraft();
  return true;
}
/*
 * The one gate. Anything that would drop a tab's draft — leaving the tab, loading another roster
 * or concert, making a new one, importing, closing the dialog — runs through here, and when the
 * draft is unsaved it asks first: Save changes, Discard changes, or Cancel.
 */
function guardLayer(id, run, what) {
  if (!layerDirty(id)) {
    run();
    return;
  }
  askChoice(`You have unsaved changes to ${LAYER_NAME[id]}. ${what}`, [
    { label: 'Save changes', kind: 'primary', run: () => commitLayer(id) && run() },
    { label: 'Discard changes', kind: 'danger', run: () => (reloadLayer(id), run()) }
  ]);
}

// The open concert changing under the dialog (Load, New, Save as, import, restore, a delete)
// replaces the concert and splits drafts, which every path to it has already guarded.
watch(() => store.openConcertId.value, () => {
  loadConcertDraft();
  loadAssignDraft();
});
// A restore or Clear everything replaces the whole library; the roster being edited may be gone.
watch(() => store.library.value, () => {
  resetOrder();
  loadRosterDraft(rosterDraft.id);
  loadConcertDraft();
  loadAssignDraft();
});

/* ---------- Roster tab ---------- */
// The roster chosen in the picker, which Load loads. Follows the loaded roster.
const pickedRosterId = ref('');
const pickedRosterOther = computed(() => pickedRosterId.value !== rosterDraft.id);
// The picked roster, which is what Rename and Delete act on.
const pickedRosterOwn = computed(() => store.rosterOptions.value.find((r) => r.id === pickedRosterId.value) || null);
const pickedRoster = computed(() => rosterOf(pickedRosterId.value));
const pickedRosterConcerts = computed(() => (pickedRoster.value ? store.concertsUsingRoster(pickedRoster.value.id) : []));
// The loaded roster's concerts, for Save's warning about removed singers.
const rosterConcerts = computed(() => (loadedRoster.value ? store.concertsUsingRoster(rosterDraft.id) : []));
const rosterTabRows = computed(() => (loadedRoster.value ? ordered(rosterDraft.id, rosterDraft.singers, 'draft:' + rosterDraft.id) : []));
const atSingerLimit = computed(() => rosterDraft.singers.length >= LIMITS.singers);

function loadRoster() {
  presetUI.error = '';
  presetUI.note = '';
  const id = pickedRosterId.value;
  guardLayer('roster', () => {
    loadRosterDraft(id);
    finishPreset(`Loaded "${loadedRoster.value.name}".`);
  }, 'Load the other roster and lose them?');
}
// A name that would masquerade as a seat sentinel is refused, and so is one somebody else on the
// roster has: the spreadsheet import skips a repeated name, so a roster exported and read back in
// would lose them.
function renameSinger(row, e) {
  const name = e.target.value.trim();
  if (!name || !isSinger(name) || rosterDraft.singers.some((q) => q !== row && q.name === name)) {
    if (name) alert(isSinger(name) ? 'That name is already in the roster.' : 'That name is reserved for empty/blocked seats. Pick another.');
    e.target.value = row.name;
    return;
  }
  row.name = name;
}
function deleteSinger(row) {
  rosterDraft.singers = rosterDraft.singers.filter((p) => p.id !== row.id);
}
function addSinger() {
  // A courtesy, not an identity: four rows reading "New singer" would be indistinguishable to the
  // person typing over them.
  const taken = new Set(rosterDraft.singers.map((q) => q.name));
  let n = 1, name;
  do {
    name = 'New singer ' + n++;
  } while (taken.has(name));
  // Off the library's counter, so never an id anybody has held: a singer deleted, saved or not,
  // cannot hand theirs — and with it their chairs and categories — to somebody new.
  const id = store.mint(store.ID.singer);
  rosterDraft.singers.push({ id, name, section: SECTIONS[0] });
}
function commitRosterDraft() {
  if (!store.commitRoster(rosterDraft.id, rosterDraft.singers)) {
    presetUI.error = "That roster can't be saved.";
    return false;
  }
  loadRosterDraft(rosterDraft.id);
  return true;
}
// Save asks first only when it reaches beyond this roster: singers removed leave every concert
// over it, which may empty chairs in plans the user is not looking at.
function saveRoster() {
  presetUI.error = '';
  presetUI.note = '';
  const name = loadedRoster.value.name;
  const keep = new Set(rosterDraft.singers.map((p) => p.id));
  const removed = loadedRoster.value.singers.filter((p) => !keep.has(p.id)).length;
  const done = () => commitRosterDraft() && finishPreset(`Saved "${name}".`);
  if (!removed || !rosterConcerts.value.length) {
    done();
    return;
  }
  const n = removed === 1 ? '1 singer' : `${removed} singers`;
  askConfirm(
    `Save "${name}"? The ${n} you removed will leave ${rosterConcerts.value.map((c) => c.name).join(', ')}, and their seats there will be emptied.`,
    'Save',
    done
  );
}
// Deleting a roster deletes every concert over it, so the question names them.
function delRoster() {
  const r = rosterOf(pickedRosterOwn.value.id);
  const used = store.concertsUsingRoster(r.id).map((c) => `"${c.name}"`);
  const also = !used.length
    ? ''
    : used.length === 1
      ? ` It appears in the concert ${used[0]}, which will be deleted with it, seating plans and all.`
      : ` It appears in the concerts ${used.slice(0, -1).join(', ')} and ${used[used.length - 1]}, which will be deleted with it, seating plans and all.`;
  askConfirm(`Delete the roster "${r.name}" and its ${r.singers.length} singers?${also} This can't be undone.`, 'Delete', () => {
    if (!store.deleteRoster(r.id)) {
      presetUI.error = "That roster can't be deleted.";
      return;
    }
    // The loaded roster, and any edits to it, stay unless it was the one deleted.
    if (rosterDraft.id === r.id) loadRosterDraft('');
    else pickedRosterId.value = rosterDraft.id;
    finishPreset(used.length ? `Deleted "${r.name}" and ${used.length === 1 ? 'its concert' : `its ${used.length} concerts`}.` : `Deleted "${r.name}".`);
  }, true);
}

/* ---------- Concert tab ---------- */
const concertOpen = computed(() => !!store.concert.value);
// The concert chosen in the picker, which Load opens. Follows the open concert.
const pickedConcertId = ref(store.openConcertId.value);
watch(() => store.openConcertId.value, (id) => (pickedConcertId.value = id), { immediate: true });
const pickedOther = computed(() => pickedConcertId.value !== store.openConcertId.value);
// The picked concert, which is what Rename and Delete act on.
const pickedConcertOwn = computed(() => store.concertOptions.value.find((c) => c.id === pickedConcertId.value) || null);
// The roster chosen in the Singers from picker, which Apply moves the concert onto. Follows the
// open concert's roster.
const pickedConcertRosterId = ref('');
watch(() => (store.openRoster.value ? store.openRoster.value.id : ''), (id) => (pickedConcertRosterId.value = id), { immediate: true });
const pickedRosterForConcertOther = computed(() => !!store.openRoster.value && pickedConcertRosterId.value !== store.openRoster.value.id);
// The seats, pins and categories all name the old roster's singers, so putting a new roster into
// the concert restarts it (store.changeConcertRoster). The concert draft is asked about first, then this.
function applyConcertRoster() {
  presetUI.error = '';
  presetUI.note = '';
  const picked = pickedConcertRosterId.value;
  const target = store.rosterOptions.value.find((r) => r.id === picked);
  if (!target) return;
  const concertName = store.openConcertName.value;
  const plans = arrangementOptions.value.length;
  guardLayer('concert', () => {
    askConfirm(
      `Put the roster "${target.name}" into the concert "${concertName}"? This restarts the concert: ` +
        `everyone on "${target.name}" is ticked in, split parts are cleared, and ` +
        `${plans === 1 ? 'its seating plan is' : `all ${plans} of its seating plans are`} reseated from scratch` +
        `${dirty.value ? ', losing the seating changes you have not saved' : ''}. This can't be undone.`,
      'Change roster',
      () => {
        if (!store.changeConcertRoster(store.openConcertId.value, picked)) {
          presetUI.error = "That roster couldn't be applied.";
          return;
        }
        // Same concert id, so the watch that reloads the drafts on a concert change does not fire.
        loadConcertDraft();
        loadAssignDraft();
        finishPreset(`Put the roster "${target.name}" into "${concertName}".`);
      },
      true
    );
  }, 'Change the roster and lose them?');
}
const arrangementOptions = computed(() => {
  const c = store.concert.value;
  return c ? c.arrangements.map((a) => ({ id: a.id, name: a.name })) : [];
});
// Whether the seating plan on stage has unsaved changes: a computed over the store's own
// comparison, so it re-evaluates on a drag and again the moment Save clears it.
const dirty = computed(() => store.hasUnsavedChanges());
// The saved roster with this concert's DRAFT ticks. Unticked rows are dimmed, not hidden.
const memberRows = computed(() => {
  const r = store.openRoster.value;
  if (!r) return [];
  const on = new Set(concertDraft.members);
  return ordered(r.id, r.singers).map((p) => ({ id: p.id, name: p.name, section: p.section, in: on.has(p.id) }));
});
const outCount = computed(() => memberRows.value.filter((r) => !r.in).length);
// Everyone the draft has singing, counted by section in the section order.
const draftCounts = computed(() => {
  const singing = [...memberRows.value.filter((r) => r.in), ...concertDraft.guests];
  const by = {};
  for (const p of singing) by[p.section] = (by[p.section] || 0) + 1;
  const order = [...store.sectionOrder.value, ...SECTIONS.filter((s) => !store.sectionOrder.value.includes(s))];
  return {
    total: singing.length,
    guests: concertDraft.guests.length,
    sections: order.filter((s) => by[s]).map((s) => ({ section: s, count: by[s] }))
  };
});
const atConcertLimit = computed(() => draftCounts.value.total >= LIMITS.singers);
function addGuest() {
  const taken = new Set(concertDraft.guests.map((g) => g.name));
  let n = 1, name;
  do {
    name = 'Guest ' + n++;
  } while (taken.has(name));
  // Off the library's counter, so a guest removed, saved or not, cannot hand their id — and with
  // it their chairs and categories — to somebody new.
  const id = store.mint(store.ID.guest);
  concertDraft.guests.push({ id, name, section: SECTIONS[0] });
}
function renameGuest(row, e) {
  const name = e.target.value.trim();
  const taken = [...concertDraft.guests.filter((g) => g !== row), ...(store.openRoster.value ? store.openRoster.value.singers : [])].some((q) => q.name === name);
  if (!name || !isSinger(name) || taken) {
    if (name) alert(isSinger(name) ? 'Somebody in this concert or its roster already has that name.' : 'That name is reserved for empty/blocked seats. Pick another.');
    e.target.value = row.name;
    return;
  }
  row.name = name;
}
function removeGuest(row) {
  concertDraft.guests = concertDraft.guests.filter((g) => g.id !== row.id);
}
// A guest who joins the choir. The concert is saved first if it has changes, since the move
// works on the saved concert and its seating plans.
function moveGuest(row) {
  presetUI.error = '';
  presetUI.note = '';
  const rosterName = store.openRosterName.value;
  const roster = store.openRoster.value;
  if (roster && roster.singers.length >= LIMITS.singers) {
    presetUI.error = `"${rosterName}" already has the maximum of ${LIMITS.singers} singers.`;
    return;
  }
  guardLayer('concert', () => {
    const guest = store.concert.value.guests.find((g) => g.id === row.id);
    if (!guest) return;
    if (roster && roster.singers.some((p) => p.name === guest.name)) {
      presetUI.error = `"${rosterName}" already has a singer called ${guest.name}. Rename the guest first.`;
      return;
    }
    askConfirm(
      `Add ${guest.name} to the roster "${rosterName}"? They stay in this concert with their seats and parts, and can then be ticked into other concerts over "${rosterName}".`,
      'Move to roster',
      () => {
        if (!store.moveGuestToChoir(guest.id)) {
          presetUI.error = "That guest couldn't be moved.";
          return;
        }
        loadConcertDraft();
        loadAssignDraft();
        loadRosterDraft(rosterDraft.id);
        finishPreset(`${guest.name} is now on the roster "${rosterName}".`);
      }
    );
  }, 'Save them before moving the guest?');
}
function toggleMember(row, e) {
  if (e.target.checked && atConcertLimit.value) {
    e.target.checked = false;
    presetUI.error = `A concert can have at most ${LIMITS.singers} singers.`;
    return;
  }
  concertDraft.members = e.target.checked ? [...concertDraft.members, row.id] : concertDraft.members.filter((id) => id !== row.id);
}
// Up to the singer limit, which a restore holds every concert to.
function tickAllIn() {
  const room = Math.max(0, LIMITS.singers - draftCounts.value.total);
  concertDraft.members = [...concertDraft.members, ...memberRows.value.filter((r) => !r.in).slice(0, room).map((r) => r.id)];
}
const atSplitLimit = computed(() => concertDraft.splits.length >= LIMITS.splits);
function renameSplit(si, e) {
  const name = e.target.value.trim();
  if (!name) {
    e.target.value = concertDraft.splits[si].name;
    return;
  }
  concertDraft.splits[si].name = name;
}
// A split or category that goes takes its answers with it, so the draft holds no category the
// splits no longer offer.
function dropAnswers(splitId, keep = null) {
  for (const row of Object.values(concertDraft.assign)) if (splitId in row && (!keep || !keep(row[splitId]))) delete row[splitId];
}
function deleteSplit(si) {
  dropAnswers(concertDraft.splits[si].id);
  concertDraft.splits.splice(si, 1);
}
function addCat(si) {
  const s = concertDraft.splits[si];
  if (s.cats.length < LIMITS.cats) s.cats.push(store.uniqueCat(s));
}
function deleteCat(si, ci) {
  const s = concertDraft.splits[si];
  if (s.cats.length <= 1) return;
  const gone = s.cats[ci];
  s.cats.splice(ci, 1);
  dropAnswers(s.id, (v) => v !== gone);
}
function renameCat(si, ci, e) {
  const s = concertDraft.splits[si], old = s.cats[ci], val = e.target.value.trim();
  if (!val || val === old) {
    e.target.value = old;
    return;
  }
  if (s.cats.some((c, k) => k !== ci && c === val)) {
    alert('That part already exists in this split.');
    e.target.value = old;
    return;
  }
  s.cats[ci] = val;
  for (const row of Object.values(concertDraft.assign)) if (row[s.id] === old) row[s.id] = val;
}
function addSplit() {
  if (atSplitLimit.value) return;
  const n = concertDraft.splits.length + 1;
  concertDraft.splits.push({ id: store.newSplitId(), name: 'New split ' + n, cats: ['A', 'B'] });
}
const draftOf = () => ({ members: concertDraft.members.slice(), guests: concertDraft.guests, splits: concertDraft.splits, assign: concertDraft.assign });
function commitConcertDraft() {
  if (!store.commitConcert(draftOf())) {
    presetUI.error = "That concert can't be saved.";
    return false;
  }
  loadConcertDraft();
  loadAssignDraft();
  return true;
}
// Save asks first only when somebody ticked out is sitting in the plan on stage, because saving
// empties their chair there.
function saveConcert() {
  presetUI.error = '';
  presetUI.note = '';
  const name = store.openConcertName.value;
  const on = new Set([...concertDraft.members, ...concertDraft.guests.map((g) => g.id)]);
  const seated = store.seats.value.filter((id) => isSinger(id) && !on.has(id));
  const done = () => commitConcertDraft() && finishPreset(`Saved "${name}".`);
  if (!seated.length) {
    done();
    return;
  }
  const who = seated.map((id) => store.byId.value[id]?.name).filter(Boolean);
  const list = who.length <= 3 ? who.join(', ') : `${who.slice(0, 3).join(', ')} and ${who.length - 3} more`;
  askConfirm(`Save "${name}"? ${list} ${who.length === 1 ? 'is' : 'are'} no longer singing and will lose ${who.length === 1 ? 'their seat' : 'their seats'} in "${store.openArrangementName.value}".`, 'Save', done);
}

/* ---------- Splits tab ---------- */
// Everyone singing, in the same order as the Concert tab's lists: the members, then the guests.
const splitRows = computed(() => {
  const by = new Map(store.data.value.map((p) => [p.id, p]));
  const r = store.openRoster.value;
  if (!r) return [];
  return [...ordered(r.id, r.singers).filter((p) => by.has(p.id)), ...store.data.value.filter((p) => p.guest)];
});
const splitGuests = computed(() => splitRows.value.filter((p) => p.guest).length);
// Per section, how many sing and how they divide in each split, from the draft's categories.
const balance = computed(() => {
  const splits = store.splits.value;
  const blank = () => Object.fromEntries(splits.map((s) => [s.id, Object.fromEntries(s.cats.map((c) => [c, 0]))]));
  const rows = new Map();
  const total = { count: 0, cats: blank() };
  for (const p of splitRows.value) {
    if (!rows.has(p.section)) rows.set(p.section, { section: p.section, count: 0, cats: blank() });
    const b = rows.get(p.section);
    b.count++;
    total.count++;
    for (const s of splits) {
      const c = catOf(p.id, s.id);
      b.cats[s.id][c]++;
      total.cats[s.id][c]++;
    }
  }
  const order = [...store.sectionOrder.value, ...SECTIONS.filter((s) => !store.sectionOrder.value.includes(s))];
  return { rows: order.filter((s) => rows.has(s)).map((s) => rows.get(s)), total };
});
// A missing or stale answer reads as the split's first category, as it does on the stage.
function catOf(singerId, splitId) {
  const v = (assignDraft.value[singerId] || {})[splitId];
  const opts = store.SPLIT_OPTIONS.value[splitId] || [];
  return opts.includes(v) ? v : opts[0];
}
function editCategory(singerId, splitId, e) {
  assignDraft.value = { ...assignDraft.value, [singerId]: { ...(assignDraft.value[singerId] || {}), [splitId]: e.target.value } };
}
function commitAssignDraft() {
  if (!store.commitConcert({ assign: assignDraft.value })) {
    presetUI.error = "Those splits can't be saved.";
    return false;
  }
  loadConcertDraft();
  loadAssignDraft();
  return true;
}
function saveAssign() {
  presetUI.error = '';
  if (commitAssignDraft()) finishPreset('Saved the splits.');
}

/* ---------- Settings: colours ----------
   One row per voice part, in SATB order; a column for the section colour and one per split
   category position this concert's splits reach. Every value is what is actually drawn: the
   draft's overrides resolved against the defaults. The panel edits a draft of the active scheme,
   as the Roster tab edits a draft of a roster: the stage keeps the saved colours until Save. */
const colourDraft = ref({ colours: {}, splitColours: {} });
const colourBase = ref('');
const colourDirty = computed(() => snap(colourDraft.value) !== colourBase.value);
// The scheme chosen in the picker, which Load makes active. Follows the active scheme.
const pickedSchemeId = ref('');
const pickedSchemeOther = computed(() => pickedSchemeId.value !== store.palettes.value.active);
const pickedScheme = computed(() => store.palettes.value.schemes.find((x) => x.id === pickedSchemeId.value) || null);
function loadColourDraft() {
  const s = activeScheme(store.palettes.value);
  colourDraft.value = JSON.parse(JSON.stringify({ colours: s.colours, splitColours: s.splitColours }));
  colourBase.value = snap(colourDraft.value);
  pickedSchemeId.value = s.id;
}
function commitColourDraft() {
  store.saveSchemeColours(store.palettes.value.active, colourDraft.value);
  loadColourDraft();
  return true;
}
// A restore or Clear everything replaces the whole block; the scheme being edited may be gone.
watch(() => store.palettes.value, loadColourDraft);

const draftSectionColours = computed(() => resolveSectionColours(colourDraft.value.colours));
const draftSplitFrames = computed(() => resolveSplitFrames(draftSectionColours.value, colourDraft.value.splitColours));
// Every position a split can reach, not just the ones this concert's splits use: the scheme is
// global, so it colours splits that other concerts, and later ones, have. The names of the
// categories this concert puts at each position ride along as a tooltip.
const framePositions = computed(() => {
  const used = splitCatPositions(store.splits.value);
  return Array.from({ length: LIMITS.cats }, (_, pos) => ({ pos, names: used[pos] ? used[pos].names : [] }));
});
const colourRows = computed(() =>
  SECTIONS.map((section) => {
    const hex = draftSectionColours.value[section];
    return {
      section,
      hex,
      fill: tint(hex),
      plain: bolden(hex),
      frames: framePositions.value.map((p) => ({ pos: p.pos, frame: draftSplitFrames.value[section][p.pos] })),
      custom: hasCustomColours(colourDraft.value, section)
    };
  })
);
const anyCustomColour = computed(() => hasCustomColours(colourDraft.value));
// The preview's seats: four parts each, as many as the split frames need.
const previewGroups = Array.from({ length: Math.ceil(LIMITS.cats / 4) }, (_, i) => ({ from: i * 4 }));
function quarters(cells) {
  const c = [0, 1, 2, 3].map((i) => (cells[i] ? cells[i].frame : 'transparent'));
  return `conic-gradient(from -90deg, ${c[0]} 0 25%, ${c[1]} 0 50%, ${c[2]} 0 75%, ${c[3]} 0)`;
}
const activeSchemeName = computed(() => activeScheme(store.palettes.value).name);
// A row's Reset puts the section AND its frames back, so no section is left half on the defaults.
function resetSection(section) {
  colourDraft.value = withoutSectionSplitColours(withoutSectionColour(colourDraft.value, section), section);
}
function resetAllColours() {
  colourDraft.value = { colours: {}, splitColours: {} };
}
// `input` rather than `change`, so the previews follow the OS colour picker while it is open.
function onColour(section, e) {
  colourDraft.value = withSectionColour(colourDraft.value, section, e.target.value);
}
function onSplitColour(section, pos, e) {
  colourDraft.value = withSplitColour(colourDraft.value, section, pos, e.target.value);
}
function loadScheme() {
  presetUI.error = '';
  presetUI.note = '';
  const id = pickedSchemeId.value;
  guardLayer('settings', () => {
    store.selectScheme(id);
    loadColourDraft();
    finishPreset(`Loaded "${activeSchemeName.value}".`);
  }, 'Load the other colour scheme and lose them?');
}
function saveScheme() {
  presetUI.error = '';
  presetUI.note = '';
  const name = activeSchemeName.value;
  commitColourDraft();
  finishPreset(`Saved "${name}".`);
}
function delScheme() {
  const { id, name } = pickedScheme.value;
  askConfirm(`Delete the colour scheme "${name}"?`, 'Delete', () => {
    const wasActive = id === store.palettes.value.active;
    if (store.deleteScheme(id)) {
      // Deleting another scheme leaves the colours being edited alone.
      if (wasActive) loadColourDraft();
      else pickedSchemeId.value = store.palettes.value.active;
      finishPreset(`Deleted "${name}".`);
    }
  }, true);
}

/* ---------- Settings: seat labelling and the viewpoint ----------
   Every control lists its DEFAULT first. The values are the ones utils/labels.js declares;
   store.setLabel refuses anything else. */
const VIEWPOINT_OPTIONS = [
  { value: 'bottom', label: 'Below' },
  { value: 'top', label: 'Above' }
];
const LABEL_CONTROLS = [
  { field: 'rowLabel', label: 'Row labelling', options: [{ value: 'letters', label: 'Letters' }, { value: 'numbers', label: 'Numbers' }] },
  { field: 'rowFirst', label: 'First row', options: [{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }] },
  { field: 'colLabel', label: 'Column labelling', options: [{ value: 'numbers', label: 'Numbers' }, { value: 'letters', label: 'Letters' }] },
  { field: 'colOrder', label: 'Column order', options: [{ value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }] }
];
const startLabel = computed(() => startSeatLabel(SAMPLE_ROWS, SAMPLE_COLS, store.labels, store.audienceAt.value));

/* ---------- the inline name form and confirm ---------- */
// `targetId` is the roster, concert or scheme a Rename applies to: the one chosen in its picker.
const presetUI = reactive({ mode: 'idle', name: '', targetId: '', rosterId: '', error: '', note: '', confirm: null });
const presetInput = ref(null);
const presetInline = ref(null);
const presetMsg = ref(null);
const busyUI = computed(() => presetUI.mode !== 'idle');
const NAMING = {
  create: { placeholder: 'Name your new concert', submit: 'Create' },
  rename: { placeholder: 'New concert name', submit: 'Rename' },
  saveconcertas: { placeholder: 'Name the new concert', submit: 'Save' },
  newroster: { placeholder: 'Name your new roster', submit: 'Create' },
  saverosteras: { placeholder: 'Name the new roster', submit: 'Save' },
  renameroster: { placeholder: 'New roster name', submit: 'Rename' },
  newscheme: { placeholder: 'Name your new colour scheme', submit: 'Create' },
  saveasscheme: { placeholder: 'Name the copy', submit: 'Save' },
  renamescheme: { placeholder: 'New colour scheme name', submit: 'Rename' }
};
const namingModes = Object.keys(NAMING);
const namePlaceholder = computed(() => NAMING[presetUI.mode]?.placeholder || '');
const submitLabel = computed(() => NAMING[presetUI.mode]?.submit || 'OK');
// The form sits at the top of a body that scrolls; on a phone it can render off-screen while
// every button goes disabled, so anything newly shown is pulled into view.
function reveal(el) {
  nextTick(() => el.value && el.value.scrollIntoView({ block: 'nearest' }));
}
watch(() => presetUI.mode, (m) => {
  if (m === 'idle') return;
  reveal(presetInline);
  if (m !== 'confirm') nextTick(() => presetInput.value && presetInput.value.focus());
});
watch(() => presetUI.error, (v) => {
  if (v) reveal(presetMsg);
});
function cancelPreset() {
  presetUI.mode = 'idle';
  presetUI.name = '';
  presetUI.rosterId = '';
  presetUI.error = '';
  presetUI.confirm = null;
}
function finishPreset(note) {
  cancelPreset();
  presetUI.note = note;
}
function startNaming(mode, name = '', targetId = '') {
  presetUI.name = name;
  presetUI.targetId = targetId;
  presetUI.error = '';
  presetUI.note = '';
  presetUI.mode = mode;
}
function startCreate() {
  // Defaults to the roster already open: "another concert for this choir" is the common case.
  startNaming('create');
  presetUI.rosterId = store.openRoster.value ? store.openRoster.value.id : '';
}
// A question with its own buttons; Cancel is always added after them.
function askChoice(text, actions) {
  presetUI.error = '';
  presetUI.note = '';
  presetUI.confirm = { text, actions };
  presetUI.mode = 'confirm';
}
function askConfirm(text, ok, run, danger = false) {
  askChoice(text, [{ label: ok, kind: danger ? 'danger' : 'primary', run }]);
}
function doAction(a) {
  presetUI.mode = 'idle';
  presetUI.confirm = null;
  a.run();
}
function submitName() {
  const mode = presetUI.mode;
  const name = presetUI.name.trim();
  if (!name) {
    presetUI.error = 'Enter a name.';
    return;
  }
  switch (mode) {
    case 'newroster':
    case 'saverosteras': {
      // Save as takes the draft on screen, unsaved edits and all, and the roster it came from is
      // left as it was saved.
      const r = store.addRoster(name, mode === 'saverosteras' ? rosterDraft.singers : []);
      loadRosterDraft(r.id);
      return finishPreset(mode === 'saverosteras' ? `Saved as the roster "${name}".` : `Created the roster "${name}".`);
    }
    case 'renameroster':
      store.renameRoster(presetUI.targetId, name);
      return finishPreset(`Renamed to "${name}".`);
    case 'newscheme':
    case 'saveasscheme':
    case 'renamescheme': {
      const problem = store.schemeNameProblem(name, mode === 'renamescheme' ? presetUI.targetId : null);
      if (problem) {
        presetUI.error = problem;
        return;
      }
      // Save as takes the draft on screen, unsaved edits and all, and the scheme it came from is
      // left as it was saved.
      if (mode === 'renamescheme') store.renameScheme(presetUI.targetId, name);
      else {
        store.addScheme(name, mode === 'saveasscheme' ? colourDraft.value : null);
        loadColourDraft();
      }
      return finishPreset(mode === 'renamescheme' ? `Renamed to "${name}".` : `Created the colour scheme "${name}".`);
    }
  }
  // concerts: two may not share a name, because the picker and the export filenames address them by it
  const problem = store.concertNameProblem(name, mode === 'rename' ? presetUI.targetId : null);
  if (problem) {
    presetUI.error = problem;
    return;
  }
  if (mode === 'rename') {
    store.renameConcert(presetUI.targetId, name);
    return finishPreset(`Renamed to "${name}".`);
  }
  if (mode === 'saveconcertas') {
    // The concert draft and the plan on stage both travel into the copy; the original keeps
    // what it had saved.
    const draft = concertDirty.value ? draftOf() : null;
    cancelPreset();
    store.saveConcertAs(name, draft, () => finishPreset(`Saved as "${name}", which is now open.`));
    return;
  }
  // A new concert takes the default 2-way split and one plan, which is seated when it opens.
  // Over an existing roster everyone starts ticked in (rule 3).
  const picked = presetUI.rosterId;
  const over = store.rosterOptions.value.find((r) => r.id === picked);
  replacingStage('Create the new concert and lose them?', () => {
    const c = store.addConcert(name, { rosterId: picked || null });
    store.openArrangementById(c.id, c.arrangements[0].id);
    finishPreset(
      over
        ? `Created "${name}" with all ${over.singers} singers from ${over.name}. Untick anyone sitting it out.`
        : `Created "${name}". Add its singers on the Roster tab, or import a spreadsheet there.`
    );
  });
}

/*
 * Unsaved changes to the plan on stage. Anything here that replaces the stage goes through
 * this: opening another concert, and creating one. (Switching plans is PlanBar's, which asks the
 * same question.) A plan with nothing unsaved just goes; otherwise it offers "Save, then open", the
 * action itself, and Cancel.
 */
function replacingStage(what, run) {
  if (!dirty.value) {
    run();
    return;
  }
  const actions = [
    { label: 'Save, then open', kind: 'primary', run: () => (store.saveArrangement(), run()) },
    { label: 'Open anyway', kind: 'primary', run }
  ];
  askChoice(`"${store.openArrangementName.value}" has seating changes you have not saved. ${what}`, actions);
}
/*
 * A stored seating plan may seat somebody the concert no longer has. Opening it
 * would empty their chair silently, so the people are NAMED first, with Cancel and "Remove them
 * and open" — which writes the removal into the stored plan so it opens clean.
 */
function openingArrangement(concertId, arrangementId, run) {
  const stale = store.staleForOpen(concertId, arrangementId);
  if (!stale.length) {
    run();
    return;
  }
  const names = stale.map((p) => p.name);
  const who = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const gone = stale.some((p) => !p.inRoster);
  askConfirm(
    `That seating plan seats ${who}, who ${names.length === 1 ? 'is' : 'are'} not singing this concert. ` +
      (gone ? 'Some of them are no longer on the roster. ' : 'Tick them back in to keep their seats. ') +
      'Opening it empties their seats.',
    'Remove them and open',
    () => {
      store.dropStale(concertId, arrangementId);
      run();
    },
    true
  );
}
// Load: the concert draft is asked about first, then the seating plan on stage, then any stale
// seats in the plan being opened.
function loadConcert() {
  const id = pickedConcertId.value;
  presetUI.error = '';
  presetUI.note = '';
  if (id === store.openConcertId.value) return;
  const name = store.concertOptions.value.find((c) => c.id === id)?.name || 'the concert';
  guardLayer('concert', () =>
    replacingStage('Load the other concert and lose them?', () =>
      openingArrangement(id, '', () => {
        if (!store.openArrangementById(id, '', () => finishPreset(`Loaded "${name}".`))) presetUI.error = 'That concert is no longer available.';
      })
    ), 'Load the other concert and lose them?');
}
function delConcert() {
  const { id, name, arrangements } = pickedConcertOwn.value;
  const plans = arrangements.length === 1 ? 'its seating plan' : `all ${arrangements.length} of its seating plans`;
  askConfirm(
    `Delete the concert "${name}" and ${plans}? Its roster is kept. This can't be undone.`,
    'Delete',
    () => {
      store.deleteConcert(id);
      pickedConcertId.value = store.openConcertId.value;
      finishPreset(`Deleted "${name}".`);
    },
    true
  );
}
function onClearAll() {
  if (!confirm('Delete every roster, concert and seating plan and start again from the example choir? Your colour schemes are kept.')) return;
  store.clearAll();
}

/* ---------- import / restore, reported in the page ----------
   Every message on this path is one of the two overlays at the bottom of the template rather
   than an alert(): a 200-row skipped list in an alert() is unscrollable and truncated. */
const importUI = reactive({ open: false, kind: 'concert', stage: 'intro', columns: [], found: 0, rows: null, result: {}, unsaved: false, nameError: { roster: '', concert: '' } });
const msgUI = reactive({ open: false, title: '', tone: 'info', text: '' });
function showMessage(title, text, tone) {
  msgUI.title = title;
  msgUI.text = text;
  msgUI.tone = tone;
  msgUI.open = true;
}
function showImportError(error) {
  importUI.rows = null;
  importUI.columns = [];
  importUI.result = { ok: false, error };
  importUI.stage = 'result';
  importUI.open = true;
}
// The dialog opens on what the file has to look like, and the file is chosen from there.
// `kind` is the tab's: 'roster' reads names and sections, 'concert' the splits as well.
function openImport(kind) {
  importUI.kind = kind;
  importUI.stage = 'intro';
  importUI.rows = null;
  importUI.columns = [];
  importUI.result = {};
  importUI.open = true;
}
function pickImportFile() {
  store.pickSpreadsheet(async (buffer) => {
    const read = await store.readSpreadsheet(buffer);
    if (!read.ok) {
      showImportError(read.error);
      return;
    }
    // Nothing has been touched yet: the next screen is the confirm. A concert import only ever
    // ADDS a concert, so the one thing it can lose is unsaved work on stage.
    importUI.rows = read.rows;
    importUI.columns = read.columns;
    importUI.found = read.found;
    importUI.result = {};
    importUI.unsaved = dirty.value;
    importUI.nameError = { roster: '', concert: '' };
    importUI.stage = importUI.kind === 'roster' ? 'roster' : 'columns';
    importUI.open = true;
  });
}
function runImport(choice) {
  if (importUI.kind === 'roster') return runRosterImport(choice);
  const { picked, names } = choice;
  // Rosters may share a name (nothing addresses one by it); concerts may not.
  importUI.nameError = { roster: names.roster ? '' : 'Enter a name.', concert: store.concertNameProblem(names.concert) || '' };
  if (importUI.nameError.roster || importUI.nameError.concert) return;
  importUI.result = store.importAsConcert(importUI.rows, picked, names);
  importUI.stage = 'result';
  if (importUI.result.ok && store.openRoster.value) loadRosterDraft(store.openRoster.value.id);
}
// A new roster is saved at once and loaded. A replace is only loaded, as the Roster tab's
// unsaved draft: the user sees the result, and Save names the concerts anybody leaves.
function runRosterImport(choice) {
  if (choice.mode === 'new') {
    importUI.result = store.importAsRoster(importUI.rows, choice.name);
    if (importUI.result.ok) loadRosterDraft(importUI.result.rosterId);
  } else {
    const res = store.rosterReplacement(importUI.rows, choice.rosterId);
    if (res.ok) {
      loadRosterDraft(res.rosterId);
      rosterDraft.singers = res.singers.map((p) => ({ ...p }));
      orderCache.delete('draft:' + rosterDraft.id);
    }
    importUI.result = res;
  }
  importUI.stage = 'result';
}
function onRestore() {
  store.pickFile('.json,application/json', (text) => {
    const hasSomething = store.library.value.rosters.length || store.library.value.concerts.length;
    if (hasSomething && !confirm('Restore this backup?\n\nIt replaces everything this tool holds — every roster, concert, seating plan and colour scheme.')) return;
    const res = store.restoreJSON(text);
    if (!res.ok) {
      showMessage("That backup couldn't be restored", res.error, 'error');
      return;
    }
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    showMessage('Backup restored', `Restored ${plural(res.concerts, 'concert')} and ${plural(res.imported, 'singer')}.`, 'ok');
  });
}
</script>

<style scoped>
.rosterdialog {
  /* re-centre: Tailwind Preflight resets the UA `margin: auto` that centres a modal <dialog> */
  margin: auto;
  width: min(1100px, 94vw);
  max-width: 94vw;
  max-height: 90vh;
  max-height: 90dvh;
  padding: 0;
  border: 1px solid #d3d9e0;
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  color: #1d2330;
  background: #fff;
  /* head and tabs are fixed; only the body scrolls, on every tab */
  display: flex;
  flex-direction: column;
}
.rosterdialog:not([open]) {
  display: none;
}
.rosterdialog::backdrop {
  background: rgba(20, 25, 40, 0.42);
  backdrop-filter: blur(1px);
}
.rosterdialog-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e6ec;
  background: #fafbfc;
}
.rosterdialog-head h2 {
  font-size: 16px;
  margin: 0;
  /* min-width:0 is what makes the ellipsis work at all. A flex item's automatic minimum
     size is its min-content width, which for white-space:nowrap is the whole string, so
     without this the title refuses to shrink and pushes the count and the Close button
     out past the clipped edge of the dialog. Preset names have no length cap. */
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head-count {
  font-size: 12px;
  color: #5a6573;
  flex: none;
}
.rosterclose {
  margin-left: auto;
  flex: none;
  font-weight: 600;
}
button:disabled,
.autobtn:disabled {
  opacity: 0.45;
  cursor: default;
}
/* ---------- tab strip ---------- */
.rostertabs {
  flex: none;
  display: flex;
  gap: 4px;
  /* a little air above the tabs so they don't sit flush against the header's rule */
  padding: 6px 12px 0;
  background: #fafbfc;
  /* The strip's bottom rule is an inset shadow, not a border, and the tabs sit flush on it
     rather than overlapping it with a -1px margin. That overlap put the tab 1px outside the
     strip's content box, which counts as scrollable overflow, and because overflow-x:auto
     forces overflow-y to auto too, it grew a vertical scrollbar. The active tab's white
     bottom border still paints over the rule (children draw above the strip's own shadow). */
  box-shadow: inset 0 -1px 0 #e2e6ec;
  overflow-x: auto;
  overflow-y: hidden;
}
.rostertab {
  flex: none;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #5a6573;
  background: transparent;
}
.rostertab:hover:not(.on) {
  color: #2f4368;
  background: #eef1f5;
}
.rostertab.on {
  color: #2f4368;
  background: #fff;
  border-color: #e2e6ec;
  border-bottom: 1px solid #fff;
}
.rosterbody {
  flex: 1 1 auto;
  min-height: 0;
  padding: 14px 16px 18px;
  overflow: auto;
}
.rosterwrap {
  background: transparent;
}
/* ---------- the one panel ----------
   Every block on every tab is one of these: concerts, singers, import/export, splits, and each
   setting. One border, one heading, one row of controls, so the dialog reads as a stack of
   equals rather than a table with two differently-dressed boxes bolted underneath it. */
.panel {
  border: 1px solid #e2e6ec;
  border-radius: 8px;
  padding: 10px 12px 12px;
  margin-bottom: 14px;
  background: #fafbfc;
  font-size: 13px;
}
.panel:last-child {
  margin-bottom: 0;
}
.panel-head {
  font-size: 13px;
  margin-bottom: 10px;
}
.panel-head .hint,
.colsub .hint {
  margin-left: 0.5em;
  color: #5a6573;
  font-size: 12px;
  font-weight: 400;
}
/* the single control row shape: concert buttons, add/clear, import/export, backup/restore */
.ctlrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ctlrow + .ctlrow {
  margin-top: 8px;
}
/* New… | picker, Load, Save, Save as… | Rename, Delete: a wider gap opens each group */
.ctlrow .grpstart {
  margin-left: 8px;
}
.ctlrow .hint {
  color: #5a6573;
  font-size: 12px;
}
/* a tab with unsaved changes */
.dirtydot {
  margin-left: 4px;
  color: #c2410c;
}
.splitsave {
  margin-bottom: 10px;
}
/* the inline name form / confirm / messages, above the tab's own panels */
.noticepanel {
  background: #fff;
  border-color: #c4ccd6;
}
.noticepanel .presetinline {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
/* the standing explanation of what each file actually contains — deliberately on the panel and
   not only in a tooltip, because confusing an export with a backup is how people lose plans */
.ionote {
  margin: 10px 0 0;
  color: #5a6573;
  font-size: 12px;
  line-height: 1.45;
}
.ionote b {
  color: #1d2330;
  font-weight: 600;
}
.ionote + .ionote {
  margin-top: 6px;
}
/* the body of the shared message modal (restore result), which holds one sentence */
.msgtext {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
}
.emptynote {
  color: #5a6573;
  font-size: 13px;
  line-height: 1.5;
  padding: 6px 0;
}
/* The second row's label, so the two pickers read as a hierarchy — a concert, then one of its
   seating plans — rather than as two unrelated dropdowns. */
.planlabel {
  font-size: 12px;
  font-weight: 600;
  color: #5a6573;
  align-self: center;
}
.presetsel {
  height: 36px;
  /* A <select> at width:auto sizes to its widest option, so the box follows the longest
     concert name instead of the 220px that was picked to fit the old footer strip. The cap
     stops one long name from pushing the buttons onto a line of their own; the floor keeps
     the placeholder from collapsing when there is nothing saved yet. */
  flex: 0 1 auto;
  width: auto;
  min-width: 200px;
  max-width: min(100%, 420px);
  text-overflow: ellipsis;
  padding: 0 10px;
  font-size: 13px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #fff;
  color: #1d2330;
}
.pbtn {
  height: 36px;
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
}
.pbtn:hover:not(:disabled) {
  background: #e3e8ef;
}
.pbtn:disabled {
  opacity: 0.45;
  cursor: default;
}
.pbtn-primary {
  background: #2f4368;
  border-color: #2f4368;
  color: #fff;
}
.pbtn-primary:hover:not(:disabled) {
  background: #26354f;
}
.pbtn-danger {
  background: #fbecea;
  border-color: #e0b4ae;
  color: #b4231a;
}
.pbtn-danger:hover:not(:disabled) {
  background: #f7ddd9;
}
.pbtn-danger-solid {
  background: #b4231a;
  border-color: #b4231a;
  color: #fff;
}
.pbtn-danger-solid:hover:not(:disabled) {
  background: #9c1d15;
}
.presetinline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #d3d9e0;
}
.presetinput {
  height: 36px;
  flex: 1 1 240px;
  min-width: 200px;
  max-width: 360px;
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
}
.presetinput:focus {
  outline: none;
  border-color: #2f4368;
  box-shadow: 0 0 0 3px rgba(47, 67, 104, 0.18);
}
.presetconfirmtext {
  flex: 1 1 auto;
  font-size: 13px;
  color: #1d2330;
}
.presetmsg {
  margin: 9px 0 0;
  font-size: 12.5px;
}
/* the gap separates a message from the form or question above it; alone in the panel it would
   only push the text off centre */
.presetmsg:first-child {
  margin-top: 0;
}
.presetmsg-err {
  color: #b4231a;
}
.presetmsg-ok {
  color: #2b7a3e;
}
/* the add/clear row sits under the table it acts on, so it gets a little air above it */
.addrow {
  margin-top: 12px;
}
select,
button {
  font-size: 14px;
  padding: 6px 10px;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #fff;
  color: #1d2330;
}
button {
  cursor: pointer;
}
.autobtn {
  font-size: 12px;
  padding: 3px 8px;
  background: #eef1f5;
  color: #2f4368;
  border-color: #c4ccd6;
  font-weight: 600;
}
.rosterscroll {
  overflow-x: auto;
  max-width: 100%;
}
.subhead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 16px 0 6px;
  padding-top: 12px;
  border-top: 1px solid #eef1f5;
  font-size: 13px;
}
.guesttag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #6a4a00;
  background: #fbefd0;
  vertical-align: 1px;
}
.guestacts {
  white-space: nowrap;
}
.guestacts .delrow {
  margin-left: 6px;
}
.sectioncounts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #eef1f5;
  font-size: 13px;
  font-weight: 600;
  color: #36404f;
}
.countchip {
  display: inline-flex;
  align-items: center;
}
.countchip .orderdot {
  margin-right: 6px;
}
.counttotal {
  font-weight: 500;
  color: #5a6573;
}
.panel-head + .sectioncounts {
  margin-top: 4px;
  padding-top: 0;
  border-top: none;
}
.balance {
  margin-top: 14px;
}
.balancetable .num {
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.balancetable .splitgroup {
  text-align: center;
  border-left: 1px solid #e2e6ec;
}
.balancetable .splitstart {
  border-left: 1px solid #e2e6ec;
}
.balancetable td.zero {
  color: #b8bfc9;
}
.balancetable .totalrow td {
  font-weight: 700;
  border-top: 2px solid #e2e6ec;
}
.concertlist {
  margin: 4px 0 0;
  padding-left: 20px;
  list-style: disc;
}
table.roster {
  width: auto;
  border-collapse: collapse;
  font-size: 13px;
}
table.roster th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #5a6573;
  padding: 4px 8px;
  border-bottom: 2px solid #e2e6ec;
}
table.roster td {
  padding: 3px 8px;
  border-bottom: 1px solid #eef1f5;
}
/* the Splits tab renders Name and Section as text: same rows, one editable half */
table.roster td.rread {
  color: #3b4657;
  white-space: nowrap;
  padding-top: 6px;
  padding-bottom: 6px;
}
table.roster td.rread-name {
  font-weight: 600;
  color: #1d2330;
}
table.roster td.rread .orderdot {
  margin-right: 6px;
  vertical-align: -1px;
}
table.roster input.rname {
  width: 220px;
  font: inherit;
  padding: 3px 6px;
  border: 1px solid #c4ccd6;
  border-radius: 5px;
}
table.roster select.rfield {
  font: inherit;
  padding: 3px 4px;
  border: 1px solid #c4ccd6;
  border-radius: 5px;
  background: #fff;
}
/* ---------- the membership tick ---------- */
/* Narrow, centred, and first: it is a column of one-character answers, not a field. */
table.roster th.inhead,
table.roster td.incell {
  width: 32px;
  text-align: center;
  padding-left: 4px;
  padding-right: 4px;
}
table.roster input.intick {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #2f4368;
  cursor: pointer;
}
/* Somebody in the choir but not in this concert. Dimmed rather than hidden, because the row is
   still editable — their name and section are facts about the person — and because hiding them
   is how a roster silently loses people. Not opacity: that would fade the tick they need to
   click to come back. */
table.roster tr.rowout td.rread,
table.roster tr.rowout input.rname,
table.roster tr.rowout select.rfield {
  color: #97a1b0;
}
table.roster tr.rowout input.rname,
table.roster tr.rowout select.rfield {
  background: #f7f8fa;
}
/* the roster picker heads the Who is singing panel, above the table it fills */
.ctlrow.rosterrow {
  margin-bottom: 12px;
}
table.roster .delrow {
  border: 1px solid #e0b4ae;
  background: #fbecea;
  color: #b4231a;
  border-radius: 5px;
  width: 24px;
  height: 24px;
  line-height: 1;
  font-size: 15px;
  padding: 0;
}
/* ---------- settings ---------- */
.orderdot {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  flex: none;
  display: inline-block;
}
/* The native control, sized down to a swatch. Chromium and Firefox both draw their own chrome
   inside it, hence the zeroed padding: without it the colour sits in a thick grey frame that
   reads as a disabled button. */
.colpick {
  flex: none;
  width: 40px;
  height: 28px;
  padding: 0;
  border: 1px solid #c4ccd6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.colname {
  font-weight: 700;
  font-size: 12px;
  min-width: 62px;
  cursor: pointer;
}
/* a seat cell, at the size the real grid draws one: same 3px border, same radius, same text
   colour, so the preview is a sample and not an impression of one */
.colseat {
  flex: none;
  box-sizing: border-box;
  width: 72px;
  padding: 4px 6px;
  border: 3px solid transparent;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 500;
  color: #11203a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.07);
}
.colsub {
  margin: 16px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: #36404f;
}
.seccols {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.seccol {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e2e6ec;
  border-radius: 7px;
  padding: 6px 10px;
  background: #fff;
}
/* The preview seat: a conic gradient behind an inset fill makes a frame of four colours. Drawn
   larger than a real seat, with a thicker frame, so each quarter reads. */
.qseat {
  display: inline-block;
  padding: 5px;
  border-radius: 9px;
}
.qfill {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 118px;
  height: 46px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  color: #11203a;
}
.qn {
  position: absolute;
  font-style: normal;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  color: #5a6573;
}
.qn.tl { top: 4px; left: 5px; }
.qn.tr { top: 4px; right: 5px; }
.qn.br { bottom: 4px; right: 5px; }
.qn.bl { bottom: 4px; left: 5px; }
/* The colour tables: a row per section, a column per split category or preview seat. */
.coltable-wrap {
  overflow-x: auto;
  margin-top: 10px;
}
.coltable {
  border-collapse: collapse;
}
.coltable th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: #5a6573;
  padding: 4px 10px 6px 0;
  white-space: nowrap;
}
.coltable td {
  padding: 5px 10px 5px 0;
  border-top: 1px solid #eef1f5;
}
/* a gap between each four parts, the same groups the preview draws */
.coltable .grpgap {
  padding-left: 14px;
}
.colpick.small {
  width: 32px;
  height: 24px;
}
.smallbtn {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
/* the mini plan and the controls, side by side, stacking on a narrow dialog */
.setbody {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
}
/* one setting per row: a name on the left, a segmented control on the right. The rows stack on
   a narrow dialog rather than squeezing the two-button controls. */
.setrows {
  display: flex;
  flex: 0 1 380px;
  flex-direction: column;
  gap: 8px;
}
.setrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.setlabel {
  font-weight: 600;
  font-size: 12px;
  min-width: 124px;
}
/* segmented control: two buttons in one pill, exactly one of them on. A radio group in effect,
   built from buttons because the state lives in the store and is written through setLabel
   rather than bound to a form value.
   A GRID of two equal halves, not a flex row: sized to their text, the five controls came out
   five different widths and none of the options lined up down the panel. */
.seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 232px;
  max-width: 100%;
  border: 1px solid #c4ccd6;
  border-radius: 7px;
  overflow: hidden;
  background: #fff;
}
.segbtn {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border: 0;
  border-radius: 0;
  background: #fff;
  color: #2f4368;
  white-space: nowrap;
}
.segbtn + .segbtn {
  border-left: 1px solid #c4ccd6;
}
.segbtn:hover:not(.on) {
  background: #eef1f5;
}
.segbtn.on {
  background: #2f4368;
  color: #fff;
}
.splitcards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.splitcard {
  border: 1px solid #e2e6ec;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fff;
  min-width: 180px;
}
.splitcard-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.splitname {
  font: inherit;
  font-weight: 600;
  width: 110px;
  padding: 3px 6px;
  border: 1px solid #c4ccd6;
  border-radius: 5px;
}
.splitdel {
  font-size: 11px;
  padding: 2px 6px;
}
.cats {
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;
}
.catchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.catname {
  font: inherit;
  font-size: 12px;
  width: 96px;
  padding: 2px 5px;
  border: 1px solid #c4ccd6;
  border-radius: 5px;
}
.catdel {
  width: 20px;
  height: 20px;
  line-height: 1;
  font-size: 13px;
  padding: 0;
  border: 1px solid #d8dde4;
  background: #f3f5f8;
  color: #8a93a0;
  border-radius: 4px;
}
.catdel:hover:not([disabled]) {
  background: #fbecea;
  color: #b4231a;
  border-color: #e0b4ae;
}
.catdel[disabled] {
  opacity: 0.4;
  cursor: default;
}
.catadd {
  font-size: 11px;
  padding: 2px 8px;
  margin-top: 2px;
}
.addsplit {
  margin-top: 10px;
}
/* on a narrow screen every control row becomes a two-column grid: the thing you choose from
   (the concert dropdown, the name field) takes a full line above buttons that then sit in
   even pairs. Wrapping flexbox gave ragged rows of differently-sized buttons; a grid makes
   every button the same width and the tap targets predictable. Everything also loses a few
   pixels of height, because the panels stack and what they spend comes straight out of the
   table's share of the dialog. */
@media (max-width: 640px) {
  .panel {
    padding: 9px 10px 11px;
  }
  .ctlrow,
  .presetinline {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  /* the full-width row above the pairs */
  .presetsel,
  .presetinput,
  .presetconfirmtext {
    grid-column: 1 / -1;
  }
  .presetsel {
    min-width: 0;
    max-width: none;
  }
  .presetinput {
    min-width: 0;
    max-width: none;
  }
  /* Presets is the one row with an odd number of buttons, so its last one — Delete — spans
     the pair rather than leaving a half-width gap beside it. */
  .presetctl > .pbtn:last-child {
    grid-column: 1 / -1;
  }
  .presetsel,
  .presetinput,
  .pbtn {
    height: 32px;
  }
  .pbtn {
    padding: 0 11px;
    font-size: 12.5px;
  }
  .ionote {
    margin-top: 8px;
    font-size: 11.5px;
    line-height: 1.4;
  }
  /* the settings panel stacks: the plan above, then full-width controls under their labels */
  .setbody {
    gap: 12px;
  }
  .seg {
    width: 100%;
  }
}
</style>
