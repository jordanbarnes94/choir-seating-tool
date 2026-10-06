import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import manual from './tools/vite-manual.mjs';
import notices from './tools/vite-notices.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Relative, so one build works at /projects/choir-seating/ on the website, or unzipped on any host.
  base: './',
  plugins: [
    vue(),
    manual({ homepage: pkg.homepage }),
    VitePWA({
      // A new version waits to be asked for (the notice in App.vue), or for the next launch. It
      // never reloads the page by itself: Choir setup can be holding an unsaved draft.
      registerType: 'prompt',
      // src/main.js registers the worker.
      injectRegister: false,
      manifest: {
        name: 'Choir Seating Tool',
        short_name: 'Choir Seating Tool',
        description: pkg.description,
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      // The glob below already takes the icons in.
      includeManifestIcons: false,
      workbox: {
        // Everything in the build: the app, its lazy spreadsheet chunk, the manual and its
        // screenshots, and the third-party notices. The plugin adds the web manifest itself.
        globPatterns: ['**/*.{js,css,html,png,svg,txt}'],
        // No client routing: a URL that is not a file is not the app.
        navigateFallback: null,
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
        cleanupOutdatedCaches: true
      }
    }),
    // After VitePWA: it checks the worker that plugin writes.
    notices({
      // What a worker that only precaches is built from.
      serviceWorker: ['workbox-precaching'],
      vendored: [{ name: "Tailwind CSS's preflight", file: 'src/base.css' }],
      // read-excel-file's worker helper: MIT by its package.json, published with no licence file.
      unlicensed: ['worker-f']
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_HOMEPAGE__: JSON.stringify(pkg.homepage),
    __APP_AUTHOR__: JSON.stringify(pkg.author),
    __APP_REPOSITORY__: JSON.stringify(pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''))
  },
  // IPv4, as the tools address it: `localhost` can resolve to ::1.
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' }
});
