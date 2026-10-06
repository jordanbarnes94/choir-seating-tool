/*
 * icons — rasterise the app's icons from their two SVG sources.
 *
 *   node tools/icons.mjs
 *
 * public/icon.svg is the icon as drawn, with rounded, see-through corners. public/icon-maskable.svg
 * is the same drawing full-bleed and smaller, for systems that cut icons to their own shape. Run
 * this after editing either. It draws each in a headless Chromium (the `playwright`
 * devDependency), so the PNGs come out as a browser renders the SVG.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
// The apple-touch-icon must be opaque, so it comes from the full-bleed source.
const OUTPUTS = [
  ['icon.svg', 192, 'icon-192.png'],
  ['icon.svg', 512, 'icon-512.png'],
  ['icon-maskable.svg', 512, 'icon-maskable-512.png'],
  ['icon-maskable.svg', 180, 'apple-touch-icon.png']
];

const browser = await chromium.launch();
try {
  for (const [source, size, name] of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = readFileSync(PUBLIC + source, 'utf8');
    await page.setContent(`<style>html, body { margin: 0; background: transparent; } svg { display: block; width: ${size}px; height: ${size}px; }</style>${svg}`);
    await page.screenshot({ path: PUBLIC + name, omitBackground: true });
    await page.close();
    console.log('  ' + name);
  }
} finally {
  await browser.close();
}
