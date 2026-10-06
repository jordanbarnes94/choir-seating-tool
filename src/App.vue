<template>
  <div class="topbar">
    <a :href="homepage" class="back-link"><span class="back-arrow" aria-hidden="true">←</span>About Choir Seating Tool</a>
    <div class="topbar-end">
      <button
        v-if="installPrompt && !update.ready"
        type="button"
        class="install"
        data-tip="Install Choir Seating Tool on this device, so you can use it offline."
        @click="install"
      >
        Install app
      </button>
      <!-- Asked, never automatic: a reload would throw away an unsaved draft in Choir setup. -->
      <p v-if="update.ready" class="newversion" role="status">
        A new version is ready.
        <button type="button" @click="update.apply()">Reload</button>
      </p>
    </div>
  </div>
  <main class="choir-page">
    <div class="choir-pagebody">
      <ChoirArranger />
    </div>
    <!-- The source link and the version are how a hosted copy says what it is running, and
         Licences is the notices other people's code in it asks for (tools/vite-notices.mjs). The
         links open a window of their own: nothing in the footer takes the app's window away. -->
    <footer class="pagefoot">
      <a href="manual/" target="_blank">Manual</a>
      <span aria-hidden="true">·</span>
      <a :href="repository" target="_blank" rel="noopener">Source</a>
      <span aria-hidden="true">·</span>
      <a href="THIRD-PARTY-NOTICES.txt" target="_blank">Licences</a>
      <span aria-hidden="true">·</span>
      <span>Version {{ version }}</span>
      <span aria-hidden="true">·</span>
      <span>Made by <a :href="authorSite" target="_blank" rel="noopener">{{ author }}</a></span>
    </footer>
  </main>
</template>

<script setup>
import { shallowRef } from 'vue';
import ChoirArranger from './components/ChoirArranger.vue';

defineProps({
  // { ready, apply() }: whether a newer build is waiting, and the reload that starts it.
  update: { type: Object, required: true }
});

const homepage = __APP_HOMEPAGE__;
// The author's website is the one the about page is on.
const author = __APP_AUTHOR__;
const authorSite = new URL('/', homepage).href;
const repository = __APP_REPOSITORY__;
const version = __APP_VERSION__;

// Chrome and Edge hand over their install prompt when the app can be installed and is not yet.
// No other browser does, so the button is theirs alone; the manual says how to install elsewhere.
const installPrompt = shallowRef(null);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt.value = e;
});
window.addEventListener('appinstalled', () => { installPrompt.value = null; });

function install() {
  // A prompt can be shown once. The browser hands over another if this one is turned down.
  const prompt = installPrompt.value;
  installPrompt.value = null;
  prompt.prompt();
}
</script>

<style scoped>
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 3rem;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid #1e293b;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  color: #9ca3af;
  text-decoration: none;
  font-size: 0.875rem;
  padding: 0.4rem 0.6rem;
  border-radius: 0.375rem;
  transition: color 0.15s, background 0.15s;
}

.back-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}

.back-arrow {
  font-size: 1.1em;
  line-height: 1;
}

.topbar-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.install {
  padding: 0.3rem 0.8rem;
  border: 1px solid #475569;
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  font-weight: 400;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.install:hover {
  border-color: #94a3b8;
  background: rgba(255, 255, 255, 0.06);
}

.newversion {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
  font-weight: 400;
}

.newversion button {
  padding: 0.3rem 0.8rem;
  border-radius: 0.375rem;
  background: #2563eb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.newversion button:hover {
  background: #1d4ed8;
}

/* The dark canvas the app's card sits on, clear of the fixed bar. */
.choir-page {
  min-height: 100vh;
  padding-top: 4rem;
  background-color: oklch(20.8% 0.042 265.755);
}

.choir-pagebody {
  padding: 1.5rem;
}

.pagefoot {
  display: flex;
  justify-content: center;
  gap: 0.6rem;
  padding: 0 1.5rem 1.5rem;
  font-size: 0.8rem;
  color: #94a3b8;
}

.pagefoot a {
  color: inherit;
  text-decoration: none;
}

.pagefoot a:hover {
  color: #e2e8f0;
  text-decoration: underline;
}

/* ---------- in a window of its own ----------
   An installed copy, or the desktop app (public/app-window.js marks <html>), is not a page of
   the website. There is no link back, and no bar at all unless a new version is waiting to be
   announced in it. And the app is the window: it fills it, white to the edges, with no dark
   page round a card. ChoirArranger.vue takes the card's border and corners off. */
:root.app-window .back-link {
  display: none;
}
:root.app-window .topbar:not(:has(.newversion)) {
  display: none;
}
:root.app-window .choir-page {
  padding-top: 3rem;
  background-color: #fff;
}
:root.app-window .topbar:not(:has(.newversion)) + .choir-page {
  padding-top: 0;
}
:root.app-window .choir-pagebody {
  padding: 0;
}
:root.app-window .pagefoot {
  padding: 0.9rem 1.5rem;
  border-top: 1px solid #e2e6ec;
  color: #64748b;
}
:root.app-window .pagefoot a:hover {
  color: #1d2330;
}
</style>

<style>
/* The window itself, when the app has one to itself: light like the app in it, where on the
   website it is the dark page's. Global, because it reaches <html>, <body> and every scrollbar.
   Here and not in base.css, which the manual's pages share: they keep their dark page. */
:root.app-window {
  color-scheme: light;
}
:root.app-window,
:root.app-window body {
  background-color: #fff;
}
:root.app-window ::-webkit-scrollbar-track {
  background: #f1f5f9;
}
:root.app-window ::-webkit-scrollbar-thumb {
  background: #cbd5e1;
}
:root.app-window ::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* ---------- print ----------
   The page shell's half of the printed sheet. ChoirArranger.vue has the app's half and
   PlanSheet.vue the sheet itself.

   Three things on the shell would otherwise reach the paper. The dark canvas, which is only
   visible at all when the user ticks "Background graphics" — which the seating plan needs them
   to do, so it cannot simply be left to the default. The top bar, which is `position: fixed`
   and so prints at least once and, in some engines, on every page. And the shell's own padding
   and footer, which would push the plan in from the `@page` margin and out the other side,
   costing exactly the "one sheet, always" promise the scale arithmetic is there to keep.

   Global, not scoped, because it reaches <html> and <body>. */
@media print {
  :root {
    color-scheme: light !important;
  }
  html,
  body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    /* The whole document on ChoirArranger's named page, not just .choir-app. A change of page
       name forces a page break, so anything left on the default page would add a blank one. */
    page: choir;
  }
  .topbar,
  .pagefoot {
    display: none !important;
  }
  .choir-page {
    background: #fff !important;
    min-height: 0 !important;
    padding-top: 0 !important;
  }
  .choir-pagebody {
    padding: 0 !important;
  }
}
</style>
