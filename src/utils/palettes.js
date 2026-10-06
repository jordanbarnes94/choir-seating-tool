/*
 * palettes — the colour schemes. Pure: plain functions over plain data, so `node --test` reaches
 * all of it. See test/palettes.test.js.
 *
 * Colours are GLOBAL, not plan data: changing concert or seating plan never changes them. A user
 * can keep several named schemes and switch between them; exactly one is active, and what the
 * stage, the reference panes, print and export paint with is the active one.
 *
 *   { active: 'p1', schemes: [{ id: 'p1', name: 'Default', colours, splitColours }, …] }
 *
 * `colours` and `splitColours` are the sparse override maps described in utils/arranger.js
 * (normaliseColours / normaliseSplitColours): absent means the app's default.
 */
import { LIMITS, SECTIONS, nextId, normaliseColours, normaliseSplitColours, validSectionColour } from './arranger.js';

export const SCHEME_ID_PREFIX = 'p';

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** A scheme with no overrides: the app's own colours. */
export function defaultPalettes() {
  return { active: 'p1', schemes: [{ id: 'p1', name: 'Default', colours: {}, splitColours: {} }] };
}

/** One scheme, cleaned, or null when it is not one. */
export function normaliseScheme(raw) {
  if (!raw || typeof raw !== 'object' || !nonEmpty(raw.id)) return null;
  return {
    id: raw.id,
    name: nonEmpty(raw.name) ? raw.name : 'Colours',
    colours: normaliseColours(raw.colours),
    splitColours: normaliseSplitColours(raw.splitColours)
  };
}

/**
 * The whole block. Malformed schemes are dropped and duplicate ids keep the first; there is
 * always at least one scheme, and `active` always names one of them.
 */
export function normalisePalettes(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const schemes = [];
  for (const s of Array.isArray(src.schemes) ? src.schemes : []) {
    const rec = normaliseScheme(s);
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    schemes.push(rec);
  }
  if (!schemes.length) return defaultPalettes();
  return { active: seen.has(src.active) ? src.active : schemes[0].id, schemes };
}

/** The scheme being painted with. */
export const activeScheme = (palettes) => palettes.schemes.find((s) => s.id === palettes.active) || palettes.schemes[0];

/**
 * A new scheme for `palettes`, not yet added to it. `from` is a scheme to copy the colours of
 * ("Save as…") — a scheme or a bare `{ colours, splitColours }` pair; without it the new
 * scheme starts on the app's defaults.
 */
export function makeScheme(palettes, name, from = null) {
  return {
    id: nextId(SCHEME_ID_PREFIX, palettes.schemes.map((s) => s.id)),
    name: nonEmpty(name) ? name.trim() : 'Colours',
    colours: normaliseColours(from && from.colours),
    splitColours: normaliseSplitColours(from && from.splitColours)
  };
}

/* ---------- editing a scheme's colours ----------
 * Each takes a `{ colours, splitColours }` pair and returns a new one, or the same pair when
 * nothing changes, so the Colours panel can edit a draft and save it whole. */

/**
 * One section's colour. Guarded: the picker can only produce a six-digit hex, so anything else
 * arrived from somewhere that has no business writing a scheme.
 *
 * Setting a section to EXACTLY its default is stored as an override rather than dropped, on
 * purpose: `<input type="color">` hands a value back for merely opening and closing it, so
 * dropping it would make "I looked and kept it" indistinguishable from "reset", and the Reset
 * button would light up and down under the user. It paints identically either way.
 */
export function withSectionColour(pair, section, hex) {
  if (!SECTIONS.includes(section) || !validSectionColour(hex)) return pair;
  if (pair.colours[section] === hex.toLowerCase()) return pair;
  return { ...pair, colours: normaliseColours({ ...pair.colours, [section]: hex }) };
}

/**
 * A section back on the default. A DELETE, not a write of the default hex: reset means "whatever
 * the app's default is", which has to stay true after the default next moves.
 */
export function withoutSectionColour(pair, section) {
  if (!(section in pair.colours)) return pair;
  const colours = { ...pair.colours };
  delete colours[section];
  return { ...pair, colours };
}

/** One frame, for one section at one category position. Guarded and stored like a section colour. */
export function withSplitColour(pair, section, i, hex) {
  if (!SECTIONS.includes(section) || !Number.isInteger(i) || i < 0 || i >= LIMITS.cats) return pair;
  if (!validSectionColour(hex)) return pair;
  if (pair.splitColours[section]?.[i] === hex.toLowerCase()) return pair;
  return {
    ...pair,
    splitColours: normaliseSplitColours({ ...pair.splitColours, [section]: { ...pair.splitColours[section], [i]: hex } })
  };
}

/** Every frame of one section back on the derived default, again by deleting. */
export function withoutSectionSplitColours(pair, section) {
  if (!(section in pair.splitColours)) return pair;
  const splitColours = { ...pair.splitColours };
  delete splitColours[section];
  return { ...pair, splitColours };
}

/** Whether a section (or, with none, any section) has a colour or frame chosen by hand. */
export function hasCustomColours(pair, section) {
  if (!section) return Object.keys(pair.colours).length > 0 || Object.keys(pair.splitColours).length > 0;
  return section in pair.colours || Object.keys(pair.splitColours[section] || {}).length > 0;
}
