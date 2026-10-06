// Marks <html> with `app-window` when the page is in a window of its own, as an installed copy
// is, and not in a browser tab. The styles that tell the app from a page of the website hang off
// that class. Loaded in <head>, before anything is drawn, by the app and by every manual page.
//
// The desktop app's web view never reports display-mode as standalone, so it sets the same
// class itself (src-tauri/src/lib.rs). That is why this only ever adds it.
(function (standalone) {
  function mark() {
    if (standalone.matches) document.documentElement.classList.add('app-window');
  }
  mark();
  // Installing moves an open tab into its new window without loading it again.
  standalone.addEventListener('change', mark);
})(matchMedia('(display-mode: standalone)'));

// The link back goes to the published about page. A copy of the whole site served from this
// machine has an about page of its own, so there the link stays on the copy. Served by itself at
// the root of a port, the tool has no such page beside it and keeps the published one.
(function (root) {
  if (['127.0.0.1', 'localhost'].indexOf(root.hostname) < 0 || root.pathname === '/') return;
  addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a.back-link').forEach(function (a) {
      a.href = new URL(a.href).pathname;
    });
  });
})(new URL('.', document.currentScript.src));
