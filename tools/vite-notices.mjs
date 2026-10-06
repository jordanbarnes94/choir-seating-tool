/*
 * vite-notices — THIRD-PARTY-NOTICES.txt, the copyright and licence text of other people's code
 * in the build.
 *
 * Their licences (MIT, BSD, ISC, Apache) ask for that text to travel with every copy, and
 * minifying strips it from the code. Nothing here is a list kept by hand: the file is written
 * from what this build holds.
 *
 *  - npm packages: every module Rollup rendered into a chunk, traced to its package.
 *  - The service worker: Workbox builds it after Vite's bundle is closed, so its packages cannot
 *    be traced. They are taken as `serviceWorker` and everything those depend on, and once the
 *    worker is written the stamps Workbox leaves in its code ("workbox:core:7.4.0") are
 *    checked against the list. A stamp that is not listed fails the build.
 *  - Code copied into the source (`vendored`): the comment holding its notice, read from the file.
 *  - The desktop app: under `tauri build` the Rust crates compiled into the program are added, by
 *    cargo-about (src-tauri/about.toml and about.hbs). A web build has no Rust in it and no such
 *    section.
 *
 * A package with no licence file fails the build unless it is named in `unlicensed`, and so does a
 * crate under a licence about.toml does not accept. `npm run dev` has no bundle to read, and serves a line saying so.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTICES = 'THIRD-PARTY-NOTICES.txt';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TAURI = join(ROOT, 'src-tauri');
const RULE = '-'.repeat(78);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

// The folder of the package a file belongs to: the nearest package.json above it with a name and
// a version. A package's build folders can hold a bare `{ "type": "module" }`, which is not it.
function packageDir(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name, version } = json(manifest);
    if (name && version) return dir;
  }
  return null;
}

// Where `name` resolves from inside the package at `from`, as Node would find it.
function dependencyDir(from, name) {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    const found = join(dir, 'node_modules', name);
    if (existsSync(join(found, 'package.json'))) return found;
  }
  throw new Error(`${NOTICES}: ${name} is not installed`);
}

function withDependencies(dir, out = new Set()) {
  if (out.has(dir)) return out;
  out.add(dir);
  for (const name of Object.keys(json(join(dir, 'package.json')).dependencies || {})) {
    withDependencies(dependencyDir(dir, name), out);
  }
  return out;
}

const person = (p) => (typeof p === 'string' ? p : [p?.name, p?.email && `<${p.email}>`].filter(Boolean).join(' '));

function describe(dir, unlicensed) {
  const { name, version, license, author, repository } = json(join(dir, 'package.json'));
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
  const licence = String(license || 'see below');
  if (files.length) return { name, version, licence, text: files.map((f) => tidy(readFileSync(join(dir, f), 'utf8'))).join('\n\n') };
  // No text to carry. What the package says of itself is all there is, and only for a package
  // that has been looked at and named.
  if (!unlicensed.includes(name) || !license) {
    throw new Error(`${NOTICES}: ${name} ${version} is in the build and has no licence file in ${dir}. If its package.json names a licence, add it to unlicensed in vite.config.js.`);
  }
  const text = [
    'This package is published without a licence file. Its package.json says:',
    `  license: ${licence}`,
    author && `  author: ${person(author)}`,
    repository && `  repository: ${repository.url || repository}`
  ].filter(Boolean).join('\n');
  return { name, version, licence, text };
}

// The comment in a source file that holds a notice, without its comment marks.
function vendoredNotice(file) {
  const comment = readFileSync(join(ROOT, file), 'utf8').match(/\/\*[\s\S]*?\*\//g)?.find((c) => /copyright/i.test(c));
  if (!comment) throw new Error(`${NOTICES}: ${file} has no comment with a copyright notice`);
  return tidy(comment.slice(2, -2).replace(/^[ \t]*\* ?/gm, ''));
}

// The crates in the desktop program, from Cargo.lock.
function crates(target) {
  const args = ['about', 'generate', '--locked', '--fail', '--manifest-path', join(TAURI, 'Cargo.toml'), '--config', join(TAURI, 'about.toml'), '--target', target, join(TAURI, 'about.hbs')];
  try {
    return tidy(execFileSync('cargo', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    const said = String(e.stderr || e.message).trim();
    const missing = /no such command/.test(said) ? '\nInstall it with: cargo install --locked cargo-about --features cli' : '';
    throw new Error(`${NOTICES}: cargo-about could not list the desktop app's crates.${missing}\n${said}`);
  }
}

function render(packages, vendored, rust) {
  // Most packages share a licence word for word. Each text is printed once, under all of them.
  const groups = new Map();
  for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    const key = p.licence + '\n' + p.text;
    if (!groups.has(key)) groups.set(key, { ...p, names: [] });
    groups.get(key).names.push(`${p.name} ${p.version}`);
  }
  const out = [
    'Third-party notices',
    '',
    'This copy of Choir Seating Tool includes software written by other people, under the licences',
    'below. Choir Seating Tool itself is under the GNU Affero General Public License, version 3; the',
    'Source link at the foot of the app leads to its source and its licence.'
  ];
  for (const g of groups.values()) {
    out.push('', RULE, ...g.names, `Licence: ${g.licence}`, RULE, '', g.text);
  }
  for (const v of vendored) {
    out.push('', RULE, v.name, `Copied into ${v.file}`, RULE, '', vendoredNotice(v.file));
  }
  if (rust) out.push('', RULE, 'The desktop app', RULE, '', rust);
  return out.join('\n') + '\n';
}

function scripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    if (f.isDirectory()) return scripts(join(dir, f.name));
    return f.name.endsWith('.js') ? [join(dir, f.name)] : [];
  });
}

/**
 * @param {{ serviceWorker: string[], vendored: { name: string, file: string }[], unlicensed: string[] }} options
 *   `serviceWorker`: the Workbox packages the generated worker is built from.
 *   `vendored`: source files that hold code copied in, with its notice in a comment.
 *   `unlicensed`: packages known to ship no licence file, listed by what their package.json says.
 */
export default function notices({ serviceWorker = [], vendored = [], unlicensed = [] } = {}) {
  let outDir;
  let listed;
  return {
    name: 'choir-notices',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_, bundle) {
      try {
        const dirs = new Set();
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const [id, module] of Object.entries(chunk.modules)) {
            if (!module.renderedLength || !id.includes('node_modules')) continue;
            const dir = packageDir(id.replace(/^\0+/, '').split('?')[0]);
            if (dir) dirs.add(dir);
          }
        }
        for (const name of serviceWorker) withDependencies(dependencyDir(ROOT, name), dirs);
        const packages = [...dirs].map((dir) => describe(dir, unlicensed));
        listed = new Set(packages.map((p) => p.name));
        const target = process.env.TAURI_ENV_TARGET_TRIPLE;
        this.emitFile({ type: 'asset', fileName: NOTICES, source: render(packages, vendored, target ? crates(target) : '') });
      } catch (e) {
        this.error(e.message);
      }
    },
    // After vite-plugin-pwa has written the worker in its own closeBundle.
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (!listed || !existsSync(outDir)) return;
        const missing = new Set();
        for (const file of scripts(outDir)) {
          // By name: the stamp is the version a package last changed at, which can trail its own.
          for (const [, name] of readFileSync(file, 'utf8').matchAll(/workbox:([a-z-]+):/g)) {
            if (!listed.has(`workbox-${name}`)) missing.add(`workbox-${name}`);
          }
        }
        if (missing.size) this.error(`${NOTICES} does not list ${[...missing].join(', ')}, which the build holds. Add it to serviceWorker in vite.config.js.`);
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split(/[?#]/)[0] !== `/${NOTICES}`) return next();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('npm run build writes this file, from what the build holds. The dev server has no build to read.\n');
      });
    }
  };
}
