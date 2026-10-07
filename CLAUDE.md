# Choir Seating Tool

A choir seating tool that runs entirely in the browser: a Vue 3 app that Vite builds into static
files, with a service worker so it installs and works offline. It is served at
`https://jordanbarnes.uk/projects/choir-seating/` by the author's website, which unpacks the latest
release's zip there when the website is published. This repository does not use GitHub Pages.

**Read `DEVELOPING.md` first**: it maps every file, the data model, the store, the solver, and the
rules that are easy to break. `README.md` is for people who use or host the app.

## Commands

- `npm run dev` is the dev server at `http://127.0.0.1:5173`, with the manual at `/manual/`.
- `npm run build` writes the static build into `dist/`: the app, the manual, the service worker and
  `THIRD-PARTY-NOTICES.txt` (other people's licence texts, written from what the build bundles by
  `tools/vite-notices.mjs`; see "Third-party notices" in `DEVELOPING.md` when it fails the build).
  `npm run preview` serves it.
- `npm test` runs `node --test "test/*.test.js"` and covers the pure `src/utils/`: persistence,
  plan factory and field list, singer ids, the concert library, colours, palettes, seat labels,
  seat preview, stage layout, export, print, walk-on list, spreadsheet import and the solver. It
  also checks the manual's built pages (`tools/vite-manual.mjs`). The glob is deliberate.
  `node --test` with no argument treats *every* file under `test/` as a test, which would run
  `test/fixtures/import/make-fixtures.mjs`.
- `node tools/store-smoke.mjs` drives the LIVE store headlessly, which `npm test` does not: it
  imports the store and runs it against stubbed browser globals. It is a tool, not a test. Run it
  after anything that touches `SCHEMA`, the stored shape or the seating array. It is the only
  automated check that reaches `restoreJSON`, `save()` and the bench.
- `node tools/lateral-check.mjs` measures the solver (laterals, stranded, broken, time). Run it
  after changing `src/utils/arranger.js`. Put the previous version at `.smoke/arranger-old.js`
  (gitignored) to compare the two: `git show HEAD:src/utils/arranger.js > .smoke/arranger-old.js`.
- `node tools/manual-shots.mjs` retakes the user manual's screenshots (`manual/*.png`) against a
  running `npm run dev`. Run it after changing anything the manual (`manual/*.md`) shows, and
  update the manual's text in the same change.
- `node tools/icons.mjs` redraws the icon PNGs in `public/` after either SVG there is edited.
- `npx tauri build --no-bundle` builds the desktop app, `src-tauri/target/release/Choir Seating Tool.exe`
  (it runs `npm run build` first; the first build takes several minutes). `npx tauri dev` runs it
  against the dev server. Both need Rust, and the build needs cargo-about to list the crates in the
  notices: `cargo install --locked cargo-about --features cli`. Without `--no-bundle` it builds the installer too, which
  needs the update signing key in `TAURI_SIGNING_PRIVATE_KEY`. Read "The desktop app" in
  `DEVELOPING.md` before changing `src-tauri/tauri.conf.json`: its `identifier` decides where
  people's work is kept, and its `pubkey` decides whose updates an installed copy accepts.

CI runs the tests, the store smoke tool and the build on every push.

## Releasing

A release is a version tag. `.github/workflows/release.yml` builds once and attaches that build to
a GitHub Release as `choir-seating-tool.zip`. It then builds the desktop app for Windows and adds
three files to the Release: the one-file app `Choir-Seating-Tool.exe`, its installer
`Choir-Seating-Tool-setup.exe`, and `latest.json`, which is what a desktop copy reads to learn
there is a newer version. The names are the same in every release, so
`https://github.com/jordanbarnes94/choir-seating-tool/releases/latest/download/<name>` is always
the newest, and the website's download page links to those.

1. Set `version` in `package.json`, run `npm install` so `package-lock.json` follows, commit, push,
   and wait for CI to pass.
2. Tag that commit `v<version>` and push the tag. The workflow fails if the tag and `package.json`
   disagree.
3. Check that the Release has the zip and the three desktop files, and that `latest.json` names
   the new version.
4. The web copy goes live when the website is next published: until then it stays on the release
   before. Afterwards, check that `https://jordanbarnes.uk/projects/choir-seating/version.json`
   shows the new version and commit.

People with the app open are told a new version is ready and choose when to reload. The desktop
app asks the latest Release as it opens: an installed copy offers to update itself, and the
one-file copy offers the download page.

The installer is signed with a key that is not in the repository: the private half is the
repository secret `TAURI_SIGNING_PRIVATE_KEY`, and the author's own copy. An installed copy takes
updates signed with that key only, so if it is lost, no copy already installed can ever update.

## People's data

The app is live, and its users' choirs are in their browsers' `localStorage`. The storage keys (`LS`
in `src/utils/persistence.js`, and `choir-folds` in `ChoirArranger.vue`) and `SCHEMA` do not change
without deciding what happens to that data. See "Change the stored shape" in `DEVELOPING.md`.

## Tooltips

Use `data-tip="…"` on a control, not `title`. `TipLayer.vue` shows it styled and quickly on hover
or keyboard focus. Longer explanations go in the manual.

## Touch screens

Drag and drop works on touch (long-press, then drag), and that is as far as touch support needs to
go. Hover-only things (tooltips, pointing at a neighbour check entry) need no touch equivalent.

## Contributions

Code from anyone but the author is not merged without an agreement that lets the author relicense
it (`README.md`, "Contributing").
