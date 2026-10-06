# Choir Seating Tool

Choir Seating Tool arranges a choir on stage so that every singer sits next to someone singing the same
part, in every piece of the concert at once. You set up your choir, it works out a seating, and you
adjust it by hand.

**Use it at <https://jordanbarnes.uk/projects/choir-seating/>.**

**Read the [user manual](manual/README.md).** In the app, open it with the **Manual** link at the
bottom of the page.

![The arranger with a concert open](manual/overview.png)

- Seats the whole stage so that each singer keeps a neighbour from their section and from each way
  the sections are split, and shows you anyone it could not manage that for.
- Drag singers to swap them, lock the ones who must stay put, and block chairs nobody can sit in.
- Several seating plans per concert, side by side to compare.
- A walk-on order, printing, PDF, and spreadsheet import and export.
- It runs in your browser. There is no account and nothing is sent anywhere: your choir is saved in
  your browser, on your device.

## Install it

The hosted copy can be installed like an app: it opens in a window of its own, and works offline
once it has been opened. In Chrome or Edge, click **Install app** at the top of the page. The
manual's [Settings and backup](manual/settings-and-backup.md) page covers other browsers, and how
to move your work between devices with a backup file.

## Download it for Windows

Every [release](https://github.com/jordanbarnes94/choir-seating-tool/releases/latest) also has the app
for Windows 10 and 11, in a window of its own, in two forms:

- `Choir-Seating-Tool.exe` is one file with nothing to install: double-click it. When a newer version
  is out it says so, and you download the new file in its place.
- `Choir-Seating-Tool-setup.exe` installs it, with a Start menu entry, and it then updates itself.

Neither is signed with a paid certificate, so Windows may say "Windows protected your PC" the first
time: click **More info**, then **Run anyway**. Your choirs are kept on your computer, separately
from any in your browser, and stay where they are when the app is updated or replaced.

## Host it yourself

Every [release](https://github.com/jordanbarnes94/choir-seating-tool/releases/latest) has a zip of the
built app. It is a folder of static files and needs nothing but something to serve them.

1. Download `choir-seating-tool.zip` from the latest release and unzip it.
2. Put the `choir-seating-tool` folder on any web server or static host. It works under any path.
3. Open it over `https://`. On your own computer, `http://localhost` works too: run
   `python -m http.server` in the folder and open the address it prints. Opening `index.html`
   straight from the disk does not work.

A choir is saved under the address it was made at, so a copy you host starts empty. To bring your
work across, use **Save backup file** and **Restore from backup** in **Settings**.

`version.json` in the folder says which version and commit a copy was built from. The hosted copy
is the same build as the zip.

## Build it from source

It needs [Node.js](https://nodejs.org/) 24.

```sh
npm ci
npm run dev      # http://127.0.0.1:5173
npm test
npm run build    # the static build, in dist/
```

What is in the repository:

| Folder | What it is |
|---|---|
| `src/` | the app |
| `manual/` | the user manual: Markdown pages, their screenshots, and the page template |
| `public/` | files copied into the build as they are: the icons and `app-window.js` |
| `src-tauri/` | the desktop app: a small Rust shell that shows the build in a window of its own |
| `test/` | the automated tests and their fixture files |
| `tools/` | scripts run by hand, and the plugins that build the manual and the third-party notices |
| `.github/` | the workflows: checks on every push, and a release on a version tag |

[DEVELOPING.md](DEVELOPING.md) maps the code file by file.

## Licence

Copyright © 2026 Jordan Barnes.

Choir Seating Tool is free software, released under the
[GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`). You may use it, change
it and share it, on your own server too. If you share it, or let other people use a copy you have
changed over a network, you must offer them the source of your version under the same licence. The
**Source** link at the foot of the app is that offer: a changed copy should point it at its own
source, which is the `repository` in `package.json`.

It comes with no warranty.

It is built with other people's software, under licences of their own (MIT, BSD and the like). The
build writes their copyright notices and licence texts into `THIRD-PARTY-NOTICES.txt`, from what it
actually bundles, and the **Licences** link at the foot of the app opens that file. The desktop
app's copy also covers the Rust crates compiled into it.

**A commercial licence is available** for anyone who wants to use Choir Seating Tool outside those
terms. [Get in touch with the author](https://jordanbarnes.uk/contact/).

## Contributing

Bug reports and ideas are welcome as
[issues](https://github.com/jordanbarnes94/choir-seating-tool/issues).

Code from other people is not merged without an agreement that lets the author relicense it. The
commercial licence above depends on the author owning all of the code, so please open an issue
before writing a pull request.
