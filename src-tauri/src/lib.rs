//! Choir Seating Tool in a window of its own: the web app's build, shown in the system's web view.
//!
//! The app is the same files the website serves. All this adds is the window, a second one for
//! the manual, and the rule that neither can be taken anywhere else: a link out of the app opens
//! in the browser.

use tauri::{
  webview::NewWindowResponse, AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder,
  WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const APP: &str = "main";
const MANUAL: &str = "manual";

/// Other people's licence texts, which the footer's Licences link opens (tools/vite-notices.mjs).
const NOTICES: &str = "/THIRD-PARTY-NOTICES.txt";

/// Where a copy that cannot update itself sends its user for the new one.
const DOWNLOAD_PAGE: &str = "https://jordanbarnes.uk/projects/choir-seating/download/";

/// Marks `<html>` so the page drops the bar back to the website, as an installed copy does in a
/// browser. There it is told by `display-mode`, which a web view never reports as standalone.
/// The script runs before the document has an element, hence the observer.
///
/// It also removes the service worker and its caches. Version 0.9.0 registered one, as the website
/// does, and every version of the program shares one address and one storage: the worker served
/// the files it had cached from whichever version ran first, so a newer program opened showing
/// an older app. A page that came from the worker is loaded again, from the program this time.
/// `localStorage`, where people's work is, is not touched.
const APP_WINDOW: &str = r#"(() => {
  try {
    if (navigator.serviceWorker && location.hostname === 'tauri.localhost') {
      const served = !!navigator.serviceWorker.controller;
      Promise.all([
        navigator.serviceWorker.getRegistrations().then((all) => Promise.all(all.map((r) => r.unregister()))),
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      ]).then(() => { if (served) location.reload(); }, () => {});
    }
  } catch {}
  const mark = () => document.documentElement.classList.add('app-window');
  if (document.documentElement) return mark();
  new MutationObserver((_, o) => {
    if (document.documentElement) { o.disconnect(); mark(); }
  }).observe(document, { childList: true });
})();"#;

/// Whether a URL is one of the app's own files rather than somewhere on the web.
fn in_app(url: &Url) -> bool {
  match url.scheme() {
    "tauri" => true,
    _ => {
      let host = url.host_str();
      host == Some("tauri.localhost") || (cfg!(dev) && host == Some("127.0.0.1"))
    }
  }
}

/// What the second window shows: the manual, and the notices for other people's code.
fn in_manual(url: &Url) -> bool {
  in_app(url) && (url.path().starts_with("/manual/") || url.path() == NOTICES)
}

fn open_in_browser(app: &AppHandle, url: &Url) {
  let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

fn focus(app: &AppHandle, label: &str) {
  if let Some(window) = app.get_webview_window(label) {
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

/// Whether this copy was put here by the installer, which leaves its uninstaller beside it. The
/// other kind is the one file somebody downloaded and runs from wherever they keep it.
fn installed() -> bool {
  std::env::current_exe()
    .ok()
    .and_then(|exe| exe.parent().map(|folder| folder.join("uninstall.exe").exists()))
    .unwrap_or(false)
}

fn ask(app: &AppHandle, message: String, yes: &str) -> bool {
  let mut dialog = app
    .dialog()
    .message(message)
    .title("Choir Seating Tool")
    .kind(MessageDialogKind::Info)
    .buttons(MessageDialogButtons::OkCancelCustom(yes.into(), "Later".into()));
  if let Some(window) = app.get_webview_window(APP) {
    dialog = dialog.parent(&window);
  }
  dialog.blocking_show()
}

/// Asks the latest release whether it is newer than this copy, once, as the app opens. An
/// installed copy offers to update itself: the installer runs over it and starts it again. The
/// one-file copy cannot replace itself, so it offers the download page. Either way the user is
/// asked first, because Choir setup can be holding an unsaved draft, and no answer, no network
/// and no release all leave the app as it is. Nothing here touches the user's work, which is in
/// the web view's storage and not beside the program.
fn check_for_update(app: AppHandle) {
  tauri::async_runtime::spawn(async move {
    let mut updater = app.updater_builder();
    // A debug build can be pointed at a release file somewhere else, to try this out.
    #[cfg(debug_assertions)]
    if let Some(url) = std::env::var("CHOIR_SEATING_UPDATE_URL").ok().and_then(|u| u.parse().ok()) {
      updater = match updater.endpoints(vec![url]) {
        Ok(updater) => updater,
        Err(_) => return,
      };
    }
    let Ok(updater) = updater.build() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    let version = &update.version;

    if !installed() {
      let message = format!(
        "An update is available.\n\nCurrent version: {}\nLatest version: {version}\n\nDownload the latest version by clicking the button below. Your existing choirs will not be affected.",
        update.current_version
      );
      if ask(&app, message, "Download") {
        let _ = app.opener().open_url(DOWNLOAD_PAGE, None::<&str>);
      }
      return;
    }

    let message = format!(
      "An update is available.\n\nCurrent version: {}\nLatest version: {version}\n\nUpdate by clicking the button below. Choir Seating Tool will close and open again. Your existing choirs will not be affected.",
      update.current_version
    );
    if !ask(&app, message, "Update") {
      return;
    }
    // On Windows the installer ends this program itself, and starts the new one when it is done.
    match update.download_and_install(|_, _| {}, || {}).await {
      Ok(()) => app.restart(),
      Err(error) => {
        app
          .dialog()
          .message(format!("The update could not be installed.\n\n{error}"))
          .title("Choir Seating Tool")
          .kind(MessageDialogKind::Error)
          .blocking_show();
      }
    }
  });
}

/// What both windows share.
fn window<'a, R: Runtime, M: Manager<R>>(
  manager: &'a M,
  label: &str,
  url: WebviewUrl,
) -> WebviewWindowBuilder<'a, R, M> {
  let builder = WebviewWindowBuilder::new(manager, label, url).initialization_script(APP_WINDOW);
  // A debug build can be driven by a test over `--remote-debugging-port`. The loader Tauri uses
  // does not read WebView2's own WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, so this stands in for it.
  #[cfg(debug_assertions)]
  if let Ok(args) = std::env::var("CHOIR_SEATING_BROWSER_ARGS") {
    return builder.additional_browser_args(&args);
  }
  builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Used from here only. Left on, its script takes every `target="_blank"` click in the page
    // for itself, and the manual's link would never ask for its window.
    .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      let handle = app.handle().clone();
      check_for_update(handle.clone());
      let navigating = handle.clone();
      window(app, APP, WebviewUrl::App("index.html".into()))
        .title("Choir Seating Tool")
        .inner_size(1280.0, 860.0)
        .min_inner_size(480.0, 400.0)
        .on_navigation(move |url| {
          if in_app(url) {
            return true;
          }
          open_in_browser(&navigating, url);
          false
        })
        // The manual, the source link and the notices ask for a window of their own.
        .on_new_window(move |url, features| {
          if !in_manual(&url) {
            if !in_app(&url) {
              open_in_browser(&handle, &url);
            }
            return NewWindowResponse::Deny;
          }
          // One manual window: asked for again, it comes forward on the page asked for.
          if let Some(manual) = handle.get_webview_window(MANUAL) {
            let _ = manual.navigate(url);
            focus(&handle, MANUAL);
            return NewWindowResponse::Deny;
          }
          let back = handle.clone();
          let manual = window(&handle, MANUAL, WebviewUrl::External("about:blank".parse().unwrap()))
            .window_features(features)
            .title("Choir Seating Tool - Manual")
            .inner_size(1100.0, 800.0)
            .min_inner_size(360.0, 400.0)
            // A manual page is titled "<page> - Choir Seating Tool Manual": the page first, for a
            // browser tab that cuts it short. A window bar shows it all, so the name leads. The
            // notices are a text file with no title, which the web view names by its address.
            .on_document_title_changed(|window, title| {
              let title = match title.strip_suffix(" - Choir Seating Tool Manual") {
                Some(page) => format!("Choir Seating Tool - Manual - {page}"),
                None if window.url().is_ok_and(|url| url.path() == NOTICES) => "Choir Seating Tool - Licences".into(),
                None => title,
              };
              let _ = window.set_title(&title);
            })
            // "Open Choir Seating Tool" in the manual brings the app's window forward. It does not
            // start a second copy of the app in this one.
            .on_navigation(move |url| {
              if in_manual(url) || url.scheme() == "about" {
                return true;
              }
              if in_app(url) {
                focus(&back, APP);
              } else {
                open_in_browser(&back, url);
              }
              false
            })
            .build();
          match manual {
            Ok(window) => NewWindowResponse::Create { window },
            Err(_) => NewWindowResponse::Deny,
          }
        })
        .build()?;
      Ok(())
    })
    // Closing the app's window closes the manual's with it, and the program ends as it does
    // when its last window goes: in its own time, with the web view's storage written out.
    .on_window_event(|window, event| {
      if window.label() == APP && matches!(event, WindowEvent::CloseRequested { .. }) {
        if let Some(manual) = window.app_handle().get_webview_window(MANUAL) {
          let _ = manual.close();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running Choir Seating Tool");
}
