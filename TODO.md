# To do

## The desktop app's manual window shows a 404 on a machine with a web server on port 80

Found on 7 October 2026 in the released 1.0.1, and present in the released 1.0.0 too. Not fixed.

### What happens

Clicking **Manual** in the desktop app (or "Read the full user manual" in Getting started) opens
the manual's window on a page titled "404 Not Found": "The requested URL was not found on this
server." Clicking **Manual** a second time, with that window still open, loads the manual.

On a machine with nothing listening on port 80 the manual opens first time (seen by the author on
a second machine, not measured with the script below).

### To see it

```
npx tauri build --debug --no-bundle
pwsh tools/desktop-manual-check.ps1
```

The script starts the app on a throwaway web view folder, clicks **Manual** twice through Windows
UI Automation, and prints the manual window's title after each click and whether anything is
listening on port 80. `-Exe <path>` points it at a downloaded `Choir-Seating-Tool.exe` or an
installed copy instead. On the machine where this was found (Apache on port 80) it printed, three
runs out of three:

```
Something is listening on port 80 here: True
After the first click:  404 Not Found
After the second click: Choir Seating Tool - Manual - Getting started
The manual did NOT open first time.
```

### What is established

* The 404 page is the local web server's, not the app's. Apache's access log had the app's
  requests in it: `GET /manual/` and `GET /manual/getting-started/`, from `::1`. The app's address
  is `http://tauri.localhost/`, and `*.localhost` is this machine, so a request the app does not
  answer itself goes to whatever is on port 80.
* Only the first load of a newly made manual window gets out. That load is the one WebView2
  performs itself, into the window `on_new_window` hands back with
  `NewWindowResponse::Create { window }` (`src-tauri/src/lib.rs`). The second click takes the
  other branch there, `manual.navigate(url)` on the window that already exists, and is answered
  from the program's files.
* The manual's pages are in the program and are served correctly: `fetch('/manual/')` from the
  app's own window returns the page, and Tauri's asset lookup resolves a folder address to its
  `index.html` (`get_asset` in tauri 2.12.1, `src/manager/mod.rs`).
* It is not the change of the manual's addresses in 1.0.1. 1.0.0 does the same, and
  `/manual/`, which both versions link to, is one of the addresses that got out.
* It is not a service worker. The desktop app registers none, and the web view's folder for
  `uk.jordanbarnes.choir-seating-tool` holds none.
* It does not show when the app is started with `CHOIR_SEATING_BROWSER_ARGS` set to
  `--remote-debugging-port=<port>` (a debug build driven by Playwright over CDP): the manual
  opens first time. So a test written the way "To drive it from a test" in `DEVELOPING.md`
  describes passes on a machine where the app as shipped fails.

### What is not known

* Why the first load of a handed-over window is not offered to the app's file handler. wry
  0.57.0 attaches its `WebResourceRequested` filter (`http://tauri.*`) to every web view it makes
  (`attach_custom_protocol_handler`, `src/webview2/mod.rs`), so either the filter is not yet in
  place when WebView2 starts that navigation, or WebView2 does not raise the event for it.
* Why a machine with nothing on port 80 shows the manual. One guess: the request fails there, is
  tried again, and the second try is answered by the app. Running the script on such a machine
  would say whether the first click really succeeds there.
* Why the remote debugging port hides it. Setting `additional_browser_args` replaces the
  arguments Tauri passes by default, and it may also change the timing.
* Whether it worked in an earlier build of the desktop app on this machine. Under `npx tauri dev`
  the pages come from the dev server over real HTTP, so nothing needs intercepting and the fault
  cannot show.

### Ways to fix it

1. **Make the manual's window ourselves.** In `on_new_window`, answer `NewWindowResponse::Deny`
   and build the window from our code with the address asked for, so every load goes the way the
   second click already does. Check whether a window can be built from inside that handler on
   Windows, or has to be built after it returns.
2. **Keep the window WebView2 makes, and send it to the page again** once it exists. Smaller, but
   the 404 may show for a moment, and it leans on behaviour that is not understood.

Either way, `tools/desktop-manual-check.ps1` on a machine with a server on port 80 is the check
that it is fixed.
