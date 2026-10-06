import './base.css';
import { createApp, reactive } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';

// The service worker keeps the app working offline. When it has fetched a newer build, App.vue
// says so and offers to reload; until then the page stays on the build it opened with.
//
// Not in the desktop app, whose files are in the program. Every version of it runs at the same
// address on the same storage, so a worker there would hand one version's program the files it
// cached from another's. src-tauri/src/lib.rs removes a worker an earlier version left.
const update = reactive({ ready: false, apply: () => {} });
if (location.hostname !== 'tauri.localhost') {
  const activate = registerSW({ onNeedRefresh: () => { update.ready = true; } });
  update.apply = () => activate(true);
}

createApp(App, { update }).mount('#app');
