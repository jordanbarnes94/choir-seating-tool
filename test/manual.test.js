/*
 * Tests for the user manual's built pages.
 *
 * Run: npm test    (plain `node --test`, no dependency and no config)
 *
 * A page's address is its folder, /manual/<slug>/, and the first page is at /manual/ as well, one
 * level higher. Everything a page names is relative, so the two depths need different links, and
 * a wrong one is a page with no stylesheet or a link that goes nowhere. The plugin checks what
 * the Markdown names. These check what the built pages name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderManual } from '../tools/vite-manual.mjs';

const MANUAL = fileURLToPath(new URL('../manual/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const { files, images } = renderManual('https://example.org/about/');
const slugs = readdirSync(MANUAL).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3));
const pages = [...files.keys()].filter((name) => name.endsWith('.html'));

test('every page is a folder, and the first is at manual/ too', () => {
  assert.deepEqual(pages.toSorted(), ['manual/index.html', ...slugs.map((s) => `manual/${s}/index.html`)].toSorted());
});

// Where a relative reference leads, as a path in the build with folders ending in a slash.
function resolve(from, ref) {
  const url = new URL(ref, `https://build.test/${from}`);
  return { path: url.pathname.slice(1), hash: url.hash.slice(1) };
}

test('everything a built page names is in the build', () => {
  const ids = (name) => [...files.get(name).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  for (const name of pages) {
    const refs = [...files.get(name).matchAll(/ (?:href|src|value)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 10, `${name} names its stylesheet, its contents and the app`);
    for (const ref of refs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue; // another site
      const { path, hash } = resolve(name, ref);
      const where = `${name}: ${ref}`;
      if (path === '') continue; // the app
      if (path.endsWith('/')) {
        assert.ok(files.has(path + 'index.html'), where);
        if (hash) assert.ok(ids(path + 'index.html').includes(hash), where);
      } else if (path.startsWith('manual/')) {
        assert.ok(files.has(path) || images.includes(path.slice('manual/'.length)), where);
      } else {
        // The app's own files, which Vite copies from public/.
        assert.ok(existsSync(PUBLIC + path), where);
      }
    }
  }
});
